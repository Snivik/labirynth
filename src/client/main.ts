/**
 * Game shell: board rendering, turn flow, and the unlock overlays.
 */

import {
  ARROWS,
  HOME_CORNERS,
  SIZE,
  arrowById,
  key,
  pathBetween,
  type PawnColor,
} from "../game/board.ts";
import {
  applyInsert,
  applyMove,
  applyOpponentTurn,
  buildDeck,
  createGame,
  currentTarget,
  movableCells,
  targetInHand,
  type GameState,
} from "../game/engine.ts";
import { treasureById } from "../game/treasures.ts";
import {
  arrowSVG,
  cardBackSVG,
  cardFaceSVG,
  cardHomeSVG,
  pawnSVG,
  tileSVG,
} from "./art.ts";
import { iconSVG } from "./icons.ts";
import {
  isMuted,
  playDemoMessage,
  playFanfare,
  playSlide,
  playStep,
  playUnlock,
  setMuted,
  unlockAudio,
} from "./sfx.ts";

interface Collectible {
  id: string;
  treasureId: string;
  name: string;
  relation: string;
  audioUrl: string | null;
}

interface GameConfig {
  demo: boolean;
  playerName: string;
  collectibles: Collectible[];
}

const SAVE_KEY = "labyrinth-save-v2";
const SLIDE_MS = 420;
const STEP_MS = 140;

/** Touch screens get no hover previews — they'd latch on tap and never clear. */
const HOVER_CAPABLE = window.matchMedia("(hover: hover)").matches;

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let config: GameConfig = { demo: true, playerName: "", collectibles: [] };
let byTreasure = new Map<string, Collectible>();
let state!: GameState;
let pawnColor: PawnColor = "yellow";
let busy = false;

/** One DOM node per tile, kept for the whole game so tiles animate as they slide. */
const tileEls = new Map<string, HTMLElement>();
let pawnEl: HTMLElement;
/**
 * Where the spare tile is parked, in board coordinates (off-grid by one).
 * Column 0 has no arrow, so the opening position covers no control — and on a
 * phone, where the spare rests on the frame band, that matters.
 */
const START_PARK = { r: SIZE, c: 0, axis: "y" as "x" | "y", sign: 1 };
let sparePark = { ...START_PARK };

/* ─────────────────────────── boot ─────────────────────────── */

async function boot() {
  try {
    const res = await fetch("/api/game");
    config = (await res.json()) as GameConfig;
  } catch {
    $("start-note").textContent = "Could not reach the server. Refresh to try again.";
  }
  byTreasure = new Map(config.collectibles.map((c) => [c.treasureId, c]));

  renderStartScreen();
}

function renderStartScreen() {
  const n = config.collectibles.length;
  const who = config.playerName.trim();

  $("start-crest").innerHTML = iconSVG("chest");
  $("start-subtitle").textContent = who ? `Birthday Edition — for ${who}` : "Birthday Edition";
  $("start-intro").innerHTML = config.demo
    ? `<strong>Demo mode.</strong> No recordings have been uploaded yet, so the ${n}
       treasures play a placeholder chime. Everything else works exactly as it will
       on the day.`
    : `Somewhere in these shifting corridors, ${n} ${
        n === 1 ? "person has" : "people have"
      } hidden their voice. Find every treasure, then find your way home.`;

  const choice = $("pawn-choice");
  choice.innerHTML = "";
  for (const corner of HOME_CORNERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = pawnSVG(corner.color);
    b.setAttribute("aria-pressed", String(corner.color === pawnColor));
    b.title = `Start in the ${corner.color} corner`;
    b.addEventListener("click", () => {
      pawnColor = corner.color;
      for (const el of Array.from(choice.children)) el.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-pressed", "true");
    });
    choice.append(b);
  }

  const saved = loadSave();
  const resumeBtn = $("resume");
  resumeBtn.hidden = !saved;
  if (saved) {
    resumeBtn.addEventListener("click", () => {
      state = saved;
      pawnColor = saved.pawnColor;
      startGame(false);
    });
  }

  $("begin").addEventListener("click", () => {
    state = createGame({
      collectibles: buildDeck(config.collectibles.map((c) => c.treasureId)),
      pawnColor,
    });
    startGame(true);
  });

  $("start-note").textContent = config.demo
    ? "Upload recordings at /admin to replace the placeholders."
    : `${n} ${n === 1 ? "message" : "messages"} waiting to be found.`;
}

/* ─────────────────────────── board construction ─────────────────────────── */

function startGame(fresh: boolean) {
  unlockAudio();
  $("start").hidden = true;
  $("game").hidden = false;
  $("panel-sub").textContent = config.playerName
    ? `for ${config.playerName}`
    : "Birthday Edition";

  buildBoard();
  if (fresh) resetSparePark();
  layout(true);
  renderPanel();
  save();
}

function buildBoard() {
  const board = $("board");
  board.innerHTML = "";
  tileEls.clear();

  const allTiles = [...state.grid.flat(), state.spare];
  for (const tile of allTiles) {
    const el = document.createElement("div");
    el.className = "cell";
    el.dataset.tile = tile.id;
    el.innerHTML = tileSVG(tile);
    board.append(el);
    tileEls.set(tile.id, el);
  }

  pawnEl = document.createElement("div");
  pawnEl.className = "pawn";
  pawnEl.innerHTML = pawnSVG(state.pawnColor);
  board.append(pawnEl);

  buildArrows();
  board.addEventListener("click", onBoardClick);
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
    b.addEventListener("click", () => void onArrowClick(arrow.id));
    // on a touch screen mouseenter fires on tap and the preview would stick
    if (HOVER_CAPABLE) {
      b.addEventListener("mouseenter", () => previewShift(arrow.id, true));
      b.addEventListener("mouseleave", () => previewShift(arrow.id, false));
    }
    frame.append(b);
  }
}

function resetSparePark() {
  sparePark = { ...START_PARK };
}

/** Park the spare beside the board, one step past the square it was ejected from. */
function parkFromArrow(arrowId: string, exit: [number, number]) {
  const side = arrowById(arrowId)!.side;
  switch (side) {
    case "top":
      sparePark = { r: SIZE, c: exit[1], axis: "y", sign: 1 };
      break;
    case "bottom":
      sparePark = { r: -1, c: exit[1], axis: "y", sign: -1 };
      break;
    case "left":
      sparePark = { r: exit[0], c: SIZE, axis: "x", sign: 1 };
      break;
    case "right":
      sparePark = { r: exit[0], c: -1, axis: "x", sign: -1 };
      break;
  }
}

/* ─────────────────────────── layout ─────────────────────────── */

function place(el: HTMLElement, r: number, c: number) {
  el.style.setProperty("--r", String(r));
  el.style.setProperty("--c", String(c));
}

/**
 * Push the current game state into the DOM. Tile nodes never get recreated, so
 * every change is a transform the browser can animate.
 */
function layout(immediate = false) {
  const board = $("board");
  if (immediate) board.classList.add("no-anim");

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const el = tileEls.get(state.grid[r]![c]!.id)!;
      place(el, r, c);
      el.style.removeProperty("--nx");
      el.style.removeProperty("--ny");
      el.classList.remove("is-spare");
    }
  }

  const spareEl = tileEls.get(state.spare.id)!;
  place(spareEl, sparePark.r, sparePark.c);
  spareEl.classList.add("is-spare");
  // how far past the frame the spare rests; the stylesheet tunes it per screen
  const nudge = `calc(var(--spare-nudge) * ${sparePark.sign})`;
  spareEl.style.setProperty(sparePark.axis === "x" ? "--nx" : "--ny", nudge);
  spareEl.style.removeProperty(sparePark.axis === "x" ? "--ny" : "--nx");

  place(pawnEl, state.pawn.r, state.pawn.c);

  markTarget();
  markReachable();

  if (immediate) {
    void board.offsetWidth; // flush, so the next change animates from here
    board.classList.remove("no-anim");
  }
}

function markTarget() {
  for (const el of tileEls.values()) el.classList.remove("is-target");
  const target = currentTarget(state);
  if (!target) return;

  if (target.kind === "home") {
    tileEls.get(state.grid[state.home.r]![state.home.c]!.id)?.classList.add("is-target");
    return;
  }
  for (const tile of [...state.grid.flat(), state.spare]) {
    if (tile.treasure === target.treasureId)
      tileEls.get(tile.id)?.classList.add("is-target");
  }
}

function markReachable() {
  for (const el of tileEls.values()) el.classList.remove("reachable");
  if (state.phase !== "move") return;
  const cells = movableCells(state);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (cells.has(key(r, c)))
        tileEls.get(state.grid[r]![c]!.id)?.classList.add("reachable");
    }
  }
}

function previewShift(arrowId: string, on: boolean) {
  const arrow = arrowById(arrowId)!;
  if (on && (busy || state.phase !== "insert" || state.blockedArrow === arrowId)) return;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const inLine =
        arrow.side === "top" || arrow.side === "bottom"
          ? c === arrow.index
          : r === arrow.index;
      if (!inLine) continue;
      tileEls.get(state.grid[r]![c]!.id)?.classList.toggle("previewed", on);
    }
  }
}

function clearPreviews() {
  for (const el of tileEls.values()) el.classList.remove("previewed");
}

/* ─────────────────────────── panel ─────────────────────────── */

function renderPanel() {
  const target = currentTarget(state);
  const deck = $("deck");
  const caption = $("card-caption");

  deck.innerHTML = "";
  if (target?.kind === "treasure") {
    if (state.deck.length > 1) {
      const back = document.createElement("div");
      back.className = "card stack-back";
      back.innerHTML = cardBackSVG();
      deck.append(back);
    }
    const face = document.createElement("div");
    face.className = "card current";
    face.innerHTML = cardFaceSVG(target.treasureId!);
    deck.append(face);
    const treasure = treasureById(target.treasureId!);
    caption.innerHTML = `<small>Find</small>${treasure?.name ?? "the treasure"}`;
  } else if (target?.kind === "home") {
    const face = document.createElement("div");
    face.className = "card current";
    face.innerHTML = cardHomeSVG(state.pawnColor);
    deck.append(face);
    caption.innerHTML = `<small>Last card</small>Return to your corner`;
  } else {
    caption.innerHTML = `<small>Complete</small>Every voice found`;
  }

  renderStatus();
  renderProgress();

  ($("stay") as HTMLButtonElement).disabled = state.phase !== "move" || busy;
  $("messages").hidden = state.collected.length === 0;
  $("mute").textContent = isMuted() ? "Sound off" : "Sound on";
  const total = state.collected.length + state.deck.length;
  $("turn-meta").textContent = `Turn ${state.turn} · ${state.pushes} ${
    state.pushes === 1 ? "tile" : "tiles"
  } pushed · ${state.collected.length}/${total} found`;

  for (const b of document.querySelectorAll<HTMLButtonElement>(".arrow")) {
    const blocked = b.dataset.arrow === state.blockedArrow;
    b.disabled = busy || state.phase !== "insert" || blocked;
    b.classList.toggle("blocked", blocked);
  }
}

function renderStatus() {
  const el = $("status");
  const target = currentTarget(state);

  if (state.phase === "insert") {
    const bits: string[] = [];
    if (target?.kind === "treasure" && targetInHand(state)) {
      bits.push(
        `The <strong>${treasureById(target.treasureId!)?.name}</strong> is on the spare tile — push it in to put it on the board.`,
      );
    } else {
      bits.push("Slide the spare tile in at any gold arrow.");
    }
    if (state.blockedArrow) bits.push("<em>One arrow is greyed out: it would undo the last push.</em>");
    el.innerHTML = bits.join(" ");
  } else if (state.phase === "move") {
    el.innerHTML =
      target?.kind === "home"
        ? "Walk home — your corner is glowing."
        : "Walk to any lit square, as far as the corridors allow. Or stay put.";
  } else if (state.phase === "opponent") {
    el.innerHTML = "<strong>Your rival</strong> is shoving the spare tile in somewhere…";
  } else {
    el.innerHTML = "You made it home with every voice.";
  }
}

function renderProgress() {
  const wrap = $("progress");
  wrap.innerHTML = "";
  const order = [...state.collected, ...state.deck];
  for (const treasureId of order) {
    const pip = document.createElement("div");
    const done = state.collected.includes(treasureId);
    pip.className = `pip${done ? " done" : ""}${
      state.deck[0] === treasureId ? " current" : ""
    }`;
    pip.innerHTML = iconSVG(treasureById(treasureId)?.icon ?? "chest");
    pip.title = done
      ? `${byTreasure.get(treasureId)?.name ?? "Found"}`
      : "Still hidden";
    wrap.append(pip);
  }
}

/* ─────────────────────────── turn flow ─────────────────────────── */

async function onArrowClick(arrowId: string) {
  if (busy || state.phase !== "insert" || state.blockedArrow === arrowId) return;
  busy = true;
  clearPreviews();

  const out = applyInsert(state, arrowId);
  state = out.state;
  parkFromArrow(arrowId, out.exit);

  playSlide();
  if (out.wrapped) pawnEl.style.transition = "none";
  layout();
  if (out.wrapped) releasePawnJump();
  renderPanel();
  await wait(SLIDE_MS);

  busy = false;
  renderPanel();
  save();
}

function onBoardClick(event: MouseEvent) {
  const cell = (event.target as HTMLElement).closest<HTMLElement>(".cell");
  if (!cell || !cell.classList.contains("reachable")) return;
  const r = Number(cell.style.getPropertyValue("--r"));
  const c = Number(cell.style.getPropertyValue("--c"));
  void takeTurn({ r, c });
}

/** Move the pawn, resolve the treasure, then hand the board to the opponent. */
async function takeTurn(to: { r: number; c: number }) {
  if (busy || state.phase !== "move") return;
  busy = true;
  renderPanel();

  const path = pathBetween(state.grid, state.pawn, to);
  if (path && path.length > 1) {
    pawnEl.classList.remove("settling");
    for (let i = 1; i < path.length; i++) {
      place(pawnEl, path[i]![0], path[i]![1]);
      playStep(0);
      await wait(STEP_MS);
    }
  }

  const out = applyMove(state, to);
  state = out.state;
  markReachable();
  save();

  if (out.collected) {
    playUnlock();
    await wait(340);
    await showReveal(out.collected);
    markTarget();
    renderPanel();
  }

  if (out.won) {
    busy = false;
    await showFinale();
    return;
  }

  await opponentTurn();
  busy = false;
  renderPanel();
  save();
}

async function opponentTurn() {
  renderPanel();
  await wait(520);

  const out = applyOpponentTurn(state);
  state = out.state;
  parkFromArrow(out.arrowId, out.exit);

  const arrowBtn = document.querySelector<HTMLElement>(`.arrow[data-arrow="${out.arrowId}"]`);
  arrowBtn?.animate(
    [
      { filter: "drop-shadow(0 0 0 rgba(242,201,63,0))", scale: "1" },
      { filter: "drop-shadow(0 0 12px rgba(255,120,90,1))", scale: "1.35" },
      { filter: "drop-shadow(0 0 0 rgba(242,201,63,0))", scale: "1" },
    ],
    { duration: 700, easing: "ease-out" },
  );

  playSlide();
  pawnEl.classList.add("settling");
  if (out.wrapped) pawnEl.style.transition = "none";
  layout();
  if (out.wrapped) releasePawnJump();
  await wait(SLIDE_MS);
  pawnEl.classList.remove("settling");
}

/**
 * A pawn carried off the far edge reappears on the tile just inserted. Flush the
 * new position with transitions off so it teleports instead of gliding across
 * the whole board.
 */
function releasePawnJump() {
  void pawnEl.offsetWidth;
  pawnEl.style.transition = "";
}

/* ─────────────────────────── reveal ─────────────────────────── */

function showReveal(treasureId: string): Promise<void> {
  const treasure = treasureById(treasureId);
  const person = byTreasure.get(treasureId);
  const scrim = $("reveal-scrim");
  const box = $("reveal");

  box.innerHTML = `
    <p class="found">Treasure claimed</p>
    <div class="reveal-icon">${iconSVG(treasure?.icon ?? "chest")}</div>
    <h2>${escapeHtml(treasure?.name ?? "A treasure")}</h2>
    <p class="from">A birthday message from</p>
    <p class="who">${escapeHtml(person?.name ?? "someone who loves you")}</p>
    ${person?.relation ? `<p class="relation">${escapeHtml(person.relation)}</p>` : ""}
    ${
      person?.audioUrl
        ? `<audio id="reveal-audio" controls autoplay preload="auto" src="${person.audioUrl}"></audio>`
        : `<p class="demo-note">Demo mode — a placeholder chime plays instead of a recording.</p>`
    }
    <button class="btn gold" id="reveal-continue">Back to the labyrinth</button>
  `;

  scrim.hidden = false;

  const audio = document.getElementById("reveal-audio") as HTMLAudioElement | null;
  if (audio) {
    audio.play().catch(() => {
      /* browser declined autoplay; the controls are right there */
    });
  } else {
    void playDemoMessage();
  }

  return new Promise((resolve) => {
    $("reveal-continue").addEventListener(
      "click",
      () => {
        audio?.pause();
        scrim.hidden = true;
        resolve();
      },
      { once: true },
    );
  });
}

/* ─────────────────────────── gallery + finale ─────────────────────────── */

let galleryAudio: HTMLAudioElement | null = null;

function galleryHTML(treasureIds: string[]): string {
  return `<div class="gallery">${treasureIds
    .map((id) => {
      const person = byTreasure.get(id);
      const treasure = treasureById(id);
      return `<button class="gallery-item" data-treasure="${id}">
        ${iconSVG(treasure?.icon ?? "chest")}
        <span>${escapeHtml(person?.name ?? treasure?.name ?? "Message")}
          ${person?.relation ? `<small>${escapeHtml(person.relation)}</small>` : ""}
        </span>
      </button>`;
    })
    .join("")}</div>`;
}

function wireGallery(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".gallery-item").forEach((item) => {
    item.addEventListener("click", () => {
      const person = byTreasure.get(item.dataset.treasure!);
      root.querySelectorAll(".gallery-item").forEach((el) => el.classList.remove("playing"));
      galleryAudio?.pause();

      if (!person?.audioUrl) {
        void playDemoMessage();
        return;
      }
      item.classList.add("playing");
      galleryAudio = new Audio(person.audioUrl);
      galleryAudio.addEventListener("ended", () => item.classList.remove("playing"));
      void galleryAudio.play();
    });
  });
}

function showMessages() {
  const scrim = $("reveal-scrim");
  const box = $("reveal");
  box.innerHTML = `
    <p class="found">Messages unlocked so far</p>
    ${galleryHTML(state.collected)}
    <button class="btn gold" id="reveal-continue">Back to the labyrinth</button>
  `;
  scrim.hidden = false;
  wireGallery(box);
  $("reveal-continue").addEventListener(
    "click",
    () => {
      galleryAudio?.pause();
      scrim.hidden = true;
    },
    { once: true },
  );
}

async function showFinale() {
  const scrim = $("finale-scrim");
  const box = $("finale");
  const who = config.playerName.trim();
  const n = state.collected.length;

  box.innerHTML = `
    <h2>Happy Birthday${who ? `, ${escapeHtml(who)}` : ""}!</h2>
    <p class="lede">You walked out of the labyrinth carrying ${n}
      ${n === 1 ? "voice" : "voices"} — every one of them here because of you.
      Play them again as often as you like.</p>
    ${galleryHTML(state.collected)}
    <div class="start-actions">
      <button class="btn gold" id="finale-close">Keep the messages open</button>
      <button class="btn ghost" id="finale-restart">Play again</button>
    </div>
  `;

  scrim.hidden = false;
  wireGallery(box);
  playFanfare();
  confetti();

  $("finale-close").addEventListener("click", () => {
    scrim.hidden = true;
    $("messages").hidden = false;
  });
  $("finale-restart").addEventListener("click", () => {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  });
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

/* ─────────────────────────── persistence ─────────────────────────── */

function signature(): string {
  return config.collectibles.map((c) => `${c.id}:${c.treasureId}`).join("|");
}

function save() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ signature: signature(), sparePark, state }),
    );
  } catch {
    /* storage full or blocked — the game just won't resume */
  }
}

function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      signature: string;
      sparePark: typeof sparePark;
      state: GameState;
    };
    if (parsed.signature !== signature()) return null;
    if (parsed.state?.version !== 1 || parsed.state.phase === "won") return null;
    sparePark = parsed.sparePark ?? sparePark;
    // A saved game caught mid-animation resumes at the start of its turn.
    if (parsed.state.phase === "opponent") parsed.state.phase = "move";
    return parsed.state;
  } catch {
    return null;
  }
}

/* ─────────────────────────── misc ─────────────────────────── */

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

$("stay").addEventListener("click", () => void takeTurn({ ...state.pawn }));
$("messages").addEventListener("click", showMessages);
$("mute").addEventListener("click", () => {
  setMuted(!isMuted());
  $("mute").textContent = isMuted() ? "Sound off" : "Sound on";
});
$("restart").addEventListener("click", () => {
  if (!confirm("Start a brand new labyrinth? Unlocked messages stay unlocked in Messages.")) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
});

void boot();
