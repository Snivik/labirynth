/**
 * Game shell: the front door, the lobby, and the board.
 *
 * The server owns the rules, so this file never decides anything — it renders
 * whatever room state arrives and animates the difference. Every board change
 * comes with an event saying what just happened, which is what lets a tile slide
 * and a pawn walk instead of the whole board snapping to a new arrangement.
 */

import {
  ARROWS,
  HOME_CORNERS,
  SIZE,
  arrowById,
  key,
  reachable,
} from "../game/board.ts";
import type { Tile } from "../game/tiles.ts";
import { treasureById } from "../game/treasures.ts";
import type {
  GameEvent,
  PlayerView,
  RoomView,
  ServerMessage,
} from "../shared/protocol.ts";
import {
  arrowSVG,
  cardBackSVG,
  cardFaceSVG,
  cardHomeSVG,
  pawnSVG,
  tileSVG,
} from "./art.ts";
import { iconSVG } from "./icons.ts";
import { Net, type Credentials } from "./net.ts";
import {
  isMuted,
  playFanfare,
  playSlide,
  playStep,
  playTurn,
  playUnlock,
  setMuted,
  unlockAudio,
} from "./sfx.ts";

const SEAT_KEY = "labyrinth-seat";
const NAME_KEY = "labyrinth-name";
const SLIDE_MS = 420;
const STEP_MS = 140;

/** Touch screens get no hover previews — they'd latch on tap and never clear. */
const HOVER_CAPABLE = window.matchMedia("(hover: hover)").matches;

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let room: RoomView | null = null;
/** Which deal the board on screen was built for. */
let builtGameId: string | null = null;
let overShown = false;
let lastTurnHolder: string | null = null;

/** One DOM node per tile and per pawn, kept for the whole game so they animate. */
const tileEls = new Map<string, HTMLElement>();
const pawnEls = new Map<string, HTMLElement>();

/**
 * Where the spare tile is parked, in board coordinates (off-grid by one).
 * Column 0 has no arrow, so the opening position covers no control — and on a
 * phone, where the spare rests on the frame band, that matters.
 */
const START_PARK = { r: SIZE, c: 0, axis: "y" as "x" | "y", sign: 1 };
let sparePark = { ...START_PARK };

const net = new Net(onServerMessage, setOnline);

/* ─────────────────────────── helpers ─────────────────────────── */

function me(): PlayerView | undefined {
  return room?.players.find((p) => p.id === room!.youId);
}

function playerNamed(id: string | null | undefined): PlayerView | undefined {
  return id ? room?.players.find((p) => p.id === id) : undefined;
}

function myTurn(): boolean {
  const game = room?.game;
  return !!game && game.phase !== "over" && game.currentId === room!.youId;
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function showScreen(name: "home" | "lobby" | "game") {
  $("home").hidden = name !== "home";
  $("lobby").hidden = name !== "lobby";
  $("game").hidden = name !== "game";
}

let toastTimer: number | undefined;
function toast(message: string) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3600);
}

function setOnline(online: boolean) {
  $("offline").hidden = online;
}

/* ─────────────────────────── credentials ─────────────────────────── */

function loadSeat(): Credentials | null {
  try {
    const raw = localStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Credentials;
    return parsed.code && parsed.playerId && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

function saveSeat(credentials: Credentials) {
  try {
    localStorage.setItem(SEAT_KEY, JSON.stringify(credentials));
  } catch {
    /* private browsing — the seat just won't survive a refresh */
  }
}

function clearSeat() {
  try {
    localStorage.removeItem(SEAT_KEY);
  } catch {
    /* nothing to clear */
  }
}

function myName(): string {
  return ($("home-name") as HTMLInputElement).value.trim();
}

function rememberName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* fine */
  }
}

/** A code out of /j/ABCD or ?room=ABCD. */
function codeFromUrl(): string | null {
  const fromPath = /^\/j\/([A-Za-z0-9]{4})\/?$/.exec(location.pathname)?.[1];
  const fromQuery = new URLSearchParams(location.search).get("room");
  const code = (fromPath ?? fromQuery ?? "").toUpperCase();
  return /^[A-Z0-9]{4}$/.test(code) ? code : null;
}

/* ─────────────────────────── server messages ─────────────────────────── */

function onServerMessage(msg: ServerMessage) {
  switch (msg.t) {
    case "seat": {
      const credentials = { code: msg.code, playerId: msg.playerId, token: msg.token };
      saveSeat(credentials);
      net.resumeWith(credentials);
      return;
    }
    case "room":
      return enqueue(msg.room, msg.event);
    case "error":
      return toast(msg.message);
    case "closed":
      return goHome(msg.reason);
  }
}

function goHome(reason?: string) {
  clearSeat();
  net.resumeWith(null);
  room = null;
  builtGameId = null;
  overShown = false;
  lastTurnHolder = null;
  $("over-scrim").hidden = true;
  showScreen("home");
  const err = $("home-error");
  err.hidden = !reason;
  err.textContent = reason ?? "";
}

/**
 * Updates are applied one at a time: an insert takes 420ms of sliding to show,
 * and a second update landing halfway through would cut it off mid-animation.
 */
const pending: { room: RoomView; event?: GameEvent }[] = [];
let draining = false;

function enqueue(next: RoomView, event?: GameEvent) {
  pending.push({ room: next, event });
  void drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (pending.length) {
      const update = pending.shift()!;
      await applyUpdate(update.room, update.event);
    }
  } finally {
    draining = false;
  }
}

async function applyUpdate(next: RoomView, event?: GameEvent) {
  const previous = room;
  room = next;

  if (next.status === "lobby" || !next.game) {
    builtGameId = null;
    overShown = false;
    lastTurnHolder = null;
    $("over-scrim").hidden = true;
    renderLobby();
    showScreen("lobby");
    return;
  }

  showScreen("game");

  // A fresh deal: throw the old board away rather than animating into it.
  if (next.game.id !== builtGameId) {
    builtGameId = next.game.id;
    overShown = false;
    buildBoard();
    sparePark = { ...START_PARK };
    layout(true);
    renderPanel();
    announceTurn();
    return;
  }

  if (event?.type === "move") {
    clearMarks();
    if (event.path.length > 1) await walkPawn(event.playerId, event.path);
  }

  if (event?.type === "insert") {
    // the hovered line has just moved out from under the cursor
    clearMarks();
    sparePark = parkFromArrow(event.arrowId, event.exit);
    flagRiders(previous, event.wrapped);
    playSlide();
  }

  layout();
  releaseTeleports();
  renderPanel();

  if (event?.type === "insert") {
    await wait(SLIDE_MS);
    for (const el of pawnEls.values()) el.classList.remove("settling");
  }

  if (event?.type === "move" && event.collected) {
    playUnlock();
    await wait(300);
  }

  if (next.status === "over" && !overShown) showOver();
  else announceTurn();
}

/** A soft chime the moment the table hands the turn over to you. */
function announceTurn() {
  const holder = room?.game?.currentId ?? null;
  if (holder === lastTurnHolder) return;
  lastTurnHolder = holder;
  if (holder === room?.youId && room?.game?.phase !== "over") playTurn();
}

/* ─────────────────────────── board construction ─────────────────────────── */

function buildBoard() {
  const game = room!.game!;
  const board = $("board");
  board.innerHTML = "";
  tileEls.clear();
  pawnEls.clear();

  for (const tile of [...game.grid.flat(), game.spare]) {
    const el = document.createElement("div");
    el.className = "cell";
    el.dataset.tile = tile.id;
    refreshTile(el, tile);
    board.append(el);
    tileEls.set(tile.id, el);
  }

  for (const player of room!.players) {
    const el = document.createElement("div");
    el.className = "pawn";
    el.innerHTML = pawnSVG(player.color);
    el.title = player.name;
    board.append(el);
    pawnEls.set(player.id, el);
  }

  board.onclick = onBoardClick;
  buildArrows();
}

function buildArrows() {
  const frame = $("frame");
  frame.querySelectorAll(".arrow").forEach((el) => el.remove());

  for (const arrow of ARROWS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `arrow ${arrow.side}`;
    b.style.setProperty("--i", String(arrow.index));
    b.dataset.arrow = arrow.id;
    b.innerHTML = arrowSVG();
    b.title = "Slide the spare tile in here";
    b.setAttribute("aria-label", `Push the spare tile in from the ${arrow.side}`);
    b.addEventListener("click", () => net.send({ t: "insert", arrowId: arrow.id }));
    // on a touch screen mouseenter fires on tap and the preview would stick
    if (HOVER_CAPABLE) {
      b.addEventListener("mouseenter", () => previewShift(arrow.id, true));
      b.addEventListener("mouseleave", () => previewShift(arrow.id, false));
    }
    frame.append(b);
  }
}

/** Redraw a tile only when its artwork actually changed — rotation, mostly. */
function refreshTile(el: HTMLElement, tile: Tile) {
  const signature = `${tile.shape}:${tile.rot}:${tile.treasure ?? ""}:${tile.home ?? ""}`;
  if (el.dataset.sig === signature) return;
  el.dataset.sig = signature;
  el.innerHTML = tileSVG(tile);
}

/** Park the spare beside the board, one step past the square it was ejected from. */
function parkFromArrow(arrowId: string, exit: [number, number]) {
  switch (arrowById(arrowId)!.side) {
    case "top":
      return { r: SIZE, c: exit[1], axis: "y" as const, sign: 1 };
    case "bottom":
      return { r: -1, c: exit[1], axis: "y" as const, sign: -1 };
    case "left":
      return { r: exit[0], c: SIZE, axis: "x" as const, sign: 1 };
    case "right":
      return { r: exit[0], c: -1, axis: "x" as const, sign: -1 };
  }
}

/* ─────────────────────────── layout ─────────────────────────── */

function place(el: HTMLElement, r: number, c: number) {
  el.style.setProperty("--r", String(r));
  el.style.setProperty("--c", String(c));
}

function layout(immediate = false) {
  const game = room?.game;
  if (!game) return;
  const board = $("board");
  if (immediate) board.classList.add("no-anim");

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const tile = game.grid[r]![c]!;
      const el = tileEls.get(tile.id);
      if (!el) continue;
      refreshTile(el, tile);
      place(el, r, c);
      el.style.removeProperty("--nx");
      el.style.removeProperty("--ny");
      el.classList.remove("is-spare");
    }
  }

  const spareEl = tileEls.get(game.spare.id);
  if (spareEl) {
    refreshTile(spareEl, game.spare);
    place(spareEl, sparePark.r, sparePark.c);
    spareEl.classList.add("is-spare");
    // how far past the frame the spare rests; the stylesheet tunes it per screen
    const nudge = `calc(var(--spare-nudge) * ${sparePark.sign})`;
    spareEl.style.setProperty(sparePark.axis === "x" ? "--nx" : "--ny", nudge);
    spareEl.style.removeProperty(sparePark.axis === "x" ? "--ny" : "--nx");
  }

  placePawns();
  markTarget();
  markReachable();

  if (immediate) {
    void board.offsetWidth; // flush, so the next change animates from here
    board.classList.remove("no-anim");
  }
}

/** Where several pawns share a square, fan them out instead of stacking them. */
const CLUSTER: [number, number][][] = [
  [[0, 0]],
  [
    [-19, 0],
    [19, 0],
  ],
  [
    [-20, -13],
    [20, -13],
    [0, 15],
  ],
  [
    [-19, -19],
    [19, -19],
    [-19, 19],
    [19, 19],
  ],
];

function placePawns() {
  const groups = new Map<string, PlayerView[]>();
  for (const player of room!.players) {
    const k = key(player.pawn.r, player.pawn.c);
    const group = groups.get(k);
    if (group) group.push(player);
    else groups.set(k, [player]);
  }

  for (const group of groups.values()) {
    const offsets = CLUSTER[Math.min(group.length, CLUSTER.length) - 1]!;
    group.forEach((player, i) => {
      const el = pawnEls.get(player.id);
      if (!el) return;
      place(el, player.pawn.r, player.pawn.c);
      const [ox, oy] = offsets[i] ?? [0, 0];
      el.style.setProperty("--ox", `${ox}%`);
      el.style.setProperty("--oy", `${oy}%`);
      el.classList.toggle("crowded", group.length > 1);
      el.classList.toggle("away", !player.connected);
      el.classList.toggle("in-turn", room!.game?.currentId === player.id);
    });
  }
}

/** Only your own target is marked — everyone else's card is face down. */
function markTarget() {
  for (const el of tileEls.values()) el.classList.remove("is-target");
  const game = room!.game!;
  const mine = me();
  if (!mine || game.phase === "over") return;

  if (mine.remaining === 0) {
    const tile = game.grid[mine.home.r]![mine.home.c]!;
    tileEls.get(tile.id)?.classList.add("is-target");
    return;
  }

  if (!mine.card) return;
  for (const tile of [...game.grid.flat(), game.spare]) {
    if (tile.treasure === mine.card) tileEls.get(tile.id)?.classList.add("is-target");
  }
}

function markReachable() {
  for (const el of tileEls.values()) el.classList.remove("reachable");
  const game = room!.game!;
  if (!myTurn() || game.phase !== "move") return;
  const cells = reachable(game.grid, me()!.pawn);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (cells.has(key(r, c)))
        tileEls.get(game.grid[r]![c]!.id)?.classList.add("reachable");
    }
  }
}

function clearMarks() {
  for (const el of tileEls.values()) el.classList.remove("reachable", "previewed");
}

function previewShift(arrowId: string, on: boolean) {
  const game = room?.game;
  if (!game) return;
  const arrow = arrowById(arrowId)!;
  if (on && (!myTurn() || game.phase !== "insert" || game.blockedArrow === arrowId)) return;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const inLine =
        arrow.side === "top" || arrow.side === "bottom"
          ? c === arrow.index
          : r === arrow.index;
      if (!inLine) continue;
      tileEls.get(game.grid[r]![c]!.id)?.classList.toggle("previewed", on);
    }
  }
}

/* ─────────────────────────── animation ─────────────────────────── */

/**
 * A pawn riding a pushed line should glide with the tile, and one carried off
 * the far edge should teleport rather than sail back across the whole board.
 */
function flagRiders(previous: RoomView | null, wrapped: string[]) {
  const teleported = new Set(wrapped);
  for (const player of room!.players) {
    const el = pawnEls.get(player.id);
    if (!el) continue;
    const before = previous?.players.find((p) => p.id === player.id)?.pawn;
    if (!before || (before.r === player.pawn.r && before.c === player.pawn.c)) continue;
    if (teleported.has(player.id)) el.style.transition = "none";
    else el.classList.add("settling");
  }
}

function releaseTeleports() {
  let anyFrozen = false;
  for (const el of pawnEls.values()) if (el.style.transition === "none") anyFrozen = true;
  if (!anyFrozen) return;
  void $("board").offsetWidth;
  for (const el of pawnEls.values()) if (el.style.transition === "none") el.style.transition = "";
}

async function walkPawn(playerId: string, path: [number, number][]) {
  const el = pawnEls.get(playerId);
  if (!el) return;
  el.classList.remove("settling");
  // walking pawns take the middle of the square, however crowded it is
  el.style.setProperty("--ox", "0%");
  el.style.setProperty("--oy", "0%");
  for (let i = 1; i < path.length; i++) {
    place(el, path[i]![0], path[i]![1]);
    playStep(0);
    await wait(STEP_MS);
  }
}

/* ─────────────────────────── panel ─────────────────────────── */

function renderPanel() {
  const game = room!.game!;
  const mine = me();
  if (!mine) return;
  const holder = playerNamed(game.currentId);
  const mineTurn = myTurn();

  $("panel-sub").textContent = `Room ${room!.code}`;

  const deck = $("deck");
  const caption = $("card-caption");
  deck.innerHTML = "";

  if (game.phase === "over") {
    caption.innerHTML = `<small>Finished</small>${
      room!.winnerId === mine.id ? "You won" : `${escapeHtml(playerNamed(room!.winnerId)?.name ?? "Someone")} won`
    }`;
  } else if (mine.remaining > 0 && mine.card) {
    if (mine.remaining > 1) {
      const back = document.createElement("div");
      back.className = "card stack-back";
      back.innerHTML = cardBackSVG();
      deck.append(back);
    }
    const face = document.createElement("div");
    face.className = "card current";
    face.innerHTML = cardFaceSVG(mine.card);
    deck.append(face);
    caption.innerHTML = `<small>Find</small>${escapeHtml(
      treasureById(mine.card)?.name ?? "the treasure",
    )}`;
  } else {
    const face = document.createElement("div");
    face.className = "card current";
    face.innerHTML = cardHomeSVG(mine.color);
    deck.append(face);
    caption.innerHTML = `<small>Last card</small>Return to your corner`;
  }

  renderStatus(mineTurn, holder);
  $("game-roster").innerHTML = rosterHTML(false);
  renderProgress(mine);

  const canRotate = mineTurn && game.phase === "insert";
  ($("rot-cw") as HTMLButtonElement).disabled = !canRotate;
  ($("rot-ccw") as HTMLButtonElement).disabled = !canRotate;
  $("rotate-row").classList.toggle("live", canRotate);

  ($("stay") as HTMLButtonElement).disabled = !mineTurn || game.phase !== "move";

  const stuck = holder && !holder.connected && holder.id !== mine.id && game.phase !== "over";
  $("pass").hidden = !stuck;

  $("mute").textContent = isMuted() ? "Sound off" : "Sound on";
  $("turn-meta").textContent = `Turn ${game.turn} · ${mine.collected.length}/${
    mine.collected.length + mine.remaining
  } of your treasures`;

  for (const b of document.querySelectorAll<HTMLButtonElement>(".arrow")) {
    const blocked = b.dataset.arrow === game.blockedArrow;
    b.disabled = !mineTurn || game.phase !== "insert" || blocked;
    b.classList.toggle("blocked", blocked);
  }
}

function renderStatus(mineTurn: boolean, holder: PlayerView | undefined) {
  const game = room!.game!;
  const el = $("status");
  const mine = me()!;

  if (game.phase === "over") {
    el.innerHTML =
      room!.winnerId === mine.id
        ? "Every treasure, and home again. <strong>You win.</strong>"
        : `<strong>${escapeHtml(holder?.name ?? "Someone")}</strong> got home first.`;
    return;
  }

  if (!mineTurn) {
    const who = `<strong>${escapeHtml(holder?.name ?? "Someone")}</strong>`;
    if (holder && !holder.connected) {
      el.innerHTML = `${who} has dropped out. Wait for them, or skip their turn.`;
      return;
    }
    el.innerHTML =
      game.phase === "insert"
        ? `${who} is turning the spare tile…`
        : `${who} is deciding where to walk…`;
    return;
  }

  if (game.phase === "insert") {
    const bits: string[] = [];
    if (mine.card && game.spare.treasure === mine.card) {
      bits.push(
        `<strong>${escapeHtml(
          treasureById(mine.card)?.name ?? "Your treasure",
        )}</strong> is on the spare tile — push it in to put it on the board.`,
      );
    } else {
      bits.push("Turn the spare tile if you like, then push it in at a gold arrow.");
    }
    if (game.blockedArrow)
      bits.push("<em>One arrow is greyed out: it would undo the last push.</em>");
    el.innerHTML = bits.join(" ");
    return;
  }

  el.innerHTML =
    mine.remaining === 0
      ? "Walk home — your corner is glowing."
      : "Walk to any lit square, as far as the corridors allow. Or stay put.";
}

/** The roster, used in the lobby and beside the board. */
function rosterHTML(lobby: boolean): string {
  const game = room!.game;
  return room!.players
    .map((player) => {
      const isTurn = !lobby && game?.currentId === player.id && game.phase !== "over";
      const classes = ["seat", `seat-${player.color}`];
      if (isTurn) classes.push("turn");
      if (!player.connected) classes.push("away");
      if (player.id === room!.youId) classes.push("mine");

      const detail = lobby
        ? [player.host ? "host" : "", player.connected ? "" : "away"]
            .filter(Boolean)
            .join(" · ")
        : `${player.collected.length} found · ${player.remaining} to go`;

      const pips = lobby
        ? ""
        : `<span class="seat-pips">${player.collected
            .map((id) => iconSVG(treasureById(id)?.icon ?? "chest"))
            .join("")}</span>`;

      return `<li class="${classes.join(" ")}">
        <span class="seat-pawn">${pawnSVG(player.color)}</span>
        <span class="seat-who">
          <strong>${escapeHtml(player.name)}${
            player.id === room!.youId ? " <em>you</em>" : ""
          }</strong>
          <small>${detail || "&nbsp;"}</small>
        </span>
        ${pips}
      </li>`;
    })
    .join("");
}

function renderProgress(mine: PlayerView) {
  const wrap = $("progress");
  wrap.innerHTML = "";
  for (const treasureId of mine.collected) {
    const pip = document.createElement("div");
    pip.className = "pip done";
    pip.innerHTML = iconSVG(treasureById(treasureId)?.icon ?? "chest");
    pip.title = treasureById(treasureId)?.name ?? "Found";
    wrap.append(pip);
  }
  for (let i = 0; i < mine.remaining; i++) {
    const pip = document.createElement("div");
    pip.className = `pip${i === 0 ? " current" : ""}`;
    pip.innerHTML = iconSVG(
      i === 0 ? (treasureById(mine.card ?? "")?.icon ?? "chest") : "chest",
    );
    pip.title = i === 0 ? "Your card" : "Still in your stack";
    wrap.append(pip);
  }
}

/* ─────────────────────────── lobby ─────────────────────────── */

function renderLobby() {
  const mine = me();
  if (!mine) return;

  $("lobby-code").textContent = room!.code;
  $("lobby-roster").innerHTML = rosterHTML(true);

  const picker = $("corner-picker");
  picker.innerHTML = "";
  for (const corner of HOME_CORNERS) {
    const holder = room!.players.find((p) => p.color === corner.color);
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = pawnSVG(corner.color);
    b.setAttribute("aria-pressed", String(corner.color === mine.color));
    b.disabled = !!holder && holder.id !== mine.id;
    b.title = holder ? `${holder.name}'s corner` : `Take the ${corner.color} corner`;
    b.addEventListener("click", () => net.send({ t: "color", color: corner.color }));
    picker.append(b);
  }

  $("host-settings").hidden = !mine.host;
  const cards = $("cards") as HTMLInputElement;
  cards.max = String(room!.maxCardsPerPlayer);
  cards.value = String(room!.cardsPerPlayer);
  $("cards-out").textContent = `— ${room!.cardsPerPlayer} each`;

  const begin = $("begin") as HTMLButtonElement;
  begin.hidden = !mine.host;
  begin.disabled = room!.players.length < 2;

  $("lobby-note").textContent = mine.host
    ? room!.players.length < 2
      ? "Waiting for at least one more player."
      : `${room!.players.length} at the table. Deal when you're ready.`
    : "Waiting for the host to deal.";
}

/* ─────────────────────────── ending ─────────────────────────── */

function showOver() {
  overShown = true;
  const winner = playerNamed(room!.winnerId);
  const mine = me()!;
  const iWon = winner?.id === mine.id;

  const standings = [...room!.players]
    .sort((a, b) => b.collected.length - a.collected.length)
    .map(
      (p) => `<li class="seat seat-${p.color}${p.id === winner?.id ? " won" : ""}">
        <span class="seat-pawn">${pawnSVG(p.color)}</span>
        <span class="seat-who">
          <strong>${escapeHtml(p.name)}</strong>
          <small>${p.collected.length} treasure${
            p.collected.length === 1 ? "" : "s"
          }${p.id === winner?.id ? " · home" : ""}</small>
        </span>
      </li>`,
    )
    .join("");

  $("over").innerHTML = `
    <h2>${iWon ? "You win!" : `${escapeHtml(winner?.name ?? "Nobody")} wins`}</h2>
    <p class="lede">${
      iWon
        ? "Every treasure on your cards, and back to your own corner before anyone else."
        : `${escapeHtml(
            winner?.name ?? "They",
          )} emptied their stack and made it home. Another go?`
    }</p>
    <ul class="roster standings">${standings}</ul>
    <div class="start-actions">
      ${
        mine.host
          ? `<button class="btn gold" id="over-again">Back to the lobby</button>`
          : `<p class="note">Waiting for the host to start another game.</p>`
      }
      <button class="btn ghost" id="over-leave">Leave</button>
    </div>`;

  $("over-scrim").hidden = false;
  if (iWon) {
    playFanfare();
    confetti();
  }

  document.getElementById("over-again")?.addEventListener("click", () => {
    net.send({ t: "again" });
  });
  $("over-leave").addEventListener("click", () => net.send({ t: "leave" }));
}

function confetti() {
  const layer = document.createElement("div");
  layer.className = "confetti";
  const colors = ["#f2c93f", "#c8382e", "#2f5fa8", "#3d8f4e", "#f6efd9"];
  for (let i = 0; i < 130; i++) {
    const bit = document.createElement("i");
    bit.style.left = `${Math.random() * 100}vw`;
    bit.style.background = colors[Math.floor(Math.random() * colors.length)]!;
    bit.style.animationDuration = `${2.4 + Math.random() * 2.6}s`;
    bit.style.animationDelay = `${Math.random() * 1.4}s`;
    layer.append(bit);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 7000);
}

/* ─────────────────────────── input ─────────────────────────── */

function onBoardClick(event: MouseEvent) {
  const cell = (event.target as HTMLElement).closest<HTMLElement>(".cell");
  if (!cell) return;

  // the spare tile is the one thing on the board you turn rather than walk to
  if (cell.classList.contains("is-spare")) return rotateSpare(1);

  if (!cell.classList.contains("reachable")) return;
  net.send({
    t: "move",
    r: Number(cell.style.getPropertyValue("--r")),
    c: Number(cell.style.getPropertyValue("--c")),
  });
}

function rotateSpare(quarters: number) {
  if (!myTurn() || room!.game!.phase !== "insert") return;
  net.send({ t: "rotate", quarters });
}

function leaveRoom() {
  const playing = room?.status === "playing";
  if (
    playing &&
    !confirm("Leaving ends the game for everyone still at the table. Leave anyway?")
  )
    return;
  net.send({ t: "leave" });
}

function wire() {
  $("home-create").addEventListener("click", () => {
    unlockAudio();
    const name = myName();
    rememberName(name);
    net.send({ t: "create", name });
  });

  $("join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    unlockAudio();
    const input = $("home-code") as HTMLInputElement;
    const code = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      const err = $("home-error");
      err.hidden = false;
      err.textContent = "A room code is four letters or numbers.";
      return;
    }
    const name = myName();
    rememberName(name);
    net.send({ t: "join", code, name });
  });

  ($("home-code") as HTMLInputElement).addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  $("home-name").addEventListener("change", () => rememberName(myName()));

  $("copy-link").addEventListener("click", async () => {
    const link = `${location.origin}/j/${room?.code ?? ""}`;
    try {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied.");
    } catch {
      toast(link);
    }
  });

  const cards = $("cards") as HTMLInputElement;
  cards.addEventListener("input", () => {
    $("cards-out").textContent = `— ${cards.value} each`;
  });
  cards.addEventListener("change", () =>
    net.send({ t: "cards", cardsPerPlayer: Number(cards.value) }),
  );

  $("begin").addEventListener("click", () => {
    unlockAudio();
    net.send({ t: "begin" });
  });

  $("lobby-leave").addEventListener("click", leaveRoom);
  $("leave").addEventListener("click", leaveRoom);

  $("rot-cw").addEventListener("click", () => rotateSpare(1));
  $("rot-ccw").addEventListener("click", () => rotateSpare(-1));

  $("stay").addEventListener("click", () => {
    const mine = me();
    if (mine) net.send({ t: "move", r: mine.pawn.r, c: mine.pawn.c });
  });

  $("pass").addEventListener("click", () => net.send({ t: "pass" }));

  $("mute").addEventListener("click", () => {
    setMuted(!isMuted());
    $("mute").textContent = isMuted() ? "Sound off" : "Sound on";
  });

  document.addEventListener("keydown", (event) => {
    if ($("game").hidden) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      rotateSpare(event.shiftKey ? -1 : 1);
    } else if (event.key === " " && myTurn() && room!.game!.phase === "move") {
      event.preventDefault();
      const mine = me()!;
      net.send({ t: "move", r: mine.pawn.r, c: mine.pawn.c });
    }
  });
}

/* ─────────────────────────── boot ─────────────────────────── */

function boot() {
  $("home-crest").innerHTML = iconSVG("chest");
  const stored = localStorage.getItem(NAME_KEY) ?? "";
  ($("home-name") as HTMLInputElement).value = stored;
  wire();
  showScreen("home");

  const invited = codeFromUrl();
  const seat = loadSeat();

  if (invited && (!seat || seat.code !== invited)) {
    // a fresh invite link wins over whatever seat this browser was last in
    clearSeat();
    ($("home-code") as HTMLInputElement).value = invited;
    if (stored) net.send({ t: "join", code: invited, name: stored });
    else $("home-name").focus();
  } else if (seat) {
    net.resumeWith(seat);
    net.connect();
  }

  if (invited) history.replaceState({}, "", "/");
}

boot();
