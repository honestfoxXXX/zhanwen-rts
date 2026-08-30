export type Side = 0 | 1; // 0 玩家（下方），1 敌方（上方）
export type UnitType = 'infantry' | 'archer' | 'heavy';
export type BuildingType = 'hq' | 'barracks' | 'mine' | 'tower';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Vec { x: number; y: number }

export interface UnitDef {
  name: string;
  cost: number;
  pop: number;
  trainTime: number;
  hp: number;
  speed: number;
  radius: number;
  range: number;
  aggro: number;
  damage: number;
  cooldown: number;
  projectileSpeed: number; // >0 远程弹道，0 近战瞬时
  /** 克制加成：对指定兵种的伤害倍率（只对单位生效，建筑不受影响）。集中在 config.ts 调整 */
  dmgBonus?: Partial<Record<UnitType, number>>;
}

export interface WeaponDef { range: number; damage: number; cooldown: number; projectileSpeed: number }

export interface BuildingDef {
  name: string;
  cost: number;
  hp: number;
  buildTime: number;
  half: number; // 半宽（世界单位），建筑均为 half*2 见方
  income: number;
  weapon: WeaponDef | null;
}

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'attack'; targetId: number }
  | { kind: 'hold' }    // 原地固守：只打射程内目标，不脱战追击
  | { kind: 'retreat' }; // 撤退：返回己方主基地后转为待命

export interface Unit {
  id: number;
  side: Side;
  type: UnitType;
  x: number; y: number;
  hp: number; maxHp: number;
  cd: number;
  facing: number;
  order: Order;
  engageId: number | null; // 自动索敌/指定的当前目标
  path: Vec[];
  pathI: number;
  repathT: number;
  stuckT: number;
  lastX: number; lastY: number;
  dead: boolean;
}

export interface Building {
  id: number;
  side: Side;
  type: BuildingType;
  x: number; y: number;
  half: number;
  hp: number; maxHp: number;
  buildT: number; // 剩余建造时间，<=0 已完工
  cd: number;
  facing: number; // 武器朝向（塔/主基地渲染用）
  trainType: UnitType | null;
  trainT: number;
  rally: Vec | null; // 本兵营独立集结点；null 时回退到 w.rally[side]
  dead: boolean;
}

export interface CrystalNode { id: number; x: number; y: number; mineId: number | null }

export interface Projectile {
  x: number; y: number;
  sx: number; sy: number;
  tx: number; ty: number;
  t: number; dur: number;
  side: Side;
  big: boolean;
  arrow: boolean; // 箭矢（弓手） vs 炮弹
}

export type DenyReason = 'cost' | 'pop' | 'nobarracks' | 'place' | 'nonode' | 'queue';

export interface SimEvent {
  type: 'shot' | 'die' | 'boom' | 'built' | 'denied' | 'gameOver' | 'moveMark' | 'wave';
  x?: number; y?: number; tx?: number; ty?: number;
  side?: Side; big?: boolean; r?: number;
  reason?: DenyReason;
  winner?: Side;
  /** shot 事件附带：被打的是建筑(true)还是部队(false)，用于挨打告警分级 */
  targetBuilding?: boolean;
  /** shot 事件附带：近战(true)没有弹道，表现层用挥砍弧线而非枪口闪光 */
  melee?: boolean;
}

type WithTick<T> = T & { tick?: number };

/**
 * 指令流。tick 由输入层标注（联机 lockstep 下由网络层填执行帧），单机可省略。
 * 未来只同步指令流即可复现整局，因此所有指令都必须是可序列化的普通对象。
 */
export type Command =
  | WithTick<{ type: 'move'; side: Side; ids: number[]; x: number; y: number }>
  | WithTick<{ type: 'attack'; side: Side; ids: number[]; targetId: number }>
  | WithTick<{ type: 'hold'; side: Side; ids: number[] }>
  | WithTick<{ type: 'retreat'; side: Side; ids: number[] }>
  | WithTick<{ type: 'build'; side: Side; building: BuildingType; x: number; y: number }>
  | WithTick<{ type: 'train'; side: Side; unit: UnitType }>
  | WithTick<{ type: 'rally'; side: Side; x: number; y: number; buildingId?: number }>;

export interface AIState {
  thinkT: number;
  defending: boolean;
  attacking: boolean;
  waveCd: number;
  waveStart: number; // 出击时部队总血量，用于判断溃退
  waveAt: number;    // 本波开始的时刻（world.time），用于给波次设时长上限
  /** 侦查到的玩家兵种构成（累计观测量），用于针对性调整出兵配比 */
  scout: Record<UnitType, number>;
  /** 当前波次的进攻目标；为空表示尚未确定 */
  goal: Vec | null;
  /** 已发起的波次数（从 0 开始），用于隔波切换"打矿场 / 推主基地" */
  waves: number;
}

export interface World {
  tick: number;
  time: number;
  seed: number;
  rngState: number;
  difficulty: Difficulty;
  /** 使用的地图索引（指向 config 的 MAPS），决定岩石与矿点布局 */
  map: number;
  units: Unit[];
  buildings: Building[];
  nodes: CrystalNode[];
  projectiles: Projectile[];
  crystals: number[];
  popUsed: number[];
  income: number[];
  queue: UnitType[][]; // 全局造兵队列（每方）
  rally: Vec[];
  blocked: Uint8Array;
  /** id → 实体索引。避免每帧 O(n) 线性查找；手搓实体（如测试）未入索引时会回退扫描并回填 */
  index: Map<number, Unit | Building>;
  nextId: number;
  events: SimEvent[];
  gameOver: null | { winner: Side };
  /** 战报统计：kills[s] = s 方的击杀数（即对方的阵亡数） */
  stats: {
    kills: number[];
    trained: number[];   // 实际造出的兵
    peakPop: number[];   // 峰值兵力
    earned: number[];    // 水晶总收入
  };
  ai: AIState;
}
