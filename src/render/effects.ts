/** 纯视觉层特效（不影响模拟确定性） */
interface Fx {
  kind: 'ring' | 'boom' | 'mark' | 'built' | 'flash' | 'debris' | 'smoke' | 'slash' | 'spark' | 'shock' | 'dust' | 'text' | 'stain';
  x: number; y: number;
  t: number; dur: number;
  r: number;
  color: string;
  text?: string;
  big: boolean;
  // debris/smoke/spark 粒子参数
  vx: number; vy: number;
}

import type { Side } from '../core/types';
import { SIDE_FILL } from './shapes';

const SIDE_COLORS = SIDE_FILL;

export class Effects {
  private list: Fx[] = [];

  private add(f: Omit<Fx, 't'>): void {
    if (this.list.length > 220) this.list.shift();
    this.list.push({ ...f, t: 0 });
  }

  push(kind: Fx['kind'], x: number, y: number, opts: { r?: number; color?: string; big?: boolean } = {}): void {
    const dur = kind === 'boom' ? 0.55 : kind === 'mark' ? 0.5 : kind === 'ring' ? 0.4
      : kind === 'built' ? 0.5 : kind === 'smoke' ? 0.9 : kind === 'slash' ? 0.18 : kind === 'shock' ? 0.45
      : kind === 'text' ? 0.85 : kind === 'stain' ? 7 : 0.14;
    this.add({ kind, x, y, dur, r: opts.r ?? 10, color: opts.color ?? '#ffffff', big: opts.big ?? false, vx: 0, vy: 0 });
  }

  dieEvent(x: number, y: number, r: number, side: Side, big = false): void {
    this.stain(x, y, big ? r * 1.5 : r * 1.15);
    this.add({ kind: 'ring', x, y, dur: 0.4, r, color: SIDE_COLORS[side], big, vx: 0, vy: 0 });
    // 内圈反向收拢，两圈一扩一缩，比单环更有"爆开"的层次
    this.add({ kind: 'shock', x, y, dur: 0.3, r: r + 10, color: 'rgba(255,255,255,0.9)', big, vx: 0, vy: 0 });
    // 四散碎片：体型大的单位碎得更夸张
    for (let i = 0; i < (big ? 7 : 4); i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      const sp = 60 + (i % 2) * 30;
      this.add({ kind: 'debris', x, y, dur: 0.45, r: 1.8, color: SIDE_COLORS[side], big: false, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
    }
  }

  boomEvent(x: number, y: number, big: boolean): void {
    this.add({ kind: 'boom', x, y, dur: 0.55, r: big ? 60 : 34, color: '#fbbf24', big, vx: 0, vy: 0 });
    // 冲击波：细环快速外扩，先于火焰到达
    this.add({ kind: 'shock', x, y, dur: 0.45, r: big ? 26 : 14, color: 'rgba(255,237,180,0.95)', big, vx: 0, vy: 0 });
    // 飞溅火星：高速小亮点，受重力下坠
    const n = big ? 8 : 5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 120;
      this.add({
        kind: 'spark', x, y, dur: 0.3 + Math.random() * 0.2, r: 1.6,
        color: i % 3 === 0 ? '#fde68a' : '#fbbf24', big: false,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 50,
      });
    }
    for (let i = 0; i < 3; i++) {
      this.add({
        kind: 'smoke',
        x: x + (i - 1) * 8, y: y - 4,
        dur: 0.9, r: big ? 16 + i * 5 : 9 + i * 3,
        color: 'rgba(148,163,184,0.5)', big,
        vx: (i - 1) * 14, vy: -26 - i * 8,
      });
    }
    if (big) {
      // 大建筑坍塌：大碎块抛散 + 升腾尘云
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.random();
        const sp = 60 + Math.random() * 80;
        this.add({ kind: 'debris', x, y, dur: 0.8, r: 4 + Math.random() * 3, color: '#5a5248', big, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40 });
      }
      for (let i = 0; i < 3; i++) {
        this.add({ kind: 'smoke', x: x + (Math.random() - 0.5) * 30, y: y - 6, dur: 1.3, r: 14 + Math.random() * 10, color: 'rgba(148,163,184,0.5)', big, vx: (Math.random() - 0.5) * 20, vy: -20 - Math.random() * 12 });
      }
    }
  }



  /** 弹道命中点的火花：几条放射短线，一闪而过 */
  spark(x: number, y: number, side: Side): void {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 60;
      this.add({
        kind: 'spark', x, y, dur: 0.14 + Math.random() * 0.06, r: 1.2,
        color: i === 0 ? '#fff7d6' : SIDE_COLORS[side], big: false,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      });
    }
  }

  mark(x: number, y: number, forced = false): void {
    // 强制移动用奶白标记与普通移动的金色区分，玩家能看出"这次不接战"
    this.add({ kind: 'mark', x, y, dur: 0.5, r: forced ? 12 : 10, color: forced ? '#f5ecd2' : '#c9a227', big: false, vx: 0, vy: 0 });
  }

  builtEvent(x: number, y: number, side: Side): void {
    this.add({ kind: 'built', x, y, dur: 0.5, r: 40, color: SIDE_COLORS[side], big: false, vx: 0, vy: 0 });
  }

  flash(x: number, y: number, big: boolean): void {
    this.add({ kind: 'flash', x, y, dur: 0.14, r: big ? 7 : 4.5, color: '#fde68a', big, vx: 0, vy: 0 });
  }

  /** 伤害数字：上飘渐隐（设置可关） */
  dmgText(x: number, y: number, text: string): void {
    this.add({ kind: 'text', x: x + (Math.random() - 0.5) * 10, y: y - 8, dur: 0.85, r: 0, color: '#ffe9a8', big: false, vx: 0, vy: 0, text });
  }

  /** 尸痕/焦痕：淡出的地面暗斑，战后痕迹感 */
  stain(x: number, y: number, r: number): void {
    this.add({ kind: 'stain', x, y, dur: 7, r, color: '#14100a', big: false, vx: 0, vy: 0 });
  }

  /** 近战挥砍：没有弹道，用一道弧线表现，和远程的闪光区分开 */
  slash(x: number, y: number, big: boolean): void {
    this.add({ kind: 'slash', x, y, dur: 0.18, r: big ? 19 : 13, color: '#e2e8f0', big, vx: 0, vy: 0 });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      if (f.kind === 'debris' || f.kind === 'smoke' || f.kind === 'spark') {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (f.kind !== 'smoke') f.vy += 220 * dt; // 碎片/火星受重力，烟往上飘
        if (f.kind === 'spark') { f.vx *= 0.92; f.vy *= 0.92; } // 火星快速减速
      }
      if (f.t >= f.dur) this.list.splice(i, 1);
    }
  }

  clear(): void {
    this.list = [];
  }

  draw(g: CanvasRenderingContext2D): void {
    for (const f of this.list) {
      const k = f.t / f.dur;
      g.save();
      switch (f.kind) {
        case 'ring': {
          g.globalAlpha = 1 - k;
          g.strokeStyle = f.color;
          g.lineWidth = 2;
          g.beginPath();
          g.arc(f.x, f.y, f.r + k * 14, 0, Math.PI * 2);
          g.stroke();
          break;
        }
        case 'boom': {
          g.globalAlpha = (1 - k) * 0.9;
          g.strokeStyle = f.color;
          g.lineWidth = 3.5 * (1 - k) + 1;
          g.beginPath();
          g.arc(f.x, f.y, f.r * (0.3 + k * 0.9), 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = (1 - k) * 0.35;
          g.fillStyle = f.color;
          g.beginPath();
          g.arc(f.x, f.y, f.r * 0.5 * (1 - k * 0.5), 0, Math.PI * 2);
          g.fill();
          break;
        }
        case 'smoke': {
          g.globalAlpha = (1 - k) * 0.4;
          g.fillStyle = '#64748b';
          g.beginPath();
          g.arc(f.x, f.y, f.r * (0.6 + k * 0.8), 0, Math.PI * 2);
          g.fill();
          break;
        }
        case 'text': {
          g.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
          g.fillStyle = f.color;
          g.font = '700 11px ui-sans-serif, system-ui, sans-serif';
          g.textAlign = 'center';
          g.strokeStyle = 'rgba(20,14,6,0.9)';
          g.lineWidth = 2.5;
          g.strokeText(f.text ?? '', f.x, f.y - k * 16);
          g.fillText(f.text ?? '', f.x, f.y - k * 16);
          break;
        }
        case 'stain': {
          g.globalAlpha = 0.22 * (1 - k);
          g.fillStyle = f.color;
          g.beginPath();
          g.ellipse(f.x, f.y, f.r * (1 + k * 0.15), f.r * 0.6, 0, 0, Math.PI * 2);
          g.fill();
          break;
        }
        case 'debris': {
          g.globalAlpha = 1 - k;
          g.fillStyle = f.color;
          g.fillRect(f.x - f.r / 2, f.y - f.r / 2, f.r, f.r);
          break;
        }
        case 'mark': {
          g.globalAlpha = 1 - k;
          g.strokeStyle = f.color;
          g.lineWidth = 2.5;
          g.beginPath();
          g.arc(f.x, f.y, 16 * (1 - k) + 3, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.arc(f.x, f.y, 3, 0, Math.PI * 2);
          g.fillStyle = f.color;
          g.fill();
          break;
        }
        case 'built': {
          g.globalAlpha = (1 - k) * 0.8;
          g.strokeStyle = f.color;
          g.lineWidth = 2;
          const s = 20 + k * 30;
          g.strokeRect(f.x - s / 2, f.y - s / 2, s, s);
          break;
        }
        case 'flash': {
          g.globalAlpha = 1 - k;
          g.fillStyle = f.color;
          g.beginPath();
          g.arc(f.x, f.y, f.r * (1 - k * 0.5), 0, Math.PI * 2);
          g.fill();
          break;
        }
        case 'slash': {
          g.globalAlpha = (1 - k) * 0.9;
          g.strokeStyle = f.color;
          g.lineWidth = (f.big ? 3.5 : 2.4) * (1 - k * 0.4);
          g.beginPath();
          g.arc(f.x, f.y, f.r, -0.95 + k * 0.7, 0.95 + k * 0.7);
          g.stroke();
          break;
        }
        case 'dust': {
          g.globalAlpha = 0.25 * (1 - f.t / f.dur);
          g.fillStyle = f.color;
          g.beginPath();
          g.arc(f.x, f.y, f.r + f.t * 8, 0, Math.PI * 2);
          g.fill();
          break;
        }
        case 'shock': {
          // 冲击波：细环快速外扩、透明度陡降
          g.globalAlpha = (1 - k) * 0.85;
          g.strokeStyle = f.color;
          g.lineWidth = 2.2 * (1 - k) + 0.4;
          g.beginPath();
          g.arc(f.x, f.y, f.r + k * (f.big ? 70 : 40), 0, Math.PI * 2);
          g.stroke();
          break;
        }
        case 'spark': {
          // 火星：沿速度方向的短亮线，越接近寿命末端越细
          g.globalAlpha = 1 - k;
          g.strokeStyle = f.color;
          g.lineWidth = 1.4 * (1 - k * 0.5);
          const len = 3.5 + k * 2;
          const sp = Math.hypot(f.vx, f.vy) || 1;
          g.beginPath();
          g.moveTo(f.x - (f.vx / sp) * len, f.y - (f.vy / sp) * len);
          g.lineTo(f.x, f.y);
          g.stroke();
          break;
        }
      }
      g.restore();
    }
  }
}
