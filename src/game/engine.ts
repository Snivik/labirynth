/**
 * Game state machine.
 *
 * Two to four players share one board. On your turn you may turn the spare tile
 * to any of its four rotations, then you must push it into the labyrinth, then
 * you may walk as far as the open corridors allow. Find the treasure on your
 * card, take the next card, and when your stack is empty walk home to win.
 */

import {
  ARROWS,
  HOME_CORNERS,
  type Arrow,
  type Cell,
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
import { rotate, type Tile } from "./tiles.ts";
import { ALL_TREASURES } from "./treasures.ts";

export type Phase =
  /** Waiting for the player in turn to rotate and push the spare tile. */
  | "insert"
  /** Tile is in, waiting for them to walk (or stay put). */
  | "move"
  /** Somebody has collected everything and made it home. */
  | "over";

export const MAX_PLAYERS = HOME_CORNERS.length;
export const MIN_PLAYERS = 2;

/** With 24 treasures to share out, this is what each player can be dealt. */
export function maxCardsPerPlayer(playerCount: number): number {
  return Math.floor(ALL_TREASURES.length / Math.max(1, playerCount));
}

export interface Target {
  kind: "treasure" | "home";
  treasureId?: string;
}

export interface GamePlayer {
  id: string;
  color: PawnColor;
  pawn: Cell;
  home: Cell;
  /** Treasure cards still to find. Index 0 is the card in front of them. */
  hand: string[];
  /** Treasure ids already claimed, in the order they were collected. */
  collected: string[];
}

export interface GameState {
  version: 3;
  seed: number;
  grid: Tile[][];
  spare: Tile;
  players: GamePlayer[];
  /** Index into `players` of whoever is acting. */
  current: number;
  /** Arrow that may not be used this turn — it would undo the last push. */
  blockedArrow: string | null;
  phase: Phase;
  /** Player-turns taken so far, counting from 1. */
  turn: number;
  winnerId: string | null;
}

export interface Seat {
  id: string;
  color: PawnColor;
}

export interface CreateOptions {
  seats: Seat[];
  cardsPerPlayer: number;
  seed?: number;
}

export function createGame(opts: CreateOptions): GameState {
  if (opts.seats.length < MIN_PLAYERS)
    throw new Error(`a game needs at least ${MIN_PLAYERS} players`);
  if (opts.seats.length > MAX_PLAYERS)
    throw new Error(`a board only has ${MAX_PLAYERS} corners`);
  if (new Set(opts.seats.map((s) => s.color)).size !== opts.seats.length)
    throw new Error("two players cannot share a corner");

  const cards = Math.max(
    1,
    Math.min(Math.trunc(opts.cardsPerPlayer), maxCardsPerPlayer(opts.seats.length)),
  );
  const seed = opts.seed ?? (Math.random() * 2 ** 32) >>> 0;
  const rng = makeRng(seed);
  const { grid, spare } = createBoard(rng);
  const deck = shuffle(
    ALL_TREASURES.map((t) => t.id),
    rng,
  );

  const players: GamePlayer[] = opts.seats.map((seat, i) => {
    const corner = HOME_CORNERS.find((h) => h.color === seat.color)!;
    return {
      id: seat.id,
      color: seat.color,
      pawn: { r: corner.r, c: corner.c },
      home: { r: corner.r, c: corner.c },
      hand: deck.slice(i * cards, i * cards + cards),
      collected: [],
    };
  });

  return {
    version: 3,
    seed,
    grid,
    spare,
    players,
    // drawn from the seed, so the host isn't automatically first
    current: Math.floor(rng() * players.length),
    blockedArrow: null,
    phase: "insert",
    turn: 1,
    winnerId: null,
  };
}

export function currentPlayer(state: GameState): GamePlayer {
  return state.players[state.current]!;
}

export function playerById(state: GameState, id: string): GamePlayer | undefined {
  return state.players.find((p) => p.id === id);
}

/** What this player is hunting: the card in front of them, or their corner. */
export function targetOf(player: GamePlayer): Target {
  return player.hand.length > 0
    ? { kind: "treasure", treasureId: player.hand[0]! }
    : { kind: "home" };
}

/** Board cell the target sits on, or null when the treasure is on the spare tile. */
export function targetCell(state: GameState, player: GamePlayer): Cell | null {
  const target = targetOf(player);
  if (target.kind === "home") return player.home;
  return findTreasure(state.grid, target.treasureId!);
}

/** True when the player's target treasure is on the spare tile, not the board. */
export function targetInHand(state: GameState, player: GamePlayer): boolean {
  const target = targetOf(player);
  return target.kind === "treasure" && state.spare.treasure === target.treasureId;
}

export function legalArrows(state: GameState): Arrow[] {
  return ARROWS.filter((a) => a.id !== state.blockedArrow);
}

/** Turn the spare tile in the hand of the player in turn. */
export function rotateSpare(state: GameState, quarters: number): GameState {
  if (state.phase !== "insert")
    throw new Error(`cannot turn the spare tile during phase ${state.phase}`);
  return { ...state, spare: rotate(state.spare, quarters) };
}

export interface InsertOutcome {
  state: GameState;
  arrowId: string;
  entry: [number, number];
  exit: [number, number];
  /** Tile that was pushed out and is now the spare. */
  ejected: Tile;
  /** Ids of players whose pawn rode off the far edge and reappeared. */
  wrapped: string[];
}

/** Push the spare tile in. Legal only during the `insert` phase. */
export function applyInsert(state: GameState, arrowId: string): InsertOutcome {
  if (state.phase !== "insert") throw new Error(`cannot insert during phase ${state.phase}`);
  const arrow = arrowById(arrowId);
  if (!arrow) throw new Error(`unknown arrow ${arrowId}`);
  if (arrowId === state.blockedArrow) throw new Error("that arrow would undo the last push");

  const result = shift(
    state.grid,
    state.spare,
    arrow,
    state.players.map((p) => p.pawn),
  );

  return {
    state: {
      ...state,
      grid: result.grid,
      spare: result.spare,
      players: state.players.map((p, i) => ({ ...p, pawn: result.pawns[i]! })),
      blockedArrow: oppositeArrow(arrowId),
      phase: "move",
    },
    arrowId,
    entry: result.entry,
    exit: result.exit,
    ejected: result.spare,
    wrapped: result.wrapped.map((i) => state.players[i]!.id),
  };
}

/** Cells the player in turn can currently walk to. */
export function movableCells(state: GameState): Set<string> {
  return reachable(state.grid, currentPlayer(state).pawn);
}

export interface MoveOutcome {
  state: GameState;
  /** Treasure just claimed, if the pawn landed on the player's own target. */
  collected: string | null;
  /** True when this player's stack was empty and they walked onto their corner. */
  won: boolean;
}

/**
 * Walk the pawn to `to` (which may be where it already stands) and hand the
 * board to the next player.
 */
export function applyMove(state: GameState, to: Cell): MoveOutcome {
  if (state.phase !== "move") throw new Error(`cannot move during phase ${state.phase}`);
  if (!movableCells(state).has(key(to.r, to.c)))
    throw new Error("no open path to that square");

  const player = currentPlayer(state);
  // Read the target before the move: collecting the last treasure sets the next
  // target to home, and that must not count as walking home in the same turn.
  const target = targetOf(player);

  let collected: string | null = null;
  let won = false;
  const moved: GamePlayer = { ...player, pawn: { ...to } };

  if (target.kind === "treasure") {
    if (state.grid[to.r]![to.c]!.treasure === target.treasureId) {
      collected = target.treasureId!;
      moved.hand = player.hand.slice(1);
      moved.collected = [...player.collected, collected];
    }
  } else if (to.r === player.home.r && to.c === player.home.c) {
    won = true;
  }

  return {
    state: {
      ...state,
      players: state.players.map((p, i) => (i === state.current ? moved : p)),
      phase: won ? "over" : "insert",
      winnerId: won ? player.id : null,
      current: won ? state.current : (state.current + 1) % state.players.length,
      turn: won ? state.turn : state.turn + 1,
    },
    collected,
    won,
  };
}

/**
 * Hand the turn on without playing it. Used when whoever is in turn has
 * disconnected and the others would otherwise be stuck waiting.
 */
export function passTurn(state: GameState): GameState {
  if (state.phase === "over") throw new Error("the game is already over");
  return {
    ...state,
    phase: "insert",
    current: (state.current + 1) % state.players.length,
    turn: state.turn + 1,
  };
}
