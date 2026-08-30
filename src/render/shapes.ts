import type { BuildingType, Side, UnitType } from '../core/types';

/**
 * 形状与配色的单一绘制源。
 *
 * 设计原则：两个正交通道，互不干扰
 *   阵营 = 颜色（填充色 + 外环）
 *   兵种 = 轮廓形状 + 尺寸 + 徽记
 *
 * 这样即便在色弱 / 小屏 / 混战的极端情况下，读取任意一个通道都能拿到信息。
 *
 * 注意：这里的 rMul 只影响视觉尺寸，绝不改动 UNIT_DEFS.radius
 * （那是碰撞、分离、射程判定用的），因此调外观不会动到平衡。
 *
 * 战场渲染与 HUD 卡槽图标共用本文件的函数，避免两套图形各自漂移。
 */

export const SIDE_FILL = ['#22d3ee', '#fb7185'];
export const SIDE_DARK = ['#155e75', '#9f1239'];
export const SIDE_RING = ['rgba(34,211,238,0.7)', 'rgba(251,113,133,0.7)'];

type ShapeKind = 'circle' | 'arrow' | 'hex';
type EmblemKind = 'dot' | 'ring' | 'plates';

interface UnitShape {
  shape: ShapeKind;
  rMul: number;      // 视觉半径倍率
  emblem: EmblemKind;
  bob: number;       // 步行摆动幅度；重装为 0，强化"沉重"的体感差异
}

export const UNIT_SHAPES: Record<UnitType, UnitShape> = {
  infantry: { shape: 'circle', rMul: 1.0, emblem: 'dot', bob: 0.9 },
  archer: { shape: 'arrow', rMul: 1.15, emblem: 'ring', bob: 0.7 },
  heavy: { shape: 'hex', rMul: 1.12, emblem: 'plates', bob: 0 },
};

function shapePath(g: CanvasRenderingContext2D, kind: ShapeKind, r: number): void {
  g.beginPath();
  if (kind === 'circle') {
    g.arc(0, 0, r, 0, Math.PI * 2);
    return;
  }
  if (kind === 'arrow') {
    // 尖端朝 +x，由调用方 rotate 到实际朝向
    g.moveTo(r * 1.25, 0);
    g.lineTo(-r * 0.75, -r * 0.95);
    g.lineTo(-r * 0.35, 0);
    g.lineTo(-r * 0.75, r * 0.95);
    g.closePath();
    return;
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

function drawEmblem(g: CanvasRenderingContext2D, kind: EmblemKind, vr: number, side: Side): void {
  g.fillStyle = SIDE_DARK[side];
  g.strokeStyle = SIDE_DARK[side];
  switch (kind) {
    case 'dot':
      g.beginPath();
      g.arc(0, 0, Math.max(2, vr * 0.26), 0, Math.PI * 2);
      g.fill();
      break;
    case 'ring':
      g.lineWidth = Math.max(1.6, vr * 0.16);
      g.beginPath();
      g.arc(0, 0, Math.max(2.4, vr * 0.34), 0, Math.PI * 2);
      g.stroke();
      break;
    case 'plates': {
      const w = vr * 0.6, h = Math.max(1.6, vr * 0.14);
      g.fillRect(-w / 2, -vr * 0.26 - h / 2, w, h);
      g.fillRect(-w / 2, vr * 0.26 - h / 2, w, h);
      break;
    }
  }
}

export interface UnitDrawOpts {
  moving?: boolean;
  t?: number;      // 世界时间，驱动步行摆动
  phase?: number;  // 每单位相位，避免整队同步摆动
}

/** 以原点为中心绘制一个单位（调用方负责 translate） */
export function drawUnitBody(
  g: CanvasRenderingContext2D,
  type: UnitType,
  side: Side,
  r: number,
  facing: number,
  opts: UnitDrawOpts = {},
): void {
  const def = UNIT_SHAPES[type];
  const vr = r * def.rMul;
  const bob = opts.moving && def.bob ? Math.sin((opts.t ?? 0) * 11 + (opts.phase ?? 0)) * def.bob : 0;

  // 阴影
  g.fillStyle = 'rgba(0,0,0,0.32)';
  g.beginPath();
  g.ellipse(0, vr * 0.7, vr * 0.85, vr * 0.38, 0, 0, Math.PI * 2);
  g.fill();

  // 阵营底环：尺寸缩到 10px 量级时，阵营主要靠它辨认
  g.strokeStyle = SIDE_RING[side];
  g.lineWidth = 2;
  g.globalAlpha = 0.6;
  g.beginPath();
  g.arc(0, 0, vr + 2.6, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;

  g.save();
  g.translate(0, bob); // 摆动保持屏幕纵向，不随朝向旋转

  g.save();
  g.rotate(facing);
  shapePath(g, def.shape, vr);
  g.fillStyle = SIDE_FILL[side];
  g.fill();
  g.strokeStyle = SIDE_DARK[side];
  g.lineWidth = 2;
  g.stroke();

  // 朝向指针
  g.strokeStyle = SIDE_DARK[side];
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(vr * 0.2, 0);
  g.lineTo(vr + 4, 0);
  g.stroke();
  g.restore();

  // 徽记不随朝向旋转 —— 这是剪影能否稳定辨认的关键
  drawEmblem(g, def.emblem, vr, side);
  g.restore();
}

/**
 * 建筑图标。在 ±16 的设计坐标系内绘制，由 scale 缩放到实际尺寸。
 * 造型之间刻意拉开差距（菱形 / 水晶簇 / 人字顶 / 塔形），远距离也能区分。
 */
export function drawBuildingIcon(
  g: CanvasRenderingContext2D,
  type: BuildingType,
  side: Side,
  scale: number,
  pulse = 1,
): void {
  g.save();
  g.scale(scale, scale);
  g.fillStyle = SIDE_FILL[side];
  g.strokeStyle = SIDE_DARK[side];

  switch (type) {
    case 'hq': {
      g.save();
      g.scale(pulse, pulse);
      g.beginPath();
      g.moveTo(0, -14); g.lineTo(11, 0); g.lineTo(0, 14); g.lineTo(-11, 0);
      g.closePath();
      g.fill();
      g.restore();
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 20, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    case 'mine': {
      // 水晶簇：三根晶柱，与主基地的单个菱形明显不同
      for (const [cx, cy, r] of [[0, -1, 12], [-9, 4, 8], [9, 4, 8]] as const) {
        g.beginPath();
        g.moveTo(cx, cy - r);
        g.lineTo(cx + r * 0.6, cy);
        g.lineTo(cx, cy + r);
        g.lineTo(cx - r * 0.6, cy);
        g.closePath();
        g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath();
      g.moveTo(0, -13); g.lineTo(6, -1); g.lineTo(0, 2);
      g.closePath();
      g.fill();
      break;
    }
    case 'barracks': {
      // 营房：屋身 + 人字屋顶
      g.fillRect(-12, -4, 24, 14);
      g.beginPath();
      g.moveTo(-16, -4); g.lineTo(0, -17); g.lineTo(16, -4);
      g.closePath();
      g.fill();
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(-4, 10); g.lineTo(-4, -1);
      g.moveTo(4, 10); g.lineTo(4, -1);
      g.stroke();
      break;
    }
    case 'tower': {
      // 塔：梯形塔身 + 塔尖 + 垛口
      g.beginPath();
      g.moveTo(-8, 10); g.lineTo(-5, -6); g.lineTo(5, -6); g.lineTo(8, 10);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(0, -17); g.lineTo(7, -6); g.lineTo(-7, -6);
      g.closePath();
      g.fill();
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(-6, -6); g.lineTo(-6, -11);
      g.moveTo(6, -6); g.lineTo(6, -11);
      g.stroke();
      break;
    }
  }
  g.restore();
}

/** 绘制 HUD 卡槽图标（与战场内完全同源） */
export function drawIcon(
  g: CanvasRenderingContext2D,
  kind: 'unit' | 'building',
  type: UnitType | BuildingType,
  side: Side,
  size: number,
): void {
  g.clearRect(0, 0, size, size);
  g.save();
  g.translate(size / 2, size / 2);
  if (kind === 'unit') {
    drawUnitBody(g, type as UnitType, side, size * 0.28, -Math.PI / 2, {});
  } else {
    drawBuildingIcon(g, type as BuildingType, side, size / 38, 1);
  }
  g.restore();
}
