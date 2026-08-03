/**
 * Rule tests. Run with `bun test`.
 */

import { describe, expect, test } from "bun:test";
import {
  ARROWS,
  SHIFTABLE,
  SIZE,
  arrowById,
  createBoard,
  isFixed,
  key,
  makeRng,
  oppositeArrow,
  pathBetween,
  reachable,
  shift,
} from "./board.ts";
import { MOVABLE_SHAPE_COUNTS, openings, openingsOf, type Tile } from "./tiles.ts";
import { ALL_TREASURES } from "./treasures.ts";
import {
  MAX_PLAYERS,
  applyInsert,
  applyMove,
  createGame,
  currentPlayer,
  legalArrows,
  maxCardsPerPlayer,
  movableCells,
  passTurn,
  rotateSpare,
  targetOf,
  type GameState,
} from "./engine.ts";

const rng = () => makeRng(12345);
const TREASURE_COUNT = ALL_TREASURES.length;

const twoPlayer = (cardsPerPlayer = 3, seed = 99) =>
  createGame({
    seats: [
      { id: "a", color: "yellow" },
      { id: "b", color: "blue" },
    ],
    cardsPerPlayer,
    seed,
  });

/** Force whose turn it is, so a test can drive one particular player. */
const asPlayer = (state: GameState, id: string): GameState => ({
  ...state,
  current: state.players.findIndex((p) => p.id === id),
});

describe("tile geometry", () => {
  test("rotating four times returns to the start", () => {
    for (const shape of ["straight", "corner", "tee"] as const) {
      const masks = [0, 1, 2, 3].map((r) => openingsOf(shape, r as 0));
      expect(new Set(masks).size).toBe(shape === "straight" ? 2 : 4);
      expect(openingsOf(shape, 0)).toBe(openingsOf(shape, 4 as 0));
    }
  });

  test("a straight tile is a corridor with two opposite openings", () => {
    const mask = openingsOf("straight", 0);
    expect(mask & 1).toBeTruthy(); // N
    expect(mask & 4).toBeTruthy(); // S
    expect(mask & 2).toBeFalsy(); // E
  });
});

describe("board setup", () => {
  test("49 squares filled plus one tile left in hand", () => {
    const { grid, spare } = createBoard(rng());
    expect(grid.length).toBe(SIZE);
    expect(grid.every((row) => row.length === SIZE)).toBe(true);
    expect(grid.flat().every(Boolean)).toBe(true);
    expect(spare).toBeTruthy();
  });

  test("every tile is unique and the counts match the physical box", () => {
    const { grid, spare } = createBoard(rng());
    const all = [...grid.flat(), spare];
    expect(all.length).toBe(50);
    expect(new Set(all.map((t) => t.id)).size).toBe(50);

    expect(all.filter((t) => t.fixed).length).toBe(16);
    const loose = all.filter((t) => !t.fixed);
    expect(loose.length).toBe(34);

    const shapes = (tiles: Tile[]) =>
      tiles.reduce<Record<string, number>>(
        (acc, t) => ({ ...acc, [t.shape]: (acc[t.shape] ?? 0) + 1 }),
        {},
      );
    expect(shapes(loose)).toEqual(MOVABLE_SHAPE_COUNTS);
  });

  test("all 24 treasures are on the board or in hand, none duplicated", () => {
    const { grid, spare } = createBoard(rng());
    const treasures = [...grid.flat(), spare].map((t) => t.treasure).filter(Boolean);
    expect(treasures.length).toBe(TREASURE_COUNT);
    expect(new Set(treasures)).toEqual(new Set(ALL_TREASURES.map((t) => t.id)));
  });

  test("fixed tiles sit at the even intersections and never carry a home and a treasure", () => {
    const { grid } = createBoard(rng());
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        expect(grid[r]![c]!.fixed).toBe(isFixed(r, c));
        if (grid[r]![c]!.home) expect(grid[r]![c]!.treasure).toBeUndefined();
      }
    }
  });

  test("the four corners are the home squares", () => {
    const { grid } = createBoard(rng());
    expect(grid.flat().filter((t) => t.home).length).toBe(MAX_PLAYERS);
    expect(grid[0]![0]!.home).toBe("yellow");
    expect(grid[0]![SIZE - 1]!.home).toBe("red");
    expect(grid[SIZE - 1]![0]!.home).toBe("green");
    expect(grid[SIZE - 1]![SIZE - 1]!.home).toBe("blue");
  });
});

describe("arrows", () => {
  test("there are twelve, three per side, on the shiftable lines only", () => {
    expect(ARROWS.length).toBe(12);
    for (const arrow of ARROWS) {
      expect(SHIFTABLE).toContain(arrow.index as 1);
      expect(isFixed(arrow.index, 0) || isFixed(0, arrow.index)).toBe(false);
    }
  });

  test("opposite() is its own inverse and never returns itself", () => {
    for (const arrow of ARROWS) {
      expect(oppositeArrow(arrow.id)).not.toBe(arrow.id);
      expect(oppositeArrow(oppositeArrow(arrow.id))).toBe(arrow.id);
      expect(arrowById(oppositeArrow(arrow.id))).toBeTruthy();
    }
  });
});

describe("shifting", () => {
  test("pushing a line moves exactly seven tiles and ejects the far one", () => {
    const { grid, spare } = createBoard(rng());
    for (const arrow of ARROWS) {
      const before = grid.flat().map((t) => t.id);
      const out = shift(grid, spare, arrow, [{ r: 3, c: 3 }]);

      // the ejected tile leaves the board, the spare joins it
      const after = out.grid.flat().map((t) => t.id);
      expect(after).toContain(spare.id);
      expect(after).not.toContain(out.spare.id);
      expect(new Set(after).size).toBe(49);

      // every square in the pushed line holds a different tile, nothing else moved
      expect(after.filter((id, i) => id !== before[i]).length).toBe(SIZE);

      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
          if (isFixed(r, c)) expect(out.grid[r]![c]!.id).toBe(grid[r]![c]!.id);
    }
  });

  test("pushing then pushing back restores the board exactly", () => {
    const { grid, spare } = createBoard(rng());
    for (const arrow of ARROWS) {
      const first = shift(grid, spare, arrow, [{ r: 3, c: 3 }]);
      const back = arrowById(oppositeArrow(arrow.id))!;
      const second = shift(first.grid, first.spare, back, first.pawns);

      expect(second.grid.flat().map((t) => t.id)).toEqual(grid.flat().map((t) => t.id));
      expect(second.spare.id).toBe(spare.id);
      // ...which is exactly why the rules forbid it
    }
  });

  test("every pawn on the pushed line rides along, and only those", () => {
    const { grid, spare } = createBoard(rng());
    const out = shift(grid, spare, arrowById("top-3")!, [
      { r: 2, c: 3 },
      { r: 5, c: 3 },
      { r: 4, c: 2 },
    ]);
    expect(out.pawns).toEqual([
      { r: 3, c: 3 },
      { r: 6, c: 3 },
      { r: 4, c: 2 },
    ]);
    expect(out.wrapped).toEqual([]);
  });

  test("a pawn pushed off the far edge reappears on the tile just inserted", () => {
    const { grid, spare } = createBoard(rng());
    const out = shift(grid, spare, arrowById("top-3")!, [{ r: SIZE - 1, c: 3 }]);
    expect(out.wrapped).toEqual([0]);
    expect(out.pawns[0]).toEqual({ r: 0, c: 3 });
    expect(out.grid[0]![3]!.id).toBe(spare.id);
  });

  test("the inserted tile keeps the rotation it was pushed in with", () => {
    const { grid, spare } = createBoard(rng());
    const turned: Tile = { ...spare, rot: ((spare.rot + 1) % 4) as 0 };
    const out = shift(grid, turned, arrowById("left-1")!, []);
    expect(out.grid[1]![0]!.rot).toBe(turned.rot);
    expect(openings(out.grid[1]![0]!)).toBe(openings(turned));
  });
});

describe("path finding", () => {
  test("reachable always includes the starting square", () => {
    const { grid } = createBoard(rng());
    expect(reachable(grid, { r: 0, c: 0 }).has(key(0, 0))).toBe(true);
  });

  test("reachability is symmetric — corridors are two-way", () => {
    const { grid } = createBoard(rng());
    for (const cell of reachable(grid, { r: 3, c: 3 })) {
      const [r, c] = cell.split(",").map(Number) as [number, number];
      expect(reachable(grid, { r, c }).has(key(3, 3))).toBe(true);
    }
  });

  test("a path exists exactly when the square is reachable, and every step is adjacent", () => {
    const { grid } = createBoard(rng());
    const start = { r: 3, c: 3 };
    const cells = reachable(grid, start);

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const path = pathBetween(grid, start, { r, c });
        expect(path !== null).toBe(cells.has(key(r, c)));
        if (!path) continue;
        expect(path[0]).toEqual([start.r, start.c]);
        expect(path.at(-1)).toEqual([r, c]);
        for (let i = 1; i < path.length; i++) {
          const d =
            Math.abs(path[i]![0] - path[i - 1]![0]) + Math.abs(path[i]![1] - path[i - 1]![1]);
          expect(d).toBe(1);
        }
      }
    }
  });
});

describe("dealing", () => {
  test("everyone starts in their own corner with a full stack", () => {
    const game = twoPlayer(4);
    expect(game.players.map((p) => p.pawn)).toEqual([
      { r: 0, c: 0 },
      { r: SIZE - 1, c: SIZE - 1 },
    ]);
    for (const player of game.players) {
      expect(player.pawn).toEqual(player.home);
      expect(player.hand.length).toBe(4);
      expect(player.collected).toEqual([]);
    }
  });

  test("no two players are dealt the same treasure", () => {
    const game = createGame({
      seats: [
        { id: "a", color: "yellow" },
        { id: "b", color: "red" },
        { id: "c", color: "green" },
        { id: "d", color: "blue" },
      ],
      cardsPerPlayer: 6,
      seed: 7,
    });
    const dealt = game.players.flatMap((p) => p.hand);
    expect(dealt.length).toBe(TREASURE_COUNT);
    expect(new Set(dealt).size).toBe(TREASURE_COUNT);
  });

  test("the deal is capped by what 24 treasures can cover", () => {
    expect(maxCardsPerPlayer(2)).toBe(12);
    expect(maxCardsPerPlayer(3)).toBe(8);
    expect(maxCardsPerPlayer(4)).toBe(6);
    // asking for more than there are hands out the maximum instead of failing
    const game = twoPlayer(50);
    expect(game.players[0]!.hand.length).toBe(12);
  });

  test("a table needs two to four players, each in their own corner", () => {
    expect(() => createGame({ seats: [{ id: "a", color: "yellow" }], cardsPerPlayer: 3 })).toThrow(
      /at least 2/,
    );
    expect(() =>
      createGame({
        seats: [
          { id: "a", color: "yellow" },
          { id: "b", color: "yellow" },
        ],
        cardsPerPlayer: 3,
      }),
    ).toThrow(/share a corner/);
  });
});

describe("turn structure", () => {
  test("a game opens on the insert phase with every arrow available", () => {
    const game = twoPlayer();
    expect(game.phase).toBe("insert");
    expect(game.turn).toBe(1);
    expect(legalArrows(game).length).toBe(12);
    expect(targetOf(currentPlayer(game))).toEqual({
      kind: "treasure",
      treasureId: currentPlayer(game).hand[0],
    });
  });

  test("insertion is required before moving, and moving hands the turn on", () => {
    const game = twoPlayer();
    const first = currentPlayer(game).id;
    expect(() => applyMove(game, currentPlayer(game).pawn)).toThrow(/cannot move/);

    const inserted = applyInsert(game, "top-1").state;
    expect(inserted.phase).toBe("move");
    expect(() => applyInsert(inserted, "top-3")).toThrow(/cannot insert/);

    const moved = applyMove(inserted, currentPlayer(inserted).pawn).state;
    expect(moved.phase).toBe("insert");
    expect(moved.turn).toBe(2);
    expect(currentPlayer(moved).id).not.toBe(first);
  });

  test("the turn goes round the table and comes back", () => {
    let game = createGame({
      seats: [
        { id: "a", color: "yellow" },
        { id: "b", color: "red" },
        { id: "c", color: "green" },
      ],
      cardsPerPlayer: 2,
      seed: 3,
    });
    const opener = currentPlayer(game).id;
    const order: string[] = [];
    for (let i = 0; i < 3; i++) {
      order.push(currentPlayer(game).id);
      game = applyInsert(game, i % 2 === 0 ? "top-1" : "left-3").state;
      game = applyMove(game, currentPlayer(game).pawn).state;
    }
    expect(new Set(order).size).toBe(3);
    expect(currentPlayer(game).id).toBe(opener);
  });

  test("the arrow that would undo the last push stays blocked for the next player", () => {
    let game = twoPlayer();
    game = applyInsert(game, "top-1").state;
    expect(game.blockedArrow).toBe("bottom-1");
    expect(legalArrows(game).map((a) => a.id)).not.toContain("bottom-1");

    game = applyMove(game, currentPlayer(game).pawn).state;
    // a new player, but the same board — the undo is still forbidden
    expect(game.blockedArrow).toBe("bottom-1");
    expect(() => applyInsert(game, "bottom-1")).toThrow(/undo/);
  });

  test("a push carries every pawn standing on that line", () => {
    let game = twoPlayer();
    game = {
      ...game,
      players: game.players.map((p) => ({ ...p, pawn: { r: 2, c: 3 } })),
    };
    game = applyInsert(game, "top-3").state;
    expect(game.players.map((p) => p.pawn)).toEqual([
      { r: 3, c: 3 },
      { r: 3, c: 3 },
    ]);
  });

  test("walking somewhere with no open corridor is rejected", () => {
    const game = applyInsert(twoPlayer(), "top-1").state;
    const open = movableCells(game);
    const blocked: { r: number; c: number }[] = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) if (!open.has(key(r, c))) blocked.push({ r, c });

    expect(blocked.length).toBeGreaterThan(0);
    expect(() => applyMove(game, blocked[0]!)).toThrow(/no open path/);
  });

  test("a dropped-out player's turn can be handed on without being played", () => {
    const game = twoPlayer();
    const skipped = currentPlayer(game).id;
    const next = passTurn(game);
    expect(currentPlayer(next).id).not.toBe(skipped);
    expect(next.phase).toBe("insert");
    expect(next.turn).toBe(2);
    // nothing about the board changed
    expect(next.grid.flat().map((t) => t.id)).toEqual(game.grid.flat().map((t) => t.id));
    expect(next.spare.id).toBe(game.spare.id);
  });
});

describe("turning the spare tile", () => {
  test("a quarter turn changes the openings, four turns bring it back", () => {
    const game = twoPlayer();
    const start = game.spare.rot;
    const once = rotateSpare(game, 1);
    expect(once.spare.rot).toBe(((start + 1) % 4) as 0);

    let round = game;
    for (let i = 0; i < 4; i++) round = rotateSpare(round, 1);
    expect(round.spare.rot).toBe(start);
    expect(openings(round.spare)).toBe(openings(game.spare));
  });

  test("it turns both ways, and the board is untouched until you push", () => {
    const game = twoPlayer();
    const back = rotateSpare(game, -1);
    expect(back.spare.rot).toBe(((game.spare.rot + 3) % 4) as 0);
    expect(back.grid.flat().map((t) => t.id)).toEqual(game.grid.flat().map((t) => t.id));
    expect(back.spare.id).toBe(game.spare.id);
  });

  test("the tile goes into the maze the way you turned it", () => {
    let game = twoPlayer();
    game = rotateSpare(game, 1);
    const wanted = openings(game.spare);
    const spareId = game.spare.id;
    game = applyInsert(game, "left-1").state;
    expect(game.grid[1]![0]!.id).toBe(spareId);
    expect(openings(game.grid[1]![0]!)).toBe(wanted);
  });

  test("you cannot turn it once it is in", () => {
    const moving = applyInsert(twoPlayer(), "top-1").state;
    expect(() => rotateSpare(moving, 1)).toThrow(/cannot turn/);
  });
});

describe("claiming treasures", () => {
  /** Clear the board of treasures and put one under a given square. */
  function onlyTreasureAt(state: GameState, cell: { r: number; c: number }, id: string) {
    const grid: Tile[][] = state.grid.map((row) =>
      row.map((t) => ({ ...t, treasure: undefined })),
    );
    grid[cell.r]![cell.c] = { ...grid[cell.r]![cell.c]!, treasure: id };
    return { ...state, grid, spare: { ...state.spare, treasure: undefined } };
  }

  test("landing on the treasure on your card claims it and turns the next", () => {
    let game = applyInsert(twoPlayer(), "top-1").state;
    const player = currentPlayer(game);
    const wanted = player.hand[0]!;
    const rest = player.hand.slice(1);
    game = onlyTreasureAt(game, player.pawn, wanted);

    const out = applyMove(game, player.pawn);
    const after = out.state.players.find((p) => p.id === player.id)!;
    expect(out.collected).toBe(wanted);
    expect(after.collected).toEqual([wanted]);
    expect(after.hand).toEqual(rest);
    expect(targetOf(after)).toEqual({ kind: "treasure", treasureId: rest[0] });
  });

  test("somebody else's treasure is just a tile you are standing on", () => {
    let game = applyInsert(twoPlayer(), "top-1").state;
    const player = currentPlayer(game);
    const other = game.players.find((p) => p.id !== player.id)!;
    game = onlyTreasureAt(game, player.pawn, other.hand[0]!);

    const out = applyMove(game, player.pawn);
    expect(out.collected).toBeNull();
    expect(out.state.players.find((p) => p.id === player.id)!.collected).toEqual([]);
    expect(out.state.players.find((p) => p.id === other.id)!.hand).toEqual(other.hand);
  });

  test("only one treasure comes off the board per turn", () => {
    let game = applyInsert(twoPlayer(), "top-1").state;
    const player = currentPlayer(game);
    // the current card and the next one on the very same square
    game = onlyTreasureAt(game, player.pawn, player.hand[0]!);
    const out = applyMove(game, player.pawn);
    expect(out.state.players.find((p) => p.id === player.id)!.hand[0]).toBe(player.hand[1]);
    expect(out.won).toBe(false);
  });

  test("an empty stack sends you home, and getting there wins the game", () => {
    const base = twoPlayer();
    let game: GameState = {
      ...base,
      current: 0,
      players: base.players.map((p, i) =>
        i === 0 ? { ...p, hand: [], collected: ["chest", "crown"] } : p,
      ),
    };
    expect(targetOf(game.players[0]!)).toEqual({ kind: "home" });

    game = applyInsert(game, "top-1").state;
    // the pawn never left its corner, so staying put is arriving
    const out = applyMove(game, game.players[0]!.pawn);
    expect(out.won).toBe(true);
    expect(out.state.phase).toBe("over");
    expect(out.state.winnerId).toBe("a");
  });

  test("collecting your last treasure does not also count as coming home", () => {
    const base = asPlayer(applyInsert(twoPlayer(), "top-1").state, "a");
    const player = base.players.find((p) => p.id === "a")!;
    // one card left, and it happens to be sitting on the player's own corner
    const grid: Tile[][] = base.grid.map((row) =>
      row.map((t) => ({ ...t, treasure: undefined })),
    );
    grid[player.home.r]![player.home.c] = {
      ...grid[player.home.r]![player.home.c]!,
      treasure: "chest",
    };
    const game: GameState = {
      ...base,
      grid,
      players: base.players.map((p) => (p.id === "a" ? { ...p, hand: ["chest"] } : p)),
    };

    const out = applyMove(game, player.home);
    expect(out.collected).toBe("chest");
    expect(out.won).toBe(false);
    expect(out.state.phase).toBe("insert");
    // they still have to leave and come back
    expect(targetOf(out.state.players.find((p) => p.id === "a")!)).toEqual({ kind: "home" });
  });
});

describe("a full game plays through without breaking", () => {
  test("two players race for real and one of them wins", () => {
    let game = twoPlayer(3, 2024);
    const random = makeRng(777);
    const claimed = new Map<string, number>(game.players.map((p) => [p.id, 0]));
    let turns = 0;

    while (game.phase !== "over" && turns < 2000) {
      turns++;
      const options = legalArrows(game);
      expect(options.length).toBe(turns === 1 ? 12 : 11);

      // turn the tile at random too, so rotation is exercised in anger
      game = rotateSpare(game, Math.floor(random() * 4));
      game = applyInsert(game, options[Math.floor(random() * options.length)]!.id).state;

      // the board is always intact
      const all = [...game.grid.flat(), game.spare];
      expect(new Set(all.map((t) => t.id)).size).toBe(50);
      expect(all.map((t) => t.treasure).filter(Boolean).length).toBe(TREASURE_COUNT);

      // and every pawn is always on it
      for (const player of game.players) {
        expect(player.pawn.r).toBeGreaterThanOrEqual(0);
        expect(player.pawn.r).toBeLessThan(SIZE);
        expect(player.pawn.c).toBeGreaterThanOrEqual(0);
        expect(player.pawn.c).toBeLessThan(SIZE);
      }

      // walk toward the target when it is within reach, otherwise wander
      const player = currentPlayer(game);
      const cells = [...movableCells(game)];
      const target = targetOf(player);
      const wanted =
        target.kind === "home"
          ? key(player.home.r, player.home.c)
          : cells.find((cell) => {
              const [r, c] = cell.split(",").map(Number) as [number, number];
              return game.grid[r]![c]!.treasure === target.treasureId;
            });
      const destination =
        wanted && cells.includes(wanted)
          ? wanted
          : cells[Math.floor(random() * cells.length)]!;
      const [dr, dc] = destination.split(",").map(Number) as [number, number];

      const out = applyMove(game, { r: dr, c: dc });
      game = out.state;
      if (out.collected) claimed.set(player.id, claimed.get(player.id)! + 1);
      expect(out.state.players.find((p) => p.id === player.id)!.collected.length).toBe(
        claimed.get(player.id)!,
      );
    }

    expect(game.phase).toBe("over");
    const winner = game.players.find((p) => p.id === game.winnerId)!;
    expect(winner.hand).toEqual([]);
    expect(winner.collected.length).toBe(3);
    expect(winner.pawn).toEqual(winner.home);
    // the loser never got to play past the win
    expect(game.players.some((p) => p.id !== winner.id && p.hand.length > 0)).toBe(true);
  });
});
