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
  createdAt: string;
  audioUrl: string;
  treasureId: string | null;
  treasureName: string | null;
  active: boolean;
}

interface AdminState {
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

function render(state: AdminState) {
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

    li.innerHTML = `
      <div class="num">${i + 1}</div>
      <div class="rec-main">
        <strong></strong>
        <small>${formatSize(rec.size)} · ${rec.mime}</small>
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
        <button data-act="rename">Rename</button>
        <button data-act="delete" class="danger">Delete</button>
      </div>
      <audio controls preload="none" src="${rec.audioUrl}"></audio>
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
