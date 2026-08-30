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
  | { kind: 'attack'; targetId: number };

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
}

export type Command =
  | { type: 'move'; side: Side; ids: number[]; x: number; y: number }
  | { type: 'attack'; side: Side; ids: number[]; targetId: number }
  | { type: 'build'; side: Side; building: BuildingType; x: number; y: number }
  | { type: 'train'; side: Side; unit: UnitType }
  | { type: 'rally'; side: Side; x: number; y: number };

export interface AIState {
  thinkT: number;
  defending: boolean;
  attacking: boolean;
  waveCd: number;
  waveStart: number; // 出击时部队总血量，用于判断溃退
}

export interface World {
  tick: number;
  time: number;
  seed: number;
  rngState: number;
  difficulty: Difficulty;
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
  nextId: number;
  events: SimEvent[];
  gameOver: null | { winner: Side };
  stats: { kills: number[] };
  ai: AIState;
}
