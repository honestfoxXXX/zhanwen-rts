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

type ShapeKind = 'circle' | 'arrow' | 'heater' | 'diamond' | 'cart';
type EmblemKind = 'boss' | 'quiver' | 'cross' | 'chevron' | 'pennon' | 'bolt' | 'crown';

interface UnitShape {
  shape: ShapeKind;
  rMul: number;      // 视觉半径倍率
  emblem: EmblemKind;
  bob: number;       // 步行摆动幅度；骑士为 0，强化"沉重"的体感差异
}

export const UNIT_SHAPES: Record<UnitType, UnitShape> = {
  infantry: { shape: 'circle', rMul: 1.05, emblem: 'boss', bob: 0.9 },
  archer: { shape: 'arrow', rMul: 1.2, emblem: 'quiver', bob: 0.7 },
  heavy: { shape: 'heater', rMul: 1.18, emblem: 'cross', bob: 0 },
  pikeman: { shape: 'circle', rMul: 1.0, emblem: 'chevron', bob: 0.8 },
  horsearcher: { shape: 'diamond', rMul: 1.15, emblem: 'quiver', bob: 0 },
  knight: { shape: 'diamond', rMul: 1.3, emblem: 'pennon', bob: 0 },
  catapult: { shape: 'cart', rMul: 1.35, emblem: 'bolt', bob: 0 },
  champion: { shape: 'heater', rMul: 1.35, emblem: 'crown', bob: 0 },
};

/**
 * 单位静态本体（面向 +x 的标准姿态，分层建模）：
 * 接触阴影 → 底环 → 身体分层（腿/躯干/甲/头/道具）→ 描边。
 * 供精灵缓存烘焙与 HUD 图标共用；徽记与盔羽由调用方另行不旋转叠加。
 */
export function drawUnitStatic(
  g: CanvasRenderingContext2D,
  type: UnitType,
  side: Side,
  r: number,
): void {
  const def = UNIT_SHAPES[type];
  const vr = r * def.rMul;
  const steel = '#dfe5ee', steelDark = '#3d434f', wood = '#6b4a2a', woodDark = '#4a3520';
  const body = SIDE_FILL[side], bodyDark = SIDE_DARK[side];

  // 接触阴影（随体型）
  const shW = vr * (type === 'knight' ? 1.15 : type === 'catapult' ? 1.2 : 0.9);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(0, vr * 0.72, shW, shW * 0.42, 0, 0, Math.PI * 2);
  g.fill();

  // 阵营底环：尺寸缩到 10px 量级时，阵营主要靠它辨认
  g.strokeStyle = SIDE_RING[side];
  g.lineWidth = 2;
  g.globalAlpha = 0.6;
  g.beginPath();
  g.arc(0, 0, vr + 2.6, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;

  const shade = (x: number, y: number, rx: number, ry: number, fill: string, rot = 0): void => {
    g.fillStyle = fill;
    g.beginPath();
    g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    g.fill();
  };

  if (type === 'infantry') {
    // 躯干 + 钢盔
    shade(-vr * 0.1, 0, vr * 0.62, vr * 0.55, bodyDark);
    shade(-vr * 0.2, -vr * 0.08, vr * 0.4, vr * 0.34, body);
    shade(vr * 0.18, -vr * 0.34, vr * 0.3, vr * 0.3, steel);
    g.strokeStyle = steelDark;
    g.lineWidth = 1.1;
    g.beginPath();
    g.arc(vr * 0.18, -vr * 0.34, vr * 0.3, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.arc(vr * 0.1, -vr * 0.44, vr * 0.09, 0, Math.PI * 2);
    g.fill();
    // 剑（微弧刃）+ 护手 + 柄
    g.strokeStyle = steelDark;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(vr * 0.45, -vr * 0.05);
    g.quadraticCurveTo(vr * 1.0, -vr * 0.16, vr * 1.5, -vr * 0.1);
    g.stroke();
    g.strokeStyle = steel;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(vr * 0.5, -vr * 0.06);
    g.quadraticCurveTo(vr * 1.0, -vr * 0.17, vr * 1.44, -vr * 0.11);
    g.stroke();
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(vr * 0.58, -vr * 0.28);
    g.lineTo(vr * 0.58, vr * 0.16);
    g.stroke();
    // 圆盾：木底 + 双圈缘 + 铆钉 + 亮盾心
    shade(0, vr * 0.6, vr * 0.44, vr * 0.44, '#8a6f42');
    g.strokeStyle = woodDark;
    g.lineWidth = 1.3;
    g.beginPath();
    g.arc(0, vr * 0.6, vr * 0.44, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 0.8;
    g.beginPath();
    g.arc(0, vr * 0.6, vr * 0.3, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(240,228,190,0.8)';
    for (const [dx, dy] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) {
      g.beginPath();
      g.arc(dx * vr, vr * 0.6 + dy * vr, vr * 0.05, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(255,244,220,0.9)';
    g.beginPath();
    g.arc(0, vr * 0.6, vr * 0.13, 0, Math.PI * 2);
    g.fill();
  } else if (type === 'archer') {
    // 兜帽（尖顶）+ 躯干
    shade(-vr * 0.1, 0, vr * 0.6, vr * 0.52, bodyDark);
    shade(-vr * 0.2, -vr * 0.06, vr * 0.38, vr * 0.32, body);
    g.fillStyle = bodyDark;
    g.beginPath();
    g.moveTo(vr * 0.02, -vr * 0.28);
    g.lineTo(vr * 0.3, -vr * 0.72);
    g.lineTo(vr * 0.44, -vr * 0.2);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath();
    g.arc(vr * 0.26, -vr * 0.3, vr * 0.16, 0, Math.PI * 2);
    g.fill();
    // 弓：双曲臂 + 握把 + 弦
    g.strokeStyle = wood;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(vr * 0.62, -vr * 0.92);
    g.quadraticCurveTo(vr * 1.06, -vr * 0.3, vr * 0.98, 0);
    g.quadraticCurveTo(vr * 1.06, vr * 0.3, vr * 0.62, vr * 0.92);
    g.stroke();
    g.strokeStyle = woodDark;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(vr * 0.86, -vr * 0.14);
    g.lineTo(vr * 0.86, vr * 0.14);
    g.stroke();
    g.strokeStyle = 'rgba(244,234,214,0.85)';
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(vr * 0.62, -vr * 0.92);
    g.lineTo(vr * 0.62, vr * 0.92);
    g.stroke();
    // 搭箭：杆 + 箭羽
    g.strokeStyle = steel;
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(vr * 0.2, 0);
    g.lineTo(vr * 1.18, 0);
    g.stroke();
    g.strokeStyle = 'rgba(244,234,214,0.9)';
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(vr * 0.24, 0);
    g.lineTo(vr * 0.12, -vr * 0.14);
    g.moveTo(vr * 0.24, 0);
    g.lineTo(vr * 0.12, vr * 0.14);
    g.stroke();
  } else if (type === 'heavy') {
    // 躯干 + 肩甲双弧
    shade(-vr * 0.08, vr * 0.02, vr * 0.6, vr * 0.55, bodyDark);
    shade(-vr * 0.2, -vr * 0.06, vr * 0.42, vr * 0.38, body);
    g.strokeStyle = steel;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(-vr * 0.05, -vr * 0.3, vr * 0.34, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
    g.strokeStyle = steelDark;
    g.lineWidth = 0.9;
    g.beginPath();
    g.arc(-vr * 0.05, -vr * 0.3, vr * 0.42, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
    // 塔盾（前侧大矩形）：木底 + 边框 + 3 横纹 + 4 铆钉
    const sx = vr * 0.62, sy = -vr * 0.05;
    g.fillStyle = '#8a6f42';
    g.fillRect(sx - vr * 0.16, sy - vr * 0.52, vr * 0.34, vr * 1.1);
    g.strokeStyle = woodDark;
    g.lineWidth = 1.4;
    g.strokeRect(sx - vr * 0.16, sy - vr * 0.52, vr * 0.34, vr * 1.1);
    g.lineWidth = 0.9;
    for (let i = 1; i < 3; i++) {
      g.beginPath();
      g.moveTo(sx - vr * 0.14, sy - vr * 0.52 + (vr * 1.1 * i) / 3);
      g.lineTo(sx + vr * 0.16, sy - vr * 0.52 + (vr * 1.1 * i) / 3);
      g.stroke();
    }
    g.fillStyle = 'rgba(240,228,190,0.85)';
    for (const dy of [-0.38, 0.38]) {
      for (const dx of [-0.07, 0.07]) {
        g.beginPath();
        g.arc(sx + dx * vr, sy + dy * vr, vr * 0.045, 0, Math.PI * 2);
        g.fill();
      }
    }
    // 战锤：长柄 + 方锤头 + 柄箍
    g.strokeStyle = wood;
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(vr * 0.1, vr * 0.28);
    g.lineTo(vr * 1.05, -vr * 0.42);
    g.stroke();
    metalBlock(g, vr * 0.95, -vr * 0.62, vr * 0.42, vr * 0.3);
    g.strokeStyle = woodDark;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(vr * 0.36, vr * 0.02);
    g.lineTo(vr * 0.5, -vr * 0.1);
    g.stroke();
  } else if (type === 'pikeman') {
    // 轻甲躯干 + 胸甲线
    shade(-vr * 0.1, 0, vr * 0.58, vr * 0.52, bodyDark);
    shade(-vr * 0.18, -vr * 0.06, vr * 0.38, vr * 0.34, body);
    g.strokeStyle = steel;
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(-vr * 0.15, -vr * 0.1, vr * 0.34, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
    // 头盔
    shade(vr * 0.16, -vr * 0.32, vr * 0.26, vr * 0.26, steel);
    g.strokeStyle = steelDark;
    g.lineWidth = 0.9;
    g.beginPath();
    g.arc(vr * 0.16, -vr * 0.32, vr * 0.26, Math.PI, Math.PI * 2);
    g.stroke();
    // 长枪：长杆 2.2× + 钢尖 + 束带
    g.strokeStyle = wood;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-vr * 0.3, vr * 0.14);
    g.lineTo(vr * 1.85, -vr * 0.1);
    g.stroke();
    g.fillStyle = steel;
    g.beginPath();
    g.moveTo(vr * 1.78, -vr * 0.26);
    g.lineTo(vr * 2.2, -vr * 0.13);
    g.lineTo(vr * 1.76, vr * 0.02);
    g.closePath();
    g.fill();
    g.strokeStyle = steelDark;
    g.lineWidth = 0.9;
    g.stroke();
    g.strokeStyle = woodDark;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(vr * 0.7, -vr * 0.06);
    g.lineTo(vr * 0.62, vr * 0.16);
    g.stroke();
    // 小圆盾
    shade(-vr * 0.08, vr * 0.52, vr * 0.32, vr * 0.32, '#8a6f42');
    g.strokeStyle = woodDark;
    g.lineWidth = 1.1;
    g.beginPath();
    g.arc(-vr * 0.08, vr * 0.52, vr * 0.32, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(255,244,220,0.85)';
    g.beginPath();
    g.arc(-vr * 0.08, vr * 0.52, vr * 0.1, 0, Math.PI * 2);
    g.fill();
  } else if (type === 'knight') {
    // 马身（沿 +x 大椭圆）+ 马披（阵营亮带）
    shade(vr * 0.05, vr * 0.05, vr * 0.78, vr * 0.42, bodyDark);
    shade(vr * 0.0, -vr * 0.04, vr * 0.66, vr * 0.32, body);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.ellipse(-vr * 0.1, -vr * 0.14, vr * 0.42, vr * 0.14, -0.08, 0, Math.PI * 2);
    g.fill();
    // 马头（前伸）+ 双耳
    shade(vr * 0.72, -vr * 0.3, vr * 0.26, vr * 0.18, bodyDark, -0.35);
    g.fillStyle = bodyDark;
    g.beginPath();
    g.moveTo(vr * 0.6, -vr * 0.4);
    g.lineTo(vr * 0.64, -vr * 0.58);
    g.lineTo(vr * 0.74, -vr * 0.4);
    g.closePath();
    g.fill();
    // 马腿（前后各二）
    g.strokeStyle = bodyDark;
    g.lineWidth = 2;
    g.beginPath();
    for (const lx of [vr * 0.4, vr * 0.62, -vr * 0.3, -vr * 0.08]) {
      g.moveTo(lx, vr * 0.3);
      g.lineTo(lx + vr * 0.06, vr * 0.6);
    }
    g.stroke();
    // 马尾
    g.strokeStyle = bodyDark;
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(-vr * 0.72, -vr * 0.1);
    g.quadraticCurveTo(-vr * 1.0, vr * 0.05, -vr * 0.92, vr * 0.35);
    g.stroke();
    // 骑手 + 钢盔 + 长枪前指
    shade(-vr * 0.08, -vr * 0.42, vr * 0.24, vr * 0.24, bodyDark);
    shade(vr * 0.02, -vr * 0.5, vr * 0.17, vr * 0.17, steel);
    g.strokeStyle = wood;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-vr * 0.2, -vr * 0.3);
    g.lineTo(vr * 1.35, -vr * 0.44);
    g.stroke();
    g.fillStyle = steel;
    g.beginPath();
    g.moveTo(vr * 1.3, -vr * 0.6);
    g.lineTo(vr * 1.7, -vr * 0.46);
    g.lineTo(vr * 1.28, -vr * 0.32);
    g.closePath();
    g.fill();
    g.strokeStyle = steelDark;
    g.lineWidth = 0.8;
    g.stroke();
  } else if (type === 'catapult') {
    // 车架（木框 + 斜撑）
    woodFrame(g, -vr * 0.8, -vr * 0.35, vr * 1.7, vr * 0.85);
    // 两轮（辐条）
    for (const wx of [-vr * 0.45, vr * 0.55]) {
      g.fillStyle = woodDark;
      g.beginPath();
      g.arc(wx, vr * 0.52, vr * 0.3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#8a6f42';
      g.lineWidth = 1.1;
      g.beginPath();
      g.arc(wx, vr * 0.52, vr * 0.2, 0, Math.PI * 2);
      g.stroke();
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        g.beginPath();
        g.moveTo(wx + Math.cos(a) * vr * 0.06, vr * 0.52 + Math.sin(a) * vr * 0.06);
        g.lineTo(wx + Math.cos(a) * vr * 0.26, vr * 0.52 + Math.sin(a) * vr * 0.26);
        g.stroke();
      }
    }
    // 投臂（斜向上）+ 末端勺兜 + 配重箱
    g.strokeStyle = wood;
    g.lineWidth = 2.8;
    g.beginPath();
    g.moveTo(-vr * 0.35, vr * 0.1);
    g.lineTo(vr * 0.75, -vr * 0.85);
    g.stroke();
    g.fillStyle = woodDark;
    g.beginPath();
    g.arc(vr * 0.82, -vr * 0.92, vr * 0.15, 0, Math.PI * 2);
    g.fill();
    woodFrame(g, -vr * 0.62, -vr * 0.1, vr * 0.42, vr * 0.4);
    // 石弹
    g.fillStyle = '#8d877a';
    g.beginPath();
    g.arc(vr * 0.3, -vr * 0.05, vr * 0.13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.arc(vr * 0.26, -vr * 0.09, vr * 0.05, 0, Math.PI * 2);
    g.fill();
  } else {
    // champion：大躯干 + 胸甲高光 + 肩甲双弧 + 大盾 + 仪仗剑 + 披风
    // 披风（身后飘带）
    g.fillStyle = bodyDark;
    g.beginPath();
    g.moveTo(-vr * 0.3, -vr * 0.3);
    g.quadraticCurveTo(-vr * 1.05, vr * 0.05, -vr * 0.75, vr * 0.62);
    g.quadraticCurveTo(-vr * 0.4, vr * 0.45, -vr * 0.2, vr * 0.1);
    g.closePath();
    g.fill();
    // 躯干 + 胸甲高光
    shade(-vr * 0.05, vr * 0.05, vr * 0.58, vr * 0.55, bodyDark);
    shade(-vr * 0.15, -vr * 0.05, vr * 0.42, vr * 0.4, body);
    g.strokeStyle = 'rgba(255,240,200,0.5)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-vr * 0.3, -vr * 0.15);
    g.lineTo(-vr * 0.05, -vr * 0.2);
    g.stroke();
    // 肩甲双弧
    g.strokeStyle = steel;
    g.lineWidth = 2.2;
    g.beginPath();
    g.arc(-vr * 0.02, -vr * 0.34, vr * 0.36, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
    g.strokeStyle = steelDark;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(-vr * 0.02, -vr * 0.34, vr * 0.44, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
    // 头盔 + 金冠顶（呼应 crown 徽记）
    shade(vr * 0.2, -vr * 0.4, vr * 0.28, vr * 0.28, steel);
    g.strokeStyle = 'rgba(255,232,160,0.95)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(vr * 0.05, -vr * 0.55);
    g.lineTo(vr * 0.2, -vr * 0.78);
    g.lineTo(vr * 0.35, -vr * 0.55);
    g.stroke();
    // 大盾（正面 heater）+ 十字纹 + 边框
    const sx = vr * 0.68, sy = vr * 0.02;
    g.fillStyle = '#8a6f42';
    g.beginPath();
    g.moveTo(sx - vr * 0.22, sy - vr * 0.42);
    g.lineTo(sx + vr * 0.22, sy - vr * 0.42);
    g.lineTo(sx + vr * 0.22, sy + vr * 0.12);
    g.lineTo(sx, sy + vr * 0.52);
    g.lineTo(sx - vr * 0.22, sy + vr * 0.12);
    g.closePath();
    g.fill();
    g.strokeStyle = woodDark;
    g.lineWidth = 1.4;
    g.stroke();
    g.strokeStyle = 'rgba(240,228,190,0.85)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(sx, sy - vr * 0.36);
    g.lineTo(sx, sy + vr * 0.4);
    g.moveTo(sx - vr * 0.16, sy - vr * 0.12);
    g.lineTo(sx + vr * 0.16, sy - vr * 0.12);
    g.stroke();
    // 仪仗剑：前指长剑 + 金柄
    g.strokeStyle = steelDark;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(vr * 0.35, -vr * 0.5);
    g.lineTo(vr * 1.35, -vr * 0.62);
    g.stroke();
    g.strokeStyle = steel;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(vr * 0.4, -vr * 0.51);
    g.lineTo(vr * 1.3, -vr * 0.62);
    g.stroke();
    g.fillStyle = '#f0c24e';
    g.fillRect(vr * 0.26, -vr * 0.66, vr * 0.12, vr * 0.3);
  }
}

/** 金属块（小件）：底色 + 顶高光 + 底暗 */
function metalBlock(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): void {
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#f0f4fa');
  grad.addColorStop(0.5, '#c8d0dc');
  grad.addColorStop(1, '#7c8494');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.strokeStyle = steelDarkOf(g);
  g.lineWidth = 0.9;
  g.strokeRect(x, y, w, h);
}

function steelDarkOf(_g: CanvasRenderingContext2D): string {
  return '#3d434f';
}

/** 木框（矩形框 + 斜撑） */
function woodFrame(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): void {
  g.fillStyle = '#7a5530';
  g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(40,28,14,0.7)';
  g.lineWidth = 1.2;
  g.strokeRect(x, y, w, h);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y + h);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(x, y, w, 1.2);
}

/** 单位本体（战场/HUD 通用入口）：道具随朝向旋转，徽记与盔羽不旋转 */
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
  g.save();
  g.translate(0, bob);
  g.save();
  g.rotate(facing);
  drawUnitStatic(g, type, side, r);
  g.restore();
  // 徽记不随朝向旋转 —— 这是剪影能否稳定辨认的关键
  drawEmblem(g, def.emblem, vr, side);
  // 重装盔羽：竖直，不随朝向旋转
  if (type === 'heavy') {
    g.strokeStyle = SIDE_DARK[side];
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -vr * 0.95);
    g.quadraticCurveTo(vr * 0.22, -vr * 1.35, 0, -vr * 1.65);
    g.stroke();
  }
  g.restore();
}

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
  if (kind === 'diamond') {
    // 骑乘剪影：纵向拉长菱形（骑手 + 马身）
    g.moveTo(0, -r * 1.15);
    g.lineTo(r * 0.55, -r * 0.2);
    g.lineTo(r * 0.42, r * 0.85);
    g.lineTo(-r * 0.42, r * 0.85);
    g.lineTo(-r * 0.55, -r * 0.2);
    g.closePath();
    return;
  }
  if (kind === 'cart') {
    // 车体：宽方框（投石车底盘）
    g.moveTo(-r * 0.85, -r * 0.6);
    g.lineTo(r * 0.85, -r * 0.6);
    g.lineTo(r * 0.95, r * 0.55);
    g.lineTo(-r * 0.95, r * 0.55);
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
    case 'chevron':
      // 长枪兵：向上的 V 形枪阵
      g.lineWidth = Math.max(1.4, vr * 0.16);
      g.beginPath();
      g.moveTo(-vr * 0.34, -vr * 0.05);
      g.lineTo(0, vr * 0.3);
      g.lineTo(vr * 0.34, -vr * 0.05);
      g.stroke();
      break;
    case 'pennon':
      // 骑士：小三角旗（挂在心位）
      g.fillStyle = 'rgba(255,244,220,0.9)';
      g.beginPath();
      g.moveTo(-vr * 0.16, -vr * 0.32);
      g.lineTo(vr * 0.3, -vr * 0.18);
      g.lineTo(-vr * 0.16, -vr * 0.02);
      g.closePath();
      g.fill();
      g.strokeStyle = SIDE_DARK[side];
      g.lineWidth = 1;
      g.stroke();
      break;
    case 'bolt':
      // 投石车：粗螺栓头
      g.fillStyle = 'rgba(255,244,220,0.9)';
      g.beginPath();
      g.arc(0, -vr * 0.08, Math.max(1.6, vr * 0.18), 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = SIDE_DARK[side];
      g.lineWidth = 1.2;
      g.stroke();
      break;
    case 'crown':
      // 近卫军：三尖金冠
      g.strokeStyle = 'rgba(255,232,160,0.95)';
      g.lineWidth = Math.max(1.2, vr * 0.12);
      g.beginPath();
      g.moveTo(-vr * 0.32, vr * 0.02);
      g.lineTo(-vr * 0.32, -vr * 0.3);
      g.moveTo(0, vr * 0.02);
      g.lineTo(0, -vr * 0.38);
      g.moveTo(vr * 0.32, vr * 0.02);
      g.lineTo(vr * 0.32, -vr * 0.3);
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

/** 单位徽记 + 盔羽（不随朝向旋转；战场精灵缓存与 HUD 通用） */
export function drawUnitDecals(
  g: CanvasRenderingContext2D,
  type: UnitType,
  side: Side,
  r: number,
): void {
  const vr = r * UNIT_SHAPES[type].rMul;
  drawEmblem(g, UNIT_SHAPES[type].emblem, vr, side);
  if (type === 'heavy') {
    g.strokeStyle = SIDE_DARK[side];
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -vr * 0.95);
    g.quadraticCurveTo(vr * 0.22, -vr * 1.35, 0, -vr * 1.65);
    g.stroke();
  }
}

export interface UnitDrawOpts {
  moving?: boolean;
  t?: number;      // 世界时间，驱动步行摆动
  phase?: number;  // 每单位相位，避免整队同步摆动
}

export interface UnitDrawOpts {
  moving?: boolean;
  t?: number;      // 世界时间，驱动步行摆动
  phase?: number;  // 每单位相位，避免整队同步摆动
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
      // 城堡：双塔 + 主堡 + 雉堞 + 旗
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
      g.fillStyle = 'rgba(20,14,8,0.7)';
      g.fillRect(-1.6, 7, 3.2, 5);
      g.strokeStyle = 'rgba(20,14,8,0.35)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(-6, 5);
      g.lineTo(6, 5);
      g.stroke();
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
      // 金矿：坑口 + 轨道矿车 + 金块
      g.fillStyle = '#7d7566';
      g.beginPath();
      g.ellipse(0, 5, 9.5, 4.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#221a0e';
      g.beginPath();
      g.ellipse(0, 3.5, 4, 2.6, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#6b4a2a';
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-6.5, 8);
      g.lineTo(-2.5, -5);
      g.moveTo(6.5, 8);
      g.lineTo(2.5, -5);
      g.stroke();
      g.lineCap = 'butt';
      g.fillStyle = '#f0c24e';
      for (const [cx, cy, r] of [[-3, 8, 2.6], [3.5, 7.5, 2.2], [0, 4.5, 2.2]] as const) {
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ffe9a8';
      g.beginPath();
      g.arc(-3.6, 7.2, 0.8, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'barracks': {
      // 军营：帐篷 + 门帘 + 旗
      g.fillStyle = SIDE_FILL[side];
      g.beginPath();
      g.moveTo(-11, 9);
      g.lineTo(0, -11);
      g.lineTo(11, 9);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath();
      g.moveTo(0, -11);
      g.lineTo(11, 9);
      g.lineTo(2.5, 9);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(20,14,8,0.6)';
      g.beginPath();
      g.moveTo(0, -2);
      g.lineTo(-3, 9);
      g.lineTo(3, 9);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(245,236,210,0.55)';
      g.lineWidth = 1.6;
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
      // 箭塔：塔身 + 雉堞 + 箭窗
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
      g.fillStyle = 'rgba(20,14,8,0.5)';
      g.fillRect(-0.8, 1, 1.6, 4);
      break;
    }
    case 'smithy': {
      // 军械库：矮房 + 烟囱 + 炉口火光 + 铁砧
      g.fillStyle = SIDE_FILL[side];
      g.fillRect(-11, -3, 22, 13);
      g.fillStyle = SIDE_DARK[side];
      g.fillRect(4, -11, 6, 8);
      g.fillStyle = 'rgba(20,14,8,0.85)';
      g.beginPath();
      g.moveTo(-5, 10);
      g.lineTo(-5, 1);
      g.arc(-1, 1, 4, Math.PI, 0);
      g.lineTo(3, 10);
      g.closePath();
      g.fill();
      const fire = g.createRadialGradient(-1, 8, 0.5, -1, 8, 4);
      fire.addColorStop(0, 'rgba(255,190,70,0.95)');
      fire.addColorStop(1, 'rgba(200,70,15,0.6)');
      g.fillStyle = fire;
      g.beginPath();
      g.moveTo(-3.4, 10);
      g.lineTo(-3.4, 3);
      g.arc(-1, 3, 2.4, Math.PI, 0);
      g.lineTo(1.4, 10);
      g.closePath();
      g.fill();
      g.fillStyle = '#c8d0dc';
      g.fillRect(-11, 4, 5, 1.6);
      g.fillRect(-8, 5.6, 2, 4.4);
      g.strokeStyle = SIDE_DARK[side];
      g.lineWidth = 1;
      g.strokeRect(-11, -3, 22, 13);
      break;
    }
    case 'workshop': {
      // 攻城工坊：棚顶 + 木柱 + 投臂 + 轮
      g.fillStyle = SIDE_FILL[side];
      g.beginPath();
      g.moveTo(-13, -6);
      g.lineTo(13, -6);
      g.lineTo(9, -12);
      g.lineTo(-9, -12);
      g.closePath();
      g.fill();
      g.fillStyle = SIDE_DARK[side];
      g.fillRect(-11.5, -6, 2.4, 16);
      g.fillRect(9, -6, 2.4, 16);
      g.fillRect(-1, -6, 2.2, 16);
      g.strokeStyle = '#6b4a2a';
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(-4, 6);
      g.lineTo(7, -9);
      g.stroke();
      g.fillStyle = '#4a3520';
      g.beginPath();
      g.arc(7.8, -10, 2.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#4a3520';
      g.beginPath();
      g.arc(-7, 7, 3.4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#8a6f42';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(-7, 7, 2, 0, Math.PI * 2);
      g.stroke();
      break;
    }
  }
  g.restore();
}

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
