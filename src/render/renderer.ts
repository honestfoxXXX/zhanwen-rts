import {
  BUILDING_DEFS, COLS, HQ_POS, MAP_H, MAP_W, ROCK_TILES, ROWS, TILE, UNIT_DEFS,
} from '../core/config';
import type { Building, Unit, World } from '../core/types';
import type { Camera } from './camera';
import { draw as drawMinimap } from './minimap';
import { drawUnitBody } from './shapes';

const SIDE = ['#22d3ee', '#fb7185'];
const SIDE_DIM = ['rgba(34,211,238,0.14)', 'rgba(251,113,133,0.14)'];
const SIDE_DARK = ['#155e75', '#9f1239'];
const C = {
  groundA: '#0c1728',
  groundB: '#0e1a2e',
  grid: 'rgba(148,163,184,0.05)',
  rock: '#22334d',
  rockEdge: '#3b5273',
  line: 'rgba(245,158,11,0.45)',
  crystal: '#c084fc',
  select: '#6ee7b7',
  hpBack: 'rgba(2,6,16,0.7)',
  ghostOk: 'rgba(52,211,153,0.30)',
  ghostOkEdge: 'rgba(52,211,153,0.9)',
  ghostBad: 'rgba(248,113,113,0.30)',
  ghostBadEdge: 'rgba(248,113,113,0.9)',
};

export type GhostInfo = { type: Building['type']; x: number; y: number; valid: boolean } | null

let bgCanvas: HTMLCanvasElement | null = null;

/** 预渲染静态地面（棋盘 + 装饰 + 岩石 + 前线 + 基地区） */
export function buildBackground(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = MAP_W;
  c.height = MAP_H;
  const g = c.getContext('2d') as CanvasRenderingContext2D;

  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      g.fillStyle = (cx + cy) % 2 === 0 ? C.groundA : C.groundB;
      g.fillRect(cx * TILE, cy * TILE, TILE, TILE);
    }
  }
  // 半场淡染色
  g.fillStyle = 'rgba(251,113,133,0.04)';
  g.fillRect(0, 0, MAP_W, MAP_H / 2);
  g.fillStyle = 'rgba(34,211,238,0.04)';
  g.fillRect(0, MAP_H / 2, MAP_W, MAP_H / 2);

  // 网格
  g.strokeStyle = C.grid;
  g.lineWidth = 1;
  g.beginPath();
  for (let cx = 0; cx <= COLS; cx++) { g.moveTo(cx * TILE, 0); g.lineTo(cx * TILE, MAP_H); }
  for (let cy = 0; cy <= ROWS; cy++) { g.moveTo(0, cy * TILE); g.lineTo(MAP_W, cy * TILE); }
  g.stroke();

  // ---- 确定性地面装饰（碎石 / 草茎 / 暗斑）----
  let seed = 20260830;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // 暗斑
  for (let i = 0; i < 26; i++) {
    const x = rnd() * MAP_W, y = rnd() * MAP_H, r = 26 + rnd() * 52;
    g.fillStyle = `rgba(2,6,16,${0.05 + rnd() * 0.05})`;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.6, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // 草茎
  g.strokeStyle = 'rgba(94,234,212,0.10)';
  g.lineWidth = 1.4;
  for (let i = 0; i < 150; i++) {
    const x = rnd() * MAP_W, y = rnd() * MAP_H;
    const lean = (rnd() - 0.5) * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + lean, y - 3.5, x + lean * 1.6, y - 6);
    g.stroke();
  }
  // 碎石点
  for (let i = 0; i < 260; i++) {
    const x = rnd() * MAP_W, y = rnd() * MAP_H, r = 0.8 + rnd() * 1.6;
    g.fillStyle = `rgba(148,163,184,${0.05 + rnd() * 0.08})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // ---- 前线：虚线 + 箭头纹 ----
  g.strokeStyle = C.line;
  g.lineWidth = 2;
  g.setLineDash([10, 8]);
  g.beginPath();
  g.moveTo(0, MAP_H / 2);
  g.lineTo(MAP_W, MAP_H / 2);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(245,158,11,0.4)';
  for (let x = 26; x < MAP_W; x += 64) {
    g.beginPath();
    g.moveTo(x, MAP_H / 2 - 5);
    g.lineTo(x + 7, MAP_H / 2);
    g.lineTo(x, MAP_H / 2 + 5);
    g.closePath();
    g.fill();
  }
  g.fillStyle = 'rgba(245,158,11,0.55)';
  g.font = '600 13px sans-serif';
  g.textAlign = 'center';
  g.fillText('—— 前 线 ——', MAP_W / 2, MAP_H / 2 - 10);

  // ---- 岩石 ----
  for (const [cx, cy] of ROCK_TILES) {
    const x = cx * TILE, y = cy * TILE;
    g.fillStyle = C.rock;
    roundRect(g, x + 2, y + 2, TILE - 4, TILE - 4, 7);
    g.fill();
    g.strokeStyle = C.rockEdge;
    g.lineWidth = 1.5;
    roundRect(g, x + 2, y + 2, TILE - 4, TILE - 4, 7);
    g.stroke();
    g.fillStyle = 'rgba(148,163,184,0.25)';
    g.beginPath();
    g.arc(x + 13, y + 14, 2.5, 0, Math.PI * 2);
    g.arc(x + 27, y + 25, 2, 0, Math.PI * 2);
    g.fill();
  }

  // ---- 基地平台（HQ 底座）----
  for (const [i, p] of HQ_POS.entries()) {
    g.strokeStyle = i === 0 ? 'rgba(34,211,238,0.28)' : 'rgba(251,113,133,0.28)';
    g.lineWidth = 1.5;
    roundRect(g, p.x - 56, p.y - 56, 112, 112, 14);
    g.stroke();
    g.setLineDash([4, 5]);
    g.strokeStyle = i === 0 ? 'rgba(34,211,238,0.14)' : 'rgba(251,113,133,0.14)';
    roundRect(g, p.x - 48, p.y - 48, 96, 96, 12);
    g.stroke();
    g.setLineDash([]);
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

export function initRenderer(): void {
  bgCanvas = buildBackground();
}

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
  ctx.translate(0, -cam.y);

  if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0);

  // 水晶矿点
  for (const n of w.nodes) {
    if (n.mineId !== null) continue;
    const pulse = 1 + 0.1 * Math.sin(w.time * 3 + n.id * 1.7);
    const float = Math.sin(w.time * 2 + n.id) * 1.5;
    ctx.save();
    ctx.translate(n.x, n.y + float);
    // 地面光晕
    ctx.fillStyle = 'rgba(192,132,252,0.10)';
    ctx.beginPath();
    ctx.ellipse(0, 8, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(pulse, pulse);
    ctx.shadowColor = 'rgba(192,132,252,0.8)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = C.crystal;
    diamond(ctx, 0, 0, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    diamond(ctx, 0, -2, 7);
    ctx.fill();
    ctx.restore();
  }

  // 集结点（玩家）
  const r0 = w.rally[0];
  ctx.save();
  ctx.strokeStyle = 'rgba(251,191,36,0.75)';
  ctx.fillStyle = 'rgba(251,191,36,0.75)';
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
    ctx.fillStyle = gh.valid ? '#6ee7b7' : '#fca5a5';
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
    ctx.fillStyle = 'rgba(110,231,183,0.12)';
    ctx.lineWidth = 1.5;
    const x = Math.min(x0, x1), y = Math.min(y0, y1);
    ctx.fillRect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.restore();
  }

  // 小地图雷达
  drawMinimap(ctx, w, cam);
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.73, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.73, y);
  ctx.closePath();
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
  // 轮廓形状 + 徽记统一由 shapes.ts 提供：步兵=圆形 / 弓手=箭头 / 重装=六边形
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
    ctx.fillStyle = SIDE[b.side];
    ctx.strokeStyle = SIDE[b.side];
    switch (b.type) {
      case 'hq': {
        // 旋转光环 + 低血量警示
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
        ctx.save();
        ctx.rotate(time * 0.8);
        ctx.setLineDash([9, 7]);
        ctx.strokeStyle = SIDE_DARK[b.side];
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 21, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.scale(pulse, pulse);
        ctx.shadowColor = SIDE[b.side];
        ctx.shadowBlur = 10;
        diamond(ctx, 0, 0, 15);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        diamond(ctx, -2, -3, 6);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'mine': {
        ctx.save();
        ctx.translate(0, -3);
        ctx.shadowColor = 'rgba(192,132,252,0.6)';
        ctx.shadowBlur = 8;
        // 三根晶柱：此前与主基地一样是单个大菱形，远距离几乎分不出来
        for (const [cx, cy, r] of [[0, -2, 13], [-10, 5, 9], [10, 5, 9]] as const) {
          diamond(ctx, cx, cy, r);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        diamond(ctx, -1, -5, 5);
        ctx.fill();
        // 闪光
        ctx.save();
        ctx.rotate(time * 1.6);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(11, 0);
        ctx.moveTo(0, -9);
        ctx.lineTo(0, -12);
        ctx.stroke();
        ctx.restore();
        ctx.restore();
        ctx.strokeStyle = SIDE_DARK[b.side];
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 2, 16, 0.3, Math.PI - 0.3);
        ctx.stroke();
        break;
      }
      case 'barracks': {
        ctx.lineWidth = 3;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 12 - 5, 5);
          ctx.lineTo(i * 12, -4);
          ctx.lineTo(i * 12 + 5, 5);
          ctx.stroke();
        }
        // 旗帜
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
        // 基座 + 追踪炮管
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(10, 8);
        ctx.lineTo(-10, 8);
        ctx.closePath();
        ctx.fill();
        ctx.save();
        ctx.rotate(b.facing);
        ctx.fillStyle = SIDE_DARK[b.side];
        ctx.fillRect(0, -1.8, 17, 3.6);
        ctx.restore();
        ctx.fillStyle = SIDE_DARK[b.side];
        ctx.beginPath();
        ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
    if (b.type === 'barracks' && b.trainType) {
      // 训练进度
      const def = UNIT_DEFS[b.trainType];
      const k = 1 - b.trainT / def.trainTime;
      ctx.fillStyle = C.hpBack;
      ctx.fillRect(-h + 6, h - 9, (h - 6) * 2, 4.5);
      ctx.fillStyle = '#67e8f9';
      ctx.fillRect(-h + 6, h - 9, (h - 6) * 2 * k, 4.5);
    }
    if (b.hp < b.maxHp) hpBar(ctx, 0, -h - 8, h * 1.6, b.hp, b.maxHp);
  }
  ctx.restore();
}
