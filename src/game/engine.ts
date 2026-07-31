/**
 * Game state machine.
 *
 * Single player, full rules: every turn you must push the spare tile into the
 * labyrinth, then you may walk your pawn as far as the open corridors allow.
 * After you finish, an unseen opponent pushes the new spare tile in at a random
 * legal arrow, reshaping the maze under your feet.
 */

import {
  ARROWS,
  HOME_CORNERS,
  type Arrow,
  type PawnColor,
  arrowById,
  createBoard,
  findTreasure,
  key,
  makeRng,
  oppositeArrow,
  reachable,
  shift,
  shuffle,
} from "./board.ts";
import type { Tile } from "./tiles.ts";

export type Phase =
  /** Waiting for the player to pick an arrow. */
  | "insert"
  /** Tile is in, waiting for the player to walk (or stay put). */
  | "move"
  /** Opponent is reshaping the maze. */
  | "opponent"
  /** All treasures found and the player is back home. */
  | "won";

export interface Target {
  kind: "treasure" | "home";
  treasureId?: string;
}

export interface GameState {
  version: 1;
  seed: number;
  grid: Tile[][];
  spare: Tile;
  pawn: { r: number; c: number };
  home: { r: number; c: number };
  pawnColor: PawnColor;
  /** Treasure ids still to find, in reveal order. Index 0 is the current card. */
  deck: string[];
  /** Treasure ids already found, in the order they were collected. */
  collected: string[];
  /** Arrow that may not be used this turn (it would undo the last push). */
  blockedArrow: string | null;
  phase: Phase;
  turn: number;
  /** How many tiles the player has pushed in, for the stats screen. */
  pushes: number;
}

export interface CreateOptions {
  /** Treasure ids that act as collectibles, in the order they will be revealed. */
  collectibles: string[];
  pawnColor: PawnColor;
  seed?: number;
}

export function createGame(opts: CreateOptions): GameState {
  const seed = opts.seed ?? (Math.random() * 2 ** 32) >>> 0;
  const rng = makeRng(seed);
  const { grid, spare } = createBoard(rng);
  const corner = HOME_CORNERS.find((h) => h.color === opts.pawnColor) ?? HOME_CORNERS[0]!;

  return {
    version: 1,
    seed,
    grid,
    spare,
    pawn: { r: corner.r, c: corner.c },
    home: { r: corner.r, c: corner.c },
    pawnColor: opts.pawnColor,
    deck: opts.collectibles.slice(),
    collected: [],
    blockedArrow: null,
    phase: "insert",
    turn: 1,
    pushes: 0,
  };
}

/** Shuffle the collectible treasures into a deck order. */
export function buildDeck(treasureIds: string[], seed = (Math.random() * 2 ** 32) >>> 0): string[] {
  return shuffle(treasureIds, makeRng(seed));
}

export function currentTarget(state: GameState): Target | null {
  if (state.phase === "won") return null;
  if (state.deck.length > 0) return { kind: "treasure", treasureId: state.deck[0]! };
  return { kind: "home" };
}

/** Board cell the current target sits on, or null when the target tile is in hand. */
export function targetCell(state: GameState): { r: number; c: number } | null {
  const target = currentTarget(state);
  if (!target) return null;
  if (target.kind === "home") return state.home;
  return findTreasure(state.grid, target.treasureId!);
}

/** True when the target treasure is on the spare tile rather than on the board. */
export function targetInHand(state: GameState): boolean {
  const target = currentTarget(state);
  return (
    target?.kind === "treasure" && state.spare.treasure === target.treasureId
  );
}

export function legalArrows(state: GameState): Arrow[] {
  return ARROWS.filter((a) => a.id !== state.blockedArrow);
}

export interface InsertOutcome {
  state: GameState;
  entry: [number, number];
  exit: [number, number];
  /** Tile that was pushed out and is now the spare. */
  ejected: Tile;
  wrapped: boolean;
}

/** Push the spare tile in. Legal only during the `insert` phase. */
export function applyInsert(state: GameState, arrowId: string): InsertOutcome {
  if (state.phase !== "insert") throw new Error(`cannot insert during phase ${state.phase}`);
  const arrow = arrowById(arrowId);
  if (!arrow) throw new Error(`unknown arrow ${arrowId}`);
  if (arrowId === state.blockedArrow) throw new Error("that arrow would undo the last push");

  const result = shift(state.grid, state.spare, arrow, state.pawn);

  return {
    state: {
      ...state,
      grid: result.grid,
      spare: result.spare,
      pawn: result.pawn,
      blockedArrow: oppositeArrow(arrowId),
      phase: "move",
      pushes: state.pushes + 1,
    },
    entry: result.entry,
    exit: result.exit,
    ejected: result.spare,
    wrapped: result.wrappedPawn !== null,
  };
}

/** Cells the pawn can currently walk to. */
export function movableCells(state: GameState): Set<string> {
  return reachable(state.grid, state.pawn);
}

export interface MoveOutcome {
  state: GameState;
  /** Treasure just collected, if the pawn landed on the current target. */
  collected: string | null;
  /** True when the last treasure is in and the pawn made it home. */
  won: boolean;
}

/**
 * Walk the pawn to `to` (which may be where it already stands) and end the
 * player's half of the turn.
 */
export function applyMove(state: GameState, to: { r: number; c: number }): MoveOutcome {
  if (state.phase !== "move") throw new Error(`cannot move during phase ${state.phase}`);
  if (!movableCells(state).has(key(to.r, to.c)))
    throw new Error("no open path to that square");

  let next: GameState = { ...state, pawn: { ...to } };
  let collected: string | null = null;
  let won = false;

  const target = currentTarget(state);
  if (target?.kind === "treasure") {
    const tile = next.grid[to.r]![to.c]!;
    if (tile.treasure === target.treasureId) {
      collected = target.treasureId!;
      next = {
        ...next,
        deck: next.deck.slice(1),
        collected: [...next.collected, collected],
      };
    }
  } else if (target?.kind === "home") {
    if (to.r === state.home.r && to.c === state.home.c) won = true;
  }

  next.phase = won ? "won" : "opponent";
  return { state: next, collected, won };
}

export interface OpponentOutcome extends InsertOutcome {
  arrowId: string;
}

/**
 * The opponent's move: it holds no pawn and chases no treasure, it just shoves
 * the spare tile in somewhere legal and hands the board back changed.
 */
export function applyOpponentTurn(state: GameState, rng: () => number = Math.random): OpponentOutcome {
  if (state.phase !== "opponent") throw new Error(`opponent cannot act during ${state.phase}`);
  const options = ARROWS.filter((a) => a.id !== state.blockedArrow);
  const arrow = options[Math.floor(rng() * options.length)]!;
  const result = shift(state.grid, state.spare, arrow, state.pawn);

  return {
    arrowId: arrow.id,
    state: {
      ...state,
      grid: result.grid,
      spare: result.spare,
      pawn: result.pawn,
      blockedArrow: oppositeArrow(arrow.id),
      phase: "insert",
      turn: state.turn + 1,
    },
    entry: result.entry,
    exit: result.exit,
    ejected: result.spare,
    wrapped: result.wrappedPawn !== null,
  };
}
