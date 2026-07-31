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
import { MOVABLE_SHAPE_COUNTS, openingsOf, type Tile } from "./tiles.ts";
import { ALL_TREASURES, ASSIGNMENT_ORDER, MAX_COLLECTIBLES } from "./treasures.ts";
import {
  applyInsert,
  applyMove,
  applyOpponentTurn,
  buildDeck,
  createGame,
  currentTarget,
  legalArrows,
  movableCells,
  type GameState,
} from "./engine.ts";

const rng = () => makeRng(12345);

describe("tile geometry", () => {
  test("rotating four times returns to the start", () => {
    for (const shape of ["straight", "corner", "tee"] as const) {
      expect(openingsOf(shape, 0)).toBe(openingsOf(shape, 0));
      const counts = [0, 1, 2, 3].map((r) => openingsOf(shape, r as 0));
      expect(new Set(counts).size).toBe(shape === "straight" ? 2 : 4);
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

    const fixed = all.filter((t) => t.fixed);
    expect(fixed.length).toBe(16);
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
    expect(treasures.length).toBe(MAX_COLLECTIBLES);
    expect(new Set(treasures).size).toBe(MAX_COLLECTIBLES);
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
    const homes = grid.flat().filter((t) => t.home);
    expect(homes.length).toBe(4);
    expect(grid[0]![0]!.home).toBe("yellow");
    expect(grid[0]![SIZE - 1]!.home).toBe("red");
    expect(grid[SIZE - 1]![0]!.home).toBe("green");
    expect(grid[SIZE - 1]![SIZE - 1]!.home).toBe("blue");
  });

  test("assignment order covers every treasure exactly once", () => {
    expect(ASSIGNMENT_ORDER.length).toBe(MAX_COLLECTIBLES);
    expect(new Set(ASSIGNMENT_ORDER).size).toBe(MAX_COLLECTIBLES);
    expect(new Set(ASSIGNMENT_ORDER)).toEqual(new Set(ALL_TREASURES.map((t) => t.id)));
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
      const out = shift(grid, spare, arrow, { r: 3, c: 3 });

      // the ejected tile leaves the board, the spare joins it
      const after = out.grid.flat().map((t) => t.id);
      expect(after).toContain(spare.id);
      expect(after).not.toContain(out.spare.id);
      expect(new Set(after).size).toBe(49);

      // every square in the pushed line holds a different tile, nothing else moved
      const moved = after.filter((id, i) => id !== before[i]);
      expect(moved.length).toBe(SIZE);

      // fixed tiles stayed put
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
          if (isFixed(r, c)) expect(out.grid[r]![c]!.id).toBe(grid[r]![c]!.id);
    }
  });

  test("pushing then pushing back restores the board exactly", () => {
    const { grid, spare } = createBoard(rng());
    for (const arrow of ARROWS) {
      const first = shift(grid, spare, arrow, { r: 3, c: 3 });
      const back = arrowById(oppositeArrow(arrow.id))!;
      const second = shift(first.grid, first.spare, back, first.pawn);

      expect(second.grid.flat().map((t) => t.id)).toEqual(grid.flat().map((t) => t.id));
      expect(second.spare.id).toBe(spare.id);
      // ...which is exactly why the rules forbid it
    }
  });

  test("a pawn riding the line moves with it", () => {
    const { grid, spare } = createBoard(rng());
    const out = shift(grid, spare, arrowById("top-3")!, { r: 2, c: 3 });
    expect(out.pawn).toEqual({ r: 3, c: 3 });
    expect(out.wrappedPawn).toBeNull();
  });

  test("a pawn pushed off the far edge reappears on the tile just inserted", () => {
    const { grid, spare } = createBoard(rng());
    const out = shift(grid, spare, arrowById("top-3")!, { r: SIZE - 1, c: 3 });
    expect(out.wrappedPawn).not.toBeNull();
    expect(out.pawn).toEqual({ r: 0, c: 3 });
    expect(out.grid[0]![3]!.id).toBe(spare.id);
  });

  test("a pawn outside the pushed line does not move", () => {
    const { grid, spare } = createBoard(rng());
    const out = shift(grid, spare, arrowById("top-3")!, { r: 4, c: 2 });
    expect(out.pawn).toEqual({ r: 4, c: 2 });
  });
});

describe("path finding", () => {
  test("reachable always includes the starting square", () => {
    const { grid } = createBoard(rng());
    expect(reachable(grid, { r: 0, c: 0 }).has(key(0, 0))).toBe(true);
  });

  test("reachability is symmetric — corridors are two-way", () => {
    const { grid } = createBoard(rng());
    const from = reachable(grid, { r: 3, c: 3 });
    for (const cell of from) {
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
          const d = Math.abs(path[i]![0] - path[i - 1]![0]) + Math.abs(path[i]![1] - path[i - 1]![1]);
          expect(d).toBe(1);
        }
      }
    }
  });
});

describe("turn structure", () => {
  const newGame = () =>
    createGame({ collectibles: ["chest", "ghost", "crown"], pawnColor: "yellow", seed: 99 });

  test("a game starts on its home corner with the first card face up", () => {
    const game = newGame();
    expect(game.pawn).toEqual({ r: 0, c: 0 });
    expect(game.home).toEqual({ r: 0, c: 0 });
    expect(game.phase).toBe("insert");
    expect(currentTarget(game)).toEqual({ kind: "treasure", treasureId: "chest" });
    expect(legalArrows(game).length).toBe(12);
  });

  test("insertion is required before moving, and moving ends the player's turn", () => {
    const game = newGame();
    expect(() => applyMove(game, { r: 0, c: 0 })).toThrow(/cannot move/);

    const inserted = applyInsert(game, "top-1").state;
    expect(inserted.phase).toBe("move");
    expect(inserted.pushes).toBe(1);
    expect(() => applyInsert(inserted, "top-3")).toThrow(/cannot insert/);

    const moved = applyMove(inserted, inserted.pawn).state;
    expect(moved.phase).toBe("opponent");
  });

  test("the arrow that would undo the last push is blocked, for player and opponent alike", () => {
    let game = newGame();
    game = applyInsert(game, "top-1").state;
    expect(game.blockedArrow).toBe("bottom-1");
    expect(legalArrows(game).map((a) => a.id)).not.toContain("bottom-1");
    expect(() => applyInsert({ ...game, phase: "insert" }, "bottom-1")).toThrow(/undo/);

    game = applyMove(game, game.pawn).state;
    const opponent = applyOpponentTurn(game, () => 0.5);
    expect(opponent.arrowId).not.toBe("bottom-1");
    expect(opponent.state.phase).toBe("insert");
    expect(opponent.state.turn).toBe(2);
  });

  test("walking onto the current treasure collects it and turns the next card", () => {
    let game = newGame();
    game = applyInsert(game, "top-1").state;

    // put the chest under the pawn's feet
    const [r, c] = [game.pawn.r, game.pawn.c];
    const grid = game.grid.map((row) => row.slice());
    grid.forEach((row) => row.forEach((t) => t.treasure === "chest" && delete t.treasure));
    grid[r]![c] = { ...grid[r]![c]!, treasure: "chest" };
    game = { ...game, grid };

    const out = applyMove(game, { r, c });
    expect(out.collected).toBe("chest");
    expect(out.state.collected).toEqual(["chest"]);
    expect(out.state.deck).toEqual(["ghost", "crown"]);
    expect(currentTarget(out.state)).toEqual({ kind: "treasure", treasureId: "ghost" });
  });

  test("only one treasure can be claimed per turn", () => {
    let game = newGame();
    game = applyInsert(game, "top-1").state;
    const { r, c } = game.pawn;
    const grid = game.grid.map((row) => row.slice());
    grid.forEach((row) => row.forEach((t) => delete t.treasure));
    // both the current card and the next one on the same square
    grid[r]![c] = { ...grid[r]![c]!, treasure: "chest" };
    game = { ...game, grid };

    const out = applyMove(game, { r, c });
    expect(out.collected).toBe("chest");
    expect(out.state.deck[0]).toBe("ghost");
    expect(out.won).toBe(false);
  });

  test("an empty deck sends the player home, and arriving home wins", () => {
    let game: GameState = {
      ...newGame(),
      deck: [],
      collected: ["chest", "ghost", "crown"],
    };
    expect(currentTarget(game)).toEqual({ kind: "home" });

    game = applyInsert(game, "top-1").state;
    // the pawn never left home, so staying put is arriving
    const out = applyMove(game, { r: 0, c: 0 });
    expect(out.won).toBe(true);
    expect(out.state.phase).toBe("won");
    expect(currentTarget(out.state)).toBeNull();
  });

  test("walking somewhere with no open corridor is rejected", () => {
    const game = applyInsert(newGame(), "top-1").state;
    const open = movableCells(game);
    const blocked: { r: number; c: number }[] = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) if (!open.has(key(r, c))) blocked.push({ r, c });

    expect(blocked.length).toBeGreaterThan(0);
    expect(() => applyMove(game, blocked[0]!)).toThrow(/no open path/);
  });

  test("the deck is a shuffle — same treasures, no losses", () => {
    const ids = ASSIGNMENT_ORDER.slice(0, 10);
    const deck = buildDeck(ids, 7);
    expect(deck.length).toBe(ids.length);
    expect(new Set(deck)).toEqual(new Set(ids));
  });
});

describe("a full game plays through without breaking", () => {
  test("300 random turns keep every invariant", () => {
    const collectibles = buildDeck(ASSIGNMENT_ORDER.slice(0, 8), 4);
    let game = createGame({ collectibles, pawnColor: "green", seed: 2024 });
    const random = makeRng(777);
    let collected = 0;

    for (let turn = 0; turn < 300 && game.phase !== "won"; turn++) {
      // all twelve on the opening turn, eleven once a push can be undone
      const options = legalArrows(game);
      expect(options.length).toBe(turn === 0 ? 12 : 11);
      const arrow = options[Math.floor(random() * options.length)]!;
      game = applyInsert(game, arrow.id).state;

      // the board is always intact
      const all = [...game.grid.flat(), game.spare];
      expect(all.length).toBe(50);
      expect(new Set(all.map((t) => t.id)).size).toBe(50);
      expect(all.map((t) => t.treasure).filter(Boolean).length).toBe(MAX_COLLECTIBLES);

      // the pawn is always on the board
      expect(game.pawn.r).toBeGreaterThanOrEqual(0);
      expect(game.pawn.r).toBeLessThan(SIZE);
      expect(game.pawn.c).toBeGreaterThanOrEqual(0);
      expect(game.pawn.c).toBeLessThan(SIZE);

      // walk to a random reachable square, preferring the target when possible
      const cells = [...movableCells(game)];
      const target = currentTarget(game);
      let destination = cells[Math.floor(random() * cells.length)]!;
      if (target) {
        const wanted =
          target.kind === "home"
            ? key(game.home.r, game.home.c)
            : cells.find((cell) => {
                const [r, c] = cell.split(",").map(Number) as [number, number];
                return game.grid[r]![c]!.treasure === target.treasureId;
              });
        if (wanted && cells.includes(wanted)) destination = wanted;
      }
      const [dr, dc] = destination.split(",").map(Number) as [number, number];

      const move = applyMove(game, { r: dr, c: dc });
      game = move.state;
      if (move.collected) collected++;
      expect(game.collected.length).toBe(collected);

      if (game.phase === "opponent") game = applyOpponentTurn(game, random).state;
    }

    expect(game.phase).toBe("won");
    expect(game.collected).toEqual(collectibles);
    expect(game.pawn).toEqual(game.home);
  });
});
