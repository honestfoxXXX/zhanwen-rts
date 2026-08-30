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

/**
 * 纹章三原色：天蓝（Azure）/ 绯红（Gules）/ 金（Or），即蓝衫军 / 红衫军 / 金衫军。
 * 金衫军与"黄金资源色"的区分：资源与提示统一用奶白金（#f5ecd2 系），琥珀金只归阵营。
 * 全项目只有这一处定义阵营色，其它模块一律从这里引入，避免各处颜色对不上。
 */
export const SIDE_FILL = ['#5b8dd6', '#d64545', '#dfa53b'];
export const SIDE_DARK = ['#1e3a5f', '#6b1f1f', '#8a5a10'];
export const SIDE_RING = ['rgba(91,141,214,0.7)', 'rgba(214,69,69,0.7)', 'rgba(223,165,59,0.7)'];
export const SIDE_DIM = ['rgba(91,141,214,0.16)', 'rgba(214,69,69,0.16)', 'rgba(223,165,59,0.16)'];

type ShapeKind = 'circle' | 'arrow' | 'heater';
type EmblemKind = 'boss' | 'quiver' | 'cross';

interface UnitShape {
  shape: ShapeKind;
  rMul: number;      // 视觉半径倍率
  emblem: EmblemKind;
  bob: number;       // 步行摆动幅度；骑士为 0，强化"沉重"的体感差异
}

export const UNIT_SHAPES: Record<UnitType, UnitShape> = {
  infantry: { shape: 'circle', rMul: 1.0, emblem: 'boss', bob: 0.9 },
  archer: { shape: 'arrow', rMul: 1.15, emblem: 'quiver', bob: 0.7 },
  heavy: { shape: 'heater', rMul: 1.12, emblem: 'cross', bob: 0 },
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
  // heater：骑士盾，顶部圆弧、两肋内收、底部收尖
  g.moveTo(-r, -r * 0.5);
  g.quadraticCurveTo(-r, -r, 0, -r);
  g.quadraticCurveTo(r, -r, r, -r * 0.5);
  g.lineTo(r * 0.55, r * 0.35);
  g.lineTo(0, r * 1.1);
  g.lineTo(-r * 0.55, r * 0.35);
  g.closePath();
}

function drawEmblem(g: CanvasRenderingContext2D, kind: EmblemKind, vr: number, side: Side): void {
  g.fillStyle = SIDE_DARK[side];
  g.strokeStyle = SIDE_DARK[side];
  switch (kind) {
    case 'boss':
      // 盾心：上半圈盾缘弧线 + 中心一颗亮圆点
      g.lineWidth = Math.max(1.6, vr * 0.14);
      g.beginPath();
      g.arc(0, 0, Math.max(2.6, vr * 0.55), Math.PI, 0);
      g.stroke();
      g.fillStyle = 'rgba(255,250,235,0.85)';
      g.beginPath();
      g.arc(0, Math.max(0.6, vr * 0.08), Math.max(1.8, vr * 0.2), 0, Math.PI * 2);
      g.fill();
      break;
    case 'quiver':
      // 弦月（朝上）+ 中心竖直箭杆，读作箭囊；徽记不随朝向旋转
      g.lineWidth = Math.max(1.6, vr * 0.14);
      g.beginPath();
      g.arc(0, vr * 0.1, Math.max(2.6, vr * 0.5), Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      g.beginPath();
      g.moveTo(0, -vr * 0.32);
      g.lineTo(0, vr * 0.34);
      g.stroke();
      break;
    case 'cross': {
      // 十字：骑士盾上的竖条 + 横条
      const w = Math.max(1.6, vr * 0.16);
      g.fillRect(-w / 2, -vr * 0.45, w, vr * 0.9);
      g.fillRect(-vr * 0.35, -vr * 0.18 - w / 2, vr * 0.7, w);
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
  // 剪影内打光：左上高光 + 右下暗面，让平涂色块有了体积
  g.save();
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.34)';
  g.beginPath();
  g.ellipse(-vr * 0.34, -vr * 0.42, vr * 0.72, vr * 0.55, -0.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(2,6,16,0.22)';
  g.beginPath();
  g.ellipse(vr * 0.38, vr * 0.5, vr * 0.8, vr * 0.6, -0.6, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.strokeStyle = SIDE_DARK[side];
  g.lineWidth = 2;
  shapePath(g, def.shape, vr);
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
      // 城堡：主堡 + 双塔 + 雉堞 + 旗
      g.save();
      g.scale(pulse, pulse);
      g.fillStyle = SIDE_FILL[side];
      g.fillRect(-12, 2, 5, 10);
      g.fillRect(7, 2, 5, 10);
      g.fillRect(-6.5, -2, 13, 14);
      g.fillRect(-12, -1, 5, 3);
      g.fillRect(7, -1, 5, 3);
      g.fillRect(-6.5, -5, 3.2, 3);
      g.fillRect(-1.6, -5, 3.2, 3);
      g.fillRect(3.3, -5, 3.2, 3);
      g.strokeStyle = SIDE_DARK[side];
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(0, -5);
      g.lineTo(0, -14);
      g.stroke();
      g.fillStyle = SIDE_FILL[side];
      g.beginPath();
      g.moveTo(0, -14);
      g.lineTo(8, -11.5);
      g.lineTo(0, -9);
      g.closePath();
      g.fill();
      g.restore();
      break;
    }
    case 'mine': {
      // 金矿：X 井架 + 金块堆
      g.strokeStyle = '#6b4a2a';
      g.lineWidth = 2.6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-8, -8);
      g.lineTo(8, 8);
      g.moveTo(8, -8);
      g.lineTo(-8, 8);
      g.stroke();
      g.lineCap = 'butt';
      g.fillStyle = '#f0c24e';
      for (const [cx, cy, r] of [[-3, 6, 3], [3.5, 5.5, 2.6], [0, 2.5, 2.6]] as const) {
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ffe9a8';
      g.beginPath();
      g.arc(-4, 5, 1, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'barracks': {
      // 军营：三角帐篷 + 中柱
      g.fillStyle = SIDE_FILL[side];
      g.beginPath();
      g.moveTo(-11, 9);
      g.lineTo(0, -11);
      g.lineTo(11, 9);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(245,236,210,0.55)';
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(-8.5, 5);
      g.lineTo(-1.2, -7.6);
      g.stroke();
      g.strokeStyle = SIDE_DARK[side];
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(0, -11);
      g.lineTo(0, 9);
      g.stroke();
      break;
    }
    case 'tower': {
      // 箭塔：梯形塔身 + 雉堞
      g.fillStyle = SIDE_FILL[side];
      g.beginPath();
      g.moveTo(-6, 11);
      g.lineTo(-4, -3);
      g.lineTo(4, -3);
      g.lineTo(6, 11);
      g.closePath();
      g.fill();
      g.fillRect(-5.5, -7, 3, 4);
      g.fillRect(-1.5, -7, 3, 4);
      g.fillRect(2.5, -7, 3, 4);
      g.strokeStyle = SIDE_DARK[side];
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-4.6, 4);
      g.lineTo(4.6, 4);
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
