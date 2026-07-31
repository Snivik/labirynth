/**
 * Persistence for the uploaded birthday recordings.
 *
 * Everything lives under DATA_DIR (a Railway volume in production): a small
 * JSON manifest plus the audio files themselves. No database needed.
 */

import { access, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { MAX_COLLECTIBLES } from "../game/treasures.ts";

export const DATA_DIR = process.env.DATA_DIR ?? "./data";
export const AUDIO_DIR = join(DATA_DIR, "audio");
const MANIFEST = join(DATA_DIR, "manifest.json");

/** When this process started — compared against the manifest to prove persistence. */
const BOOTED_AT = new Date().toISOString();

/** Whether the message plays as sound only or shows a picture too. */
export type MediaKind = "audio" | "video";

export interface Recording {
  id: string;
  /** Who recorded it — shown when the treasure is unlocked. */
  name: string;
  /** Optional line shown under the name, e.g. "her sister". */
  relation: string;
  /** File name inside AUDIO_DIR. */
  file: string;
  mime: string;
  size: number;
  createdAt: string;
  /**
   * Derived from the upload's MIME type, overridable from the console for the
   * odd file that reports itself wrongly.
   */
  kind: MediaKind;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".3gp"]);

/** Decide audio vs video from what the browser told us, falling back to the extension. */
export function kindFor(mime: string, ext: string): MediaKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return VIDEO_EXTENSIONS.has(ext.toLowerCase()) ? "video" : "audio";
}

export interface Manifest {
  recordings: Recording[];
  /**
   * Hard cap on collectibles. `null` means "use every recording uploaded",
   * which is the point: the board grows as more people send messages.
   */
  collectibleCount: number | null;
  /** Shown on the start screen. */
  playerName: string;
  /** First time this storage was ever written. Resets if the disk is ephemeral. */
  firstSeen?: string;
  /** How many times the server has started against this storage. */
  boots?: number;
}

const DEFAULTS: Manifest = {
  recordings: [],
  collectibleCount: null,
  playerName: "",
};

let cache: Manifest | null = null;

async function ensureDirs() {
  await mkdir(AUDIO_DIR, { recursive: true });
}

export async function readManifest(): Promise<Manifest> {
  if (cache) return cache;
  await ensureDirs();
  try {
    const raw = await readFile(MANIFEST, "utf8");
    const parsed = JSON.parse(raw) as Partial<Manifest>;
    cache = {
      ...DEFAULTS,
      ...parsed,
      // `kind` arrived after the first recordings did — infer it for those
      recordings: (parsed.recordings ?? []).map((r) => ({
        ...r,
        relation: r.relation ?? "",
        kind: r.kind ?? kindFor(r.mime ?? "", r.file?.match(/\.[a-z0-9]+$/i)?.[0] ?? ""),
      })),
    };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export async function writeManifest(next: Manifest): Promise<Manifest> {
  await ensureDirs();
  cache = next;
  await writeFile(MANIFEST, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function update(fn: (m: Manifest) => Manifest): Promise<Manifest> {
  return writeManifest(fn(structuredClone(await readManifest())));
}

/**
 * How many collectibles the game should place: every recording uploaded, capped
 * by the optional manual override and by the 24 treasures on the board.
 */
export function effectiveCount(m: Manifest): number {
  const available = Math.min(m.recordings.length, MAX_COLLECTIBLES);
  if (m.collectibleCount === null) return available;
  return Math.max(0, Math.min(m.collectibleCount, available));
}

export async function addRecording(
  input: { name: string; relation: string; mime: string; bytes: ArrayBuffer; ext: string },
): Promise<Recording> {
  await ensureDirs();
  const id = crypto.randomUUID();
  const file = `${id}${input.ext}`;
  await Bun.write(join(AUDIO_DIR, file), input.bytes);
  const rec: Recording = {
    id,
    name: input.name,
    relation: input.relation,
    file,
    mime: input.mime,
    size: input.bytes.byteLength,
    createdAt: new Date().toISOString(),
    kind: kindFor(input.mime, input.ext),
  };
  await update((m) => ({ ...m, recordings: [...m.recordings, rec] }));
  return rec;
}

export async function deleteRecording(id: string): Promise<boolean> {
  const m = await readManifest();
  const rec = m.recordings.find((r) => r.id === id);
  if (!rec) return false;
  await rm(join(AUDIO_DIR, rec.file), { force: true });
  await update((cur) => ({ ...cur, recordings: cur.recordings.filter((r) => r.id !== id) }));
  return true;
}

export async function updateRecording(
  id: string,
  patch: { name?: string; relation?: string; kind?: MediaKind },
): Promise<boolean> {
  let found = false;
  await update((m) => ({
    ...m,
    recordings: m.recordings.map((r) => {
      if (r.id !== id) return r;
      found = true;
      return {
        ...r,
        name: patch.name?.trim() || r.name,
        relation: patch.relation !== undefined ? patch.relation.trim() : r.relation,
        kind: patch.kind ?? r.kind,
      };
    }),
  }));
  return found;
}

export function audioPath(rec: Recording): string {
  return join(AUDIO_DIR, rec.file);
}

/* ─────────────────────── is the disk actually persistent? ─────────────────────── */

export interface StorageStatus {
  dataDir: string;
  writable: boolean;
  /** True when DATA_DIR is its own mount point. null when we cannot tell. */
  mounted: boolean | null;
  /** First write ever seen here. If this keeps changing, the disk is ephemeral. */
  firstSeen: string | null;
  bootedAt: string;
  boots: number;
  recordings: number;
  bytes: number;
  /** The disk has outlived at least one restart with recordings still on it. */
  proven: boolean;
}

/**
 * Whether `dir` is a mount point of its own, which on Railway means a volume is
 * attached there rather than it being part of the container's throwaway layer.
 */
async function isMountPoint(dir: string): Promise<boolean | null> {
  try {
    const target = await realpath(dir);
    const raw = await readFile("/proc/self/mountinfo", "utf8");
    for (const line of raw.split("\n")) {
      // field 5 of each mountinfo line is the mount point
      const point = line.split(" ")[4];
      if (point && point.replace(/\\040/g, " ") === target) return true;
    }
    return false;
  } catch {
    return null; // no /proc — running on macOS, most likely
  }
}

/** Stamp this start-up into the manifest so persistence becomes measurable. */
export async function recordBoot(): Promise<Manifest> {
  return update((m) => ({
    ...m,
    firstSeen: m.firstSeen ?? BOOTED_AT,
    boots: (m.boots ?? 0) + 1,
  }));
}

export async function storageStatus(): Promise<StorageStatus> {
  const m = await readManifest();
  const dir = resolve(DATA_DIR);

  let writable = false;
  try {
    await access(dir, constants.W_OK);
    writable = true;
  } catch {
    /* left false */
  }

  const boots = m.boots ?? 0;
  const bytes = m.recordings.reduce((sum, r) => sum + r.size, 0);

  return {
    dataDir: dir,
    writable,
    mounted: await isMountPoint(dir),
    firstSeen: m.firstSeen ?? null,
    bootedAt: BOOTED_AT,
    boots,
    recordings: m.recordings.length,
    bytes,
    // outlived a restart, and still holding files
    proven: boots > 1 && m.firstSeen !== BOOTED_AT && m.recordings.length > 0,
  };
}
