import { MAP_H, MAP_W, TILE } from '../core/config';
import type { World } from '../core/types';
import type { Camera } from './camera';
import { currentMap } from './renderer';
import { SIDE_FILL } from './shapes';

const SIDE = SIDE_FILL;

export interface MiniRect { x: number; y: number; w: number; h: number }

/** 小地图雷达区域（屏幕坐标，右缘竖条） */
export function minimapRect(cssW: number, cssH: number): MiniRect {
  const w = 24;
  const top = 56;
  const bottom = 176;
  const h = Math.max(160, cssH - top - bottom);
  return { x: cssW - w - 7, y: top, w, h };
}

export function isInsideMinimap(sx: number, sy: number, cssW: number, cssH: number): boolean {
  const r = minimapRect(cssW, cssH);
  return sx >= r.x - 4 && sx <= r.x + r.w + 4 && sy >= r.y - 4 && sy <= r.y + r.h + 4;
}

/** 把屏幕点映射为相机目标 y（点击/拖动小地图跳转视野） */
export function jumpCameraTo(sy: number, cam: Camera): void {
  const r = minimapRect(cam.cssW, cam.cssH);
  const ratio = Math.max(0, Math.min(1, (sy - r.y) / r.h));
  cam.y = ratio * MAP_H - cam.viewH / 2;
  cam.clamp();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function draw(g: CanvasRenderingContext2D, world: World, cam: Camera): void {
  const r = minimapRect(cam.cssW, cam.cssH);
  const sx = r.w / MAP_W;
  const sy = r.h / MAP_H;

  g.save();
  // 面板
  g.globalAlpha = 0.9;
  g.fillStyle = 'rgba(2,6,16,0.78)';
  roundRect(g, r.x, r.y, r.w, r.h, 6);
  g.fill();
  g.strokeStyle = 'rgba(148,163,184,0.3)';
  g.lineWidth = 1;
  roundRect(g, r.x, r.y, r.w, r.h, 6);
  g.stroke();
  g.globalAlpha = 1;

  // 前线
  g.strokeStyle = 'rgba(245,158,11,0.5)';
  g.beginPath();
  g.moveTo(r.x + 2, r.y + (MAP_H / 2) * sy);
  g.lineTo(r.x + r.w - 2, r.y + (MAP_H / 2) * sy);
  g.stroke();

  // 岩石地形：雷达上能看出"哪里绕得过去"
  g.fillStyle = 'rgba(58,82,114,0.95)';
  const rw = Math.max(1.6, TILE * sx), rh = Math.max(1.6, TILE * sy);
  for (const [cx, cy] of currentMap().rocks) {
    g.fillRect(r.x + cx * TILE * sx, r.y + cy * TILE * sy, rw, rh);
  }

  // 水晶矿点
  g.fillStyle = '#c084fc';
  for (const n of world.nodes) {
    if (n.mineId !== null) continue;
    g.fillRect(r.x + n.x * sx - 1.5, r.y + n.y * sy - 1.5, 3, 3);
  }

  // 建筑
  for (const b of world.buildings) {
    g.fillStyle = SIDE[b.side];
    g.fillRect(r.x + (b.x - b.half) * sx, r.y + (b.y - b.half) * sy, Math.max(2.5, b.half * 2 * sx), Math.max(2.5, b.half * 2 * sy));
  }

  // 单位
  for (const u of world.units) {
    g.fillStyle = SIDE[u.side];
    g.fillRect(r.x + u.x * sx - 1, r.y + u.y * sy - 1, 2, 2);
  }

  // 当前视野框
  g.strokeStyle = 'rgba(226,232,240,0.85)';
  g.lineWidth = 1;
  g.strokeRect(
    r.x + 1,
    r.y + cam.y * sy,
    r.w - 2,
    Math.min(r.h - 2, cam.viewH * sy),
  );
  g.restore();
}

export interface AlertMark { x: number; y: number; building: boolean }

/** 在雷达上标出正在挨打的位置（纯视觉，不影响模拟） */
export function drawAlert(g: CanvasRenderingContext2D, alert: AlertMark | null, cam: Camera, time: number): void {
  if (!alert) return;
  const r = minimapRect(cam.cssW, cam.cssH);
  const sx = r.w / MAP_W, sy = r.h / MAP_H;
  const px = r.x + alert.x * sx, py = r.y + alert.y * sy;
  const pulse = 5 + Math.sin(time * 10) * 2;
  g.save();
  g.globalAlpha = 0.5;
  g.fillStyle = '#f87171';
  g.beginPath();
  g.arc(px, py, pulse, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = alert.building ? '#fecaca' : '#fca5a5';
  g.fillRect(px - 1.5, py - 1.5, 3, 3);
  g.restore();
}
