/**
 * Synthesised sound effects — no audio assets to ship, and nothing that can
 * fail to load on the day.
 */

let ctx: AudioContext | null = null;
let muted = false;

export function unlockAudio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(value: boolean) {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

function gainNode(at: number, peak: number, duration: number): GainNode | null {
  if (muted || !ctx) return null;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  g.connect(ctx.destination);
  return g;
}

/** Stone grinding on stone, for a tile being pushed in. */
export function playSlide() {
  const c = ctx;
  if (muted || !c) return;
  const now = c.currentTime;
  const duration = 0.42;

  const frames = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    data[i] = (Math.random() * 2 - 1) * (1 - t) * (0.35 + 0.65 * Math.sin(t * Math.PI));
  }

  const src = c.createBufferSource();
  src.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(340, now);
  filter.frequency.linearRampToValueAtTime(900, now + duration);
  filter.Q.value = 0.9;

  const g = gainNode(now, 0.22, duration);
  if (!g) return;
  src.connect(filter).connect(g);
  src.start(now);
  src.stop(now + duration);
}

/** Soft tick as the pawn steps along the corridor. */
export function playStep(index = 0) {
  const c = ctx;
  if (muted || !c) return;
  const at = c.currentTime + index * 0.075;
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(220 + (index % 3) * 30, at);
  const g = gainNode(at, 0.07, 0.09);
  if (!g) return;
  osc.connect(g);
  osc.start(at);
  osc.stop(at + 0.1);
}

/** Rising chime when a treasure is claimed. */
export function playUnlock() {
  const c = ctx;
  if (muted || !c) return;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    const at = c.currentTime + i * 0.11;
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, at);
    const g = gainNode(at, 0.16, 0.75);
    if (!g) return;
    osc.connect(g);
    osc.start(at);
    osc.stop(at + 0.8);
  });
}

/** Little fanfare for the ending screen. */
export function playFanfare() {
  const c = ctx;
  if (muted || !c) return;
  const melody: [number, number][] = [
    [523.25, 0],
    [523.25, 0.16],
    [587.33, 0.32],
    [523.25, 0.56],
    [698.46, 0.76],
    [659.25, 1.0],
  ];
  for (const [freq, offset] of melody) {
    const at = c.currentTime + offset;
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, at);
    const g = gainNode(at, 0.13, 0.42);
    if (!g) return;
    osc.connect(g);
    osc.start(at);
    osc.stop(at + 0.5);
  }
}

/** Stand-in "recording" used in demo mode, so the flow can be tested. */
export function playDemoMessage(): Promise<void> {
  const c = unlockAudio();
  if (muted) return Promise.resolve();
  const melody: [number, number][] = [
    [391.99, 0],
    [391.99, 0.22],
    [440.0, 0.44],
    [391.99, 0.7],
    [523.25, 0.96],
    [493.88, 1.22],
  ];
  for (const [freq, offset] of melody) {
    const at = c.currentTime + offset;
    const osc = c.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, at);
    const g = gainNode(at, 0.08, 0.24);
    if (!g) continue;
    osc.connect(g);
    osc.start(at);
    osc.stop(at + 0.3);
  }
  return new Promise((resolve) => setTimeout(resolve, 1700));
}
