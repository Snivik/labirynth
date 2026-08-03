/**
 * Rooms live in memory for as long as somebody is playing in them.
 *
 * Every rule check happens here, on the server. The browser can ask for
 * anything it likes; if it isn't that player's turn, or the arrow is the blocked
 * one, it gets an error back and the board doesn't move.
 */

import { HOME_CORNERS, pathBetween, type PawnColor } from "../game/board.ts";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  applyInsert,
  applyMove,
  createGame,
  currentPlayer,
  maxCardsPerPlayer,
  passTurn,
  playerById,
  rotateSpare,
  targetOf,
  type GameState,
} from "../game/engine.ts";
import {
  CODE_LENGTH,
  cleanName,
  type GameEvent,
  type RoomStatus,
  type RoomView,
} from "../shared/protocol.ts";

/** Unambiguous when read aloud over a phone: no I, O, 0, 1 or L. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DEFAULT_CARDS = 5;
/** A room with nobody connected is thrown away after this long. */
const IDLE_MS = 30 * 60 * 1000;

const COLORS: PawnColor[] = HOME_CORNERS.map((h) => h.color);

export class RoomError extends Error {}

export interface Seat {
  id: string;
  token: string;
  name: string;
  color: PawnColor;
  connected: boolean;
  /** When they last had a live socket, for reaping and for the roster dot. */
  lastSeen: number;
}

export interface Room {
  code: string;
  hostId: string;
  seats: Seat[];
  status: RoomStatus;
  /** What the host asked for; the effective value is clamped to the table size. */
  cardsPerPlayer: number;
  game: GameState | null;
  /** Fresh per deal. The client rebuilds its board when it changes. */
  gameId: string;
  touched: number;
}

const rooms = new Map<string, Room>();

export function roomCount(): number {
  return rooms.size;
}

/* ─────────────────────────── lookup and creation ─────────────────────────── */

function newCode(): string {
  for (let attempt = 0; attempt < 400; attempt++) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new RoomError("the server is full of rooms — try again in a minute");
}

function newSeat(name: string, color: PawnColor): Seat {
  return {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    name,
    color,
    connected: true,
    lastSeen: Date.now(),
  };
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.trim().toUpperCase());
}

function requireRoom(code: string): Room {
  const room = getRoom(code);
  if (!room) throw new RoomError("no room with that code — check the letters");
  return room;
}

function touch(room: Room) {
  room.touched = Date.now();
}

export function createRoom(rawName: string): { room: Room; seat: Seat } {
  const seat = newSeat(fallbackName(rawName, 0), COLORS[0]!);
  const room: Room = {
    code: newCode(),
    hostId: seat.id,
    seats: [seat],
    status: "lobby",
    cardsPerPlayer: DEFAULT_CARDS,
    game: null,
    gameId: crypto.randomUUID(),
    touched: Date.now(),
  };
  rooms.set(room.code, room);
  return { room, seat };
}

export function joinRoom(code: string, rawName: string): { room: Room; seat: Seat } {
  const room = requireRoom(code);
  if (room.status === "playing")
    throw new RoomError("that game is already under way — they can deal you in next round");
  if (room.status !== "lobby")
    throw new RoomError("that game has just finished — ask the host to open the lobby");
  if (room.seats.length >= MAX_PLAYERS)
    throw new RoomError(`that room is full (${MAX_PLAYERS} players)`);

  const taken = new Set(room.seats.map((s) => s.color));
  const color = COLORS.find((c) => !taken.has(c))!;
  const seat = newSeat(fallbackName(rawName, room.seats.length), color);
  room.seats.push(seat);
  touch(room);
  return { room, seat };
}

/** Pick the seat back up after a refresh or a dropped connection. */
export function resumeSeat(
  code: string,
  playerId: string,
  token: string,
): { room: Room; seat: Seat } {
  const room = requireRoom(code);
  const seat = room.seats.find((s) => s.id === playerId);
  if (!seat || seat.token !== token) throw new RoomError("that seat is no longer yours");
  seat.connected = true;
  seat.lastSeen = Date.now();
  rehost(room);
  touch(room);
  return { room, seat };
}

function fallbackName(raw: string, index: number): string {
  return cleanName(raw) || `Player ${index + 1}`;
}

/* ─────────────────────────── coming and going ─────────────────────────── */

/**
 * Host is whoever sits first among the connected. It never moves back when the
 * old host reconnects — that would hand the controls around under people.
 */
function rehost(room: Room) {
  if (room.seats.some((s) => s.id === room.hostId && s.connected)) return;
  const next = room.seats.find((s) => s.connected) ?? room.seats[0];
  if (next) room.hostId = next.id;
}

/**
 * A socket dropped. In the lobby the seat goes with it; mid-game it is held open
 * so they can come back to their pawn and their cards.
 */
export function disconnect(room: Room, seatId: string) {
  const seat = room.seats.find((s) => s.id === seatId);
  if (!seat) return;
  seat.connected = false;
  seat.lastSeen = Date.now();
  if (room.status === "lobby") room.seats = room.seats.filter((s) => s.id !== seatId);
  rehost(room);
  touch(room);
  if (room.seats.length === 0) rooms.delete(room.code);
}

/** They pressed Leave, so the seat goes even if a game is running. */
export function removeSeat(room: Room, seatId: string) {
  room.seats = room.seats.filter((s) => s.id !== seatId);
  rehost(room);
  touch(room);
  if (room.seats.length === 0) {
    rooms.delete(room.code);
    return;
  }
  // A game can't continue a player short — the board and the hands are dealt.
  if (room.status === "playing" && room.game?.players.some((p) => p.id === seatId)) {
    room.status = "lobby";
    room.game = null;
  }
}

export function reapIdleRooms(now = Date.now()): number {
  let dropped = 0;
  for (const room of [...rooms.values()]) {
    if (room.seats.some((s) => s.connected)) continue;
    if (now - room.touched < IDLE_MS) continue;
    rooms.delete(room.code);
    dropped++;
  }
  return dropped;
}

/* ─────────────────────────── lobby settings ─────────────────────────── */

function seatOf(room: Room, seatId: string): Seat {
  const seat = room.seats.find((s) => s.id === seatId);
  if (!seat) throw new RoomError("you are not in this room");
  return seat;
}

export function setName(room: Room, seatId: string, raw: string) {
  const seat = seatOf(room, seatId);
  seat.name = cleanName(raw) || seat.name;
  touch(room);
}

export function setColor(room: Room, seatId: string, color: PawnColor) {
  if (room.status !== "lobby") throw new RoomError("corners are fixed once the game starts");
  if (!COLORS.includes(color)) throw new RoomError("no such corner");
  const seat = seatOf(room, seatId);
  const holder = room.seats.find((s) => s.color === color);
  if (holder && holder.id !== seat.id)
    throw new RoomError(`${holder.name} is already in that corner`);
  seat.color = color;
  touch(room);
}

export function effectiveCards(room: Room): number {
  return Math.max(1, Math.min(room.cardsPerPlayer, maxCardsPerPlayer(room.seats.length)));
}

export function setCards(room: Room, seatId: string, cards: number) {
  requireHost(room, seatId);
  if (room.status !== "lobby") throw new RoomError("the hands are already dealt");
  if (!Number.isFinite(cards)) throw new RoomError("that is not a number of cards");
  room.cardsPerPlayer = Math.max(
    1,
    Math.min(Math.trunc(cards), maxCardsPerPlayer(MIN_PLAYERS)),
  );
  touch(room);
}

function requireHost(room: Room, seatId: string) {
  if (room.hostId !== seatId) throw new RoomError("only the host can do that");
}

/* ─────────────────────────── running the game ─────────────────────────── */

export function begin(room: Room, seatId: string): GameEvent {
  requireHost(room, seatId);
  if (room.status === "playing") throw new RoomError("the game is already running");
  if (room.seats.length < MIN_PLAYERS)
    throw new RoomError(`you need at least ${MIN_PLAYERS} players`);

  room.game = createGame({
    seats: room.seats.map((s) => ({ id: s.id, color: s.color })),
    cardsPerPlayer: effectiveCards(room),
  });
  room.gameId = crypto.randomUUID();
  room.status = "playing";
  touch(room);
  return { type: "begin" };
}

export function again(room: Room, seatId: string): void {
  requireHost(room, seatId);
  room.status = "lobby";
  room.game = null;
  touch(room);
}

function requireTurn(room: Room, seatId: string): GameState {
  const game = room.game;
  if (!game || room.status !== "playing") throw new RoomError("no game is running");
  if (game.phase === "over") throw new RoomError("the game is over");
  if (currentPlayer(game).id !== seatId) throw new RoomError("it is not your turn");
  return game;
}

export function rotate(room: Room, seatId: string, quarters: number): GameEvent {
  const game = requireTurn(room, seatId);
  if (game.phase !== "insert") throw new RoomError("you have already pushed the tile in");
  if (!Number.isInteger(quarters)) throw new RoomError("turn it a quarter at a time");
  room.game = rotateSpare(game, quarters);
  touch(room);
  return { type: "rotate", playerId: seatId, rot: room.game.spare.rot };
}

export function insert(room: Room, seatId: string, arrowId: string): GameEvent {
  const game = requireTurn(room, seatId);
  const out = applyInsert(game, arrowId);
  room.game = out.state;
  touch(room);
  return {
    type: "insert",
    playerId: seatId,
    arrowId,
    entry: out.entry,
    exit: out.exit,
    wrapped: out.wrapped,
  };
}

export function move(room: Room, seatId: string, r: number, c: number): GameEvent {
  const game = requireTurn(room, seatId);
  if (game.phase !== "move") throw new RoomError("push the spare tile in first");

  const from = currentPlayer(game).pawn;
  // worked out before the move, purely so the client can walk the pawn there
  const path = pathBetween(game.grid, from, { r, c }) ?? [[from.r, from.c]];

  const out = applyMove(game, { r, c });
  room.game = out.state;
  if (out.won) room.status = "over";
  touch(room);
  return { type: "move", playerId: seatId, path, collected: out.collected, won: out.won };
}

/** Skip past somebody who has dropped out, so the table isn't stuck on them. */
export function pass(room: Room, seatId: string): GameEvent {
  const game = room.game;
  if (!game || room.status !== "playing") throw new RoomError("no game is running");
  seatOf(room, seatId);

  const stuckOn = currentPlayer(game);
  const seat = room.seats.find((s) => s.id === stuckOn.id);
  if (seat?.connected) throw new RoomError(`${seat.name} is still here — it's their turn`);

  room.game = passTurn(game);
  touch(room);
  return { type: "pass", playerId: stuckOn.id };
}

/* ─────────────────────────── views ─────────────────────────── */

/** The room as one player sees it: everyone's pile, but only your own card. */
export function roomView(room: Room, viewerId: string): RoomView {
  const game = room.game;

  return {
    code: room.code,
    youId: viewerId,
    status: room.status,
    cardsPerPlayer: effectiveCards(room),
    maxCardsPerPlayer: maxCardsPerPlayer(Math.max(room.seats.length, MIN_PLAYERS)),
    winnerId: game?.winnerId ?? null,
    players: room.seats.map((seat) => {
      const player = game ? playerById(game, seat.id) : undefined;
      const target = player ? targetOf(player) : null;
      return {
        id: seat.id,
        name: seat.name,
        color: seat.color,
        connected: seat.connected,
        host: seat.id === room.hostId,
        pawn: player?.pawn ?? homeOf(seat.color),
        home: player?.home ?? homeOf(seat.color),
        collected: player?.collected ?? [],
        remaining: player?.hand.length ?? 0,
        // your own card only: everybody else's stack stays face down
        ...(seat.id === viewerId
          ? { card: target?.kind === "treasure" ? target.treasureId! : null }
          : {}),
      };
    }),
    game: game
      ? {
          id: room.gameId,
          grid: game.grid,
          spare: game.spare,
          currentId: currentPlayer(game).id,
          phase: game.phase,
          blockedArrow: game.blockedArrow,
          turn: game.turn,
        }
      : null,
  };
}

function homeOf(color: PawnColor) {
  const corner = HOME_CORNERS.find((h) => h.color === color)!;
  return { r: corner.r, c: corner.c };
}
