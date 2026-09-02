import {
  BUILDING_DEFS, COLS, MAP_H, MAPS, MAP_W, ROWS, TILE, UNIT_DEFS,
} from '../core/config';
import type { MapDef } from '../core/config';
import type { Building, Unit, World } from '../core/types';
import type { Camera } from './camera';
import { draw as drawMinimap } from './minimap';
import { drawUnitBody, SIDE_DARK, SIDE_DIM, SIDE_FILL } from './shapes';

// 阵营色统一从 shapes.ts 取，保证三方混战时各处颜色一致
const SIDE = SIDE_FILL;
const C = {
  groundA: '#38512e',
  groundB: '#2a3f24',
  grid: 'rgba(240,228,200,0.04)',
  rock: '#6d6a63',
  rockEdge: '#57544d',
  line: 'rgba(201,162,39,0.5)',
  crystal: '#f0c24e',
  select: '#f5ecd2',
  hpBack: 'rgba(2,6,16,0.7)',
  ghostOk: 'rgba(232,226,196,0.30)',
  ghostOkEdge: 'rgba(232,226,196,0.9)',
  ghostBad: 'rgba(214,69,69,0.30)',
  ghostBadEdge: 'rgba(214,69,69,0.9)',
};

export type GhostInfo = { type: Building['type']; x: number; y: number; valid: boolean } | null

let bgCanvas: HTMLCanvasElement | null = null;

// 3840² 的全分辨率地面画布在 iOS 上逼近内存红线，按半分辨率预渲染后放大绘制
const BG_SCALE = 0.5;

/** 预渲染静态地面（地貌装饰 + 岩石 + 国境线 + 基地区）。换地图需要重新调用 */
export function buildBackground(map: MapDef = MAPS[0]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(MAP_W * BG_SCALE);
  c.height = Math.round(MAP_H * BG_SCALE);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.scale(BG_SCALE, BG_SCALE);
  // 以下全部使用世界坐标绘制

  // 基底：垂直光照渐变（北亮南暗），苔绿草原
  const base = g.createLinearGradient(0, 0, 0, MAP_H);
  base.addColorStop(0, '#3d5732');
  base.addColorStop(0.45, '#33492b');
  base.addColorStop(1, '#2a3f24');
  g.fillStyle = base;
  g.fillRect(0, 0, MAP_W, MAP_H);

  // 网格：保留但压到几乎不可见，只作对位参考
  g.strokeStyle = 'rgba(240,228,200,0.03)';
  g.lineWidth = 1;
  g.beginPath();
  for (let cx = 0; cx <= COLS; cx++) { g.moveTo(cx * TILE, 0); g.lineTo(cx * TILE, MAP_H); }
  for (let cy = 0; cy <= ROWS; cy++) { g.moveTo(0, cy * TILE); g.lineTo(MAP_W, cy * TILE); }
  g.stroke();

  // ---- 确定性地面装饰（大块色斑 / 暗斑 / 草茎 / 碎石 / 野花）----
  let seed = 20260902;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // 大块色斑：两种色相（草甸 / 褐土），让地面有"地貌"而非纯色
  for (let i = 0; i < 150; i++) {
    const x = rnd() * MAP_W, y = rnd() * MAP_H, r = 60 + rnd() * 150;
    g.fillStyle = i % 2 === 0
      ? `rgba(122,158,78,${0.04 + rnd() * 0.03})`
      : `rgba(122,88,52,${0.055 + rnd() * 0.03})`;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.5 + rnd() * 0.3), rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // 暗斑
  for (let i = 0; i < 110; i++) {
    const x = rnd() * MAP_W, y = rnd() * MAP_H, r = 40 + rnd() * 90;
    g.fillStyle = `rgba(2,6,16,${0.06 + rnd() * 0.06})`;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.6, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // 草茎
  g.strokeStyle = 'rgba(150,190,100,0.13)';
  g.lineWidth = 1.4;
  for (let i = 0; i < 560; i++) {
    const x = rnd() * MAP_W, y = rnd() * MAP_H;
    const lean = (rnd() - 0.5) * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + lean, y - 3.5, x + lean * 1.6, y - 6);
    g.stroke();
  }
  // 碎石点
  for (let i = 0; i < 900; i++) {
    const x = rnd() * MAP_W, y = rnd() * MAP_H, r = 0.8 + rnd() * 1.6;
    g.fillStyle = `rgba(210,200,178,${0.05 + rnd() * 0.09})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // 野花：白菊为主，少量野罂粟点缀
  for (let i = 0; i < 320; i++) {
    const x = rnd() * MAP_W, y = rnd() * MAP_H;
    const poppy = i % 6 === 0;
    g.fillStyle = poppy
      ? `rgba(214,80,80,${0.25 + rnd() * 0.15})`
      : `rgba(238,232,200,${0.25 + rnd() * 0.18})`;
    g.beginPath();
    g.arc(x, y, poppy ? 1.2 + rnd() * 0.9 : 0.9 + rnd() * 0.9, 0, Math.PI * 2);
    g.fill();
  }

  // 泥土路：每个出生点一条弯路通往地图质心 —— 1v1 是两条主路在前线会合，
  // 三方是三条路汇聚"王冠之地"。画在岩石之前，路被巨石截断才自然。
  const roadCx = map.spawns.reduce((s, p) => s + p.pos.x, 0) / map.players;
  const roadCy = map.spawns.reduce((s, p) => s + p.pos.y, 0) / map.players;
  for (const sp of map.spawns) {
    const mx = (sp.pos.x + roadCx) / 2 + (sp.pos.y - roadCy) * 0.08;
    const my = (sp.pos.y + roadCy) / 2 - (sp.pos.x - roadCx) * 0.08;
    for (const [c, lw] of [['rgba(60,42,24,0.35)', 30], ['rgba(138,106,66,0.55)', 22]] as const) {
      g.strokeStyle = c;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(sp.pos.x, sp.pos.y);
      g.quadraticCurveTo(mx, my, roadCx, roadCy);
      g.stroke();
    }
  }

  // ---- 国境线（1v1）：两出生点连线的垂直平分线，对角几何下依然成立；三方标出质心 ----
  if (map.players === 2) {
    const a = map.spawns[0].pos, b = map.spawns[1].pos;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len; // 法向单位向量
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.setLineDash([12, 9]);
    g.beginPath();
    g.moveTo(mx - px * 3400, my - py * 3400);
    g.lineTo(mx + px * 3400, my + py * 3400);
    g.stroke();
    g.setLineDash([]);
    const ang = Math.atan2(py, px);
    g.fillStyle = 'rgba(201,162,39,0.4)';
    for (let t = -3200; t <= 3200; t += 110) {
      const x = mx + px * t, y = my + py * t;
      if (x < 0 || x > MAP_W || y < 0 || y > MAP_H) continue;
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(-5, -5);
      g.lineTo(3, 0);
      g.lineTo(-5, 5);
      g.closePath();
      g.fill();
      g.restore();
    }
    g.save();
    g.translate(mx, my);
    g.rotate(ang);
    g.fillStyle = 'rgba(201,162,39,0.55)';
    g.font = '600 14px sans-serif';
    g.textAlign = 'center';
    g.fillText('—— 国 境 线 ——', 0, -12);
    g.restore();
  } else {
    const tcx = map.spawns.reduce((s, p) => s + p.pos.x, 0) / map.players;
    const tcy = map.spawns.reduce((s, p) => s + p.pos.y, 0) / map.players;
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.setLineDash([7, 7]);
    g.beginPath();
    g.arc(tcx, tcy, 46, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(201,162,39,0.55)';
    g.font = '600 13px sans-serif';
    g.textAlign = 'center';
    g.fillText('王 冠 之 地', tcx, tcy - 58);
  }

  // ---- 岩石：不规则多面体（投影 + 亮面 + 裂纹），两种变体避免明显平铺 ----
  for (const [cx, cy] of map.rocks) {
    const x = cx * TILE, y = cy * TILE;
    const v = (cx * 7 + cy * 13) % 2; // 逐格确定性变体
    // 底部投影
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.beginPath();
    g.ellipse(x + TILE / 2, y + TILE - 7, TILE * 0.44, 6.5, 0, 0, Math.PI * 2);
    g.fill();
    // 主体轮廓
    g.fillStyle = C.rock;
    g.beginPath();
    if (v === 0) {
      g.moveTo(x + 7, y + TILE - 8);
      g.lineTo(x + 3, y + 15);
      g.lineTo(x + 12, y + 4);
      g.lineTo(x + TILE - 9, y + 3);
      g.lineTo(x + TILE - 3, y + 17);
      g.lineTo(x + TILE - 7, y + TILE - 8);
    } else {
      g.moveTo(x + 5, y + TILE - 9);
      g.lineTo(x + 2, y + 18);
      g.lineTo(x + 14, y + 6);
      g.lineTo(x + TILE - 7, y + 5);
      g.lineTo(x + TILE - 2, y + 14);
      g.lineTo(x + TILE - 9, y + TILE - 6);
    }
    g.closePath();
    g.fill();
    // 受光面（左上）
    g.fillStyle = 'rgba(205,203,195,0.22)';
    g.beginPath();
    g.moveTo(x + 4, y + 15);
    g.lineTo(x + 12, y + 5);
    g.lineTo(x + TILE - 9, y + 4);
    g.lineTo(x + 17, y + 16);
    g.closePath();
    g.fill();
    // 裂纹
    g.strokeStyle = 'rgba(48,44,36,0.55)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x + 14, y + 12);
    g.lineTo(x + 20, y + 22);
    g.lineTo(x + 16, y + TILE - 12);
    g.stroke();
    // 顶部苔藓斑：1-2 块，随格子变体
    g.fillStyle = 'rgba(110,150,80,0.25)';
    g.beginPath();
    g.ellipse(x + (v === 0 ? TILE * 0.38 : TILE * 0.62), y + (v === 0 ? 10 : 8), v === 0 ? 7 : 8, 4, v === 0 ? 0.3 : -0.2, 0, Math.PI * 2);
    g.fill();
    if (v === 0) {
      g.fillStyle = 'rgba(110,150,80,0.18)';
      g.beginPath();
      g.ellipse(x + TILE * 0.66, y + 20, 5, 3, -0.4, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ---- 基地平台（HQ 底座）：阵营色光晕 + 虚线边界，按地图出生点绘制 ----
  for (const [i, sp] of map.spawns.entries()) {
    const p = sp.pos;
    const glow = g.createRadialGradient(p.x, p.y, 8, p.x, p.y, 190);
    glow.addColorStop(0, SIDE_DIM[i]);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(p.x - 190, p.y - 190, 380, 380);
    g.strokeStyle = SIDE_FILL[i];
    g.globalAlpha = 0.3;
    g.lineWidth = 1.5;
    roundRect(g, p.x - 56, p.y - 56, 112, 112, 14);
    g.stroke();
    g.setLineDash([4, 5]);
    g.globalAlpha = 0.15;
    roundRect(g, p.x - 48, p.y - 48, 96, 96, 12);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  // ---- 边缘压暗：地图四边一圈渐变，视线自然聚焦战场中部 ----
  const shade = 60;
  for (const [x0, y0, x1, y1, w, h, hor] of [
    [0, 0, 0, shade, MAP_W, 0, true],
    [0, MAP_H - shade, 0, MAP_H, MAP_W, 0, true],
    [0, 0, shade, 0, 0, MAP_H, false],
    [MAP_W - shade, 0, MAP_W, 0, 0, MAP_H, false],
  ] as [number, number, number, number, number, number, boolean][]) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(12,9,4,0.42)');
    gr.addColorStop(1, 'rgba(12,9,4,0)');
    g.fillStyle = gr;
    g.fillRect(hor ? 0 : Math.min(x0, x1), hor ? Math.min(y0, y1) : 0, hor ? MAP_W : shade, hor ? shade : MAP_H);
  }
  return c;
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

let curMap: MapDef = MAPS[0];

export function initRenderer(map: MapDef = MAPS[0]): void {
  curMap = map;
  bgCanvas = buildBackground(map);
}

/** 当前地图（小地图等模块需要静态地形数据时使用） */
export function currentMap(): MapDef { return curMap; }

export interface RenderUI {
  selection: number[];
  ghost: GhostInfo;
  boxRect: { x0: number; y0: number; x1: number; y1: number } | null;
}

// 暗角缓存
let vig: CanvasGradient | null = null;
let vigKey = '';

function hpColor(k: number): string {
  const c0 = [250, 204, 21], c1 = [74, 222, 128], c2 = [248, 113, 113];
  const t = Math.max(0, Math.min(1, k));
  const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = t > 0.5 ? lerp(c0, c1, (t - 0.5) * 2) : lerp(c2, c0, t * 2);
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

export function draw(ctx: CanvasRenderingContext2D, w: World, cam: Camera, ui: RenderUI, fxList: { draw: (g: CanvasRenderingContext2D) => void }): void {
  ctx.clearRect(0, 0, cam.cssW, cam.cssH);
  ctx.save();
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-cam.x, -cam.y);

  if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, MAP_W, MAP_H);

  // 金矿脉矿点：石堆上三颗金块（矿是"挖出来"的，不是浮在空中的图标）
  for (const n of w.nodes) {
    if (n.mineId !== null) continue;
    const pulse = 1 + 0.1 * Math.sin(w.time * 3 + n.id * 1.7);
    const float = Math.sin(w.time * 2 + n.id) * 1.5;
    ctx.save();
    ctx.translate(n.x, n.y + float);
    // 地面光晕
    ctx.fillStyle = 'rgba(240,194,78,0.12)';
    ctx.beginPath();
    ctx.ellipse(0, 8, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(pulse, pulse);
    // 石堆
    ctx.fillStyle = '#57544d';
    ctx.beginPath();
    ctx.ellipse(0, 3, 12, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 三颗金块
    ctx.shadowColor = 'rgba(240,194,78,0.8)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = C.crystal;
    for (const [gx, gy, gr] of [[-4, 1, 5], [4, 2, 4], [0, -4, 4]] as const) {
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    // 高光
    ctx.fillStyle = '#ffe9a8';
    for (const [gx, gy] of [[-5.5, -0.5], [3, 1], [-1, -5]] as const) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 集结点（玩家）
  const r0 = w.rally[0];
  ctx.save();
  ctx.strokeStyle = 'rgba(201,162,39,0.8)';
  ctx.fillStyle = 'rgba(201,162,39,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(r0.x, r0.y, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(r0.x, r0.y);
  ctx.lineTo(r0.x, r0.y - 18);
  ctx.stroke();
  const wave = Math.sin(w.time * 6) * 1.5;
  ctx.beginPath();
  ctx.moveTo(r0.x, r0.y - 18);
  ctx.quadraticCurveTo(r0.x + 6, r0.y - 17 + wave, r0.x + 12, r0.y - 14 + wave);
  ctx.lineTo(r0.x, r0.y - 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 选中圈（旋转虚线，画在单位下面）
  if (ui.selection.length) {
    ctx.save();
    ctx.strokeStyle = C.select;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -w.time * 16;
    for (const id of ui.selection) {
      const u = w.index.get(id) as Unit | undefined; // 走索引，避免每帧线性查找
      if (!u || u.dead) continue;
      const r = UNIT_DEFS[u.type].radius;
      ctx.beginPath();
      ctx.ellipse(u.x, u.y + 3, r + 5, r + 3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 建筑（按 y 排序）
  const buildings = [...w.buildings].sort((a, b) => a.y - b.y);
  for (const b of buildings) drawBuilding(ctx, b, w.time);

  // 单位（按 y 排序）
  const sel = new Set(ui.selection);
  const units = [...w.units].sort((a, b) => a.y - b.y);
  for (const u of units) drawUnit(ctx, u, w.time, sel.has(u.id));

  // 弹道：箭矢 / 炮弹
  for (const p of w.projectiles) {
    const dx = p.tx - p.sx, dy = p.ty - p.sy;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    if (p.arrow) {
      // 箭矢
      ctx.strokeStyle = SIDE[p.side];
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(p.x - ux * 11, p.y - uy * 11);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - ux * 4 - uy * 2.5, p.y - uy * 4 + ux * 2.5);
      ctx.lineTo(p.x, p.y);
      ctx.lineTo(p.x - ux * 4 + uy * 2.5, p.y - uy * 4 - ux * 2.5);
      ctx.closePath();
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
    } else {
      // 炮弹
      const tail = Math.min(16, d * 0.3);
      ctx.strokeStyle = p.big ? 'rgba(251,191,36,0.8)' : SIDE[p.side];
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = p.big ? 3 : 1.8;
      ctx.beginPath();
      ctx.moveTo(p.x - ux * tail, p.y - uy * tail);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowColor = p.big ? '#fbbf24' : SIDE[p.side];
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.big ? 2.6 : 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  fxList.draw(ctx);

  // 放置幽灵
  if (ui.ghost) {
    const gh = ui.ghost;
    const cx = Math.round(gh.x / TILE), cy = Math.round(gh.y / TILE);
    ctx.fillStyle = gh.valid ? C.ghostOk : C.ghostBad;
    ctx.strokeStyle = gh.valid ? C.ghostOkEdge : C.ghostBadEdge;
    ctx.lineWidth = 2;
    ctx.fillRect(cx * TILE - TILE, cy * TILE - TILE, TILE * 2, TILE * 2);
    ctx.strokeRect(cx * TILE - TILE, cy * TILE - TILE, TILE * 2, TILE * 2);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = gh.valid ? '#f5ecd2' : '#f0a3a3';
    ctx.font = '600 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(BUILDING_DEFS[gh.type].name, gh.x, gh.y + 4);
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // 暗角
  const key = `${cam.cssW}x${cam.cssH}`;
  if (vigKey !== key) {
    vigKey = key;
    const grad = ctx.createRadialGradient(
      cam.cssW / 2, cam.cssH / 2, Math.min(cam.cssW, cam.cssH) * 0.45,
      cam.cssW / 2, cam.cssH / 2, Math.max(cam.cssW, cam.cssH) * 0.72,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.30)');
    vig = grad;
  }
  if (vig) {
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, cam.cssW, cam.cssH);
  }

  // 框选矩形（屏幕空间）
  if (ui.boxRect) {
    const { x0, y0, x1, y1 } = ui.boxRect;
    ctx.save();
    ctx.strokeStyle = C.select;
    ctx.fillStyle = 'rgba(245,236,210,0.12)';
    ctx.lineWidth = 1.5;
    const x = Math.min(x0, x1), y = Math.min(y0, y1);
    ctx.fillRect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.restore();
  }

  // 小地图雷达
  drawMinimap(ctx, w, cam);
}

function hpBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, hp: number, maxHp: number): void {
  const h = 3.5;
  ctx.fillStyle = C.hpBack;
  ctx.fillRect(x - width / 2, y, width, h);
  const k = Math.max(0, hp / maxHp);
  ctx.fillStyle = hpColor(k);
  ctx.fillRect(x - width / 2, y, width * k, h);
}

function drawUnit(ctx: CanvasRenderingContext2D, u: Unit, time: number, selected = false): void {
  const def = UNIT_DEFS[u.type];
  const r = def.radius;
  const justFired = u.cd > def.cooldown - 0.12;
  const recoilX = justFired ? -Math.cos(u.facing) * 2 : 0;
  const recoilY = justFired ? -Math.sin(u.facing) * 2 : 0;
  ctx.save();
  ctx.translate(u.x + recoilX, u.y + recoilY);
  // 轮廓形状 + 徽记统一由 shapes.ts 提供：步兵=圆盾 / 弓手=箭头 / 重装=骑士盾
  drawUnitBody(ctx, u.type, u.side, r, u.facing, {
    moving: u.path.length > 0, t: time, phase: u.id * 1.7,
  });
  ctx.restore();
  // 选中的部队常驻血条，方便在混战里掌握残血单位
  if (selected || u.hp < u.maxHp) hpBar(ctx, u.x, u.y - r - 8, r * 2, u.hp, u.maxHp);
}

function drawBuilding(ctx: CanvasRenderingContext2D, b: Building, time: number): void {
  const h = b.half;
  const constructing = b.buildT > 0;
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, -h + 2, -h + 4, h * 2, h * 2, 10);
  ctx.fill();

  ctx.fillStyle = SIDE_DIM[b.side];
  roundRect(ctx, -h, -h, h * 2, h * 2, 10);
  ctx.fill();
  ctx.strokeStyle = SIDE[b.side];
  ctx.lineWidth = 2.5;
  if (constructing) ctx.setLineDash([7, 5]);
  roundRect(ctx, -h, -h, h * 2, h * 2, 10);
  ctx.stroke();
  ctx.setLineDash([]);

  // 主基地/金矿的地面光晕：远景下也能一眼识别重要建筑；金矿再叠一层金色小光晕
  if (!constructing && (b.type === 'hq' || b.type === 'mine')) {
    const gl = ctx.createRadialGradient(0, 2, 4, 0, 2, h + 16);
    gl.addColorStop(0, SIDE_DIM[b.side]);
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(-(h + 16), -(h + 14), (h + 16) * 2, (h + 16) * 2 + 8);
    if (b.type === 'mine') {
      const gl2 = ctx.createRadialGradient(0, 4, 2, 0, 4, h * 0.62);
      gl2.addColorStop(0, 'rgba(240,194,78,0.10)');
      gl2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gl2;
      ctx.fillRect(-h * 0.62, -h * 0.62, h * 1.24, h * 1.24 + 6);
    }
  }

  const pulse = 1 + 0.06 * Math.sin(time * 2.5 + b.id);
  if (constructing) {
    // 施工中：脚手架 + 进度条
    ctx.strokeStyle = 'rgba(226,232,240,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-h * 0.55, -h * 0.45);
    ctx.lineTo(h * 0.55, h * 0.45);
    ctx.moveTo(h * 0.55, -h * 0.45);
    ctx.lineTo(-h * 0.55, h * 0.45);
    ctx.stroke();
    const k = 1 - b.buildT / BUILDING_DEFS[b.type].buildTime;
    ctx.fillStyle = C.hpBack;
    ctx.fillRect(-h + 6, h - 10, (h - 6) * 2, 5);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(-h + 6, h - 10, (h - 6) * 2 * k, 5);
  } else {
    switch (b.type) {
      case 'hq': {
        // 低血量警示脉冲（保留）
        if (b.hp < b.maxHp * 0.4) {
          ctx.save();
          ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 6);
          ctx.shadowColor = '#f87171';
          ctx.shadowBlur = 18;
          ctx.strokeStyle = '#f87171';
          ctx.lineWidth = 3;
          roundRect(ctx, -h + 2, -h + 2, h * 2 - 4, h * 2 - 4, 10);
          ctx.stroke();
          ctx.restore();
        }
        // 旋转光环（金色虚线圆，保留）
        ctx.save();
        ctx.rotate(time * 0.8);
        ctx.setLineDash([9, 7]);
        ctx.strokeStyle = 'rgba(201,162,39,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, h + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.scale(pulse, pulse);
        // 双侧塔楼（石砌）
        ctx.fillStyle = '#857f71';
        ctx.fillRect(-21, -9, 9, 23);
        ctx.fillRect(12, -9, 9, 23);
        ctx.strokeStyle = 'rgba(40,34,24,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-20, 0); ctx.lineTo(-13, 0);
        ctx.moveTo(13, 0); ctx.lineTo(20, 0);
        ctx.moveTo(-20, 8); ctx.lineTo(-13, 8);
        ctx.moveTo(13, 8); ctx.lineTo(20, 8);
        ctx.stroke();
        // 主堡 + 石缝
        ctx.fillStyle = '#a29c8e';
        ctx.fillRect(-12, -7, 24, 25);
        ctx.beginPath();
        ctx.moveTo(-11, 1); ctx.lineTo(11, 1);
        ctx.moveTo(-11, 9); ctx.lineTo(11, 9);
        ctx.moveTo(-5, -3); ctx.lineTo(-5, 1);
        ctx.moveTo(6, 1); ctx.lineTo(6, 9);
        ctx.stroke();
        // 右缘暗面（体积）
        ctx.fillStyle = 'rgba(30,24,16,0.14)';
        ctx.fillRect(6, -7, 6, 25);
        // 雉堞：主堡 + 双塔
        ctx.fillStyle = '#b5afa0';
        ctx.fillRect(-12, -11, 24, 5);
        ctx.fillRect(-21, -13, 9, 5);
        ctx.fillRect(12, -13, 9, 5);
        ctx.fillStyle = '#6e695e';
        for (const nx of [-8.5, -2.5, 3.5]) ctx.fillRect(nx, -11, 2.2, 5);
        ctx.fillRect(-16.5, -13, 2, 5);
        ctx.fillRect(-11.5, -13, 2, 5);
        ctx.fillRect(16.5, -13, 2, 5);
        ctx.fillRect(10.5, -13, 2, 5);
        // 拱门 + 门闸
        ctx.fillStyle = 'rgba(26,20,12,0.82)';
        ctx.beginPath();
        ctx.moveTo(-4.5, 18);
        ctx.lineTo(-4.5, 14);
        ctx.arc(0, 14, 4.5, Math.PI, 0);
        ctx.lineTo(4.5, 18);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(201,162,39,0.55)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-1.5, 15); ctx.lineTo(-1.5, 18);
        ctx.moveTo(1.5, 15); ctx.lineTo(1.5, 18);
        ctx.stroke();
        // 箭窗
        ctx.fillStyle = 'rgba(26,20,12,0.7)';
        ctx.fillRect(-7.2, -4, 1.6, 3.5);
        ctx.fillRect(5.6, -4, 1.6, 3.5);
        // 旗帜（右塔，远景辨认阵营）
        ctx.strokeStyle = SIDE_DARK[b.side];
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(16.5, -13);
        ctx.lineTo(16.5, -25);
        ctx.stroke();
        const fw = Math.sin(time * 4.4 + b.id) * 1.4;
        ctx.fillStyle = SIDE[b.side];
        ctx.beginPath();
        ctx.moveTo(16.5, -25);
        ctx.quadraticCurveTo(22.5, -23.4 + fw, 27.5, -20.8 + fw);
        ctx.lineTo(16.5, -17.4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'mine': {
        // 土堆 + 坑口：金矿是从土里挖出来的
        ctx.fillStyle = '#7d7566';
        ctx.beginPath();
        ctx.ellipse(0, 7, 15, 7.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath();
        ctx.ellipse(-4, 3.5, 8, 3.4, -0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#221a0e';
        ctx.beginPath();
        ctx.ellipse(0, 3.5, 6.5, 4.2, 0, 0, Math.PI * 2);
        ctx.fill();
        // 木井架：两腿 + 横梁
        ctx.strokeStyle = '#6b4a2a';
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-8, 12);
        ctx.lineTo(-3.5, -8);
        ctx.moveTo(8, 12);
        ctx.lineTo(3.5, -8);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-6, -6.5);
        ctx.lineTo(6, -6.5);
        ctx.stroke();
        ctx.lineCap = 'butt';
        // 金块堆（坑口前）
        ctx.fillStyle = '#f0c24e';
        for (const [gx, gy, gr] of [[-7, 11, 3.6], [6, 12, 3.2], [0, 13.5, 3]] as const) {
          ctx.beginPath();
          ctx.arc(gx, gy, gr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ffe9a8';
        for (const [gx, gy] of [[-8, 10], [5, 11], [-1, 12.6]] as const) {
          ctx.beginPath();
          ctx.arc(gx, gy, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
        // 闪光（保留）
        ctx.save();
        ctx.rotate(time * 1.6);
        ctx.strokeStyle = 'rgba(255,233,168,0.8)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(12, -4);
        ctx.lineTo(15, -4);
        ctx.moveTo(0, -13);
        ctx.lineTo(0, -16);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'barracks': {
        // 拉绳 + 基座
        ctx.strokeStyle = 'rgba(60,48,30,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -12);
        ctx.lineTo(-19, 12);
        ctx.moveTo(0, -12);
        ctx.lineTo(19, 12);
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(0, 13, 17, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // 帐篷（阵营色帆布）
        ctx.fillStyle = SIDE[b.side];
        ctx.beginPath();
        ctx.moveTo(-16, 12);
        ctx.lineTo(0, -13);
        ctx.lineTo(16, 12);
        ctx.closePath();
        ctx.fill();
        // 背光面 + 受光面（体积）
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(16, 12);
        ctx.lineTo(4, 12);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(-16, 12);
        ctx.lineTo(-7, 12);
        ctx.closePath();
        ctx.fill();
        // 顶脊奶白条纹（保留）
        ctx.strokeStyle = 'rgba(245,236,210,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-13, 7.5);
        ctx.lineTo(-1.5, -11);
        ctx.moveTo(2.5, -10.4);
        ctx.lineTo(13, 7.5);
        ctx.stroke();
        // 敞开的门帘
        ctx.fillStyle = 'rgba(20,14,8,0.6)';
        ctx.beginPath();
        ctx.moveTo(0, -3);
        ctx.lineTo(-4.5, 12);
        ctx.lineTo(4.5, 12);
        ctx.closePath();
        ctx.fill();
        // 中柱（保留）
        ctx.strokeStyle = 'rgba(20,14,8,0.55)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(0, 12);
        ctx.stroke();
        // 旗帜
        ctx.strokeStyle = SIDE_DARK[b.side];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-h + 8, -h + 22);
        ctx.lineTo(-h + 8, -h + 6);
        ctx.stroke();
        const fw = Math.sin(time * 5 + b.id) * 1.5;
        ctx.fillStyle = SIDE[b.side];
        ctx.beginPath();
        ctx.moveTo(-h + 8, -h + 6);
        ctx.quadraticCurveTo(-h + 15, -h + 8 + fw, -h + 21, -h + 10 + fw);
        ctx.lineTo(-h + 8, -h + 14);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'tower': {
        // 基座
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(0, 13, 11, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        // 石砌塔身（梯形，加高）
        ctx.fillStyle = '#a29c8e';
        ctx.beginPath();
        ctx.moveTo(-8.5, 13);
        ctx.lineTo(-6, -7);
        ctx.lineTo(6, -7);
        ctx.lineTo(8.5, 13);
        ctx.closePath();
        ctx.fill();
        // 右缘暗面（体积）
        ctx.fillStyle = 'rgba(30,24,16,0.14)';
        ctx.beginPath();
        ctx.moveTo(2, -7);
        ctx.lineTo(6, -7);
        ctx.lineTo(8.5, 13);
        ctx.lineTo(3.5, 13);
        ctx.closePath();
        ctx.fill();
        // 石缝
        ctx.strokeStyle = 'rgba(40,34,24,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-6.8, 5);
        ctx.lineTo(7.2, 5);
        ctx.moveTo(-5.8, -1);
        ctx.lineTo(6.2, -1);
        ctx.moveTo(-6.4, 2);
        ctx.lineTo(-3.4, 2);
        ctx.moveTo(4.4, 8);
        ctx.lineTo(7.4, 8);
        ctx.stroke();
        // 雉堞
        ctx.fillStyle = '#b5afa0';
        ctx.fillRect(-7.5, -12, 15, 5);
        ctx.fillStyle = '#6e695e';
        ctx.fillRect(-3.2, -12, 2, 5);
        ctx.fillRect(3.4, -12, 2, 5);
        // 箭窗
        ctx.fillStyle = 'rgba(26,20,12,0.75)';
        ctx.fillRect(-0.8, -4.5, 1.6, 4);
        // 追踪炮管（保留）
        ctx.save();
        ctx.rotate(b.facing);
        ctx.fillStyle = SIDE_DARK[b.side];
        ctx.fillRect(0, -1.6, 16, 3.2);
        ctx.restore();
        ctx.fillStyle = SIDE_DARK[b.side];
        ctx.beginPath();
        ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
        ctx.fill();
        // 刚开火的枪口焰
        if (b.cd > (BUILDING_DEFS.tower.weapon?.cooldown ?? 1) - 0.1) {
          ctx.save();
          ctx.rotate(b.facing);
          ctx.fillStyle = 'rgba(253,230,138,0.95)';
          ctx.beginPath();
          ctx.arc(19, 0, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        break;
      }
    }
    if (b.type === 'barracks' && b.trainType) {
      // 训练进度
      const def = UNIT_DEFS[b.trainType];
      const k = 1 - b.trainT / def.trainTime;
      ctx.fillStyle = C.hpBack;
      ctx.fillRect(-h + 6, h - 9, (h - 6) * 2, 4.5);
      ctx.fillStyle = '#e8e2c4';
      ctx.fillRect(-h + 6, h - 9, (h - 6) * 2 * k, 4.5);
    }
    if (b.hp < b.maxHp) hpBar(ctx, 0, -h - 8, h * 1.6, b.hp, b.maxHp);
  }
  ctx.restore();
}
