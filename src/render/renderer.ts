import {
  BUILDING_DEFS, COLS, MAP_H, MAPS, MAP_W, ROWS, TILE, UNIT_DEFS,
} from '../core/config';
import type { MapDef } from '../core/config';
import type { Building, Unit, UnitType, World } from '../core/types';
import type { Camera } from './camera';
import { draw as drawMinimap } from './minimap';
import { drawUnitDecals, drawUnitStatic, SIDE_DARK, SIDE_DIM, SIDE_FILL, UNIT_SHAPES } from './shapes';
import { getSprite } from './spriteCache';
import type { BuildingType, Side } from '../core/types';

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
// 后处理管线：游戏渲染到离屏 → 后处理 → 屏幕
let sceneCanvas: HTMLCanvasElement | null = null;
let grainCanvas: HTMLCanvasElement | null = null;
let grainInit = false;

function initPostFX(cssW: number, cssH: number): void {
  if (!sceneCanvas || sceneCanvas.width !== Math.round(cssW) || sceneCanvas.height !== Math.round(cssH)) {
    sceneCanvas = document.createElement('canvas');
    sceneCanvas.width = Math.round(cssW);
    sceneCanvas.height = Math.round(cssH);
  }
}

function initGrain(): void {
  if (grainInit) return;
  grainCanvas = document.createElement('canvas');
  grainCanvas.width = 128;
  grainCanvas.height = 128;
  const g = grainCanvas.getContext('2d') as CanvasRenderingContext2D;
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.floor(Math.random() * 36);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainInit = true;
}

// 3840² 全分辨率画布在 iOS 上逼近内存红线；0.75 分辨率（2880²）是清晰度与内存的平衡点
const BG_SCALE = 0.75;

// 河流采样（A1 绘制时填充；运行时用于水面闪烁）
const riverSamples: { x: number; y: number; a: number }[] = [];

// 云影：预渲染两张柔影贴图，世界锚定慢速漂移（渲染在地面之上、单位之下）
let cloudSprites: HTMLCanvasElement[] = [];
const CLOUDS = [
  { x: 400, y: 600, w: 900, h: 520, speed: 13, alpha: 0.5 },
  { x: 1800, y: 2100, w: 1200, h: 640, speed: 9, alpha: 0.42 },
  { x: 3000, y: 900, w: 800, h: 480, speed: 15, alpha: 0.5 },
  { x: 900, y: 2900, w: 1000, h: 560, speed: 11, alpha: 0.45 },
  { x: 2600, y: 3000, w: 850, h: 500, speed: 14, alpha: 0.5 },
  { x: 1500, y: 1200, w: 700, h: 420, speed: 17, alpha: 0.4 },
];

function makeCloudSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const blob = (x: number, y: number, r: number, a: number): void => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(8,20,12,${a})`);
    grad.addColorStop(1, 'rgba(8,20,12,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(90, 80, 78, 0.5);
  blob(150, 70, 64, 0.42);
  blob(120, 100, 90, 0.4);
  blob(60, 96, 52, 0.36);
  return c;
}

/** 水面闪烁：沿河采样点画短亮划，相位错开（纯时间驱动，零分配） */
function drawWaterShimmer(g: CanvasRenderingContext2D, time: number): void {
  if (!riverSamples.length) return;
  g.save();
  g.strokeStyle = 'rgba(214,232,240,0.32)';
  g.lineWidth = 1.4;
  g.lineCap = 'round';
  for (let i = 0; i < riverSamples.length; i += 2) {
    const p = riverSamples[i];
    const ph = Math.sin(time * 1.8 + i * 1.37);
    if (ph < 0.25) continue;
    g.globalAlpha = 0.15 + ph * 0.22;
    const ox = Math.cos(p.a + Math.PI / 2) * (ph - 0.5) * 18;
    const oy = Math.sin(p.a + Math.PI / 2) * (ph - 0.5) * 18;
    g.beginPath();
    g.moveTo(p.x + ox - Math.cos(p.a) * 7, p.y + oy - Math.sin(p.a) * 7);
    g.lineTo(p.x + ox + Math.cos(p.a) * 7, p.y + oy + Math.sin(p.a) * 7);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.restore();
}

/** 云影漂移（世界锚定，地面之上、单位之下） */
function drawCloudShadows(g: CanvasRenderingContext2D, time: number): void {
  for (let i = 0; i < CLOUDS.length; i++) {
    const c = CLOUDS[i];
    const cx = ((c.x + time * c.speed) % (MAP_W + 1400)) - 700;
    g.save();
    g.globalAlpha = c.alpha;
    g.drawImage(cloudSprites[i % cloudSprites.length], cx, c.y, c.w, c.h);
    g.restore();
  }
}

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
  g.strokeStyle = 'rgba(240,228,200,0.018)';
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

  // ---- 地面纹理增强：草丛簇、碎石小径、泥土斑块 ----
  // 草丛簇（多笔画小草，模拟真实草地密度）
  for (let i = 0; i < 800; i++) {
    const x = rnd() * MAP_W, y = rnd() * MAP_H;
    const clump = 2 + Math.floor(rnd() * 3);
    const hue = rnd() < 0.7 ? 'rgba(110,160,70,' : 'rgba(90,130,55,';
    for (let b = 0; b < clump; b++) {
      const bx = x + (rnd() - 0.5) * 12, by = y + (rnd() - 0.5) * 8;
      const bh = 3 + rnd() * 4;
      g.strokeStyle = hue + (0.15 + rnd() * 0.15) + ')';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + (rnd() - 0.5) * 2, by - bh);
      g.stroke();
    }
  }
  // 碎石小径
  for (let i = 0; i < 200; i++) {
    const x = rnd() * MAP_W, y = rnd() * MAP_H;
    g.fillStyle = `rgba(180,170,150,${0.1 + rnd() * 0.1})`;
    g.beginPath();
    g.arc(x, y, 0.7 + rnd() * 1.2, 0, Math.PI * 2);
    g.fill();
  }
  // 泥土斑块（不规则形状，增加地面层次）
  for (let i = 0; i < 60; i++) {
    const x = rnd() * MAP_W, y = rnd() * MAP_H, r = 20 + rnd() * 50;
    g.fillStyle = `rgba(110,85,50,${0.05 + rnd() * 0.06})`;
    g.beginPath();
    const np = 5 + Math.floor(rnd() * 3);
    for (let k = 0; k <= np; k++) {
      const a = (k / np) * Math.PI * 2;
      const nr = r * (0.6 + rnd() * 0.4);
      const px = x + Math.cos(a) * nr, py = y + Math.sin(a) * nr * 0.6;
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }

  // ---- 河流：岸 → 水面 → 浅滩（有河流的图）----
  riverSamples.length = 0;
  for (const river of map.rivers ?? []) {
    const pts: { x: number; y: number; a: number }[] = [];
    for (let i = 0; i < river.pts.length - 1; i++) {
      const a = river.pts[i], b = river.pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = Math.max(1, Math.ceil(d / 60));
      for (let k = 0; k < n; k++) {
        const x = a.x + (dx * k) / n, y = a.y + (dy * k) / n;
        pts.push({ x, y, a: Math.atan2(dy, dx) });
      }
    }
    // 岸草
    g.strokeStyle = 'rgba(70,90,52,0.8)';
    g.lineWidth = river.width + 34;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.stroke();
    // 水面
    g.strokeStyle = 'rgba(38,66,88,0.92)';
    g.lineWidth = river.width;
    g.stroke();
    // 深水芯
    g.strokeStyle = 'rgba(22,44,64,0.7)';
    g.lineWidth = river.width * 0.55;
    g.stroke();
    // 浅滩（可通行）：亮沙 + 踏石
    g.lineCap = 'butt';
    for (const f of river.fords) {
      g.fillStyle = 'rgba(196,186,150,0.75)';
      g.beginPath();
      g.ellipse(f.x, f.y, 62, 44, Math.atan2(1, 1.4), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(120,110,80,0.8)';
      for (const [sx, sy] of [[-16, -6], [2, 4], [14, -4], [-4, 10]] as const) {
        g.beginPath();
        g.arc(f.x + sx, f.y + sy, 3.4, 0, Math.PI * 2);
        g.fill();
      }
    }
    riverSamples.push(...pts);
  }

  // 泥土路：每个出生点一条弯路通往地图质心 —— 1v1 是两条主路在前线会合，
  // 三方是三条路汇聚"王冠之地"。画在岩石之前，路被巨石截断才自然。
  const roadCx = map.spawns.reduce((s, p) => s + p.pos.x, 0) / map.players;
  const roadCy = map.spawns.reduce((s, p) => s + p.pos.y, 0) / map.players;
  const roadSamples: { x: number; y: number }[] = [];
  for (const sp of map.spawns) {
    const mx = (sp.pos.x + roadCx) / 2 + (sp.pos.y - roadCy) * 0.08;
    const my = (sp.pos.y + roadCy) / 2 - (sp.pos.x - roadCx) * 0.08;
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const ix = (1 - t) * (1 - t) * sp.pos.x + 2 * (1 - t) * t * mx + t * t * roadCx;
      const iy = (1 - t) * (1 - t) * sp.pos.y + 2 * (1 - t) * t * my + t * t * roadCy;
      roadSamples.push({ x: ix, y: iy });
    }
    for (const [c, lw] of [['rgba(60,42,24,0.35)', 30], ['rgba(138,106,66,0.55)', 22]] as const) {
      g.strokeStyle = c;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(sp.pos.x, sp.pos.y);
      g.quadraticCurveTo(mx, my, roadCx, roadCy);
      g.stroke();
    }
  }

  // ---- 树丛：边缘林带 + 野地树簇（纯装饰；避开要道/河流/出生/矿/岩石/质心）----
  {
    const near = (list: { x: number; y: number }[], x: number, y: number, r: number): boolean => {
      for (const p of list) if ((p.x - x) ** 2 + (p.y - y) ** 2 < r * r) return true;
      return false;
    };
    const spawnPts = map.spawns.map(s => s.pos);
    const rockPts = map.rocks.map(([tx, ty]) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }));
    const treeSpot = (x: number, y: number): boolean => {
      if (x < 80 || y < 80 || x > MAP_W - 80 || y > MAP_H - 80) return false;
      if (near(spawnPts, x, y, 320)) return false;
      if (near(map.nodes, x, y, 150)) return false;
      if (near(rockPts, x, y, 95)) return false;
      if (near(roadSamples, x, y, 70)) return false;
      if (near(riverSamples, x, y, 130)) return false;
      if ((x - roadCx) ** 2 + (y - roadCy) ** 2 < 300 * 300) return false; // 质心留空
      return true;
    };
    const drawTree = (x: number, y: number, s: number, v: number): void => {
      g.fillStyle = 'rgba(10,20,12,0.28)';
      g.beginPath();
      g.ellipse(x + 6 * s, y + 8 * s, 15 * s, 6 * s, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#4a3524';
      g.beginPath();
      g.moveTo(x - 3 * s, y + 6 * s);
      g.lineTo(x - 1.3 * s, y - 5 * s);
      g.lineTo(x + 1.3 * s, y - 5 * s);
      g.lineTo(x + 3 * s, y + 6 * s);
      g.closePath();
      g.fill();
      if (v === 0) {
        // 阔叶：三层圆冠
        g.fillStyle = '#26421f';
        g.beginPath(); g.arc(x, y - 14 * s, 14 * s, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#33552a';
        g.beginPath(); g.arc(x - 4 * s, y - 18 * s, 10 * s, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#4b7136';
        g.beginPath(); g.arc(x - 3 * s, y - 21 * s, 5.6 * s, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(214,232,150,0.5)';
        g.beginPath(); g.arc(x - 6 * s, y - 22 * s, 2 * s, 0, Math.PI * 2); g.fill();
      } else if (v === 1) {
        // 高杉：三层塔冠
        g.fillStyle = '#1f3a22';
        g.beginPath();
        g.moveTo(x - 12 * s, y + 2 * s); g.lineTo(x, -18 * s + y); g.lineTo(x + 12 * s, y + 2 * s);
        g.closePath(); g.fill();
        g.fillStyle = '#2c4f2b';
        g.beginPath();
        g.moveTo(x - 9 * s, y - 8 * s); g.lineTo(x, -24 * s + y); g.lineTo(x + 9 * s, y - 8 * s);
        g.closePath(); g.fill();
        g.fillStyle = '#3d6634';
        g.beginPath();
        g.moveTo(x - 6 * s, y - 15 * s); g.lineTo(x, -27 * s + y); g.lineTo(x + 6 * s, y - 15 * s);
        g.closePath(); g.fill();
      } else {
        // 幼树
        g.fillStyle = '#2c4f2b';
        g.beginPath(); g.arc(x, y - 9 * s, 8 * s, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#466d36';
        g.beginPath(); g.arc(x - 2.5 * s, y - 11 * s, 4.5 * s, 0, Math.PI * 2); g.fill();
      }
    };
    let planted = 0;
    for (let i = 0; i < 1400 && planted < 150; i++) {
      const x = rnd() * MAP_W, y = rnd() * MAP_H;
      if (!treeSpot(x, y)) continue;
      // 聚簇：一半概率在附近再补 1-3 棵
      drawTree(x, y, 0.9 + rnd() * 0.5, Math.floor(rnd() * 3));
      planted++;
      const extra = 1 + Math.floor(rnd() * 3);
      for (let e = 0; e < extra && planted < 150; e++) {
        const ox = x + (rnd() - 0.5) * 220, oy = y + (rnd() - 0.5) * 220;
        if (!treeSpot(ox, oy)) continue;
        drawTree(ox, oy, 0.8 + rnd() * 0.55, Math.floor(rnd() * 3));
        planted++;
      }
    }

    // ---- 氛围点缀：出生点旁的小营地（篝火 + 木堆 + 帐篷角）----
    for (const sp of map.spawns) {
      const px = sp.pos.x - 150, py = sp.pos.y - 150;
      // 篝火
      g.fillStyle = '#4a3524';
      for (const [a, b] of [[-1, -1], [1, -1]] as const) {
        g.save();
        g.translate(px, py);
        g.rotate(a * b * 0.7);
        g.fillRect(-9, -1.5, 18, 3);
        g.restore();
      }
      g.fillStyle = 'rgba(255,146,40,0.85)';
      g.beginPath(); g.arc(px, py - 2, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,220,120,0.9)';
      g.beginPath(); g.arc(px, py - 2.5, 2, 0, Math.PI * 2); g.fill();
      // 木堆
      g.fillStyle = '#6b4a2a';
      g.fillRect(px + 16, py - 4, 14, 3.2);
      g.fillRect(px + 18, py - 7, 10, 3.2);
      // 帐篷角
      g.fillStyle = '#8a6f42';
      g.beginPath();
      g.moveTo(px - 26, py + 8); g.lineTo(px - 18, py - 8); g.lineTo(px - 10, py + 8);
      g.closePath(); g.fill();
    }
    // 三方图：王冠之地石阵
    if (map.players === 3) {
      const tcx = map.spawns.reduce((s, p) => s + p.pos.x, 0) / map.players;
      const tcy = map.spawns.reduce((s, p) => s + p.pos.y, 0) / map.players;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        const sx = tcx + Math.cos(a) * 70, sy = tcy + Math.sin(a) * 70;
        g.fillStyle = '#57544d';
        g.fillRect(sx - 7, sy - 16, 14, 20);
        g.fillStyle = 'rgba(255,255,255,0.1)';
        g.fillRect(sx - 7, sy - 16, 14, 5);
      }
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
  if (!cloudSprites.length) {
    cloudSprites = [makeCloudSprite(), makeCloudSprite()];
  }
  bgCanvas = buildBackground(map);
}

/** 当前地图（小地图等模块需要静态地形数据时使用） */
export function currentMap(): MapDef { return curMap; }

export interface RenderUI {
  selection: number[];
  mode: 'none' | 'place' | 'rally' | 'box';
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
  initPostFX(cam.cssW, cam.cssH);
  initGrain();
  const sctx = sceneCanvas!.getContext('2d') as CanvasRenderingContext2D;
  sctx.clearRect(0, 0, cam.cssW, cam.cssH);
  ctx.clearRect(0, 0, cam.cssW, cam.cssH);

  // 场景渲染到离屏画布
  sctx.save();
  sctx.scale(cam.scale, cam.scale);
  sctx.translate(-cam.x, -cam.y);

  if (bgCanvas) sctx.drawImage(bgCanvas, 0, 0, MAP_W, MAP_H);
  drawCloudShadows(ctx, w.time);
  drawWaterShimmer(ctx, w.time);

  // ---- 氛围粒子：漂浮尘埃 + 萤火虫 ----
  {
    const t = w.time;
    // 漂浮尘埃（视野内随机位置，微弱白色小点缓慢下落）
    ctx.save();
    for (let i = 0; i < 12; i++) {
      const px = cam.x + ((i * 331.7 + t * 8) % cam.viewW);
      const py = cam.y + ((i * 217.3 + t * 4) % cam.viewH);
      const alpha = 0.06 + 0.04 * Math.sin(t * 2 + i);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px, py, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // 萤火虫（只在暗处 / 夜晚，但当前无昼夜 → 均匀散布少量暖光点）
    for (let i = 0; i < 4; i++) {
      const fx = cam.x + ((i * 529.1 + Math.sin(t * 0.3 + i) * 200) % cam.viewW);
      const fy = cam.y + ((i * 347.7 + Math.cos(t * 0.2 + i) * 150) % cam.viewH);
      const glow = 0.15 + 0.1 * Math.sin(t * 3 + i * 2);
      ctx.globalAlpha = glow;
      ctx.fillStyle = '#ffeb8a';
      ctx.beginPath();
      ctx.arc(fx, fy, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

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

  // 建造区轮廓（放置模式提示：告诉玩家边界在哪）
  if (ui.mode === 'place') {
    const reg = curMap.spawns[0].build;
    ctx.save();
    ctx.strokeStyle = 'rgba(245,236,210,0.5)';
    ctx.fillStyle = 'rgba(245,236,210,0.045)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 8]);
    const rx = reg.x0 * TILE, ry = reg.y0 * TILE;
    const rw = (reg.x1 - reg.x0 + 1) * TILE, rh = (reg.y1 - reg.y0 + 1) * TILE;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 军营独立集结点小旗（金角旗，与全局旗区分）
  for (const b of w.buildings) {
    if (b.side !== 0 || b.type !== 'barracks' || !b.rally) continue;
    ctx.save();
    ctx.strokeStyle = SIDE[0];
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(b.rally.x, b.rally.y);
    ctx.lineTo(b.rally.x, b.rally.y - 12);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,232,160,0.92)';
    ctx.beginPath();
    ctx.moveTo(b.rally.x, b.rally.y - 12);
    ctx.lineTo(b.rally.x + 7, b.rally.y - 10);
    ctx.lineTo(b.rally.x, b.rally.y - 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

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

  drawTowerWalls(ctx, w);

  // 建筑（按 y 排序）
  const buildings = [...w.buildings].sort((a, b) => a.y - b.y);
  for (const b of buildings) drawBuilding(ctx, b, w.time);

  // 单位（按 y 排序）
  const sel = new Set(ui.selection);
  const units = [...w.units].sort((a, b) => a.y - b.y);
  for (const u of units) drawUnit(ctx, u, w.time, sel.has(u.id));

  // 弹道：箭矢 / 炮弹（高度弧线 + 地面影子）
  for (const p of w.projectiles) {
    const dx = p.tx - p.sx, dy = p.ty - p.sy;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / d, uy = dy / d;
    const k = Math.max(0, Math.min(1, p.t / p.dur));
    const lift = Math.sin(k * Math.PI) * (p.arrow ? 9 : 6);
    // 地面影子
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 2, 2.6 - lift * 0.09, 1.4 - lift * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(0, -lift);
    if (p.arrow) {
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
    ctx.restore();
  }

  // 行军扬尘：更新 + 绘制（土色渐大渐淡）
  {
    const dt = dustLastTime < 0 ? 0 : Math.max(0, Math.min(0.25, w.time - dustLastTime));
    dustLastTime = w.time;
    for (const u of w.units) {
      if (u.dead || u.path.length === 0) continue;
      if (Math.random() < dt * 2.2) {
        dust.push({ x: u.x + (Math.random() - 0.5) * 8, y: u.y + (Math.random() - 0.5) * 6 + 4, t: 0, r: 1.6 + Math.random() * 1.8 });
      }
    }
    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i];
      d.t += dt;
      d.y -= dt * 6;
      if (d.t >= 0.7) dust.splice(i, 1);
    }
    if (dust.length) {
      for (const d of dust) {
        ctx.globalAlpha = 0.3 * (1 - d.t / 0.7);
        ctx.fillStyle = '#b9a77f';
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + d.t * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  fxList.draw(sctx);
  sctx.restore();

  // ---- 后处理管线：把离屏场景合成到屏幕并叠加效果 ----
  // 1) 场景
  ctx.drawImage(sceneCanvas!, 0, 0);
  // 2) 暗角
  const vg = ctx.createRadialGradient(
    cam.cssW / 2, cam.cssH / 2, Math.min(cam.cssW, cam.cssH) * 0.35,
    cam.cssW / 2, cam.cssH / 2, Math.max(cam.cssW, cam.cssH) * 0.7,
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, cam.cssW, cam.cssH);
  // 3) 暖色调滤镜（乘法混色 → 统一全画面色温）
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(255,244,220,1)'; // 暖白：把冷色拉暖
  ctx.fillRect(0, 0, cam.cssW, cam.cssH);
  ctx.restore();
  // 4) 高光溢出（bloom）：亮区域泛白
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,220,140,0.03)';
  ctx.fillRect(0, 0, cam.cssW, cam.cssH);
  ctx.restore();
  // 5) 胶片噪点（微妙颗粒感）
  if (grainCanvas) {
    ctx.save();
    ctx.globalAlpha = 0.03;
    ctx.globalCompositeOperation = 'overlay';
    const gx = (Math.random() * 128) | 0;
    const gy = (Math.random() * 128) | 0;
    ctx.drawImage(grainCanvas, -gx, -gy, cam.cssW + 128, cam.cssH + 128);
    ctx.restore();
  }

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

  // ---- 全局后处理：暖色调滤镜 + 暗角 + 边缘压暗 ----
  // 色调层：给全画面叠一层暖色，把冷绿拉向"午后阳光"的战场氛围
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = 'rgba(255,220,150,0.08)';
  ctx.fillRect(0, 0, cam.cssW, cam.cssH);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = 'rgba(255,180,80,0.06)';
  ctx.fillRect(0, 0, cam.cssW, cam.cssH);
  ctx.restore();

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

// 单位精灵缓存：静态本体烘焙一次，每帧 blit；徽记/盔羽不随朝向旋转，另行叠加
const unitSprites = new Map<string, HTMLCanvasElement>();
function unitSprite(type: UnitType, side: Side): { c: HTMLCanvasElement; s: number } {
  const key = `${type}:${side}`;
  const s = (UNIT_DEFS[type].radius * UNIT_SHAPES[type].rMul) * 2.2 + 10; // 覆盖武器道具与底环
  let c = unitSprites.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = Math.ceil(s * 2 * 2);
    c.height = Math.ceil(s * 2 * 2);
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.scale(2, 2);
    g.translate(s, s);
    drawUnitStatic(g, type, side, UNIT_DEFS[type].radius);
    unitSprites.set(key, c);
  }
  return { c, s };
}

// 行军扬尘（纯视觉）：移动中的单位按概率扬起土尘
const dust: { x: number; y: number; t: number; r: number }[] = [];
let dustLastTime = -1;

/** 中原箭塔城墙连接：相邻箭塔(<100px)之间画石墙段（纯视觉） */
function drawTowerWalls(ctx: CanvasRenderingContext2D, w: World): void {
  if (w.civs[0] !== 'central' && (w.players < 3 || w.civs[1] !== 'central')) return;
  const towers = w.buildings.filter(b => b.type === 'tower' && !b.dead && b.buildT <= 0);
  for (let i = 0; i < towers.length; i++) {
    for (let j = i + 1; j < towers.length; j++) {
      const a = towers[i], c = towers[j];
      const dx = c.x - a.x, dy = c.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 100 || d < 5) continue;
      // 石墙段：厚线 + 砖纹
      ctx.save();
      ctx.strokeStyle = '#8d877a';
      ctx.lineWidth = 8;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 4);
      ctx.lineTo(c.x, c.y - 4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(40,34,24,0.3)';
      ctx.lineWidth = 0.7;
      // 石缝
      const steps = Math.ceil(d / 8);
      for (let k = 1; k < steps; k++) {
        const mx = a.x + (dx * k) / steps, my = a.y - 4 + (dy * k) / steps;
        ctx.beginPath();
        ctx.moveTo(mx, my - 3.5);
        ctx.lineTo(mx, my + 3.5);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

function drawUnit(ctx: CanvasRenderingContext2D, u: Unit, time: number, selected = false): void {
  const def = UNIT_DEFS[u.type];
  const r = def.radius;
  const justFired = u.cd > def.cooldown - 0.12;
  const recoilX = justFired ? -Math.cos(u.facing) * 2 : 0;
  const recoilY = justFired ? -Math.sin(u.facing) * 2 : 0;
  const moving = u.path.length > 0;
  const bob = moving ? Math.sin(time * 11 + u.id * 1.7) * UNIT_SHAPES[u.type].bob : 0;
  const breathe = 1 + 0.025 * Math.sin(time * 3 + u.id * 2.1);

  // 精灵 blit（本体随朝向旋转 + 呼吸缩放）
  const { c: spr, s } = unitSprite(u.type, u.side);
  ctx.save();
  ctx.translate(u.x + recoilX, u.y + recoilY + bob);
  ctx.rotate(u.facing);
  ctx.scale(breathe, breathe);
  ctx.drawImage(spr, -s, -s, s * 2, s * 2);
  ctx.restore();
  // 徽记 + 盔羽（不随朝向旋转）
  ctx.save();
  ctx.translate(u.x + recoilX, u.y + recoilY + bob);
  drawUnitDecals(ctx, u.type, u.side, r);
  ctx.restore();
  // 选中的部队常驻血条，方便在混战里掌握残血单位
  if (selected || u.hp < u.maxHp) hpBar(ctx, u.x, u.y - r - 8, r * 2, u.hp, u.maxHp);
}

/** 损伤冒烟：受损建筑顶部持续冒烟（纯时间驱动） */
function smokePuffs(g: CanvasRenderingContext2D, x: number, y: number, seed: number): void {
  for (let i = 0; i < 3; i++) {
    const k = (seed * 0.4 + i * 0.33) % 1;
    g.globalAlpha = 0.2 * (1 - k);
    g.fillStyle = '#6f6f6f';
    g.beginPath();
    g.arc(x + i * 7 - 5, y - k * 26, 2.5 + k * 4.5, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/* ---------------- 建筑材质 helpers ---------------- */

/** 错缝砖墙：底色 + 分行错缝描线 + 顶部受光边 */
function brickWall(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  base: string, seam: string,
): void {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  g.strokeStyle = seam;
  g.lineWidth = 0.7;
  const rows = Math.max(2, Math.round(h / 6.5));
  const rh = h / rows;
  for (let r = 0; r <= rows; r++) {
    g.beginPath();
    g.moveTo(x, y + r * rh);
    g.lineTo(x + w, y + r * rh);
    g.stroke();
    if (r < rows) {
      const off = (r % 2) * (w / 4);
      g.beginPath();
      g.moveTo(x + off, y + r * rh);
      g.lineTo(x + off, y + (r + 1) * rh);
      g.stroke();
      g.beginPath();
      g.moveTo(x + off + w / 2, y + r * rh);
      g.lineTo(x + off + w / 2, y + (r + 1) * rh);
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(255,250,230,0.1)';
  g.fillRect(x, y, w, 1.1);
}

/** 木板面：横板 + 板缝 + 木纹短弧 */
function woodPlank(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  base: string, seam: string, vertical = false,
): void {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  g.strokeStyle = seam;
  g.lineWidth = 0.7;
  const n = Math.max(2, Math.round((vertical ? w : h) / 5));
  for (let i = 1; i < n; i++) {
    g.beginPath();
    if (vertical) { g.moveTo(x + (w / n) * i, y); g.lineTo(x + (w / n) * i, y + h); }
    else { g.moveTo(x, y + (h / n) * i); g.lineTo(x + w, y + (h / n) * i); }
    g.stroke();
  }
}

/** 金属件：垂直渐变高光 */
function metalShade(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): void {
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#f0f4fa');
  grad.addColorStop(0.45, '#c8d0dc');
  grad.addColorStop(1, '#7c8494');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
}

/** 建筑静态主体（精灵缓存内绘制；中心 0,0；dmg = 损伤档 0/1/2） */
function paintBuildingStatic(
  g: CanvasRenderingContext2D,
  type: BuildingType,
  side: Side,
  h: number,
  dmg: number,
): void {
  // 底板 + 阵营描边
  g.fillStyle = SIDE_DIM[side];
  roundRect(g, -h, -h, h * 2, h * 2, 10);
  g.fill();
  g.strokeStyle = SIDE[side];
  g.lineWidth = 2.5;
  roundRect(g, -h, -h, h * 2, h * 2, 10);
  g.stroke();
  // 主基地/金矿地面光晕（静态部分）
  if (type === 'hq' || type === 'mine') {
    const gl = g.createRadialGradient(0, 2, 4, 0, 2, h + 16);
    gl.addColorStop(0, SIDE_DIM[side]);
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gl;
    g.fillRect(-(h + 16), -(h + 14), (h + 16) * 2, (h + 16) * 2 + 8);
    if (type === 'mine') {
      const gl2 = g.createRadialGradient(0, 4, 2, 0, 4, h * 0.62);
      gl2.addColorStop(0, 'rgba(240,194,78,0.10)');
      gl2.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gl2;
      g.fillRect(-h * 0.62, -h * 0.62, h * 1.24, h * 1.24 + 6);
    }
  }
  switch (type) {
    case 'hq': {
      // 石台基座
      g.fillStyle = '#6f6a5e';
      g.fillRect(-26, 16, 52, 5);
      g.fillStyle = '#7d786c';
      g.fillRect(-25, 12, 50, 5);
      // 双侧塔楼：左亮右暗圆柱感 + 锥顶
      for (const [tx, bright] of [[-25, true], [13, false]] as const) {
        g.fillStyle = bright ? '#98927f' : '#7d786c';
        g.fillRect(tx, -9, 12, 22);
        brickWall(g, tx, -9, 12, 22, bright ? '#98927f' : '#7d786c', 'rgba(40,34,24,0.3)');
        g.fillStyle = bright ? '#a8a294' : '#6e695e';
        g.fillRect(tx, -12, 12, 4);
        // 锥形顶（阵营色染边）
        g.fillStyle = SIDE[side];
        g.beginPath();
        g.moveTo(tx - 7.5, -12);
        g.lineTo(tx + 6, -26);
        g.lineTo(tx + 12, -12);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.beginPath();
        g.moveTo(tx + 6, -26);
        g.lineTo(tx + 12, -12);
        g.lineTo(tx + 6, -12);
        g.closePath();
        g.fill();
      }
      // 主堡：错缝砖墙 + 出檐
      brickWall(g, -13, -7, 26, 23, '#a29c8e', 'rgba(40,34,24,0.32)');
      g.fillStyle = 'rgba(30,24,16,0.16)';
      g.fillRect(5, -7, 8, 23);
      g.fillStyle = '#b5afa0';
      g.fillRect(-14, -11, 28, 5);
      g.fillStyle = '#6e695e';
      for (const nx of [-10.5, -4, 2.5]) g.fillRect(nx, -11, 2.4, 5);
      // 大门拱 + 吊桥木板 + 门闸
      g.fillStyle = 'rgba(26,20,12,0.85)';
      g.beginPath();
      g.moveTo(-5.5, 18);
      g.lineTo(-5.5, 13);
      g.arc(0, 13, 5.5, Math.PI, 0);
      g.lineTo(5.5, 18);
      g.closePath();
      g.fill();
      g.fillStyle = '#6b4a2a';
      g.fillRect(-4.5, 13.5, 9, 4.5);
      g.strokeStyle = 'rgba(30,22,12,0.6)';
      g.lineWidth = 0.7;
      for (let i = 1; i < 3; i++) {
        g.beginPath();
        g.moveTo(-4.5 + i * 3, 13.5);
        g.lineTo(-4.5 + i * 3, 18);
        g.stroke();
      }
      g.strokeStyle = 'rgba(201,162,39,0.65)';
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(-2, 14.5); g.lineTo(-2, 18);
      g.moveTo(2, 14.5); g.lineTo(2, 18);
      g.stroke();
      // 箭窗（左右塔）
      g.fillStyle = 'rgba(26,20,12,0.78)';
      g.fillRect(-20, -4, 1.8, 4);
      g.fillRect(18.2, -4, 1.8, 4);
      // 火把杆 + 旗杆（旗布动态）
      g.fillStyle = 'rgba(20,14,8,0.7)';
      g.fillRect(-8.8, 6, 1.6, 4);
      g.fillRect(7.2, 6, 1.6, 4);
      g.strokeStyle = SIDE_DARK[side];
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(16.5, -13);
      g.lineTo(16.5, -27);
      g.stroke();
      break;
    }
    case 'mine': {
      // 土堆三层
      g.fillStyle = '#6e6557';
      g.beginPath();
      g.ellipse(0, 8, 17, 8.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#7d7566';
      g.beginPath();
      g.ellipse(0, 6.5, 13, 6.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.ellipse(-4, 3.5, 7, 3, -0.25, 0, Math.PI * 2);
      g.fill();
      // 坑口木框：方井 + 双柱 + 顶梁
      g.fillStyle = '#221a0e';
      g.fillRect(-7, -2, 14, 11);
      g.fillStyle = '#6b4a2a';
      g.fillRect(-8.5, -4, 3, 14);
      g.fillRect(5.5, -4, 3, 14);
      woodPlank(g, -9.5, -6.5, 19, 3.4, '#7a5530', 'rgba(40,28,14,0.7)');
      // 轨道 + 矿车（斗 + 轮）
      g.strokeStyle = '#4a3520';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(-13, 15.5);
      g.lineTo(13, 15.5);
      g.stroke();
      g.fillStyle = '#6b4a2a';
      g.fillRect(-5, 10, 10, 4.5);
      g.fillStyle = '#3a2c18';
      g.beginPath();
      g.arc(-3, 15, 1.7, 0, Math.PI * 2);
      g.arc(3, 15, 1.7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f0c24e';
      g.fillRect(-3.8, 8.4, 7.6, 2.4);
      // 金块堆 + 高光
      g.fillStyle = '#f0c24e';
      for (const [gx, gy, gr] of [[-13, 9, 3.4], [12, 10, 3], [8, 14, 2.8]] as const) {
        g.beginPath();
        g.arc(gx, gy, gr, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ffe9a8';
      for (const [gx, gy] of [[-14, 8], [11.4, 9.2], [7.4, 13]] as const) {
        g.beginPath();
        g.arc(gx, gy, 1, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'barracks': {
      // 拉绳 + 基座
      g.strokeStyle = 'rgba(60,48,30,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, -12);
      g.lineTo(-19, 12);
      g.moveTo(0, -12);
      g.lineTo(19, 12);
      g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.beginPath();
      g.ellipse(0, 13, 17, 4.5, 0, 0, Math.PI * 2);
      g.fill();
      // 帐篷主体（帆布）
      g.fillStyle = SIDE[side];
      g.beginPath();
      g.moveTo(-16, 12);
      g.lineTo(0, -13);
      g.lineTo(16, 12);
      g.closePath();
      g.fill();
      // 背光面 + 受光面
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.beginPath();
      g.moveTo(0, -13);
      g.lineTo(16, 12);
      g.lineTo(4, 12);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.beginPath();
      g.moveTo(0, -13);
      g.lineTo(-16, 12);
      g.lineTo(-7, 12);
      g.closePath();
      g.fill();
      // 布褶皱（三条暗线）
      g.strokeStyle = 'rgba(0,0,0,0.14)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-5, -3.5);
      g.lineTo(-8.5, 12);
      g.moveTo(5, -3.5);
      g.lineTo(8.5, 12);
      g.stroke();
      // 顶脊奶白条纹
      g.strokeStyle = 'rgba(245,236,210,0.55)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-13, 7.5);
      g.lineTo(-1.5, -11);
      g.moveTo(2.5, -10.4);
      g.lineTo(13, 7.5);
      g.stroke();
      // 门帘
      g.fillStyle = 'rgba(20,14,8,0.6)';
      g.beginPath();
      g.moveTo(0, -3);
      g.lineTo(-4.5, 12);
      g.lineTo(4.5, 12);
      g.closePath();
      g.fill();
      // 武器架（3 剑插架）+ 木箱
      g.fillStyle = '#6b4a2a';
      g.fillRect(-17, 4, 8, 2);
      g.strokeStyle = '#c8d0dc';
      g.lineWidth = 1.1;
      for (const bx of [-15.5, -13, -10.5]) {
        g.beginPath();
        g.moveTo(bx, 4);
        g.lineTo(bx + (bx < -13 ? -1 : 1) * 1.5, -4);
        g.stroke();
      }
      woodPlank(g, 9, 4, 8, 7, '#8a6f42', 'rgba(40,28,14,0.6)');
      g.strokeStyle = 'rgba(40,28,14,0.7)';
      g.lineWidth = 1;
      g.strokeRect(9, 4, 8, 7);
      // 中柱 + 旗杆
      g.strokeStyle = 'rgba(20,14,8,0.55)';
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(0, -13);
      g.lineTo(0, 12);
      g.stroke();
      g.strokeStyle = SIDE_DARK[side];
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-h + 8, -h + 22);
      g.lineTo(-h + 8, -h + 6);
      g.stroke();
      break;
    }
    case 'tower': {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.beginPath();
      g.ellipse(0, 13, 11, 4, 0, 0, Math.PI * 2);
      g.fill();
      // 砖块塔身
      brickWall(g, -8.5, -7, 17, 20, '#a29c8e', 'rgba(40,34,24,0.32)');
      // 右缘暗面（体积）
      g.fillStyle = 'rgba(30,24,16,0.15)';
      g.beginPath();
      g.moveTo(2, -7);
      g.lineTo(6, -7);
      g.lineTo(8.5, 13);
      g.lineTo(3.5, 13);
      g.closePath();
      g.fill();
      // 出檐石台 + 雉堞
      g.fillStyle = '#b5afa0';
      g.fillRect(-9.5, -12, 19, 5);
      g.fillStyle = '#6e695e';
      g.fillRect(-5.8, -12, 2.2, 5);
      g.fillRect(3.6, -12, 2.2, 5);
      // 箭窗 + 木门
      g.fillStyle = 'rgba(26,20,12,0.78)';
      g.fillRect(-0.9, -5, 1.8, 4.4);
      g.fillRect(-2.2, 6, 4.4, 7);
      g.strokeStyle = 'rgba(201,162,39,0.4)';
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(0, 6);
      g.lineTo(0, 13);
      g.stroke();
      break;
    }
    case 'smithy': {
      // 石砌矮房（砖墙）+ 出檐
      brickWall(g, -18, -6, 36, 22, '#8d877a', 'rgba(40,34,24,0.34)');
      g.fillStyle = 'rgba(30,24,16,0.16)';
      g.fillRect(9, -6, 9, 22);
      g.fillStyle = '#a8a294';
      g.fillRect(-19, -9.5, 38, 4.5);
      // 大烟囱（右后，砖纹 + 烟口）
      brickWall(g, 10, -22, 9, 15, '#7d786c', 'rgba(40,34,24,0.32)');
      g.fillStyle = '#221a0e';
      g.fillRect(12, -22, 5, 2.2);
      // 锻造炉口：拱形开口 + 炭火底色（动态层加闪烁火光）
      g.fillStyle = 'rgba(20,14,8,0.9)';
      g.beginPath();
      g.moveTo(-7, 16);
      g.lineTo(-7, 6);
      g.arc(0, 6, 7, Math.PI, 0);
      g.lineTo(7, 16);
      g.closePath();
      g.fill();
      const fire = g.createRadialGradient(0, 12, 1, 0, 12, 6.5);
      fire.addColorStop(0, 'rgba(255,180,60,0.9)');
      fire.addColorStop(0.6, 'rgba(230,90,20,0.75)');
      fire.addColorStop(1, 'rgba(120,40,10,0.4)');
      g.fillStyle = fire;
      g.beginPath();
      g.moveTo(-5, 16);
      g.lineTo(-5, 8);
      g.arc(0, 8, 5, Math.PI, 0);
      g.lineTo(5, 16);
      g.closePath();
      g.fill();
      // 门框阵营色
      g.strokeStyle = SIDE[side];
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(-7, 16);
      g.lineTo(-7, 6);
      g.arc(0, 6, 7, Math.PI, 0);
      g.lineTo(7, 16);
      g.stroke();
      // 铁砧（左前 T 形）+ 立锤
      metalShade(g, -22, 8, 8, 2.6);
      g.fillStyle = '#5a5e68';
      g.fillRect(-19, 10.6, 3, 4.5);
      g.fillStyle = '#6b4a2a';
      g.fillRect(-13.5, 2, 1.8, 9);
      metalShade(g, -15.5, 0.5, 6, 3);
      // 挂墙锤 + 皮革围裙（阵营色小件）
      g.fillStyle = SIDE[side];
      g.fillRect(13, 2, 5, 7);
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.lineWidth = 0.8;
      g.strokeRect(13, 2, 5, 7);
      break;
    }
    case 'workshop': {
      // 地面垫木
      woodPlank(g, -22, 12, 44, 5, '#7a5530', 'rgba(40,28,14,0.65)', true);
      // 三根木柱
      g.fillStyle = '#6b4a2a';
      for (const px of [-20, -1, 18]) g.fillRect(px, -14, 3.4, 27);
      // 斜屋顶（木板纹 + 出檐）
      g.save();
      g.beginPath();
      g.moveTo(-25, -14);
      g.lineTo(25, -14);
      g.lineTo(20, -24);
      g.lineTo(-20, -24);
      g.closePath();
      woodPlank(g, -25, -24, 50, 10, '#8a6f42', 'rgba(40,28,14,0.6)');
      g.strokeStyle = 'rgba(40,28,14,0.5)';
      g.lineWidth = 1;
      g.stroke();
      g.restore();
      // 屋檐布幔（阵营色三角边）
      g.fillStyle = SIDE[side];
      for (let i = 0; i < 6; i++) {
        const bx = -24 + i * 8;
        g.beginPath();
        g.moveTo(bx, -14);
        g.lineTo(bx + 8, -14);
        g.lineTo(bx + 4, -9.5);
        g.closePath();
        g.fill();
      }
      // 棚内投臂原型：斜臂 + 配重箱 + 勺兜
      g.strokeStyle = '#6b4a2a';
      g.lineWidth = 3.2;
      g.beginPath();
      g.moveTo(-8, 10);
      g.lineTo(14, -16);
      g.stroke();
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(-8, 10);
      g.lineTo(2, 10);
      g.stroke();
      g.fillStyle = '#5a5248';
      g.fillRect(-13, 4, 7, 7);
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.lineWidth = 0.8;
      g.strokeRect(-13, 4, 7, 7);
      g.fillStyle = '#4a3520';
      g.beginPath();
      g.arc(15.5, -17.5, 3.4, 0, Math.PI * 2);
      g.fill();
      // 石弹
      g.fillStyle = '#8d877a';
      g.beginPath();
      g.arc(9, 9, 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.2)';
      g.beginPath();
      g.arc(8.2, 8.2, 1.1, 0, Math.PI * 2);
      g.fill();
      // 木轮（辐条）
      g.fillStyle = '#4a3520';
      g.beginPath();
      g.arc(-16, 9, 5.2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#8a6f42';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(-16, 9, 3.4, 0, Math.PI * 2);
      g.stroke();
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        g.beginPath();
        g.moveTo(-16 + Math.cos(a) * 1, 9 + Math.sin(a) * 1);
        g.lineTo(-16 + Math.cos(a) * 4.6, 9 + Math.sin(a) * 4.6);
        g.stroke();
      }
      // 圆木堆
      g.fillStyle = '#6b4a2a';
      g.fillRect(16, 6, 12, 3);
      g.fillRect(18, 3, 12, 3);
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.fillRect(16, 6, 12, 1);
      break;
    }
  }
  // 损伤层：裂纹 + 焦痕
  if (dmg >= 1) {
    g.strokeStyle = 'rgba(20,14,8,0.55)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(-h * 0.5, -h * 0.3);
    g.lineTo(-h * 0.2, -h * 0.05);
    g.lineTo(-h * 0.35, h * 0.25);
    g.moveTo(h * 0.4, -h * 0.5);
    g.lineTo(h * 0.15, -h * 0.25);
    g.stroke();
  }
  if (dmg >= 2) {
    g.strokeStyle = 'rgba(20,14,8,0.6)';
    g.beginPath();
    g.moveTo(h * 0.1, h * 0.1);
    g.lineTo(h * 0.45, h * 0.45);
    g.moveTo(-h * 0.55, h * 0.2);
    g.lineTo(-h * 0.25, h * 0.45);
    g.stroke();
    g.fillStyle = 'rgba(30,22,12,0.35)';
    g.beginPath();
    g.arc(h * 0.3, h * 0.28, h * 0.22, 0, Math.PI * 2);
    g.fill();
  }
}

/** 建筑动态层：旗布/火把焰/旋转光环/炮管（时间驱动，不进缓存） */
function drawBuildingDynamic(
  g: CanvasRenderingContext2D,
  b: Building,
  h: number,
  time: number,
): void {
  const side = b.side;
  if (b.type === 'hq') {
    // 低血量警示脉冲
    if (b.hp < b.maxHp * 0.4) {
      g.save();
      g.globalAlpha = 0.5 + 0.3 * Math.sin(time * 6);
      g.shadowColor = '#f87171';
      g.shadowBlur = 18;
      g.strokeStyle = '#f87171';
      g.lineWidth = 3;
      roundRect(g, -h + 2, -h + 2, h * 2 - 4, h * 2 - 4, 10);
      g.stroke();
      g.restore();
    }
    // 旋转光环
    g.save();
    g.rotate(time * 0.8);
    g.setLineDash([9, 7]);
    g.strokeStyle = 'rgba(201,162,39,0.5)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(0, 0, h + 3, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    // 旗布（右塔）
    const fw = Math.sin(time * 4.4 + b.id) * 1.4;
    g.fillStyle = SIDE_FILL[side];
    g.beginPath();
    g.moveTo(16.5, -25);
    g.quadraticCurveTo(22.5, -23.4 + fw, 27.5, -20.8 + fw);
    g.lineTo(16.5, -17.4);
    g.closePath();
    g.fill();
    // 门拱火把焰
    for (const tx of [-8, 8]) {
      const fl = 2.2 + Math.sin(time * 11 + tx) * 0.8;
      g.fillStyle = 'rgba(255,146,40,0.9)';
      g.beginPath();
      g.ellipse(tx, 9, 1.6, fl, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,220,120,0.9)';
      g.beginPath();
      g.ellipse(tx, 9, 0.8, fl * 0.55, 0, 0, Math.PI * 2);
      g.fill();
    }
  } else if (b.type === 'mine') {
    // 闪光
    g.save();
    g.rotate(time * 1.6);
    g.strokeStyle = 'rgba(255,233,168,0.8)';
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(12, -4);
    g.lineTo(15, -4);
    g.moveTo(0, -13);
    g.lineTo(0, -16);
    g.stroke();
    g.restore();
  } else if (b.type === 'barracks') {
    // 旗布
    const fw = Math.sin(time * 5 + b.id) * 1.5;
    g.fillStyle = SIDE_FILL[side];
    g.beginPath();
    g.moveTo(-h + 8, -h + 6);
    g.quadraticCurveTo(-h + 15, -h + 8 + fw, -h + 21, -h + 10 + fw);
    g.lineTo(-h + 8, -h + 14);
    g.closePath();
    g.fill();
  } else if (b.type === 'tower') {
    // 追踪炮管 + 枢轴 + 枪口焰
    g.save();
    g.rotate(b.facing);
    g.fillStyle = SIDE_DARK[side];
    g.fillRect(0, -1.6, 16, 3.2);
    g.restore();
    g.fillStyle = SIDE_DARK[side];
    g.beginPath();
    g.arc(0, 0, 3.2, 0, Math.PI * 2);
    g.fill();
    if (b.cd > (BUILDING_DEFS.tower.weapon?.cooldown ?? 1) - 0.1) {
      g.save();
      g.rotate(b.facing);
      g.fillStyle = 'rgba(253,230,138,0.95)';
      g.beginPath();
      g.arc(18, 0, 4.2, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
}

function drawBuilding(ctx: CanvasRenderingContext2D, b: Building, time: number): void {
  const h = b.half;
  const constructing = b.buildT > 0;
  ctx.save();
  ctx.translate(b.x, b.y);
  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, -h + 2, -h + 4, h * 2, h * 2, 10);
  ctx.fill();
  if (constructing) {
    // 施工：虚线地台 + 真脚手架（四柱双梁）+ 进度
    ctx.fillStyle = SIDE_DIM[b.side];
    roundRect(ctx, -h, -h, h * 2, h * 2, 10);
    ctx.fill();
    ctx.strokeStyle = SIDE[b.side];
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    roundRect(ctx, -h, -h, h * 2, h * 2, 10);
    ctx.stroke();
    ctx.setLineDash([]);
    const p = h - 5;
    ctx.strokeStyle = 'rgba(107,74,42,0.95)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (const [px, py] of [[-p, -p], [p, -p], [-p, p], [p, p]] as const) {
      ctx.moveTo(px, py - 7);
      ctx.lineTo(px, py + 4);
    }
    ctx.moveTo(-p, -p + 3);
    ctx.lineTo(p, -p + 3);
    ctx.moveTo(-p, p - 5);
    ctx.lineTo(p, p - 5);
    ctx.stroke();
    const k = 1 - b.buildT / BUILDING_DEFS[b.type].buildTime;
    ctx.fillStyle = C.hpBack;
    ctx.fillRect(-h + 6, h - 10, (h - 6) * 2, 5);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(-h + 6, h - 10, (h - 6) * 2 * k, 5);
  } else {
    // 静态主体走精灵缓存（含损伤档）；动态层（旗/焰/环/炮管/冒烟）实时绘制
    const dmg = b.hp < b.maxHp * 0.33 ? 2 : b.hp < b.maxHp * 0.66 ? 1 : 0;
    const S = h + 14;
    const sprite = getSprite(`bld:${b.type}:${b.side}:${dmg}`, S * 2, S * 2, g => {
      g.translate(S, S);
      paintBuildingStatic(g, b.type, b.side, h, dmg);
    });
    ctx.drawImage(sprite, -S, -S, S * 2, S * 2);
    if (dmg >= 1) smokePuffs(ctx, dmg === 2 ? -h * 0.3 : h * 0.25, -h * 0.7, time * 0.5 + b.id);
    drawBuildingDynamic(ctx, b, h, time);
    // 训练进度
    if (b.type === 'barracks' && b.trainType) {
      const def = UNIT_DEFS[b.trainType];
      const kk = 1 - b.trainT / def.trainTime;
      ctx.fillStyle = C.hpBack;
      ctx.fillRect(-h + 6, h - 9, (h - 6) * 2, 4.5);
      ctx.fillStyle = '#e8e2c4';
      ctx.fillRect(-h + 6, h - 9, (h - 6) * 2 * kk, 4.5);
    }
    if (b.hp < b.maxHp) hpBar(ctx, 0, -h - 8, h * 1.6, b.hp, b.maxHp);
  }
  ctx.restore();
}
