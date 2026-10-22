// Tiny synthesized sound effects (no audio files to ship).
import { useApp } from '../store';

let ctx: AudioContext | null = null;
const ac = () => {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slide?: number) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, gain: number, delay = 0, hp = 2000) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

const sounds = {
  deal: () => noise(0.06, 0.25, 0, 3000),
  chip: () => {
    tone(2400, 0.05, 'triangle', 0.08);
    tone(3100, 0.05, 'triangle', 0.06, 0.04);
  },
  check: () => {
    tone(180, 0.07, 'sine', 0.3);
    tone(170, 0.07, 'sine', 0.25, 0.09);
  },
  fold: () => noise(0.12, 0.12, 0, 1200),
  turn: () => {
    tone(880, 0.18, 'sine', 0.12);
    tone(1320, 0.25, 'sine', 0.1, 0.12);
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.1, i * 0.08)),
};

export type SoundName = keyof typeof sounds;

export function play(name: SoundName) {
  if (useApp.getState().muted) return;
  try {
    sounds[name]();
  } catch {
    /* audio unavailable */
  }
}

/** iOS needs a user gesture before audio plays. */
export function unlockAudio() {
  const a = ac();
  if (a) tone(1, 0.01, 'sine', 0.0001);
}

export function buzz(ms = 30) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}
