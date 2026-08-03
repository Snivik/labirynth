/**
 * Bun server: serves the game and runs the rooms over one websocket.
 *
 * Nothing is written to disk. A room lives as long as somebody is connected to
 * it, which is exactly as long as anybody cares about it.
 */

import type { ServerWebSocket } from "bun";
import index from "../client/index.html";
import type { PawnColor } from "../game/board.ts";
import {
  RoomError,
  again,
  begin,
  createRoom,
  disconnect,
  getRoom,
  insert,
  joinRoom,
  move,
  pass,
  reapIdleRooms,
  removeSeat,
  resumeSeat,
  roomCount,
  roomView,
  rotate,
  setCards,
  setColor,
  setName,
  type Room,
  type Seat,
} from "./rooms.ts";
import type { ClientMessage, GameEvent, ServerMessage } from "../shared/protocol.ts";

const PORT = Number(process.env.PORT ?? 3000);
/** Nothing legitimate comes close; anything bigger is a client gone wrong. */
const MAX_MESSAGE = 4096;

interface WsData {
  code: string | null;
  seatId: string | null;
}

type Socket = ServerWebSocket<WsData>;

/** One live socket per seat. A second tab on the same seat displaces the first. */
const sockets = new Map<string, Socket>();

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, { headers: { "cache-control": "no-store" }, ...init });

function send(ws: Socket, message: ServerMessage) {
  ws.send(JSON.stringify(message));
}

function broadcast(room: Room, event?: GameEvent) {
  for (const seat of room.seats) {
    const ws = sockets.get(seat.id);
    if (ws) send(ws, { t: "room", room: roomView(room, seat.id), event });
  }
}

/** Point this socket at a seat, displacing any socket already sitting there. */
function attach(ws: Socket, room: Room, seat: Seat) {
  const existing = sockets.get(seat.id);
  if (existing && existing !== ws) {
    send(existing, { t: "closed", reason: "You opened this seat in another window." });
    existing.data.seatId = null;
    existing.close();
  }
  ws.data.code = room.code;
  ws.data.seatId = seat.id;
  sockets.set(seat.id, ws);
  send(ws, { t: "seat", code: room.code, playerId: seat.id, token: seat.token });
  broadcast(room);
}

/** The room and seat this socket is sitting in, or an error if it isn't. */
function seated(ws: Socket): { room: Room; seatId: string } {
  const { code, seatId } = ws.data;
  const room = code ? getRoom(code) : undefined;
  if (!room || !seatId || !room.seats.some((s) => s.id === seatId))
    throw new RoomError("you are not in a room any more");
  return { room, seatId };
}

function handle(ws: Socket, msg: ClientMessage) {
  switch (msg.t) {
    case "create": {
      const { room, seat } = createRoom(msg.name);
      attach(ws, room, seat);
      return;
    }
    case "join": {
      const { room, seat } = joinRoom(msg.code, msg.name);
      attach(ws, room, seat);
      return;
    }
    case "resume": {
      // A stale seat isn't an error the player can act on — send them back to
      // the front door with the reason instead of flashing a toast.
      try {
        const { room, seat } = resumeSeat(msg.code, msg.playerId, msg.token);
        attach(ws, room, seat);
      } catch (err) {
        const reason = err instanceof RoomError ? err.message : "that room is gone";
        send(ws, { t: "closed", reason });
      }
      return;
    }
  }

  const { room, seatId } = seated(ws);

  switch (msg.t) {
    case "name":
      setName(room, seatId, msg.name);
      return broadcast(room);
    case "color":
      setColor(room, seatId, msg.color as PawnColor);
      return broadcast(room);
    case "cards":
      setCards(room, seatId, Number(msg.cardsPerPlayer));
      return broadcast(room);
    case "begin":
      return broadcast(room, begin(room, seatId));
    case "rotate":
      return broadcast(room, rotate(room, seatId, Number(msg.quarters)));
    case "insert":
      return broadcast(room, insert(room, seatId, String(msg.arrowId)));
    case "move":
      return broadcast(room, move(room, seatId, Number(msg.r), Number(msg.c)));
    case "pass":
      return broadcast(room, pass(room, seatId));
    case "again":
      again(room, seatId);
      return broadcast(room);
    case "leave": {
      sockets.delete(seatId);
      ws.data.seatId = null;
      ws.data.code = null;
      removeSeat(room, seatId);
      send(ws, { t: "closed", reason: "You left the room." });
      if (getRoom(room.code)) broadcast(room);
      return;
    }
    default:
      throw new RoomError("the server did not understand that");
  }
}

const server = Bun.serve<WsData, never>({
  port: PORT,
  hostname: "0.0.0.0",
  development: process.env.NODE_ENV !== "production",

  routes: {
    "/": index,
    // shareable invite link: labyrinth.example/j/ABCD
    "/j/:code": index,
    "/api/health": () => json({ ok: true, rooms: roomCount() }),
  },

  fetch(req, srv) {
    if (new URL(req.url).pathname === "/ws") {
      if (srv.upgrade(req, { data: { code: null, seatId: null } satisfies WsData })) return;
      return new Response("expected a websocket upgrade", { status: 400 });
    }
    return new Response("Not found", { status: 404 });
  },

  websocket: {
    // Bun's own pings keep the socket alive through a long think.
    idleTimeout: 300,
    sendPings: true,
    maxPayloadLength: MAX_MESSAGE,

    message(ws, raw) {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as ClientMessage;
      } catch {
        return send(ws, { t: "error", message: "that was not a message" });
      }
      try {
        handle(ws, msg);
      } catch (err) {
        if (err instanceof RoomError) return send(ws, { t: "error", message: err.message });
        console.error("action failed", msg.t, err);
        send(ws, { t: "error", message: "something went wrong on the server" });
      }
    },

    close(ws) {
      const { code, seatId } = ws.data;
      if (!seatId) return;
      if (sockets.get(seatId) === ws) sockets.delete(seatId);
      const room = code ? getRoom(code) : undefined;
      if (!room) return;
      disconnect(room, seatId);
      if (getRoom(room.code)) broadcast(room);
    },
  },
});

setInterval(
  () => {
    const dropped = reapIdleRooms();
    if (dropped) console.log(`swept ${dropped} idle room${dropped === 1 ? "" : "s"}`);
  },
  5 * 60 * 1000,
).unref();

console.log(`🏰  Labyrinth listening on http://localhost:${server.port}`);
