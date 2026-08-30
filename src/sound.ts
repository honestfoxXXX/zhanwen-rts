/** 极简 WebAudio 合成音效（无资源文件） */

let ac: AudioContext | null = null;
let muted = false;
const lastPlay = new Map<string, number>();

try { muted = localStorage.getItem('zw_mute') === '1'; } catch { /* ignore */ }

export function initAudio(): void {
  if (!ac) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (Ctx) ac = new Ctx();
  }
  if (ac && ac.state === 'suspended') void ac.resume();
}

export function isMuted(): boolean { return muted; }

export function toggleMute(): string {
  muted = !muted;
  try { localStorage.setItem('zw_mute', muted ? '1' : '0'); } catch { /* ignore */ }
  return muted ? '关' : '开';
}

function beep(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export type SoundName = 'shot' | 'boom' | 'die' | 'built' | 'train' | 'win' | 'lose' | 'draw' | 'ui' | 'deny' | 'move' | 'alarm';

export function play(name: SoundName): void {
  if (!ac || muted) return;
  const now = performance.now();
  const gap = name === 'shot' ? 70 : name === 'move' ? 120 : 0;
  if (gap) {
    const last = lastPlay.get(name) ?? 0;
    if (now - last < gap) return;
    lastPlay.set(name, now);
  }
  switch (name) {
    case 'shot': beep(720, 200, 0.07, 'square', 0.025); break;
    case 'die': beep(300, 60, 0.22, 'sawtooth', 0.05); break;
    case 'boom': beep(120, 40, 0.5, 'triangle', 0.16); beep(300, 50, 0.3, 'sawtooth', 0.06, 0.03); break;
    case 'built': beep(420, 640, 0.1, 'sine', 0.08); beep(640, 860, 0.1, 'sine', 0.07, 0.09); break;
    case 'train': beep(500, 700, 0.08, 'sine', 0.07); break;
    case 'move': beep(340, 480, 0.06, 'sine', 0.05); break;
    case 'alarm': beep(520, 300, 0.18, 'square', 0.08); beep(430, 230, 0.22, 'square', 0.08, 0.2); break;
    case 'deny': beep(220, 160, 0.15, 'square', 0.06); break;
    case 'ui': beep(600, 800, 0.05, 'sine', 0.06); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => beep(f, f, 0.16, 'triangle', 0.1, i * 0.13)); break;
    case 'lose': [392, 330, 262, 196].forEach((f, i) => beep(f, f, 0.2, 'triangle', 0.1, i * 0.16)); break;
    case 'draw': [440, 392, 440, 392].forEach((f, i) => beep(f, f, 0.18, 'triangle', 0.09, i * 0.15)); break;
  }
}
