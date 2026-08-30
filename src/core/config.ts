import type { Difficulty, Vec, BuildingType, UnitType } from './types';

export const TILE = 40;
export const COLS = 18;
export const ROWS = 48;
export const MAP_W = COLS * TILE; // 720
export const MAP_H = ROWS * TILE; // 1920
export const BUILD_LINE = MAP_H / 2; // 960 前线
export const POP_CAP = 40;
export const START_CRYSTAL = 150;

/**
 * 克制三角：弓手 › 重装 › 步兵 › 弓手
 *   弓手(1.6x) 打重装：远程风筝慢速重甲
 *   重装(1.5x) 打步兵：厚甲高伤碾压轻甲近战
 *   步兵(1.5x) 打弓手：便宜快速贴脸切后排
 * 只影响单位互打，打建筑一律按基础伤害。
 */
export const UNIT_DEFS: Record<UnitType, import('./types').UnitDef> = {
  infantry: { name: '步兵', cost: 50, pop: 1, trainTime: 3.2, hp: 75, speed: 60, radius: 9, range: 12, aggro: 130, damage: 7, cooldown: 0.7, projectileSpeed: 0, dmgBonus: { archer: 1.5 } },
  archer: { name: '弓手', cost: 80, pop: 1, trainTime: 4.2, hp: 45, speed: 64, radius: 9, range: 125, aggro: 155, damage: 9, cooldown: 1.0, projectileSpeed: 300, dmgBonus: { heavy: 1.6 } },
  heavy: { name: '重装', cost: 200, pop: 3, trainTime: 7.5, hp: 300, speed: 44, radius: 13, range: 14, aggro: 130, damage: 18, cooldown: 1.3, projectileSpeed: 0, dmgBonus: { infantry: 1.5 } },
};

export const BUILDING_DEFS: Record<BuildingType, import('./types').BuildingDef> = {
  hq: { name: '主基地', cost: 0, hp: 1400, buildTime: 0, half: 40, income: 5, weapon: { range: 150, damage: 9, cooldown: 1.2, projectileSpeed: 260 } },
  mine: { name: '矿场', cost: 100, hp: 220, buildTime: 5, half: 40, income: 5, weapon: null },
  barracks: { name: '兵营', cost: 150, hp: 450, buildTime: 8, half: 40, income: 0, weapon: null },
  tower: { name: '箭塔', cost: 120, hp: 340, buildTime: 6, half: 40, income: 0, weapon: { range: 175, damage: 13, cooldown: 1.0, projectileSpeed: 320 } },
};

/** 水晶矿点（世界坐标，关于 (360,960) 中心对称），共 10 座 */
export const NODES: Vec[] = [
  // 玩家侧
  { x: 80, y: 1560 }, { x: 640, y: 1560 }, { x: 280, y: 1400 },
  // 敌方侧（镜像）
  { x: 640, y: 360 }, { x: 80, y: 360 }, { x: 440, y: 520 },
  // 中路侧翼争夺点
  { x: 80, y: 960 }, { x: 640, y: 960 },
  // 中路心脏争夺点
  { x: 280, y: 840 }, { x: 440, y: 1080 },
];

/** 岩石障碍（tile 坐标）：中央关口 + 两侧墙体 */
export const ROCK_TILES: [number, number][] = [
  [8, 23], [9, 23], [8, 24], [9, 24],       // 中央关口
  [5, 22], [5, 23], [5, 24],                 // 左墙
  [12, 23], [12, 24], [12, 25],              // 右墙
  [3, 26], [14, 21],                         // 碎石点缀
];

/** 双方主基地位置（避开底部/顶部 HUD 遮挡区） */
export const HQ_POS: Vec[] = [
  { x: 360, y: 1640 }, // 玩家
  { x: 360, y: 280 },  // 敌方
];

export const DIFFICULTY: Record<Difficulty, {
  label: string;
  incomeMult: number;
  maxMines: number;
  maxBarracks: number;
  maxTowers: number;
  wavePop: number;
  waveCd: number;
  retreat: boolean;
  weights: Record<UnitType, number>;
  think: number;
}> = {
  // 数值经 scripts/balance.ts 无头跑批校准，目标胜率：简单 ~90% / 普通 ~50% / 困难 ~20%
  easy: {
    label: '简单', incomeMult: 0.6, maxMines: 3, maxBarracks: 1, maxTowers: 0,
    wavePop: 16, waveCd: 55, retreat: false,
    weights: { infantry: 0.7, archer: 0.3, heavy: 0 }, think: 0.6,
  },
  normal: {
    label: '普通', incomeMult: 0.95, maxMines: 5, maxBarracks: 2, maxTowers: 1,
    wavePop: 22, waveCd: 38, retreat: true,
    weights: { infantry: 0.55, archer: 0.3, heavy: 0.15 }, think: 0.55,
  },
  hard: {
    // 注意：困难档对参数极度敏感，incomeMult 由 0.95 提到 1.0 会让玩家胜率从 50% 直接归零
    label: '困难', incomeMult: 0.95, maxMines: 6, maxBarracks: 3, maxTowers: 2,
    wavePop: 24, waveCd: 42, retreat: true,
    weights: { infantry: 0.45, archer: 0.3, heavy: 0.25 }, think: 0.5,
  },
};
