/** WebAudio 合成音效（无资源文件）。
 *
 * 三层结构让声音不再是"8-bit 蜂鸣"：
 *   1. 振荡器层 —— 音高走向（旋律/警报/结算）
 *   2. 噪声层   —— 质感（爆炸的轰、箭矢的嗖、命中的碎）
 *   3. 总线     —— 主增益 + 压限器，混战叠加时不削波爆音
 *
 * 另有两件"去机械感"的小事：
 *   - 音高抖动 ±6%：同一声音连放 20 次不会像机枪一样整齐
 *   - 距离衰减：play(name, vol) 由调用方按"事件离屏幕多远"传入音量
 */

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
let musicOn = true;
let battleLevel = 0; // 0~1 战斗激烈度（主循环按事件密度更新）
let windGain: GainNode | null = null;
let musicTimer: number | null = null;
let birdTimer: number | null = null;
const lastPlay = new Map<string, number>();

try { musicOn = localStorage.getItem('zw_music') !== '0'; } catch { /* ignore */ }

try { muted = localStorage.getItem('zw_mute') === '1'; } catch { /* ignore */ }

export function initAudio(): void {
  if (!ac) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      ac = new Ctx();
      master = ac.createGain();
      master.gain.value = 0.85;
      // 压限器：混战时几十个声音叠在一起也不爆音
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 26;
      comp.ratio.value = 7;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;
      master.connect(comp);
      comp.connect(ac.destination);
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

/** 环境风（低通粉噪循环）+ 白日鸟鸣；战斗激烈度压低环境 */
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
  const m = master;
  const chirp = (): void => {
    if (muted || musicOn === false || battleLevel > 0.5 || !ac || !m) return;
    const t0 = ac.currentTime + Math.random() * 0.3;
    const f0 = 1900 + Math.random() * 900;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.35, t0 + 0.05);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t0 + 0.1);
    g.gain.setValueAtTime(0.018, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    o.connect(g); g.connect(m);
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

/** 拨弦音色（噪声突发 + 调谐带通 = 简化 Karplus-Strong） */
function pluck(freq: number, vol: number, when: number): void {
  if (!ac || !master) return;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 9;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.7);
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(when); src.stop(when + 0.72);
}

/** 低频战鼓 */
function drum(when: number, vol: number): void {
  if (!ac || !master) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(82, when);
  o.frequency.exponentialRampToValueAtTime(48, when + 0.16);
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
  o.connect(g); g.connect(master);
  o.start(when); o.stop(when + 0.24);
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
      // 旋律走步：相邻音级随机上下
      musicIdx = Math.max(0, Math.min(SCALE.length - 1, musicIdx + (Math.random() < 0.5 ? -1 : 1)));
      pluck(SCALE[musicIdx], musicOn ? 0.05 : 0.04, musicNext);
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

export function isMuted(): boolean { return muted; }

export function toggleMute(): string {
  muted = !muted;
  try { localStorage.setItem('zw_mute', muted ? '1' : '0'); } catch { /* ignore */ }
  return muted ? '关' : '开';
}

/** 音高抖动，让重复音效有自然差异 */
function jitter(f: number): number { return f * (0.94 + Math.random() * 0.12); }

/** 振荡器层：频率从 f0 滑到 f1 */
function tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
  if (!ac || !master) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, f0), t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 噪声层：低通从 f0 扫到 f1，做"轰/嗖/碎"的质感 */
function noise(dur: number, f0: number, f1: number, vol: number, delay = 0, type: BiquadFilterType = 'lowpass'): void {
  if (!ac || !master || !noiseBuf) return;
  const t0 = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const flt = ac.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(Math.max(40, f0), t0);
  flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
  flt.Q.value = 0.8;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

export type SoundName = 'shot' | 'boom' | 'die' | 'built' | 'train' | 'win' | 'lose' | 'draw' | 'ui' | 'deny' | 'move' | 'alarm' | 'clash' | 'siege';

/** vol：0~1 的距离衰减系数，由调用方按事件与屏幕的距离计算；UI 音恒为 1 */
export function play(name: SoundName, vol = 1): void {
  if (!ac || muted) return;
  const now = performance.now();
  const gap = name === 'shot' ? 60 : name === 'move' ? 120 : name === 'die' ? 80 : 0;
  if (gap) {
    const last = lastPlay.get(name) ?? 0;
    if (now - last < gap) return;
    lastPlay.set(name, now);
  }
  const v = Math.max(0.06, Math.min(1, vol));
  switch (name) {
    case 'shot': // 箭矢破空：高频噪声"嗖" + 轻微弦振
      noise(0.06, jitter(2600), 700, 0.09 * v, 0, 'bandpass');
      tone(jitter(700), 190, 0.06, 'square', 0.012 * v);
      break;
    case 'die': // 闷响下滑 + 一撮碎裂噪声
      noise(0.16, 1400, 220, 0.07 * v);
      tone(jitter(300), 62, 0.2, 'sawtooth', 0.045 * v);
      break;
    case 'boom': // 低频冲击 + 宽频轰鸣 + 金属回响（投石机坍塌的低频）
      tone(82, 34, 0.42, 'sine', 0.26 * v);
      noise(0.65, 1100, 55, 0.24 * v);
      tone(330, 48, 0.24, 'sawtooth', 0.05 * v, 0.02);
      noise(0.7, 420, 90, 0.06 * v, 0.08);
      break;
    case 'built': // 上行双音 + 落锤闷响
      tone(jitter(430), 650, 0.1, 'sine', 0.07 * v);
      tone(jitter(650), 880, 0.1, 'sine', 0.06 * v, 0.09);
      noise(0.09, 400, 160, 0.06 * v, 0.16);
      break;
    case 'train':
      tone(jitter(500), 720, 0.08, 'sine', 0.06 * v);
      noise(0.05, 2000, 500, 0.03 * v, 0.02, 'bandpass');
      break;
    case 'move':
      tone(jitter(340), 490, 0.06, 'sine', 0.045 * v);
      break;
    case 'alarm': // 战号角：双锯齿叠出轻微拍频
      tone(196, 147, 0.55, 'sawtooth', 0.06 * v);
      tone(198, 149, 0.55, 'sawtooth', 0.06 * v);
      break;
    case 'deny':
      tone(230, 150, 0.14, 'square', 0.055 * v);
      break;
    case 'clash': // 剑刃交锋：金属 ring
      tone(jitter(2350), jitter(1700), 0.07, 'square', 0.02 * v);
      tone(jitter(3600), jitter(2600), 0.05, 'sine', 0.028 * v);
      break;
    case 'siege': // 投石三段：闷响 → 风声 → 碎裂
      tone(70, 42, 0.3, 'sine', 0.2 * v);
      noise(0.35, 900, 300, 0.12 * v, 0.28);
      noise(0.3, 500, 120, 0.1 * v, 1.1);
      break;
    case 'ui':
      tone(jitter(620), 820, 0.05, 'sine', 0.05 * v);
      break;
    case 'win': // 号角齐奏：先落一个下行根音
      tone(392, 392, 0.18, 'triangle', 0.09);
      [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.17, 'triangle', 0.09, i * 0.13));
      noise(0.9, 900, 2400, 0.02, 0.1, 'highpass'); // 一缕"扬起"的空气声
      break;
    case 'lose':
      [392, 330, 262, 196].forEach((f, i) => tone(f, f, 0.2, 'triangle', 0.09, i * 0.16));
      noise(1.0, 500, 90, 0.05, 0.2); // 低落的尾音
      break;
    case 'draw':
      [440, 392, 440, 392].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.08, i * 0.15));
      break;
  }
}
