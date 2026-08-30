import type { Difficulty, Vec, BuildingType, UnitType } from './types';

export const TILE = 40;
export const COLS = 18;
export const ROWS = 48;
export const MAP_W = COLS * TILE; // 720
export const MAP_H = ROWS * TILE; // 1920
export const BUILD_LINE = MAP_H / 2; // 960 前线
export const POP_CAP = 50;
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
  hq: { name: '城堡', cost: 0, hp: 2800, buildTime: 0, half: 40, income: 4, weapon: { range: 150, damage: 9, cooldown: 1.2, projectileSpeed: 260 } },
  mine: { name: '金矿', cost: 100, hp: 320, buildTime: 5, half: 40, income: 4, weapon: null },
  barracks: { name: '军营', cost: 150, hp: 650, buildTime: 8, half: 40, income: 0, weapon: null },
  tower: { name: '箭塔', cost: 120, hp: 520, buildTime: 6, half: 40, income: 0, weapon: { range: 175, damage: 13, cooldown: 1.0, projectileSpeed: 320 } },
};

/** 一方的出生点：主基地位置 + 可建造区域（tile 坐标，含边界） */
export interface SpawnDef {
  pos: Vec;
  build: { x0: number; x1: number; y0: number; y1: number };
}

export interface MapDef {
  id: string;
  name: string;
  /** 一句话说明这张图的战术侧重，开局提示会给玩家看 */
  brief: string;
  /** 参战方数，由出生点数量决定 */
  players: number;
  /** 岩石障碍（tile 坐标） */
  rocks: [number, number][];
  /** 水晶矿点（世界坐标）。布局必须满足对应人数下的对称性约束 */
  nodes: Vec[];
  spawns: SpawnDef[];
}

/**
 * 双方：上下对峙，可建造区以中线 y=960 为界。
 * 边界值对齐"建筑占 cy-1..cy 两行"的占位规则，双方刚好各自贴住中线。
 */
const SPAWNS_2P: SpawnDef[] = [
  { pos: { x: 360, y: 1640 }, build: { x0: 1, x1: 16, y0: 25, y1: 46 } },
  { pos: { x: 360, y: 280 }, build: { x0: 1, x1: 16, y0: 1, y1: 23 } },
];

/**
 * 三方：三方主基地构成等边三角形（边长 560，质心 (360,880)），
 * 任意两方主基地间距完全相等 —— 公平性由几何保证，不靠"谁跟谁挨得近"。
 * 玩家在下方顶点（竖屏默认镜头看得到自己的家），两个 AI 在上方两角。
 * 可建造区为三个等面积（6×8 格）矩形：各自包住己方出生点、互不重叠，
 * 且朝质心一端的探出距离相等（都到距质心 80px 处）。
 */
const SPAWNS_3P: SpawnDef[] = [
  { pos: { x: 360, y: 1203 }, build: { x0: 6, x1: 11, y0: 24, y1: 31 } },
  { pos: { x: 80, y: 718 }, build: { x0: 1, x1: 6, y0: 14, y1: 21 } },
  { pos: { x: 640, y: 718 }, build: { x0: 11, x1: 16, y0: 14, y1: 21 } },
];

/**
 * 三方图共用矿点：绕三角形质心 (360,880) 精确 120° 旋转对称 ——
 * 三方到每一个矿点的距离完全一致，矿权没有先天偏向。
 * 布局：质心 1 个必争点 + 每方一组（轴向 1 个 + 两翼各 1 个），共 10 个。
 */
const NODES_3P: Vec[] = [
  { x: 360, y: 880 },                                              // 质心：三方等距的必争之地
  { x: 360, y: 1050 }, { x: 219, y: 1145 }, { x: 501, y: 1145 },   // 玩家组
  { x: 213, y: 795 }, { x: 201, y: 625 }, { x: 60, y: 870 },       // 左 AI 组
  { x: 507, y: 795 }, { x: 660, y: 870 }, { x: 519, y: 625 },      // 右 AI 组
];

/**
 * 三方图岩石：给一个扇区的基组，绕质心 (360,880) 旋转 120°/240° 生成另外两份。
 * 方格无法精确 120° 旋转（会落到半格上），四舍五入到最近格 —— 对称是近似的（±1 格），
 * 测试按容差校验。质心处不放岩石，把必争矿点露出来。
 */
function rot3Rocks(base: [number, number][]): [number, number][] {
  const cx = 360, cy = 880;
  const seen = new Map<string, [number, number]>();
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3;
    const cos = Math.cos(a), sin = Math.sin(a);
    for (const [tx, ty] of base) {
      const wx = (tx + 0.5) * TILE - cx, wy = (ty + 0.5) * TILE - cy;
      const nx = Math.round((cx + wx * cos - wy * sin) / TILE - 0.5);
      const ny = Math.round((cy + wx * sin + wy * cos) / TILE - 0.5);
      if (nx >= 1 && nx < COLS - 1 && ny >= 1 && ny < ROWS - 1) seen.set(`${nx}:${ny}`, [nx, ny]);
    }
  }
  return [...seen.values()];
}

/** 支持的参战人数 */
export const PLAYER_COUNTS = [2, 3];

export const MAPS: MapDef[] = [
  {
    id: 'gate',
    name: '中央关口',
    brief: '中路一道关口，两侧可绕行 —— 控制关口就控制节奏',
    players: 2,
    spawns: SPAWNS_2P,
    rocks: [
      [8, 23], [9, 23], [8, 24], [9, 24],       // 中央关口
      [5, 22], [5, 23], [5, 24],                 // 左墙
      [12, 23], [12, 24], [12, 25],              // 右墙
      [3, 26], [14, 21],                         // 碎石点缀
    ],
    nodes: [
      { x: 80, y: 1560 }, { x: 640, y: 1560 }, { x: 280, y: 1400 },
      { x: 640, y: 360 }, { x: 80, y: 360 }, { x: 440, y: 520 },
      { x: 80, y: 960 }, { x: 640, y: 960 },
      { x: 280, y: 840 }, { x: 440, y: 1080 },
    ],
  },
  {
    id: 'lanes',
    name: '双通道',
    brief: '中央被彻底封死，只能左右分兵 —— 别把部队全压在一边',
    players: 2,
    spawns: SPAWNS_2P,
    rocks: [
      [8, 20], [9, 20], [8, 21], [9, 21], [8, 22], [9, 22],
      [8, 23], [9, 23], [8, 24], [9, 24], [8, 25], [9, 25],
      [8, 26], [9, 26], [8, 27], [9, 27],                     // 中央贯穿竖墙
      [4, 24], [13, 23],                                       // 通道里的障碍
    ],
    nodes: [
      { x: 120, y: 1520 }, { x: 600, y: 1520 }, { x: 360, y: 1360 },
      { x: 600, y: 400 }, { x: 120, y: 400 }, { x: 360, y: 560 },
      { x: 120, y: 960 }, { x: 600, y: 960 },
      { x: 200, y: 860 }, { x: 520, y: 1060 },
    ],
  },
  {
    id: 'open',
    name: '开阔地',
    brief: '几乎没有掩体，机动与包抄决定胜负 —— 小心被绕后',
    players: 2,
    spawns: SPAWNS_2P,
    rocks: [
      [6, 23], [11, 25], [3, 24], [14, 22],   // 零散掩体，不构成封锁
    ],
    nodes: [
      { x: 80, y: 1560 }, { x: 640, y: 1560 }, { x: 360, y: 1420 },
      { x: 640, y: 360 }, { x: 80, y: 360 }, { x: 360, y: 500 },
      // 中路矿点放在边角：试过内移到 (200,960)/(520,960)，结果玩家吃下后太好守，
      // 普通档胜率反而从 94% 涨到 100%，故保持边角布局
      { x: 80, y: 960 }, { x: 640, y: 960 },
      { x: 240, y: 820 }, { x: 480, y: 1100 },
    ],
  },
  {
    id: 'tri',
    name: '三足鼎立',
    brief: '三方等距鼎立，每条边一道关墙 —— 谁控住边路谁就掌握节奏',
    players: 3,
    spawns: SPAWNS_3P,
    rocks: rot3Rocks([[4, 23], [5, 24], [6, 24], [8, 27]]),  // 三条边各一道关墙 + 散石
    nodes: NODES_3P,
  },
  {
    id: 'tribrawl',
    name: '中原逐鹿',
    brief: '岩石稀疏的等距三角 —— 没有地形可依，扩张速度决定一切',
    players: 3,
    spawns: SPAWNS_3P,
    rocks: rot3Rocks([[9, 19], [4, 25], [13, 21]]),  // 质心周围一圈散石，不构成封锁
    nodes: NODES_3P,
  },
];

/** 默认地图（兼容既有引用）：中央关口 */
export const NODES: Vec[] = MAPS[0].nodes;
export const ROCK_TILES: [number, number][] = MAPS[0].rocks;

export const DIFFICULTY: Record<Difficulty, {
  label: string;
  incomeMult: number;
  maxMines: number;
  maxBarracks: number;
  maxTowers: number;
  wavePop: number;
  waveCd: number;   // 两波之间的间隔
  waveMax: number;  // 单波最长持续；到点收兵重整，否则 AI 会无限续攻
  retreat: boolean;
  weights: Record<UnitType, number>;
  think: number;
}> = {
  // 数值经 scripts/balance.ts 无头跑批校准。节奏目标：1v1 普通 ~5.5-6 分钟、
  // 3 人混战 ~9 分钟（扩张 → 中期拉锯 → 攻城），胜率梯度 简单 ~100%/50% / 普通 ~88%/50% / 困难 ~38%。
  // 注意：建造区以中线 y=960 对称切分，AI 的整体数值要比「前压不对称」时期更高才能维持同等难度。
  easy: {
    label: '简单', incomeMult: 0.75, maxMines: 4, maxBarracks: 1, maxTowers: 1,
    wavePop: 30, waveCd: 95, waveMax: 40, retreat: false,
    weights: { infantry: 0.7, archer: 0.3, heavy: 0 }, think: 0.6,
  },
  // 三档必须是"单调更强"：收入更高、矿更多、兵营更多、出击更频繁。
  // 曾经把困难的 waveCd 调得比普通还长，结果两档挤在一起、难度选择失去意义。
  normal: {
    label: '普通', incomeMult: 0.99, maxMines: 5, maxBarracks: 2, maxTowers: 1,
    wavePop: 40, waveCd: 72, waveMax: 55, retreat: true,
    weights: { infantry: 0.55, archer: 0.3, heavy: 0.15 }, think: 0.55,
  },
  hard: {
    // 困难档对参数极度敏感：incomeMult 每加 0.05、waveCd 每减 4 都要重新跑批
    label: '困难', incomeMult: 1.03, maxMines: 6, maxBarracks: 3, maxTowers: 2,
    wavePop: 45, waveCd: 65, waveMax: 65, retreat: true,
    weights: { infantry: 0.45, archer: 0.3, heavy: 0.25 }, think: 0.5,
  },
};
