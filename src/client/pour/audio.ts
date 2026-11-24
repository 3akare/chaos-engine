/** Small synthesised sounds (no files). Audio starts on the first tap, as browsers require. */
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;

export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.55;
}
export const isMuted = (): boolean => muted;

export function unlockAudio(): void {
  if (ac) {
    if (ac.state === 'suspended') void ac.resume();
    return;
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ac = new Ctx();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ac.destination);
    noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    ac = null;
  }
}

export function tone(f0: number, f1: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, when = 0): void {
  if (!ac || !master) return;
  const t = ac.currentTime + when;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A ball hitting something: a tiny tick, louder when faster. */
export function click(speed: number): void {
  if (!ac || !master || !noise) return;
  const t = ac.currentTime;
  const s = ac.createBufferSource();
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  s.buffer = noise;
  f.type = 'bandpass';
  f.frequency.value = 1800 + Math.random() * 2400;
  f.Q.value = 6;
  g.gain.setValueAtTime(Math.min(0.35, 0.04 + speed * 0.03), t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  s.connect(f);
  f.connect(g);
  g.connect(master);
  s.start(t, Math.random() * 0.4, 0.06);
}

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
export function ding(n: number): void {
  const f = 523 * Math.pow(2, SCALE[n % SCALE.length]! / 12) * (n >= SCALE.length ? 2 : 1);
  tone(f, f / (n >= SCALE.length ? 2 : 1), 0.25, 'triangle', 0.16);
}
export const boing = (): void => tone(180, 620, 0.22, 'sine', 0.22);
export const bonk = (): void => tone(320, 140, 0.12, 'square', 0.08);
export const tick = (): void => tone(660, 880, 0.06, 'sine', 0.08);
export const place = (): void => tone(500, 700, 0.07, 'sine', 0.1);
export const unplace = (): void => tone(300, 200, 0.08, 'sine', 0.08);
export function fanfare(level: number): void {
  [0, 4, 7, 12, 16].slice(0, 2 + level).forEach((s, i) => tone(392 * Math.pow(2, s / 12), 392 * Math.pow(2, s / 12), 0.35, 'triangle', 0.2, i * 0.12));
}
