/**
 * The wire format, shared by the server and the browser.
 *
 * The server owns the game. The client sends intents and renders whatever comes
 * back, so a stale or tampered-with client can't invent a legal move.
 */

import type { Cell, PawnColor } from "../game/board.ts";
import type { Phase } from "../game/engine.ts";
import type { Rotation, Tile } from "../game/tiles.ts";

export type RoomStatus = "lobby" | "playing" | "over";

export const NAME_MAX = 16;
export const CODE_LENGTH = 4;

export interface PlayerView {
  id: string;
  name: string;
  color: PawnColor;
  connected: boolean;
  host: boolean;
  pawn: Cell;
  home: Cell;
  /** Treasures claimed so far — everyone's pile is face up, as on the table. */
  collected: string[];
  /** How many cards are left in their stack. */
  remaining: number;
  /**
   * The card in front of them. Only ever filled in on the copy sent to that
   * player: you hold your own stack face down in this game.
   */
  card?: string | null;
}

export interface GameView {
  /** New every deal, so the client knows to rebuild the board from scratch. */
  id: string;
  grid: Tile[][];
  spare: Tile;
  currentId: string;
  phase: Phase;
  blockedArrow: string | null;
  turn: number;
}

export interface RoomView {
  code: string;
  youId: string;
  status: RoomStatus;
  cardsPerPlayer: number;
  /** Ceiling for the setting above, given how many players are in the room. */
  maxCardsPerPlayer: number;
  players: PlayerView[];
  game: GameView | null;
  winnerId: string | null;
}

/** What just happened, so the client can animate it instead of snapping. */
export type GameEvent =
  | { type: "rotate"; playerId: string; rot: Rotation }
  | {
      type: "insert";
      playerId: string;
      arrowId: string;
      entry: [number, number];
      exit: [number, number];
      /** Players whose pawn rode off the far edge and reappeared. */
      wrapped: string[];
    }
  | {
      type: "move";
      playerId: string;
      path: [number, number][];
      collected: string | null;
      won: boolean;
    }
  | { type: "pass"; playerId: string }
  | { type: "begin" };

export type ServerMessage =
  /** Your credentials, sent once when you take a seat. Enough to reconnect. */
  | { t: "seat"; code: string; playerId: string; token: string }
  | { t: "room"; room: RoomView; event?: GameEvent }
  /** The room is gone, or you left it. The client goes back to the front door. */
  | { t: "closed"; reason: string }
  | { t: "error"; message: string };

export type ClientMessage =
  | { t: "create"; name: string }
  | { t: "join"; code: string; name: string }
  | { t: "resume"; code: string; playerId: string; token: string }
  | { t: "name"; name: string }
  | { t: "color"; color: PawnColor }
  | { t: "cards"; cardsPerPlayer: number }
  | { t: "begin" }
  | { t: "rotate"; quarters: number }
  | { t: "insert"; arrowId: string }
  | { t: "move"; r: number; c: number }
  /** Skip whoever is in turn, once they have dropped out. */
  | { t: "pass" }
  /** Host only: back to the lobby for another game. */
  | { t: "again" }
  | { t: "leave" };

export function cleanName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}
