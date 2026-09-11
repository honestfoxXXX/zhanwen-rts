import { MAP_H, MAP_W } from '../core/config';

/**
 * 自由相机：双轴平移 + 缩放，适配方形大图。
 * scale = css px / world px，范围 [minScale, minScale*8]：
 *   minScale = 全图恰好塞进视口（概览），默认 = 视口宽 820 世界像素（与旧小图手感一致）。
 * 缩放始终以锚点（光标 / 捏合中点）为中心，锚点下的世界坐标保持不动。
 */
export class Camera {
  x = 0;                 // 视口左上角（世界坐标）
  y = 0;
  scale = 1;
  cssW = 1;
  cssH = 1;
  minScale = 0.1;
  viewW = 1;             // 视口宽高（世界坐标）
  viewH = 1;

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.minScale = Math.max(cssW / MAP_W, cssH / MAP_H);
    this.scale = this.clampScale(this.defaultScale());
    this.clamp();
  }

  /** 玩法默认档：视口宽约 560 世界像素 —— 单位与建筑有足够的屏幕存在感 */
  defaultScale(): number {
    return this.cssW / 560;
  }

  private zoomTarget: number | null = null;
  private zoomAnchorCss = { x: 0, y: 0 };

  private clampScale(s: number): number {
    return Math.max(this.minScale, Math.min(this.minScale * 8, s));
  }

  /** 回到默认缩放档（瞬时，用于开局/切图） */
  resetZoom(): void {
    this.zoomTarget = null;
    this.scale = this.clampScale(this.defaultScale());
    this.clamp();
  }

  /** 每帧调用：向缩放目标指数逼近，锚点下的世界坐标保持不动 */
  update(dt: number): void {
    if (this.zoomTarget === null) return;
    const diff = this.zoomTarget - this.scale;
    if (Math.abs(diff) < 0.02) {
      this.applyZoomDelta(this.zoomTarget - this.scale);
      this.zoomTarget = null;
      return;
    }
    this.applyZoomDelta(diff * Math.min(1, dt * 13));
  }

  private applyZoomDelta(dScale: number): void {
    const { x: ax, y: ay } = this.zoomAnchorCss;
    const wx = ax / this.scale + this.x;
    const wy = ay / this.scale + this.y;
    this.scale = this.clampScale(this.scale + dScale);
    this.x = wx - ax / this.scale;
    this.y = wy - ay / this.scale;
    this.clamp();
  }

  clamp(): void {
    this.viewW = this.cssW / this.scale;
    this.viewH = this.cssH / this.scale;
    this.x = this.viewW >= MAP_W ? (MAP_W - this.viewW) / 2 : Math.max(0, Math.min(MAP_W - this.viewW, this.x));
    this.y = this.viewH >= MAP_H ? (MAP_H - this.viewH) / 2 : Math.max(0, Math.min(MAP_H - this.viewH, this.y));
  }

  /** 屏幕像素位移 → 世界平移 */
  pan(dxCss: number, dyCss: number): void {
    this.x += dxCss / this.scale;
    this.y += dyCss / this.scale;
    this.clamp();
  }

  /** 以屏幕锚点为中心缩放（平滑）：连续滚轮叠加目标倍率，帧内插值逼近 */
  zoomAt(factor: number, sxCss: number, syCss: number): void {
    this.zoomAnchorCss = { x: sxCss, y: syCss };
    const base = this.zoomTarget ?? this.scale;
    this.zoomTarget = this.clampScale(base * factor);
  }

  /** 把世界点置于视口中心 */
  centerOn(wx: number, wy: number): void {
    this.x = wx - this.viewW / 2;
    this.y = wy - this.viewH / 2;
    this.clamp();
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.scale, y: (wy - this.y) * this.scale };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: sx / this.scale + this.x, y: sy / this.scale + this.y };
  }
}
