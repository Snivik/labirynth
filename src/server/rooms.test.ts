/**
 * Room tests: who is allowed to do what, and what each player is allowed to see.
 */

import { describe, expect, test } from "bun:test";
import { currentPlayer } from "../game/engine.ts";
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
  removeSeat,
  resumeSeat,
  roomView,
  rotate,
  setColor,
  type Room,
  type Seat,
} from "./rooms.ts";

/** A room with `count` players sitting in it, ready to be dealt. */
function table(count = 2): { room: Room; seats: Seat[] } {
  const { room, seat } = createRoom("Ada");
  const seats = [seat];
  for (let i = 1; i < count; i++) {
    seats.push(joinRoom(room.code, `Player ${i + 1}`).seat);
  }
  return { room, seats };
}

/** Deal, then return the seat whose turn it is and one whose turn it is not. */
function dealt(count = 2) {
  const { room, seats } = table(count);
  begin(room, room.hostId);
  const inTurn = seats.find((s) => s.id === currentPlayer(room.game!).id)!;
  const waiting = seats.find((s) => s.id !== inTurn.id)!;
  return { room, seats, inTurn, waiting };
}

describe("getting into a room", () => {
  test("the code is four unambiguous characters and finds the room", () => {
    const { room } = table(1);
    expect(room.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    expect(getRoom(room.code)).toBe(room);
    expect(getRoom(room.code.toLowerCase())).toBe(room);
  });

  test("the first player hosts, and everyone gets their own corner", () => {
    const { room, seats } = table(4);
    expect(room.hostId).toBe(seats[0]!.id);
    expect(new Set(seats.map((s) => s.color)).size).toBe(4);
  });

  test("a nameless player still gets a name", () => {
    const { room } = createRoom("   ");
    expect(room.seats[0]!.name).toBe("Player 1");
  });

  test("a fifth player and a latecomer are both turned away", () => {
    const { room } = table(4);
    expect(() => joinRoom(room.code, "Eve")).toThrow(/full/);

    const { room: started } = table(2);
    begin(started, started.hostId);
    expect(() => joinRoom(started.code, "Eve")).toThrow(/already under way/);

    started.status = "over";
    expect(() => joinRoom(started.code, "Eve")).toThrow(/just finished/);
    again(started, started.hostId);
    expect(joinRoom(started.code, "Eve").seat.name).toBe("Eve");

    expect(() => joinRoom("ZZZZ", "Eve")).toThrow(/no room with that code/);
  });

  test("a seat can only be picked back up with its own token", () => {
    const { room, seats } = table(2);
    begin(room, room.hostId);
    const seat = seats[1]!;
    disconnect(room, seat.id);
    expect(seat.connected).toBe(false);

    expect(() => resumeSeat(room.code, seat.id, "not-the-token")).toThrow(RoomError);
    expect(resumeSeat(room.code, seat.id, seat.token).seat.connected).toBe(true);
  });
});

describe("coming and going", () => {
  test("dropping out of the lobby gives the seat up; dropping mid-game holds it", () => {
    const { room: lobby, seats: lobbySeats } = table(3);
    disconnect(lobby, lobbySeats[2]!.id);
    expect(lobby.seats.length).toBe(2);

    const { room, seats } = table(3);
    begin(room, room.hostId);
    disconnect(room, seats[2]!.id);
    expect(room.seats.length).toBe(3);
    expect(room.game!.players.length).toBe(3);
  });

  test("the host moves on when they drop, and does not take it back", () => {
    const { room, seats } = table(3);
    begin(room, room.hostId);
    disconnect(room, seats[0]!.id);
    expect(room.hostId).toBe(seats[1]!.id);

    resumeSeat(room.code, seats[0]!.id, seats[0]!.token);
    expect(room.hostId).toBe(seats[1]!.id);
  });

  test("the room disappears when the last player goes", () => {
    const { room, seats } = table(2);
    disconnect(room, seats[0]!.id);
    disconnect(room, seats[1]!.id);
    expect(getRoom(room.code)).toBeUndefined();
  });

  test("leaving a running game puts the rest back in the lobby", () => {
    const { room, seats } = table(3);
    begin(room, room.hostId);
    removeSeat(room, seats[1]!.id);
    expect(room.status).toBe("lobby");
    expect(room.game).toBeNull();
    expect(room.seats.length).toBe(2);
  });
});

describe("the lobby", () => {
  test("you can take a free corner but not somebody else's", () => {
    const { room, seats } = table(2);
    const mine = seats[0]!.color;
    const theirs = seats[1]!.color;
    expect(() => setColor(room, seats[0]!.id, theirs)).toThrow(/already in that corner/);

    setColor(room, seats[0]!.id, "green");
    expect(seats[0]!.color).toBe("green");
    // and the corner just vacated is free again
    setColor(room, seats[1]!.id, mine);
    expect(seats[1]!.color).toBe(mine);
    expect(theirs).not.toBe(mine);
  });

  test("only the host deals, and only with company", () => {
    const { room, seats } = table(1);
    expect(() => begin(room, seats[0]!.id)).toThrow(/at least 2/);

    const { room: pair, seats: pairSeats } = table(2);
    expect(() => begin(pair, pairSeats[1]!.id)).toThrow(/only the host/);
    begin(pair, pairSeats[0]!.id);
    expect(pair.status).toBe("playing");
    expect(pair.game!.players.length).toBe(2);
  });

  test("a fresh deal gets a fresh game id, so the board is rebuilt not animated", () => {
    const { room } = table(2);
    begin(room, room.hostId);
    const first = room.gameId;
    again(room, room.hostId);
    expect(room.status).toBe("lobby");
    begin(room, room.hostId);
    expect(room.gameId).not.toBe(first);
  });

  test("corners are settled once the cards are out", () => {
    const { room, seats } = table(2);
    begin(room, room.hostId);
    expect(() => setColor(room, seats[0]!.id, "green")).toThrow(/fixed once the game starts/);
  });
});

describe("taking a turn", () => {
  test("only the player in turn may act, and only in the right order", () => {
    const { room, inTurn, waiting } = dealt();

    expect(() => insert(room, waiting.id, "top-1")).toThrow(/not your turn/);
    expect(() => move(room, inTurn.id, 0, 0)).toThrow(/push the spare tile in first/);

    rotate(room, inTurn.id, 1);
    insert(room, inTurn.id, "top-1");
    expect(room.game!.phase).toBe("move");
    expect(() => rotate(room, inTurn.id, 1)).toThrow(/already pushed/);
    expect(() => insert(room, inTurn.id, "top-3")).toThrow(/not your turn|cannot insert/);
  });

  test("the undo arrow is refused", () => {
    const { room, inTurn } = dealt();
    insert(room, inTurn.id, "top-1");
    const pawn = currentPlayer(room.game!).pawn;
    move(room, inTurn.id, pawn.r, pawn.c);
    const next = currentPlayer(room.game!).id;
    expect(() => insert(room, next, "bottom-1")).toThrow(/undo/);
  });

  test("a turn can only be skipped once its owner has actually gone", () => {
    const { room, inTurn, waiting } = dealt();
    expect(() => pass(room, waiting.id)).toThrow(/still here/);

    disconnect(room, inTurn.id);
    pass(room, waiting.id);
    expect(currentPlayer(room.game!).id).toBe(waiting.id);
  });
});

describe("what each player can see", () => {
  test("you see your own card and nobody else's", () => {
    const { room, seats } = table(2);
    begin(room, room.hostId);
    const view = roomView(room, seats[0]!.id);

    const mine = view.players.find((p) => p.id === seats[0]!.id)!;
    const theirs = view.players.find((p) => p.id === seats[1]!.id)!;

    expect(typeof mine.card).toBe("string");
    expect(mine.card).toBe(room.game!.players.find((p) => p.id === seats[0]!.id)!.hand[0]);
    expect("card" in theirs).toBe(false);
    // the whole serialised view must not leak the other hand either
    const hidden = room.game!.players.find((p) => p.id === seats[1]!.id)!.hand;
    for (const treasureId of hidden.slice(1)) {
      expect(JSON.stringify(view.players)).not.toContain(treasureId);
    }
  });

  test("how many cards everyone has left is public; which ones are not", () => {
    const { room, seats } = table(2);
    begin(room, room.hostId);
    const view = roomView(room, seats[0]!.id);
    for (const player of view.players) {
      expect(player.remaining).toBe(5);
      expect(player.collected).toEqual([]);
    }
  });

  test("the lobby view reports the deal that would actually happen", () => {
    const { room } = table(4);
    room.cardsPerPlayer = 10;
    const view = roomView(room, room.hostId);
    // four players cannot have ten each out of twenty-four
    expect(view.maxCardsPerPlayer).toBe(6);
    expect(view.cardsPerPlayer).toBe(6);
  });
});
