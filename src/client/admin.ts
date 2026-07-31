/**
 * Upload console: add the recordings, name the people, cap the collectibles.
 */

import { iconSVG } from "./icons.ts";
import { treasureById } from "../game/treasures.ts";

interface AdminRecording {
  id: string;
  name: string;
  relation: string;
  size: number;
  mime: string;
  kind: "audio" | "video";
  createdAt: string;
  audioUrl: string;
  treasureId: string | null;
  treasureName: string | null;
  active: boolean;
}

interface StorageStatus {
  dataDir: string;
  writable: boolean;
  mounted: boolean | null;
  firstSeen: string | null;
  bootedAt: string;
  boots: number;
  recordings: number;
  bytes: number;
  proven: boolean;
}

interface AdminState {
  storage?: StorageStatus;
  recordings: AdminRecording[];
  collectibleCount: number | null;
  effectiveCount: number;
  maxCollectibles: number;
  playerName: string;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

function showError(el: HTMLElement, message: string | null) {
  el.textContent = message ?? "";
  el.hidden = !message;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

/* ─────────────────────────── session ─────────────────────────── */

async function boot() {
  const session = await api<{ authed: boolean; passwordConfigured: boolean }>(
    "/api/admin/session",
  );

  if (!session.passwordConfigured) {
    $("login").hidden = false;
    showError(
      $("login-error"),
      "ADMIN_PASSWORD is not set on the server. Set it in the Railway variables and redeploy.",
    );
    ($("password") as HTMLInputElement).disabled = true;
    return;
  }

  if (session.authed) return openConsole();
  $("login").hidden = false;
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError($("login-error"), null);
  const password = ($("password") as HTMLInputElement).value;
  try {
    await api("/api/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    $("login").hidden = true;
    await openConsole();
  } catch (err) {
    showError($("login-error"), (err as Error).message);
  }
});

$("logout").addEventListener("click", async () => {
  await fetch("/api/admin/session", { method: "DELETE" });
  location.reload();
});

async function openConsole() {
  $("login").hidden = true;
  $("console").hidden = false;
  render(await api<AdminState>("/api/admin/state"));
}

/* ─────────────────────────── rendering ─────────────────────────── */

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Say plainly whether the recordings will survive the next deploy. Guessing is
 * the one thing you cannot afford here: you find out you were wrong only after
 * the files are already gone.
 */
function renderStorage(s: StorageStatus | undefined) {
  const el = $("storage");
  if (!s) {
    el.innerHTML = "";
    return;
  }

  const parts: string[] = [];
  let tone: "good" | "warn" | "bad";
  let headline: string;

  if (!s.writable) {
    tone = "bad";
    headline = "Storage is not writable — uploads will fail";
    parts.push(`Nothing can be saved to <code>${s.dataDir}</code>.`);
  } else if (s.mounted === false) {
    tone = "bad";
    headline = "No volume attached — recordings will be lost on the next deploy";
    parts.push(
      `<code>${s.dataDir}</code> is the container's temporary disk, not a volume.`,
      `Attach a Railway volume with the mount path <code>${s.dataDir}</code>, then re-upload.`,
    );
  } else if (s.proven) {
    tone = "good";
    headline = "Persistent storage confirmed";
    parts.push(
      `<code>${s.dataDir}</code> has survived <strong>${s.boots - 1} restart${
        s.boots - 1 === 1 ? "" : "s"
      }</strong> with the recordings intact.`,
      s.firstSeen ? `In use since ${formatDate(s.firstSeen)}.` : "",
    );
  } else if (s.mounted === true) {
    tone = "warn";
    headline = "Volume attached, not yet proven";
    parts.push(
      `<code>${s.dataDir}</code> is a mounted volume, which is what you want.`,
      s.recordings === 0
        ? "Upload a recording, then redeploy — this box will confirm it survived."
        : "Redeploy once and come back here; this box will confirm the files survived.",
    );
  } else {
    tone = "warn";
    headline = "Cannot detect the volume from here";
    parts.push(
      `Writing to <code>${s.dataDir}</code>. Mount detection only works on Linux, so this is expected locally.`,
    );
  }

  el.className = `storage ${tone}`;
  el.innerHTML = `
    <strong>${headline}</strong>
    <p>${parts.filter(Boolean).join(" ")}</p>
    <small>boot #${s.boots} · ${s.recordings} file${s.recordings === 1 ? "" : "s"} · ${formatSize(
      s.bytes,
    )}</small>`;
}

function render(state: AdminState) {
  renderStorage(state.storage);
  const n = state.recordings.length;
  $("summary").textContent =
    n === 0
      ? "No recordings yet — the game is running in demo mode."
      : `${n} uploaded · ${state.effectiveCount} on the board · ${
          state.maxCollectibles - state.effectiveCount
        } treasure ${state.maxCollectibles - state.effectiveCount === 1 ? "slot" : "slots"} spare`;

  ($("set-count") as HTMLInputElement).value =
    state.collectibleCount === null ? "" : String(state.collectibleCount);
  ($("set-player") as HTMLInputElement).value = state.playerName;

  const list = $("rec-list");
  list.innerHTML = "";

  if (n === 0) {
    list.innerHTML = `<p class="empty">Nothing uploaded yet. Add the first message above.</p>`;
    return;
  }

  state.recordings.forEach((rec, i) => {
    const li = document.createElement("li");
    li.className = `rec${rec.active ? "" : " inactive"}`;
    const treasure = rec.treasureId ? treasureById(rec.treasureId) : undefined;

    const isVideo = rec.kind === "video";

    li.innerHTML = `
      <div class="num">${i + 1}</div>
      <div class="rec-main">
        <strong></strong>
        <small><span class="kind ${rec.kind}">${isVideo ? "video" : "audio"}</span>
          ${formatSize(rec.size)} · ${rec.mime}</small>
        <div class="treasure">
          ${treasure ? iconSVG(treasure.icon) : ""}
          ${
            rec.active
              ? `unlocked by ${treasure?.name ?? "a treasure"}`
              : "beyond the collectible cap — not in the game"
          }
        </div>
      </div>
      <div class="rec-actions">
        <button data-act="kind" title="Play this as ${isVideo ? "audio only" : "a video"}">
          Play as ${isVideo ? "audio" : "video"}
        </button>
        <button data-act="rename">Rename</button>
        <button data-act="delete" class="danger">Delete</button>
      </div>
      ${
        isVideo
          // preload="none" so a page of phone videos doesn't fetch and decode
          // hundreds of megabytes just to sit there
          ? `<video class="rec-preview" controls preload="none" playsinline src="${rec.audioUrl}"></video>`
          : `<audio controls preload="none" src="${rec.audioUrl}"></audio>`
      }
    `;

    // textContent, so a name with an apostrophe or angle bracket can't break out
    const strong = li.querySelector("strong")!;
    strong.textContent = rec.relation ? `${rec.name} — ${rec.relation}` : rec.name;

    li.querySelector<HTMLButtonElement>('[data-act="rename"]')!.addEventListener(
      "click",
      async () => {
        const name = prompt("Who recorded it?", rec.name);
        if (name === null) return;
        const relation = prompt("How does she know them? (optional)", rec.relation);
        if (relation === null) return;
        render(
          await api<AdminState>(`/api/admin/recordings/${rec.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, relation }),
          }),
        );
      },
    );

    li.querySelector<HTMLButtonElement>('[data-act="kind"]')!.addEventListener(
      "click",
      async () => {
        render(
          await api<AdminState>(`/api/admin/recordings/${rec.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: isVideo ? "audio" : "video" }),
          }),
        );
      },
    );

    li.querySelector<HTMLButtonElement>('[data-act="delete"]')!.addEventListener(
      "click",
      async () => {
        if (!confirm(`Delete the recording from ${rec.name}?`)) return;
        render(
          await api<AdminState>(`/api/admin/recordings/${rec.id}`, { method: "DELETE" }),
        );
      },
    );

    list.append(li);
  });
}

/* ─────────────────────────── forms ─────────────────────────── */

$("upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError($("upload-error"), null);

  const nameInput = $("up-name") as HTMLInputElement;
  const relationInput = $("up-relation") as HTMLInputElement;
  const fileInput = $("up-file") as HTMLInputElement;
  const button = $("upload-btn") as HTMLButtonElement;

  const file = fileInput.files?.[0];
  if (!file) return showError($("upload-error"), "Pick an audio file first.");

  const form = new FormData();
  form.set("name", nameInput.value);
  form.set("relation", relationInput.value);
  form.set("audio", file);

  button.disabled = true;
  button.textContent = "Uploading…";
  try {
    render(await api<AdminState>("/api/admin/recordings", { method: "POST", body: form }));
    nameInput.value = "";
    relationInput.value = "";
    fileInput.value = "";
  } catch (err) {
    showError($("upload-error"), (err as Error).message);
  } finally {
    button.disabled = false;
    button.textContent = "Upload";
  }
});

$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const raw = ($("set-count") as HTMLInputElement).value.trim();
  render(
    await api<AdminState>("/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        collectibleCount: raw === "" ? null : Number(raw),
        playerName: ($("set-player") as HTMLInputElement).value,
      }),
    }),
  );
});

void boot();
