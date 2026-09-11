/** WebAudio 合成音效（无资源文件）。
 *
 * 去电子化的三个核心手段：
 *   1. 卷积混响 —— 程序生成的指数衰减脉冲响应，所有声音带空间尾巴（去"干瘪"感）
 *   2. 非谐泛音簇 —— 金属撞击 = 多个不相干高频正弦簇快速衰减（真实"铿"声，替代方波）
 *   3. 噪声塑形 —— 带通/低通扫频噪声做"嗖/轰/碎"，替代方波/锯齿主体
 *
 * 保留的工程结构：play(name, vol) 统一入口、lastPlay 节流、战斗激烈度动态混音、
 * 生成式音乐层（拨弦 + 战鼓，和平/战斗双状态）。
 */

let ac: AudioContext | null = null;
import { settings } from './settings';

let master: GainNode | null = null;
let sfxBus: GainNode | null = null; // 所有音效挂此：干声进 master，湿声进混响
let musicBus: GainNode | null = null; // 音乐独立音轨（pluck/drum），音量独立可调
let noiseBuf: AudioBuffer | null = null;
let muted = false;
let musicOn = true;
let battleLevel = 0; // 0~1 战斗激烈度（主循环按事件密度更新）
let windGain: GainNode | null = null;
let musicTimer: number | null = null;
let birdTimer: number | null = null;
const lastPlay = new Map<string, number>();

try { muted = localStorage.getItem('zw_mute') === '1'; } catch { /* ignore */ }
try { musicOn = localStorage.getItem('zw_music') !== '0'; } catch { /* ignore */ }

export function initAudio(): void {
  if (!ac) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      ac = new Ctx();
      master = ac.createGain();
      master.gain.value = settings.master;
      // 压限器：混战时几十个声音叠在一起也不爆音
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 26;
      comp.ratio.value = 7;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;
      master.connect(comp);
      comp.connect(ac.destination);
      // 音效总线：干声直进 master，湿声进卷积混响
      sfxBus = ac.createGain();
      sfxBus.gain.value = settings.sfx;
      sfxBus.connect(master);
      musicBus = ac.createGain();
      musicBus.gain.value = settings.music;
      musicBus.connect(master);
      const conv = ac.createConvolver();
      conv.buffer = makeImpulse(1.5, 2.3);
      const wet = ac.createGain();
      wet.gain.value = 0.2;
      sfxBus.connect(wet);
      wet.connect(conv);
      conv.connect(master);
      // 1 秒白噪声缓冲，所有噪声层共用
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      startAmbient();
      startMusic();
    }
  }
  if (ac && ac.state === 'suspended') void ac.resume();
}

/** 程序生成混响脉冲响应：立体声指数衰减噪声 */
function makeImpulse(seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ac!.sampleRate * seconds);
  const buf = ac!.createBuffer(2, len, ac!.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export function isMuted(): boolean { return muted; }

/** 设置面板三轨音量：主/音乐/音效（0-1），实时生效 */
export function setVolumes(masterV: number, musicV: number, sfxV: number): void {
  if (master) master.gain.value = masterV;
  if (musicBus) musicBus.gain.value = musicV;
  if (sfxBus) sfxBus.gain.value = sfxV;
}

export function toggleMute(): string {
  muted = !muted;
  try { localStorage.setItem('zw_mute', muted ? '1' : '0'); } catch { /* ignore */ }
  return muted ? '关' : '开';
}

/** 音高抖动，让重复音效有自然差异 */
function jitter(f: number): number { return f * (0.94 + Math.random() * 0.12); }

/** 振荡器层：频率从 f0 滑到 f1（挂音效总线，带混响；可选 lowpass 去刺耳谐波） */
function tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0, attack = 0.004, lp?: number): void {
  if (!ac || !sfxBus) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, f0), t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let tail: AudioNode = g;
  if (lp) {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    g.connect(f);
    tail = f;
  }
  osc.connect(g);
  tail.connect(sfxBus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** 噪声层：滤波器频率扫频（挂音效总线） */
function noiseAt(dur: number, f0: number, f1: number, vol: number, delay = 0, type: BiquadFilterType = 'lowpass', q = 0.8): void {
  if (!ac || !sfxBus || !noiseBuf) return;
  const t0 = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const flt = ac.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(Math.max(40, f0), t0);
  flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
  flt.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(sfxBus);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

/** 金属撞击：非谐泛音簇快速衰减（真实"铿"声的核心配方） */
function metalClash(vol: number, when: number, base = 2500): void {
  if (!ac || !sfxBus) return;
  const acNow = ac.currentTime;
  const partials = [1, 1.34, 1.71, 2.05, 2.62, 3.41];
  const b = base * (0.9 + Math.random() * 0.2);
  const ctx = ac;
  const bus = sfxBus;
  partials.forEach((p, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = b * p * (0.97 + Math.random() * 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime((vol * 0.11) / (i + 1), when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.1 + Math.random() * 0.12);
    o.connect(g);
    g.connect(bus);
    o.start(when);
    o.stop(when + 0.3);
  });
  noiseAt(0.025, 6500, 3200, vol * 0.22, when - acNow, 'bandpass', 1.2);
}

/** 低频闷响（身体倒地 / 坠落） */
function thud(vol: number, when: number, f0 = 130): void {
  tone(f0, 42, 0.18, 'sine', vol, when - (ac?.currentTime ?? 0));
  noiseAt(0.16, 480, 140, vol * 0.8, when - (ac?.currentTime ?? 0));
}

/** 拨弦音色（噪声突发 + 调谐带通 = 简化 Karplus-Strong），音乐层用 */
function pluck(freq: number, vol: number, when: number): void {
  if (!ac || !sfxBus) return;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 9;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.7);
  src.connect(bp); bp.connect(g); g.connect(musicBus ?? sfxBus);
  src.start(when); src.stop(when + 0.72);
}

/** 低频战鼓 */
function drum(when: number, vol: number): void {
  if (!ac || !(musicBus ?? sfxBus)) return;
  const dest = musicBus ?? sfxBus;
  if (!dest) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(82, when);
  o.frequency.exponentialRampToValueAtTime(48, when + 0.16);
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
  o.connect(g); g.connect(dest);
  o.start(when); o.stop(when + 0.24);
}

/** 环境风（低通噪声循环）+ 白日鸟鸣；战斗激烈度压低环境 */
function startAmbient(): void {
  if (!ac || !master || windGain) return;
  const mm = master;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  const wg = ac.createGain();
  wg.gain.value = 0.03;
  src.connect(lp); lp.connect(wg); wg.connect(mm);
  windGain = wg;
  src.start();
  const chirp = (): void => {
    if (muted || musicOn === false || battleLevel > 0.5 || !ac || !mm) return;
    const t0 = ac.currentTime + Math.random() * 0.3;
    const f0 = 1900 + Math.random() * 900;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.35, t0 + 0.05);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t0 + 0.1);
    g.gain.setValueAtTime(0.014, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    o.connect(g); g.connect(mm);
    o.start(t0); o.stop(t0 + 0.14);
  };
  birdTimer = window.setInterval(() => {
    if (Math.random() < 0.6) { chirp(); if (Math.random() < 0.4) setTimeout(chirp, 160); }
  }, 4200);
}

/** 战斗激烈度（0~1）：由主循环按事件密度更新；压低环境声 */
export function setBattleIntensity(v: number): void {
  battleLevel = Math.max(0, Math.min(1, v));
  const wg = windGain;
  if (wg && ac) wg.gain.setTargetAtTime(0.03 * (1 - battleLevel * 0.75), ac.currentTime, 0.4);
}

// D 多利亚五声：生成式旋律在白名单内随机走步
const SCALE = [146.83, 174.61, 196.0, 220.0, 261.63, 293.66];
let musicIdx = 2;
let musicNext = 0;

function startMusic(): void {
  if (musicTimer !== null) return;
  musicTimer = window.setInterval(() => {
    if (!ac || !master || muted || !musicOn) return;
    const now = ac.currentTime;
    if (musicNext < now) musicNext = now + 0.1;
    const battle = battleLevel > 0.35;
    while (musicNext < now + 0.6) {
      musicIdx = Math.max(0, Math.min(SCALE.length - 1, musicIdx + (Math.random() < 0.5 ? -1 : 1)));
      pluck(SCALE[musicIdx], 0.05, musicNext);
      if (battle) {
        drum(musicNext + 0.42, 0.06);
        if (Math.random() < 0.5) pluck(SCALE[Math.max(0, SCALE.length - 2)], 0.03, musicNext + 0.21);
      }
      musicNext += battle ? 0.85 : 2.4;
    }
  }, 200);
}

export function isMusicOn(): boolean { return musicOn; }

export function toggleMusic(): string {
  musicOn = !musicOn;
  try { localStorage.setItem('zw_music', musicOn ? '1' : '0'); } catch { /* ignore */ }
  return musicOn ? '开' : '关';
}

export type SoundName = 'shot' | 'boom' | 'die' | 'built' | 'train' | 'win' | 'lose' | 'draw' | 'ui' | 'deny' | 'move' | 'alarm' | 'clash' | 'siege';

/** vol：0~1 的距离衰减系数，由调用方按事件与屏幕的距离计算；UI 音恒为 1 */
export function play(name: SoundName, vol = 1): void {
  if (!ac || muted) return;
  const now = performance.now();
  const gap = name === 'shot' ? 60 : name === 'move' ? 120 : name === 'die' ? 80 : name === 'clash' ? 90 : 0;
  if (gap) {
    const last = lastPlay.get(name) ?? 0;
    if (now - last < gap) return;
    lastPlay.set(name, now);
  }
  const v = Math.max(0.06, Math.min(1, vol));
  switch (name) {
    case 'shot': // 箭矢破空：带通噪声扫频（无方波主体）+ 轻弦振
      noiseAt(0.09, jitter(3200), 850, 0.09 * v, 0, 'bandpass', 1.6);
      tone(185, 92, 0.05, 'triangle', 0.016 * v);
      break;
    case 'clash': // 剑刃交锋：非谐泛音簇（金属"铿"）
      metalClash(0.5 * v, ac.currentTime);
      break;
    case 'siege': // 投石三段：闷响 → 风声 → 碎裂 + 石块散落
      tone(75, 40, 0.3, 'sine', 0.2 * v);
      noiseAt(0.4, 850, 260, 0.11 * v, 0.3, 'bandpass', 0.9);
      noiseAt(0.32, 520, 120, 0.1 * v, 1.05);
      metalClash(0.12 * v, ac.currentTime + 1.1, 1800);
      break;
    case 'die': // 闷响倒地（低频下滑 + 闷噪，无锯齿）
      thud(0.075 * v, ac.currentTime);
      break;
    case 'boom': // 坍塌：sub 下沉 + 宽频轰鸣 + 二次余震
      tone(72, 30, 0.5, 'sine', 0.28 * v);
      noiseAt(0.75, 950, 60, 0.22 * v);
      tone(46, 34, 0.32, 'sine', 0.14 * v, 0.16);
      noiseAt(0.6, 420, 80, 0.07 * v, 0.22);
      break;
    case 'built': // 建成：锤击瞬态 + 木 knock + 短音
      metalClash(0.2 * v, ac.currentTime, 1400);
      noiseAt(0.05, 900, 300, 0.08 * v, 0.12);
      tone(jitter(480), jitter(640), 0.08, 'triangle', 0.05 * v, 0.16);
      break;
    case 'train': // 点兵：木 knock + 短正弦
      noiseAt(0.04, 1100, 420, 0.06 * v);
      tone(jitter(560), jitter(700), 0.06, 'sine', 0.045 * v, 0.03);
      break;
    case 'move': // 令旗：轻拨弦
      pluck(293.66, 0.05 * v, ac.currentTime);
      break;
    case 'alarm': // 战号角：双锯齿 detune 过低通（去刺耳）+ 起音
      tone(196, 147, 0.6, 'sawtooth', 0.055 * v, 0, 0.03, 1400);
      tone(198, 149, 0.6, 'sawtooth', 0.055 * v, 0, 0.03, 1400);
      break;
    case 'deny': // 拒绝：低木 knock 双响 + 下滑
      noiseAt(0.04, 700, 260, 0.07 * v);
      tone(240, 165, 0.12, 'triangle', 0.05 * v, 0.09);
      break;
    case 'ui': // UI：木 knock + 短正弦
      noiseAt(0.03, 1200, 500, 0.05 * v);
      tone(jitter(880), jitter(1080), 0.045, 'sine', 0.035 * v, 0.02);
      break;
    case 'win': // 胜利：拨弦号角琶音（D 大）
      [293.66, 369.99, 440, 587.33].forEach((f, i) => pluck(f, 0.1, ac!.currentTime + i * 0.14));
      pluck(587.33, 0.08, ac!.currentTime + 0.62);
      break;
    case 'lose': // 战败：下行拨弦
      [392, 330, 262, 196].forEach((f, i) => pluck(f, 0.09, ac!.currentTime + i * 0.18));
      break;
    case 'draw': // 平局：交替拨弦
      [440, 392, 440, 392].forEach((f, i) => pluck(f, 0.08, ac!.currentTime + i * 0.16));
      break;
  }
}
