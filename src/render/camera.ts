import { MAP_H, MAP_W } from '../core/config';

/** 竖幅相机：世界宽度恰好铺满画布，垂直平移 */
export class Camera {
  scale = 1;
  viewH = MAP_H;
  y = 0;
  cssW = 1;
  cssH = 1;

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.scale = cssW / MAP_W;
    this.viewH = cssH / this.scale;
    this.clamp();
  }

  clamp(): void {
    const max = Math.max(0, MAP_H - this.viewH);
    this.y = Math.max(0, Math.min(max, this.y));
  }

  pan(dyCss: number): void {
    this.y += dyCss / this.scale;
    this.clamp();
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.scale, y: (wy - this.y) * this.scale };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: sx / this.scale, y: sy / this.scale + this.y };
  }
}
