import { MAP_H, MAP_W, TILE } from '../core/config';
import type { World } from '../core/types';
import type { Camera } from './camera';
import { currentMap } from './renderer';
import { SIDE_FILL } from './shapes';

const SIDE = SIDE_FILL;

export interface MiniRect { x: number; y: number; w: number; h: number }

/** 小地图方形面板（屏幕坐标，右上角） */
export function minimapRect(cssW: number, cssH: number): MiniRect {
  const size = Math.max(96, Math.min(140, cssW * 0.26, cssH * 0.16));
  return { x: cssW - size - 8, y: 54, w: size, h: size };
}

export function isInsideMinimap(sx: number, sy: number, cssW: number, cssH: number): boolean {
  const r = minimapRect(cssW, cssH);
  return sx >= r.x - 4 && sx <= r.x + r.w + 4 && sy >= r.y - 4 && sy <= r.y + r.h + 4;
}

/** 把小地图上的点映射为世界坐标并让镜头居中（点击/拖动导航） */
export function jumpCameraTo(sx: number, sy: number, cam: Camera): void {
  const r = minimapRect(cam.cssW, cam.cssH);
  const wx = Math.max(0, Math.min(MAP_W, ((sx - r.x) / r.w) * MAP_W));
  const wy = Math.max(0, Math.min(MAP_H, ((sy - r.y) / r.h) * MAP_H));
  cam.centerOn(wx, wy);
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
  g.globalAlpha = 0.92;
  g.fillStyle = 'rgba(26,18,8,0.85)';
  roundRect(g, r.x, r.y, r.w, r.h, 6);
  g.fill();
  g.strokeStyle = 'rgba(201,162,39,0.4)';
  g.lineWidth = 1;
  roundRect(g, r.x, r.y, r.w, r.h, 6);
  g.stroke();
  g.globalAlpha = 1;

  // 1v1 画国境线（两出生点垂直平分线）；三方图标出质心
  const map = currentMap();
  g.strokeStyle = 'rgba(201,162,39,0.55)';
  if (map.players === 2) {
    const a = map.spawns[0].pos, b = map.spawns[1].pos;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    g.beginPath();
    g.moveTo(r.x + (mx + (-dy / len) * 4000) * sx, r.y + (my + (dx / len) * 4000) * sy);
    g.lineTo(r.x + (mx - (-dy / len) * 4000) * sx, r.y + (my - (dx / len) * 4000) * sy);
    g.stroke();
  } else {
    const tcx = map.spawns.reduce((s, p) => s + p.pos.x, 0) / map.players;
    const tcy = map.spawns.reduce((s, p) => s + p.pos.y, 0) / map.players;
    g.beginPath();
    g.arc(r.x + tcx * sx, r.y + tcy * sy, 3.5, 0, Math.PI * 2);
    g.stroke();
  }

  // 河流 + 渡口标记（渡口=咽喉，玩家要知道在哪）
  for (const rv of map.rivers ?? []) {
    g.strokeStyle = 'rgba(70,110,150,0.9)';
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.beginPath();
    rv.pts.forEach((p, i) => {
      const px = r.x + p.x * sx, py = r.y + p.y * sy;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    });
    g.stroke();
    g.fillStyle = 'rgba(196,186,150,0.95)';
    for (const f of rv.fords) {
      g.fillRect(r.x + f.x * sx - 1.5, r.y + f.y * sy - 1.5, 3, 3);
    }
  }

  // 岩石地形：雷达上能看出"哪里绕得过去"
  g.fillStyle = '#6d6a63';
  const rw = Math.max(1.2, TILE * sx), rh = Math.max(1.2, TILE * sy);
  for (const [cx, cy] of currentMap().rocks) {
    g.fillRect(r.x + cx * TILE * sx, r.y + cy * TILE * sy, rw, rh);
  }

  // 金矿脉矿点
  g.fillStyle = '#f0c24e';
  for (const n of world.nodes) {
    if (n.mineId !== null) continue;
    g.fillRect(r.x + n.x * sx - 1.2, r.y + n.y * sy - 1.2, 2.4, 2.4);
  }

  // 建筑
  for (const b of world.buildings) {
    g.fillStyle = SIDE[b.side];
    g.fillRect(r.x + (b.x - b.half) * sx, r.y + (b.y - b.half) * sy, Math.max(2, b.half * 2 * sx), Math.max(2, b.half * 2 * sy));
  }

  // 单位
  for (const u of world.units) {
    g.fillStyle = SIDE[u.side];
    g.fillRect(r.x + u.x * sx - 0.8, r.y + u.y * sy - 0.8, 1.6, 1.6);
  }

  // 当前视野框（双轴窗口）
  g.strokeStyle = 'rgba(239,228,200,0.85)';
  g.lineWidth = 1;
  g.strokeRect(
    r.x + cam.x * sx,
    r.y + cam.y * sy,
    Math.min(r.w, cam.viewW * sx),
    Math.min(r.h, cam.viewH * sy),
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
