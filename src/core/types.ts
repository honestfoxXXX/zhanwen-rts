/** 阵营。0 恒为玩家，1..2 为 AI；实际参战方数由 World.players 决定 */
export type Side = 0 | 1 | 2;
export type UnitType = 'infantry' | 'archer' | 'heavy' | 'pikeman' | 'knight' | 'catapult' | 'champion' | 'horsearcher';
export type BuildingType = 'hq' | 'barracks' | 'mine' | 'tower' | 'smithy' | 'workshop' | 'farm';
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
  /** 科技档：1 基础 / 2 军械库 / 3 攻城工坊 */
  tier: 1 | 2 | 3;
  /** 护甲（0~1）：受到的所有伤害按此比例减免（高阶精英的独占生存能力） */
  armor?: number;
  /** 克制加成：对指定兵种生效；`building` 键对建筑生效（攻城）。集中在 config.ts 调整 */
  dmgBonus?: Partial<Record<UnitType | 'building', number>>;
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
  /** 科技档解锁：建成后允许训练该档兵种（军械库 2 / 攻城工坊 3） */
  unlocks?: 2 | 3;
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
  level: number;  // 建筑等级（中原箭塔可升级，1-3）
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
  lob?: boolean; // 大弧线抛射（投石车）
}

export type CivId = 'central' | 'nomad' | 'knight';

export type DenyReason = 'cost' | 'pop' | 'nobarracks' | 'place' | 'nonode' | 'queue' | 'nosmithy' | 'noworkshop';

export interface SimEvent {
  type: 'shot' | 'die' | 'boom' | 'built' | 'denied' | 'gameOver' | 'moveMark' | 'wave' | 'eliminated';
  x?: number; y?: number; tx?: number; ty?: number;
  side?: Side; big?: boolean; r?: number;
  reason?: DenyReason;
  /** null 表示同归于尽（多方同时被灭） */
  winner?: Side | null;
  /** shot 事件附带：挨打的是哪一方。混战里不能靠"攻击方不是我"推断 */
  targetSide?: Side;
  /** shot 事件附带：被打的是建筑(true)还是部队(false)，用于挨打告警分级 */
  targetBuilding?: boolean;
  /** shot 事件附带：近战(true)没有弹道，表现层用挥砍弧线而非枪口闪光 */
  melee?: boolean;
  /** shot 事件附带：攻击来源（表现层选音效：投石三段 / 塔 / 单位） */
  from?: 'unit' | 'tower' | 'catapult';
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
  | WithTick<{ type: 'rally'; side: Side; x: number; y: number; buildingId?: number }>
  | WithTick<{ type: 'upgradeTower'; side: Side; buildingId: number }>;

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
  /** 使用的地图索引（指向 config 的 MAPS），决定岩石、矿点与出生点布局 */
  map: number;
  /** 实际参战方数（2 或 3），由地图的出生点数量决定 */
  players: number;
  /** 各方主基地位置（从地图拷贝），撤退令与出生点相关逻辑都读它 */
  spawns: Vec[];
  /** 各方是否仍在局中；主基地被毁即出局 */
  alive: boolean[];
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
  /** winner 为 null 表示同归于尽的平局 */
  gameOver: null | { winner: Side | null };
  /** 战报统计：kills[s] = s 方的击杀数（即对方的阵亡数） */
  stats: {
    kills: number[];
    trained: number[];   // 实际造出的兵
    peakPop: number[];   // 峰值兵力
    earned: number[];    // 水晶总收入
  };
  /** 按阵营索引的 AI 状态；0 号位玩家不用，仅占位以保持下标对齐 */
  ai: AIState[];
  /** 王冠之地（3 人局）：连续占领时长与正在占领的一方 */
  crown: { t: number; side: Side | null };
  /** 各方文明（createWorld 定死，纳入 hash/序列化） */
  civs: CivId[];
  /** 阵型辅助：集结点是否自动跟随军队质心（玩家默认开；点「集结」设固定点即关闭） */
  rallyAuto: boolean[];
}
