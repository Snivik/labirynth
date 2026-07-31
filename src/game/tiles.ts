/**
 * Tile geometry for Labyrinth.
 *
 * A tile is a square of corridor with openings on some of its four sides.
 * Openings are stored as a 4-bit mask; bit `d` set means the corridor runs out
 * of the tile toward direction `d`.
 */

export const N = 0;
export const E = 1;
export const S = 2;
export const W = 3;

export type Dir = 0 | 1 | 2 | 3;
export type Rotation = 0 | 1 | 2 | 3;
export type Shape = "straight" | "corner" | "tee";

/** Row/column delta for each direction. */
export const DELTA: readonly [number, number][] = [
  [-1, 0], // N
  [0, 1], //  E
  [1, 0], //  S
  [0, -1], // W
];

/** The direction facing back the other way. */
export const OPPOSITE: readonly Dir[] = [S, W, N, E];

/** Openings of each shape at rotation 0. */
const BASE: Record<Shape, number> = {
  straight: (1 << N) | (1 << S), // vertical corridor
  corner: (1 << N) | (1 << E), // elbow, north-east
  tee: (1 << N) | (1 << E) | (1 << S), // T with its flat back to the west
};

/** How many of each movable shape are in the bag (34 loose tiles in total). */
export const MOVABLE_SHAPE_COUNTS: Record<Shape, number> = {
  straight: 12,
  corner: 16,
  tee: 6,
};

export interface Tile {
  id: string;
  shape: Shape;
  rot: Rotation;
  /** Id of the treasure illustrated on this tile, if any. */
  treasure?: string;
  /** Fixed tiles are glued to the board and never shift. */
  fixed: boolean;
  /** Home corner colour, for the four corner tiles. */
  home?: string;
}

/** Openings mask for a shape rotated clockwise `rot` quarter-turns. */
export function openingsOf(shape: Shape, rot: Rotation): number {
  const base = BASE[shape];
  let mask = 0;
  for (let d = 0; d < 4; d++) {
    if (base & (1 << d)) mask |= 1 << ((d + rot) & 3);
  }
  return mask;
}

export function openings(tile: Tile): number {
  return openingsOf(tile.shape, tile.rot);
}

export function isOpen(tile: Tile, dir: Dir): boolean {
  return (openings(tile) & (1 << dir)) !== 0;
}

/** The list of directions a tile is open toward. */
export function openDirs(tile: Tile): Dir[] {
  const mask = openings(tile);
  const out: Dir[] = [];
  for (let d = 0; d < 4; d++) if (mask & (1 << d)) out.push(d as Dir);
  return out;
}

export function rotate(tile: Tile, quarters: number): Tile {
  return { ...tile, rot: (((tile.rot + quarters) % 4) + 4) % 4 as Rotation };
}
