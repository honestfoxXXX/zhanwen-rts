/** 纯视觉层特效（不影响模拟确定性） */
interface Fx {
  kind: 'ring' | 'boom' | 'mark' | 'built' | 'flash' | 'debris' | 'smoke';
  x: number; y: number;
  t: number; dur: number;
  r: number;
  color: string;
  big: boolean;
  // debris/smoke 粒子参数
  vx: number; vy: number;
}

const SIDE_COLORS = ['#22d3ee', '#fb7185'];

export class Effects {
  private list: Fx[] = [];

  private add(f: Omit<Fx, 't'>): void {
    if (this.list.length > 220) this.list.shift();
    this.list.push({ ...f, t: 0 });
  }

  push(kind: Fx['kind'], x: number, y: number, opts: { r?: number; color?: string; big?: boolean } = {}): void {
    const dur = kind === 'boom' ? 0.55 : kind === 'mark' ? 0.5 : kind === 'ring' ? 0.4 : kind === 'built' ? 0.5 : kind === 'smoke' ? 0.9 : 0.14;
    this.add({ kind, x, y, dur, r: opts.r ?? 10, color: opts.color ?? '#ffffff', big: opts.big ?? false, vx: 0, vy: 0 });
  }

  dieEvent(x: number, y: number, r: number, side: 0 | 1): void {
    this.add({ kind: 'ring', x, y, dur: 0.4, r, color: SIDE_COLORS[side], big: false, vx: 0, vy: 0 });
    // 四散碎片
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      const sp = 60 + (i % 2) * 30;
      this.add({ kind: 'debris', x, y, dur: 0.45, r: 1.8, color: SIDE_COLORS[side], big: false, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
    }
  }

  boomEvent(x: number, y: number, big: boolean): void {
    this.add({ kind: 'boom', x, y, dur: 0.55, r: big ? 60 : 34, color: '#fbbf24', big, vx: 0, vy: 0 });
    for (let i = 0; i < 3; i++) {
      this.add({
        kind: 'smoke',
        x: x + (i - 1) * 8, y: y - 4,
        dur: 0.9, r: big ? 16 + i * 5 : 9 + i * 3,
        color: 'rgba(148,163,184,0.5)', big,
        vx: (i - 1) * 14, vy: -26 - i * 8,
      });
    }
  }

  mark(x: number, y: number): void {
    this.add({ kind: 'mark', x, y, dur: 0.5, r: 10, color: '#34d399', big: false, vx: 0, vy: 0 });
  }

  builtEvent(x: number, y: number, side: 0 | 1): void {
    this.add({ kind: 'built', x, y, dur: 0.5, r: 40, color: SIDE_COLORS[side], big: false, vx: 0, vy: 0 });
  }

  flash(x: number, y: number, big: boolean): void {
    this.add({ kind: 'flash', x, y, dur: 0.14, r: big ? 7 : 4.5, color: '#fde68a', big, vx: 0, vy: 0 });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      if (f.kind === 'debris' || f.kind === 'smoke') {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (f.kind === 'debris') f.vy += 90 * dt; // 碎片受重力
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
      }
      g.restore();
    }
  }
}
