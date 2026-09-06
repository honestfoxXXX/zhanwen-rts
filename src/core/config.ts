import type { Difficulty, Vec, BuildingType, UnitType } from './types';

export const TILE = 40;
export const COLS = 96;
export const ROWS = 96;
export const MAP_W = COLS * TILE; // 3840 方形大图
export const MAP_H = ROWS * TILE;
export const POP_CAP = 80;
export const START_CRYSTAL = 150;

/**
 * 克制三角：弓手 › 重装 › 步兵 › 弓手
 *   弓手(1.6x) 打重装：远程风筝慢速重甲
 *   重装(1.5x) 打步兵：厚甲高伤碾压轻甲近战
 *   步兵(1.5x) 打弓手：便宜快速贴脸切后排
 * 只影响单位互打，打建筑一律按基础伤害。
 */
export const UNIT_DEFS: Record<UnitType, import('./types').UnitDef> = {
  // 速度为大图整体 ×1.4（相对速度与战斗配比不变，把行军时间缩回小图节奏）
  infantry: { name: '步兵', cost: 50, pop: 1, trainTime: 3.2, hp: 75, speed: 84, radius: 9, range: 12, aggro: 130, damage: 7, cooldown: 0.7, projectileSpeed: 0, tier: 1, dmgBonus: { archer: 1.5 } },
  archer: { name: '弓手', cost: 80, pop: 1, trainTime: 4.2, hp: 45, speed: 90, radius: 9, range: 125, aggro: 155, damage: 9, cooldown: 1.0, projectileSpeed: 300, tier: 1, dmgBonus: { heavy: 1.6 } },
  heavy: { name: '重装', cost: 200, pop: 3, trainTime: 7.5, hp: 300, speed: 62, radius: 13, range: 14, aggro: 130, damage: 22, cooldown: 1.2, projectileSpeed: 0, tier: 1, dmgBonus: { infantry: 1.5, building: 1.5 } },
  // T2（军械库）：长枪兵反骑 / 骑士快速袭扰。
  // 数值红线修正：dps/人口必须高于 T1 步兵（10）——"贵=换更少的量"只体现在 dps/金上，
  // 否则人口顶满后高阶兵反而亏，升本没有意义（实测教训：初版 T2/T3 dps/人口全线 < 10）。
  pikeman: { name: '长枪兵', cost: 160, pop: 2, trainTime: 5.5, hp: 140, speed: 66, radius: 9, range: 14, aggro: 130, damage: 16, cooldown: 0.7, projectileSpeed: 0, tier: 2, dmgBonus: { knight: 1.8, heavy: 1.2 } },
  knight: { name: '骑士', cost: 240, pop: 3, trainTime: 7, hp: 220, speed: 120, radius: 10, range: 12, aggro: 170, damage: 26, cooldown: 0.72, projectileSpeed: 0, tier: 2, dmgBonus: { archer: 1.5 } },
  // T3（攻城工坊）：投石车破建筑龟缩（对建筑 ×3 + 溅射）/ 近卫军重甲精英（28% 减伤）
  catapult: { name: '投石车', cost: 420, pop: 4, trainTime: 9, hp: 300, speed: 46, radius: 12, range: 190, aggro: 190, damage: 52, cooldown: 1.5, projectileSpeed: 220, tier: 3, dmgBonus: { building: 3 } },
  champion: { name: '近卫军', cost: 450, pop: 4, trainTime: 12, hp: 460, speed: 72, radius: 12, range: 14, aggro: 140, damage: 38, cooldown: 0.73, projectileSpeed: 0, tier: 3, armor: 0.28 },
};

export const BUILDING_DEFS: Record<BuildingType, import('./types').BuildingDef> = {
  hq: { name: '城堡', cost: 0, hp: 2800, buildTime: 0, half: 30, income: 4, weapon: { range: 150, damage: 9, cooldown: 1.2, projectileSpeed: 260 } },
  mine: { name: '金矿', cost: 100, hp: 320, buildTime: 5, half: 30, income: 4, weapon: null },
  barracks: { name: '军营', cost: 150, hp: 650, buildTime: 8, half: 30, income: 0, weapon: null },
  tower: { name: '箭塔', cost: 120, hp: 520, buildTime: 6, half: 30, income: 0, weapon: { range: 175, damage: 13, cooldown: 1.0, projectileSpeed: 320 } },
  // 科技建筑：解锁高阶兵种（地图上可袭击的目标——拆工坊=掐死对方 T3）
  smithy: { name: '军械库', cost: 400, hp: 650, buildTime: 14, half: 30, income: 0, weapon: null, unlocks: 2 },
  workshop: { name: '攻城工坊', cost: 900, hp: 900, buildTime: 20, half: 30, income: 0, weapon: null, unlocks: 3 },
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
  /** 可选河流（可多条），参与寻路阻挡 */
  rivers?: RiverDef[];
}

/**
 * 双人图：对角出生（西南=玩家 / 东北=敌方），关于地图中心点对称 —— 经典 RTS 布局。
 * 两家 HQ 间距 ~4300px（步兵行军 ~52s），两条侧翼路 + 一条中路对角线。
 * 建造区 20×20 格贴角，背靠地图边缘，面向中路展开。
 */
const SPAWNS_2P: SpawnDef[] = [
  { pos: { x: 400, y: 3440 }, build: { x0: 2, x1: 21, y0: 75, y1: 94 } },
  { pos: { x: 3440, y: 400 }, build: { x0: 74, x1: 93, y0: 1, y1: 20 } },
];

/**
 * 三方：三方主基地构成等边三角形（外接圆半径 1350，质心即图中心 (1920,1920)），
 * 任意两方主基地间距完全相等（~2338）—— 公平性由几何保证。
 * 玩家在正南顶点，两个 AI 在西北 / 东北。建造区各 18×16 格（等面积、互不重叠）。
 */
const SPAWNS_3P: SpawnDef[] = [
  { pos: { x: 1920, y: 3270 }, build: { x0: 40, x1: 57, y0: 80, y1: 95 } },
  { pos: { x: 751, y: 1245 }, build: { x0: 2, x1: 19, y0: 24, y1: 39 } },
  { pos: { x: 3089, y: 1245 }, build: { x0: 69, x1: 86, y0: 24, y1: 39 } },
];

/** 2P 点对称助手：矿点自动补全关于地图中心的镜像（成对出现，测试约束按构造成立） */
function mirror2Nodes(base: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const n of base) {
    out.push(n, { x: MAP_W - n.x, y: MAP_H - n.y });
  }
  return out;
}

/** 2P 岩石点对称（格点） */
function mirror2Rocks(base: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [tx, ty] of base) {
    out.push([tx, ty], [COLS - 1 - tx, ROWS - 1 - ty]);
  }
  return out;
}

/** 3P 旋转对称助手：点集绕质心旋转 120°/240° 补全三份 */
function rot3Nodes(cx: number, cy: number, base: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3;
    const cos = Math.cos(a), sin = Math.sin(a);
    for (const p of base) {
      const dx = p.x - cx, dy = p.y - cy;
      out.push({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos });
    }
  }
  return out;
}

/** 3P 岩石旋转对称：方格无法精确 120° 旋转，四舍五入到最近格（±1 格容差，测试校验） */
function rot3Rocks(cx: number, cy: number, base: [number, number][]): [number, number][] {
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
/** 河流：平滑折线（世界坐标）+ 浅滩（可通行 crossing）。河流格参与寻路阻挡，浅滩豁免 */
export interface RiverDef {
  pts: Vec[];
  fords: Vec[];
  width: number; // 水面宽（世界 px）
}

export const PLAYER_COUNTS = [2, 3];

/** 2P 共用矿点：8 对中心对称（中央对角双点 + 双侧翼路 + 基本盘 + 边角富矿） */
const NODES_2P: Vec[] = mirror2Nodes([
  { x: 720, y: 3120 },    // 家门口基本盘
  { x: 1240, y: 3380 },   // 家侧翼（避开河道）
  { x: 1320, y: 2520 },   // 中路对角线南段
  { x: 1760, y: 1760 },   // 中央争夺簇（紧贴质心）
  { x: 760, y: 1920 },    // 西侧翼路中段
  { x: 1920, y: 3080 },   // 南北纵向路
  { x: 480, y: 1600 },    // 西北边角富矿
  { x: 1600, y: 480 },    // 东北边角富矿（镜像方向）
]);

/** 西南侧翼河（点对称后东北也有一条）：把侧翼路切成「桥/浅滩争夺战」 */
const RIVER_SW: RiverDef = {
  pts: [
    { x: -60, y: 2380 },
    { x: 700, y: 2760 },
    { x: 1400, y: 3260 },
    { x: 1960, y: 3900 },
  ],
  fords: [{ x: 950, y: 2940 }, { x: 300, y: 2560 }],
  width: 110,
};

/** 点对称补全河流（对岸也有一条，保持 2P 对称公平） */
function mirror2River(r: RiverDef): RiverDef {
  const m = (p: Vec): Vec => ({ x: MAP_W - p.x, y: MAP_H - p.y });
  return { pts: r.pts.map(m), fords: r.fords.map(m), width: r.width };
}

/** 原河 + 镜像河成对 */
function pair2Rivers(r: RiverDef): RiverDef[] {
  return [r, mirror2River(r)];
}

export const MAPS: MapDef[] = [
  {
    id: 'gate',
    name: '中央关隘',
    brief: '对角布局，中央隘口收窄 —— 控住中路就控住对方的经济动脉',
    players: 2,
    spawns: SPAWNS_2P,
    rocks: mirror2Rocks([
      [16, 40], [17, 40], [18, 40], [17, 41],       // 西北路线岩脊
      [45, 45], [46, 45], [45, 46],                 // 中央隘口（对角线两侧收窄）
      [28, 18], [29, 18],                            // 散石
      [10, 52], [11, 52], [10, 53],                  // 西南碎岩
    ]),
    nodes: NODES_2P,
    rivers: pair2Rivers(RIVER_SW),
  },
  {
    id: 'open',
    name: '开阔平原',
    brief: '几乎没有掩体，机动与包抄决定胜负 —— 小心被绕后偷矿',
    players: 2,
    spawns: SPAWNS_2P,
    rocks: mirror2Rocks([
      [30, 58], [58, 30],                            // 中场散石（镜像成对）
      [20, 66], [75, 29],                            // 家门散石
    ]),
    nodes: NODES_2P,
  },
  {
    id: 'rich',
    name: '富矿之争',
    brief: '中央矿脉密布 —— 谁吃下中心，谁就吃下整场比赛',
    players: 2,
    spawns: SPAWNS_2P,
    rocks: mirror2Rocks([
      [38, 50], [50, 38],                            // 中央两侧岩柱
      [24, 44], [44, 24],                            // 半路散石
    ]),
    nodes: mirror2Nodes([
      { x: 720, y: 3120 },
      { x: 1320, y: 3260 },
      { x: 1520, y: 2320 },   // 中路前置
      { x: 1760, y: 1760 },   // 中央簇
      { x: 2080, y: 1520 },   // 中央簇（对角另一翼）
      { x: 760, y: 1920 },
      { x: 1920, y: 3080 },
      { x: 1120, y: 1120 },   // 西北富矿角
      { x: 2720, y: 3120 },   // 东南富矿角
    ]),
  },
  {
    id: 'tri',
    name: '三足鼎立',
    brief: '三方等距鼎立，岩脊分割三路 —— 控住隘口就掌握节奏',
    players: 3,
    spawns: SPAWNS_3P,
    rocks: rot3Rocks(1920, 1920, [
      [30, 60], [31, 60], [32, 59],                  // 每条边一道岩脊
      [44, 70], [45, 70],                             // 家门侧散石
      [58, 46],                                        // 中环散石
    ]),
    nodes: [
      { x: 1920, y: 1920 },                          // 王冠之地
      ...rot3Nodes(1920, 1920, [
        { x: 1920, y: 2670 },                        // 朝家第一矿
        { x: 2526, y: 2270 },                        // 两家之间的争夺矿
        { x: 1520, y: 2860 }, { x: 2320, y: 2860 },  // 家侧双矿
        { x: 1160, y: 3240 }, { x: 2680, y: 3240 },  // 边角富矿
      ]),
    ],
  },
  {
    id: 'tribrawl',
    name: '中原逐鹿',
    brief: '岩石稀疏的等距三角 —— 没有地形可依，扩张速度决定一切',
    players: 3,
    spawns: SPAWNS_3P,
    rocks: rot3Rocks(1920, 1920, [
      [48, 34], [34, 74], [72, 62],                  // 质心周围散石
    ]),
    nodes: [
      { x: 1920, y: 1920 },
      ...rot3Nodes(1920, 1920, [
        { x: 1920, y: 2670 },
        { x: 2526, y: 2270 },
        { x: 1520, y: 2860 }, { x: 2320, y: 2860 },
        { x: 1160, y: 3240 }, { x: 2680, y: 3240 },
      ]),
    ],
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
  weights: Partial<Record<UnitType, number>>;
  think: number;
}> = {
  // 数值经 scripts/balance.ts 无头跑批校准。节奏：1v1 普通 ~4.5 分钟、
  // 3 人混战 ~8.5 分钟（扩张 → 中期拉锯 → 攻城），胜率梯度 简单 ~100%/63% / 普通 ~75%/25% / 困难 ~25%/25%。
  // 注意：建造区以中线 y=960 对称切分，AI 的整体数值要比「前压不对称」时期更高才能维持同等难度。
  easy: {
    label: '简单', incomeMult: 0.75, maxMines: 4, maxBarracks: 1, maxTowers: 1,
    wavePop: 30, waveCd: 95, waveMax: 75, retreat: false,
    weights: { infantry: 0.7, archer: 0.3, heavy: 0 }, think: 0.6,
  },
  // 三档必须是"单调更强"：收入更高、矿更多、兵营更多、出击更频繁。
  // 大图（96×96）上防守方有堡垒与零距离援军优势，进攻必须满编——AI 与人同理。
  // waveMax 必须大于跨图行军时间（~55s，速度 ×1.4 后），否则波次半路超时收兵。
  normal: {
    label: '普通', incomeMult: 1.0, maxMines: 6, maxBarracks: 2, maxTowers: 1,
    wavePop: 40, waveCd: 72, waveMax: 95, retreat: true,
    weights: { infantry: 0.55, archer: 0.3, heavy: 0.15 }, think: 0.55,
  },
  hard: {
    // 困难档对参数极度敏感：incomeMult 每加 0.05、waveCd 每减 4 都要重新跑批
    label: '困难', incomeMult: 1.1, maxMines: 6, maxBarracks: 3, maxTowers: 2,
    wavePop: 42, waveCd: 55, waveMax: 105, retreat: true,
    weights: { infantry: 0.45, archer: 0.3, heavy: 0.25 }, think: 0.5,
  },
};
