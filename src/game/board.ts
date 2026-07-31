/**
 * Board layout, tile shifting and path finding.
 *
 * The board is a 7x7 grid. Tiles at even row *and* even column are glued down
 * (16 of them); everything else is loose. Only the odd-indexed rows and columns
 * can be pushed, which is why the physical board has exactly twelve arrows.
 */

import {
  DELTA,
  MOVABLE_SHAPE_COUNTS,
  OPPOSITE,
  type Dir,
  type Rotation,
  type Shape,
  type Tile,
  isOpen,
} from "./tiles.ts";
import { CORNER_TREASURES, FIXED_TREASURES, TEE_TREASURES } from "./treasures.ts";

export const SIZE = 7;
/** Rows and columns that can be pushed. */
export const SHIFTABLE = [1, 3, 5] as const;

export type Side = "top" | "right" | "bottom" | "left";

export interface Arrow {
  id: string;
  side: Side;
  /** Column index for top/bottom, row index for left/right. */
  index: number;
}

export const ARROWS: Arrow[] = (["top", "right", "bottom", "left"] as Side[]).flatMap(
  (side) => SHIFTABLE.map((index) => ({ id: `${side}-${index}`, side, index })),
);

const ARROWS_BY_ID = new Map(ARROWS.map((a) => [a.id, a]));

export function arrowById(id: string): Arrow | undefined {
  return ARROWS_BY_ID.get(id);
}

/** The arrow that would undo a push made at `id`. */
export function oppositeArrow(id: string): string {
  const a = ARROWS_BY_ID.get(id)!;
  const flip: Record<Side, Side> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };
  return `${flip[a.side]}-${a.index}`;
}

export const HOME_CORNERS = [
  { color: "yellow", r: 0, c: 0 },
  { color: "red", r: 0, c: SIZE - 1 },
  { color: "green", r: SIZE - 1, c: 0 },
  { color: "blue", r: SIZE - 1, c: SIZE - 1 },
] as const;

export type PawnColor = (typeof HOME_CORNERS)[number]["color"];

/**
 * The fixed tiles, in board order. Four corner elbows opening inward, plus
 * twelve T-junctions whose flat backs face the nearest edge. The arrangement is
 * symmetric under a half-turn, like the printed board.
 */
const FIXED_LAYOUT: { r: number; c: number; shape: Shape; rot: Rotation }[] = [
  { r: 0, c: 0, shape: "corner", rot: 1 }, //  E S
  { r: 0, c: 2, shape: "tee", rot: 1 }, //     E S W
  { r: 0, c: 4, shape: "tee", rot: 1 },
  { r: 0, c: 6, shape: "corner", rot: 2 }, //  S W
  { r: 2, c: 0, shape: "tee", rot: 0 }, //     N E S
  { r: 2, c: 2, shape: "tee", rot: 0 },
  { r: 2, c: 4, shape: "tee", rot: 1 }, //     E S W
  { r: 2, c: 6, shape: "tee", rot: 2 }, //     S W N
  { r: 4, c: 0, shape: "tee", rot: 0 },
  { r: 4, c: 2, shape: "tee", rot: 3 }, //     W N E
  { r: 4, c: 4, shape: "tee", rot: 2 },
  { r: 4, c: 6, shape: "tee", rot: 2 },
  { r: 6, c: 0, shape: "corner", rot: 0 }, //  N E
  { r: 6, c: 2, shape: "tee", rot: 3 }, //     W N E
  { r: 6, c: 4, shape: "tee", rot: 3 },
  { r: 6, c: 6, shape: "corner", rot: 3 }, //  W N
];

export function isFixed(r: number, c: number): boolean {
  return r % 2 === 0 && c % 2 === 0;
}

/** Deterministic RNG so a saved game replays identically. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface BoardSetup {
  grid: Tile[][];
  spare: Tile;
}

/** Build a fresh board: fixed tiles placed, 33 loose tiles dealt, 1 spare left over. */
export function createBoard(rng: () => number): BoardSetup {
  const grid: (Tile | null)[][] = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => null),
  );

  // Fixed tiles. The four corners are homes; the rest carry a treasure each.
  let fixedTreasureIdx = 0;
  for (const spec of FIXED_LAYOUT) {
    const corner = HOME_CORNERS.find((h) => h.r === spec.r && h.c === spec.c);
    const tile: Tile = {
      id: `fixed-${spec.r}-${spec.c}`,
      shape: spec.shape,
      rot: spec.rot,
      fixed: true,
    };
    if (corner) {
      tile.home = corner.color;
    } else {
      tile.treasure = FIXED_TREASURES[fixedTreasureIdx++]!.id;
    }
    grid[spec.r]![spec.c] = tile;
  }

  // The bag of 34 loose tiles.
  const bag: Tile[] = [];
  let n = 0;
  const push = (shape: Shape, treasure?: string) =>
    bag.push({ id: `loose-${n++}`, shape, rot: 0, fixed: false, treasure });

  for (let i = 0; i < MOVABLE_SHAPE_COUNTS.straight; i++) push("straight");
  for (let i = 0; i < MOVABLE_SHAPE_COUNTS.corner; i++)
    push("corner", CORNER_TREASURES[i]?.id);
  for (let i = 0; i < MOVABLE_SHAPE_COUNTS.tee; i++) push("tee", TEE_TREASURES[i]?.id);

  const loose = shuffle(bag, rng).map((t) => ({
    ...t,
    rot: Math.floor(rng() * 4) as Rotation,
  }));

  let k = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!grid[r]![c]) grid[r]![c] = loose[k++]!;
    }
  }

  return { grid: grid as Tile[][], spare: loose[k]! };
}

/** The cell a push enters, and the cell whose tile gets ejected. */
export function arrowCells(arrow: Arrow): { entry: [number, number]; exit: [number, number] } {
  switch (arrow.side) {
    case "top":
      return { entry: [0, arrow.index], exit: [SIZE - 1, arrow.index] };
    case "bottom":
      return { entry: [SIZE - 1, arrow.index], exit: [0, arrow.index] };
    case "left":
      return { entry: [arrow.index, 0], exit: [arrow.index, SIZE - 1] };
    case "right":
      return { entry: [arrow.index, SIZE - 1], exit: [arrow.index, 0] };
  }
}

export interface ShiftResult {
  grid: Tile[][];
  spare: Tile;
  entry: [number, number];
  exit: [number, number];
  /** Which direction the whole line travelled. */
  dir: Dir;
  /** Non-null when a pawn was carried off the far edge and wrapped around. */
  wrappedPawn: { from: [number, number]; to: [number, number] } | null;
  /** New position of every pawn that rode along with the line. */
  pawn: { r: number; c: number };
}

/**
 * Push `spare` into the labyrinth at `arrow`. Every tile in that row or column
 * slides one step; the tile forced off the far edge becomes the next spare. A
 * pawn riding the ejected tile reappears on the tile just inserted.
 */
export function shift(
  grid: Tile[][],
  spare: Tile,
  arrow: Arrow,
  pawn: { r: number; c: number },
): ShiftResult {
  const next = grid.map((row) => row.slice());
  const { entry, exit } = arrowCells(arrow);
  const dir: Dir =
    arrow.side === "top" ? 2 : arrow.side === "bottom" ? 0 : arrow.side === "left" ? 1 : 3;

  const ejected = grid[exit[0]]![exit[1]]!;
  const inserted: Tile = { ...spare };

  let newPawn = { ...pawn };
  let wrappedPawn: ShiftResult["wrappedPawn"] = null;

  if (arrow.side === "top" || arrow.side === "bottom") {
    const c = arrow.index;
    const order =
      arrow.side === "top"
        ? [...Array(SIZE - 1).keys()].map((i) => SIZE - 1 - i) // 6..1
        : [...Array(SIZE - 1).keys()]; //                        0..5
    for (const r of order) {
      const src = arrow.side === "top" ? r - 1 : r + 1;
      next[r]![c] = grid[src]![c]!;
    }
    next[entry[0]]![c] = inserted;

    if (pawn.c === c) {
      if (pawn.r === exit[0]) {
        wrappedPawn = { from: [pawn.r, pawn.c], to: [entry[0], entry[1]] };
        newPawn = { r: entry[0], c: entry[1] };
      } else {
        newPawn = { r: pawn.r + (arrow.side === "top" ? 1 : -1), c };
      }
    }
  } else {
    const r = arrow.index;
    const order =
      arrow.side === "left"
        ? [...Array(SIZE - 1).keys()].map((i) => SIZE - 1 - i)
        : [...Array(SIZE - 1).keys()];
    for (const c of order) {
      const src = arrow.side === "left" ? c - 1 : c + 1;
      next[r]![c] = grid[r]![src]!;
    }
    next[r]![entry[1]] = inserted;

    if (pawn.r === r) {
      if (pawn.c === exit[1]) {
        wrappedPawn = { from: [pawn.r, pawn.c], to: [entry[0], entry[1]] };
        newPawn = { r: entry[0], c: entry[1] };
      } else {
        newPawn = { r, c: pawn.c + (arrow.side === "left" ? 1 : -1) };
      }
    }
  }

  return { grid: next, spare: ejected, entry, exit, dir, wrappedPawn, pawn: newPawn };
}

export const key = (r: number, c: number) => `${r},${c}`;

/** Every cell reachable from `from` along connected corridors. Includes `from`. */
export function reachable(grid: Tile[][], from: { r: number; c: number }): Set<string> {
  const seen = new Set<string>([key(from.r, from.c)]);
  const queue: [number, number][] = [[from.r, from.c]];

  while (queue.length) {
    const [r, c] = queue.shift()!;
    const tile = grid[r]![c]!;
    for (let d = 0 as Dir; d < 4; d++) {
      if (!isOpen(tile, d)) continue;
      const [dr, dc] = DELTA[d]!;
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= SIZE || nc >= SIZE) continue;
      if (!isOpen(grid[nr]![nc]!, OPPOSITE[d]!)) continue;
      const k = key(nr, nc);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push([nr, nc]);
    }
  }
  return seen;
}

/** Shortest corridor path from `from` to `to`, or null when unreachable. */
export function pathBetween(
  grid: Tile[][],
  from: { r: number; c: number },
  to: { r: number; c: number },
): [number, number][] | null {
  const prev = new Map<string, string>();
  const start = key(from.r, from.c);
  const goal = key(to.r, to.c);
  const seen = new Set([start]);
  const queue: [number, number][] = [[from.r, from.c]];

  while (queue.length) {
    const [r, c] = queue.shift()!;
    if (key(r, c) === goal) break;
    const tile = grid[r]![c]!;
    for (let d = 0 as Dir; d < 4; d++) {
      if (!isOpen(tile, d)) continue;
      const [dr, dc] = DELTA[d]!;
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= SIZE || nc >= SIZE) continue;
      if (!isOpen(grid[nr]![nc]!, OPPOSITE[d]!)) continue;
      const k = key(nr, nc);
      if (seen.has(k)) continue;
      seen.add(k);
      prev.set(k, key(r, c));
      queue.push([nr, nc]);
    }
  }

  if (!seen.has(goal)) return null;
  const path: [number, number][] = [];
  let cur = goal;
  while (cur !== start) {
    const [r, c] = cur.split(",").map(Number) as [number, number];
    path.unshift([r, c]);
    cur = prev.get(cur)!;
  }
  path.unshift([from.r, from.c]);
  return path;
}

/** Where a treasure currently sits, or null when it is on the spare tile. */
export function findTreasure(
  grid: Tile[][],
  treasureId: string,
): { r: number; c: number } | null {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r]![c]!.treasure === treasureId) return { r, c };
    }
  }
  return null;
}
