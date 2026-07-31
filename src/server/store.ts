/**
 * Persistence for the uploaded birthday recordings.
 *
 * Everything lives under DATA_DIR (a Railway volume in production): a small
 * JSON manifest plus the audio files themselves. No database needed.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_COLLECTIBLES } from "../game/treasures.ts";

export const DATA_DIR = process.env.DATA_DIR ?? "./data";
export const AUDIO_DIR = join(DATA_DIR, "audio");
const MANIFEST = join(DATA_DIR, "manifest.json");

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
      recordings: (parsed.recordings ?? []).map((r) => ({ ...r, relation: r.relation ?? "" })),
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

export async function renameRecording(
  id: string,
  patch: { name?: string; relation?: string },
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
      };
    }),
  }));
  return found;
}

export function audioPath(rec: Recording): string {
  return join(AUDIO_DIR, rec.file);
}
