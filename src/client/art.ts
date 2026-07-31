/**
 * Tile, pawn and card artwork.
 *
 * Tiles are drawn as SVG: a parchment corridor cut out of a wall of rough
 * cobbles. The cobbles are laid out per tile from a hash of the tile id, so no
 * two tiles look alike and stones get cut off at the corridor edge the way they
 * are on the printed board.
 */

import { openings, type Tile } from "../game/tiles.ts";
import { iconBody } from "./icons.ts";
import { treasureById } from "../game/treasures.ts";

/** Corridor edges, in the tile's 0-100 coordinate space. */
const C0 = 22;
const C1 = 78;

const STONE_COLORS = [
  "#d18a4a",
  "#c47a38",
  "#e0a163",
  "#b96a2c",
  "#cf8340",
  "#e8b578",
  "#ac5f26",
  "#d99752",
  "#c98f5c",
  "#bd7433",
];

/** Dark mortar showing through the gaps between stones. */
const MORTAR = "#5c3316";

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Outline of the corridor: the middle square plus an arm out of every open
 * side. Walked clockwise so it can be used as an even-odd hole.
 */
function corridorPath(mask: number): string {
  const open = (d: number) => (mask & (1 << d)) !== 0;
  const p: string[] = [`M${C0} ${C0}`];

  // top edge, left -> right
  if (open(0)) p.push(`L${C0} 0`, `L${C1} 0`, `L${C1} ${C0}`);
  else p.push(`L${C1} ${C0}`);
  // right edge, top -> bottom
  if (open(1)) p.push(`L100 ${C0}`, `L100 ${C1}`, `L${C1} ${C1}`);
  else p.push(`L${C1} ${C1}`);
  // bottom edge, right -> left
  if (open(2)) p.push(`L${C1} 100`, `L${C0} 100`, `L${C0} ${C1}`);
  else p.push(`L${C0} ${C1}`);
  // left edge, bottom -> top
  if (open(3)) p.push(`L0 ${C1}`, `L0 ${C0}`, `L${C0} ${C0}`);
  else p.push(`L${C0} ${C0}`);

  p.push("Z");
  return p.join(" ");
}

/** Wall region = whole tile minus the corridor, as one even-odd path. */
function wallPath(mask: number): string {
  return `M0 0 H100 V100 H0 Z ${corridorPath(mask)}`;
}

type Point = [number, number];

/**
 * Just the wall faces of the corridor, as open polylines. The segments that lie
 * on the tile boundary are left out — stroking those would draw a line straight
 * across every corridor opening, cutting the passage in half at each seam.
 */
function corridorOutline(mask: number): string {
  const open = (d: number) => (mask & (1 << d)) !== 0;
  const segs: { a: Point; b: Point; boundary: boolean }[] = [];
  const add = (a: Point, b: Point, boundary = false) => segs.push({ a, b, boundary });

  if (open(0)) {
    add([C0, C0], [C0, 0]);
    add([C0, 0], [C1, 0], true);
    add([C1, 0], [C1, C0]);
  } else add([C0, C0], [C1, C0]);

  if (open(1)) {
    add([C1, C0], [100, C0]);
    add([100, C0], [100, C1], true);
    add([100, C1], [C1, C1]);
  } else add([C1, C0], [C1, C1]);

  if (open(2)) {
    add([C1, C1], [C1, 100]);
    add([C1, 100], [C0, 100], true);
    add([C0, 100], [C0, C1]);
  } else add([C1, C1], [C0, C1]);

  if (open(3)) {
    add([C0, C1], [0, C1]);
    add([0, C1], [0, C0], true);
    add([0, C0], [C0, C0]);
  } else add([C0, C1], [C0, C0]);

  const paths: string[] = [];
  let run: Point[] = [];
  const flush = () => {
    if (run.length > 1) {
      paths.push(`M${run[0]![0]} ${run[0]![1]} ${run.slice(1).map((p) => `L${p[0]} ${p[1]}`).join(" ")}`);
    }
    run = [];
  };

  for (const seg of segs) {
    if (seg.boundary) {
      flush();
      continue;
    }
    if (!run.length) run.push(seg.a);
    run.push(seg.b);
  }
  flush();

  return paths.join(" ");
}

/**
 * Rough cobbles laid in uneven courses. Course height, stone width and rounding
 * all vary, which is what keeps it from reading as a regular brick wall.
 */
function cobbles(seed: number): string {
  const rnd = rngFrom(seed);
  const out: string[] = [];

  let y = -9 - rnd() * 4;
  while (y < 104) {
    const rowH = 9.5 + rnd() * 5.5;
    let x = -9 - rnd() * 11;
    while (x < 107) {
      const w = 8 + rnd() * 13;
      const h = rowH * (0.7 + rnd() * 0.2);
      const color = STONE_COLORS[Math.floor(rnd() * STONE_COLORS.length)]!;
      const tilt = (rnd() - 0.5) * 5.5;
      const cx = (x + w / 2).toFixed(1);
      const cy = (y + h / 2).toFixed(1);
      out.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(2.2 + rnd() * 2.8).toFixed(1)}" fill="${color}" transform="rotate(${tilt.toFixed(2)} ${cx} ${cy})"/>`,
        // a hint of light on the upper edge, so stones read as rounded
        `<path d="M${(x + 3).toFixed(1)} ${(y + 1.6).toFixed(1)} h${(w - 6).toFixed(1)}" stroke="#ffe3bd" stroke-width="1.1" stroke-linecap="round" opacity="${(0.14 + rnd() * 0.16).toFixed(2)}" transform="rotate(${tilt.toFixed(2)} ${cx} ${cy})"/>`,
      );
      x += w + 1.4 + rnd() * 2.2;
    }
    y += rowH;
  }
  return out.join("");
}

/** Faint blotches so the parchment does not read as flat cream. */
function parchmentGrain(seed: number): string {
  const rnd = rngFrom(seed ^ 0x9e3779b9);
  const out: string[] = [];
  for (let i = 0; i < 14; i++) {
    out.push(
      `<ellipse cx="${(rnd() * 100).toFixed(1)}" cy="${(rnd() * 100).toFixed(1)}" rx="${(3 + rnd() * 9).toFixed(1)}" ry="${(2 + rnd() * 7).toFixed(1)}" fill="#c9b27f" opacity="${(0.05 + rnd() * 0.09).toFixed(3)}"/>`,
    );
  }
  return out.join("");
}

export interface TileArtOptions {
  /** Draw the treasure illustration (off for the tile ghost preview). */
  showTreasure?: boolean;
  /** Keeps clip-path ids unique when the same tile is drawn twice. */
  idSuffix?: string;
}

export function tileSVG(tile: Tile, opts: TileArtOptions = {}): string {
  const { showTreasure = true, idSuffix = "" } = opts;
  const mask = openings(tile);
  const seed = hash(tile.id);
  const clipId = `clip-${tile.id}${idSuffix}`;
  const outline = corridorOutline(mask);
  const treasure = tile.treasure ? treasureById(tile.treasure) : undefined;

  const home = tile.home ? (PAWN_FILL[tile.home]?.[0] ?? "#f0c53f") : null;
  const homeMark = home
    ? `<g class="home-mark">
         <circle cx="50" cy="50" r="17" fill="${home}" opacity=".8"/>
         <circle cx="50" cy="50" r="17" fill="none" stroke="#3b2412" stroke-width="2.6" opacity=".55"/>
         <circle cx="50" cy="50" r="11" fill="none" stroke="#fff8e1" stroke-width="2" opacity=".7"/>
       </g>`
    : "";

  return `<svg class="tile-art" viewBox="0 0 100 100" preserveAspectRatio="none">
  <defs>
    <clipPath id="${clipId}"><path d="${wallPath(mask)}" clip-rule="evenodd"/></clipPath>
  </defs>
  <rect width="100" height="100" fill="#efe3c4"/>
  ${parchmentGrain(seed)}
  <g clip-path="url(#${clipId})">
    <rect width="100" height="100" fill="${MORTAR}"/>
    ${cobbles(seed)}
  </g>
  <!-- shadow the wall casts onto the corridor floor, then the wall's hard edge -->
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${outline}" stroke="#7a5426" stroke-width="5.5" opacity=".18"/>
    <path d="${outline}" stroke="#43270f" stroke-width="1.8" opacity=".7"/>
  </g>
  ${homeMark}
  ${
    showTreasure && treasure
      ? `<g class="tile-treasure" transform="translate(22 22) scale(0.56)">${iconBody(treasure.icon)}</g>`
      : ""
  }
</svg>`;
}

const PAWN_FILL: Record<string, [string, string]> = {
  yellow: ["#f0c53f", "#c99a1e"],
  red: ["#c8382e", "#96261e"],
  green: ["#3d8f4e", "#2a6b38"],
  blue: ["#2f5fa8", "#1f4079"],
};

/** A little cloaked adventurer, like the plastic figures in the box. */
export function pawnSVG(color: string): string {
  const [light, dark] = PAWN_FILL[color] ?? PAWN_FILL.yellow!;
  return `<svg class="pawn-art" viewBox="0 0 100 100">
    <ellipse cx="50" cy="88" rx="24" ry="7" fill="#000" opacity=".25"/>
    <path d="M26 86q0-30 24-30t24 30z" fill="${light}" stroke="#2b1a0c" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M50 56q14 0 20 18-10 4-20 4t-20-4q6-18 20-18z" fill="${dark}" opacity=".45" stroke="none"/>
    <circle cx="50" cy="44" r="14" fill="#f2d3ac" stroke="#2b1a0c" stroke-width="3.5"/>
    <path d="M32 40q6-22 18-22t18 22q-8-6-18-6t-18 6z" fill="${dark}" stroke="#2b1a0c" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="44" cy="45" r="2.4" fill="#2b1a0c" stroke="none"/>
    <circle cx="56" cy="45" r="2.4" fill="#2b1a0c" stroke="none"/>
    <path d="M45 52q5 4 10 0" fill="none" stroke="#2b1a0c" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;
}

/** Treasure card face: gold-rimmed vignette on cream, like the printed deck. */
export function cardFaceSVG(treasureId: string): string {
  const treasure = treasureById(treasureId);
  return `<svg class="card-art" viewBox="0 0 140 190">
    <rect x="3" y="3" width="134" height="184" rx="12" fill="#1c2f74" stroke="#0f1c48" stroke-width="3"/>
    <rect x="11" y="11" width="118" height="168" rx="8" fill="#f2e8ce" stroke="#c9a94e" stroke-width="2.5"/>
    <circle cx="70" cy="95" r="52" fill="#e9dcba" stroke="#b99a48" stroke-width="2"/>
    <circle cx="70" cy="95" r="45" fill="#f6efd9" stroke="#c9a94e" stroke-width="3"/>
    <g transform="translate(24 49) scale(0.92)">${iconBody(treasure?.icon ?? "chest")}</g>
  </svg>`;
}

/** The final card: go home. */
export function cardHomeSVG(color: string): string {
  const [light] = PAWN_FILL[color] ?? PAWN_FILL.yellow!;
  return `<svg class="card-art" viewBox="0 0 140 190">
    <rect x="3" y="3" width="134" height="184" rx="12" fill="#1c2f74" stroke="#0f1c48" stroke-width="3"/>
    <rect x="11" y="11" width="118" height="168" rx="8" fill="#f2e8ce" stroke="#c9a94e" stroke-width="2.5"/>
    <circle cx="70" cy="95" r="52" fill="#e9dcba" stroke="#b99a48" stroke-width="2"/>
    <circle cx="70" cy="95" r="45" fill="${light}" opacity=".22"/>
    <circle cx="70" cy="95" r="45" fill="none" stroke="#c9a94e" stroke-width="3"/>
    <g transform="translate(28 53) scale(0.84)">${pawnSVG(color)
      .replace(/^<svg[^>]*>/, "")
      .replace(/<\/svg>$/, "")}</g>
  </svg>`;
}

/** Card back: the deck's blue lattice. */
export function cardBackSVG(): string {
  return `<svg class="card-art" viewBox="0 0 140 190">
    <defs>
      <pattern id="lattice" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="18" height="18" fill="#7fa9cf"/>
        <path d="M0 9h18M9 0v18" stroke="#a9c8e0" stroke-width="3"/>
        <circle cx="9" cy="9" r="2.4" fill="#5d89b3"/>
      </pattern>
    </defs>
    <rect x="3" y="3" width="134" height="184" rx="12" fill="#1c2f74" stroke="#0f1c48" stroke-width="3"/>
    <rect x="12" y="12" width="116" height="166" rx="8" fill="url(#lattice)" stroke="#e6eef5" stroke-width="3"/>
  </svg>`;
}

/** The gold triangle used for the twelve insertion arrows. */
export function arrowSVG(): string {
  return `<svg class="arrow-art" viewBox="0 0 40 30">
    <path d="M20 27 3 4h34z" fill="#f2c93f" stroke="#8a6a12" stroke-width="2" stroke-linejoin="round"/>
    <path d="M20 21 10 8h20z" fill="#fbe79a" stroke="none" opacity=".7"/>
  </svg>`;
}
