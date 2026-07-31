/**
 * Bun server: serves the game, the hidden upload page, and the audio files.
 */

import { stat } from "node:fs/promises";
import index from "../client/index.html";
import admin from "../client/admin.html";
import { ASSIGNMENT_ORDER, MAX_COLLECTIBLES, treasureById } from "../game/treasures.ts";
import {
  checkPassword,
  clearCookie,
  isAuthed,
  passwordConfigured,
  sessionCookie,
} from "./auth.ts";
import {
  addRecording,
  audioPath,
  deleteRecording,
  effectiveCount,
  readManifest,
  recordBoot,
  renameRecording,
  storageStatus,
  update,
  type Manifest,
  type StorageStatus,
} from "./store.ts";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_UPLOAD = 25 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/flac": ".flac",
  "video/mp4": ".m4a",
  "video/webm": ".webm",
};

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, { headers: { "cache-control": "no-store" }, ...init });

/** Public game configuration: which treasure unlocks whose voice. */
async function handleGameConfig(): Promise<Response> {
  const m = await readManifest();
  const count = effectiveCount(m);

  if (count === 0) {
    // Nothing uploaded yet — hand back a playable demo so the game can be
    // tested before the recordings arrive.
    const demoCount = Math.min(Math.max(m.collectibleCount ?? 6, 1), MAX_COLLECTIBLES);
    return json({
      demo: true,
      playerName: m.playerName,
      collectibles: ASSIGNMENT_ORDER.slice(0, demoCount).map((treasureId, i) => ({
        id: `demo-${i}`,
        treasureId,
        name: `Demo message ${i + 1}`,
        relation: "no recording uploaded yet",
        audioUrl: null,
      })),
    });
  }

  return json({
    demo: false,
    playerName: m.playerName,
    collectibles: m.recordings.slice(0, count).map((rec, i) => ({
      id: rec.id,
      treasureId: ASSIGNMENT_ORDER[i]!,
      name: rec.name,
      relation: rec.relation,
      audioUrl: `/api/audio/${rec.id}`,
    })),
  });
}

async function handleAudio(req: Request, id: string): Promise<Response> {
  const m = await readManifest();
  const rec = m.recordings.find((r) => r.id === id);
  if (!rec) return new Response("Not found", { status: 404 });

  const path = audioPath(rec);
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });

  const size = (await stat(path)).size;
  const range = req.headers.get("range");
  const headers: Record<string, string> = {
    "content-type": rec.mime || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  };

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${size}` },
        });
      }
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}` },
      });
    }
  }

  return new Response(file, { headers: { ...headers, "content-length": String(size) } });
}

function adminView(m: Manifest, storage?: StorageStatus) {
  return {
    storage,
    recordings: m.recordings.map((rec, i) => ({
      id: rec.id,
      name: rec.name,
      relation: rec.relation,
      size: rec.size,
      mime: rec.mime,
      createdAt: rec.createdAt,
      audioUrl: `/api/audio/${rec.id}`,
      treasureId: ASSIGNMENT_ORDER[i] ?? null,
      treasureName: treasureById(ASSIGNMENT_ORDER[i] ?? "")?.name ?? null,
      active: i < effectiveCount(m),
    })),
    collectibleCount: m.collectibleCount,
    effectiveCount: effectiveCount(m),
    maxCollectibles: MAX_COLLECTIBLES,
    playerName: m.playerName,
  };
}

const requireAuth = (req: Request) =>
  isAuthed(req) ? null : json({ error: "unauthorised" }, { status: 401 });

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 60,
  development: process.env.NODE_ENV !== "production",

  routes: {
    "/": index,
    "/admin": admin,

    "/api/health": () => json({ ok: true }),

    "/api/game": { GET: () => handleGameConfig() },

    "/api/audio/:id": {
      GET: (req) => handleAudio(req, (req as unknown as { params: { id: string } }).params.id),
    },

    "/api/admin/session": {
      GET: (req) =>
        json({ authed: isAuthed(req), passwordConfigured }),
      POST: async (req) => {
        if (!passwordConfigured)
          return json(
            { error: "ADMIN_PASSWORD is not set on the server" },
            { status: 503 },
          );
        const body = (await req.json().catch(() => ({}))) as { password?: string };
        if (!checkPassword(body.password ?? ""))
          return json({ error: "wrong password" }, { status: 401 });
        return json({ ok: true }, { headers: { "set-cookie": sessionCookie() } });
      },
      DELETE: () => json({ ok: true }, { headers: { "set-cookie": clearCookie() } }),
    },

    "/api/admin/state": {
      GET: async (req) =>
        requireAuth(req) ??
        json(adminView(await readManifest(), await storageStatus())),
    },

    "/api/admin/settings": {
      PUT: async (req) => {
        const denied = requireAuth(req);
        if (denied) return denied;
        const body = (await req.json().catch(() => ({}))) as {
          collectibleCount?: number | null;
          playerName?: string;
        };
        const m = await update((cur) => ({
          ...cur,
          collectibleCount:
            body.collectibleCount === undefined
              ? cur.collectibleCount
              : body.collectibleCount === null
                ? null
                : Math.max(0, Math.min(Math.trunc(body.collectibleCount), MAX_COLLECTIBLES)),
          playerName: body.playerName === undefined ? cur.playerName : body.playerName.trim(),
        }));
        return json(adminView(m));
      },
    },

    "/api/admin/recordings": {
      POST: async (req) => {
        const denied = requireAuth(req);
        if (denied) return denied;

        const form = await req.formData().catch(() => null);
        if (!form) return json({ error: "expected multipart form data" }, { status: 400 });

        const file = form.get("audio");
        const name = String(form.get("name") ?? "").trim();
        const relation = String(form.get("relation") ?? "").trim();

        if (!(file instanceof File)) return json({ error: "no audio file" }, { status: 400 });
        if (!name) return json({ error: "who recorded it?" }, { status: 400 });
        if (file.size === 0) return json({ error: "that file is empty" }, { status: 400 });
        if (file.size > MAX_UPLOAD)
          return json({ error: "file is larger than 25 MB" }, { status: 413 });

        const mime = file.type || "audio/mpeg";
        const dotted = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase();
        const ext = EXT_BY_MIME[mime] ?? dotted ?? ".bin";
        if (!mime.startsWith("audio/") && !mime.startsWith("video/") && !EXT_BY_MIME[mime])
          return json({ error: `${mime || "that file"} is not audio` }, { status: 415 });

        await addRecording({ name, relation, mime, ext, bytes: await file.arrayBuffer() });
        return json(adminView(await readManifest()), { status: 201 });
      },
    },

    "/api/admin/recordings/:id": {
      PATCH: async (req) => {
        const denied = requireAuth(req);
        if (denied) return denied;
        const { id } = (req as unknown as { params: { id: string } }).params;
        const body = (await req.json().catch(() => ({}))) as {
          name?: string;
          relation?: string;
        };
        if (!(await renameRecording(id, body)))
          return json({ error: "not found" }, { status: 404 });
        return json(adminView(await readManifest()));
      },
      DELETE: async (req) => {
        const denied = requireAuth(req);
        if (denied) return denied;
        const { id } = (req as unknown as { params: { id: string } }).params;
        if (!(await deleteRecording(id))) return json({ error: "not found" }, { status: 404 });
        return json(adminView(await readManifest()));
      },
    },
  },

  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

const m = await recordBoot();
const storage = await storageStatus();

console.log(`🏰  Labyrinth listening on http://localhost:${server.port}`);
console.log(`    recordings: ${m.recordings.length}  ·  collectibles: ${effectiveCount(m)}`);
console.log(
  `    storage: ${storage.dataDir}  ·  ${
    storage.mounted === true
      ? "on a mounted volume"
      : storage.mounted === false
        ? "NOT a mount point"
        : "mount state unknown"
  }  ·  boot #${storage.boots}`,
);

if (storage.mounted === false && process.env.NODE_ENV === "production") {
  console.warn(
    `⚠  ${storage.dataDir} is not a mounted volume — recordings uploaded here will be\n` +
      "   destroyed by the next deploy. Attach a Railway volume at this exact path.",
  );
}
if (!storage.writable)
  console.error(`✖  ${storage.dataDir} is not writable — uploads will fail.`);
if (!passwordConfigured)
  console.warn("⚠  ADMIN_PASSWORD is not set — /admin is locked until you set it.");
