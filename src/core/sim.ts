import {
  BUILDING_DEFS, COLS, DIFFICULTY, MAP_H, MAPS, MAP_W, POP_CAP,
  ROWS, START_CRYSTAL, TILE, UNIT_DEFS,
} from './config';
import { findPath, isBlockedTile, lineClear, nearestFreeTile } from './pathfinding';
import { rngNext } from './rng';
import { aiThink } from './ai';
import type {
  AIState, Building, BuildingType, Command, CrystalNode, DenyReason, Projectile,
  Side, SimEvent, Unit, UnitType, Vec, World,
} from './types';

export const STEP = 1 / 60;

/* ---------------- 基础工具 ---------------- */

export function tileCenter(cx: number, cy: number): Vec {
  return { x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 };
}

export function isUnit(e: Unit | Building): e is Unit {
  return (e as Unit).order !== undefined;
}

export function entRadius(e: Unit | Building): number {
  // 建筑受击半径略大于 2×2 阻挡占格的外接半径（40）：近战单位的寻路可达位
  // 在占格外一圈格心（距中心 ~60px），射程 12 必须配上 ≥42 的受击半径才够得着，
  // 否则会贴着城堡边缘转圈打不着。视觉 half 只影响碰撞与绘制，不影响这里。
  return isUnit(e) ? UNIT_DEFS[e.type].radius : Math.max(e.half * 0.9, TILE * 1.15);
}

/**
 * 两点距离。显式 sqrt 而不用 Math.hypot：
 * hypot 的实现跨 JS 引擎（V8 / JSC / SpiderMonkey）不保证位精确，
 * 一个 ULP 的差异就会翻转索敌比较，进而在联机 lockstep 下造成不同步。
 * Math.sqrt / 四则运算是 IEEE754 精确定义的，可保证跨端一致。
 */
function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

export function entityById(w: World, id: number): Unit | Building | null {
  const hit = w.index.get(id);
  if (hit) return hit;
  // 索引未覆盖时（例如测试中手工构造的实体）回退线性扫描并回填
  for (const u of w.units) if (u.id === id) { w.index.set(id, u); return u; }
  for (const b of w.buildings) if (b.id === id) { w.index.set(id, b); return b; }
  return null;
}

/** 取本方存活单位（优先走索引） */
function unitOf(w: World, id: number, side: Side): Unit | null {
  const e = w.index.get(id);
  if (e && isUnit(e) && !e.dead && e.side === side) return e;
  return w.units.find(v => v.id === id && v.side === side && !v.dead) ?? null;
}

function ev(w: World, e: SimEvent): void {
  if (w.events.length < 300) w.events.push(e);
}

/** 供 AI 模块推送事件（如敌袭预警） */
export function pushEvent(w: World, e: SimEvent): void {
  ev(w, e);
}

export function applyDamage(w: World, target: Unit | Building, dmg: number, by: Side): boolean {
  if (target.dead) return false;
  target.hp -= dmg;
  if (target.hp <= 0) {
    target.dead = true;
    w.stats.kills[by]++;
    return true;
  }
  return false;
}

/* ---------------- 世界创建 ---------------- */

/** mapIndex 省略时用默认地图（中央关口），既有测试因此不受影响。参战方数由地图决定 */
/** 河流格标记：沿折线密采样，圆刷覆盖；浅滩（ford）半径内豁免保持通路 */
function markRiverTiles(blocked: Uint8Array, river: { pts: Vec[]; fords: Vec[]; width: number }): void {
  const R = river.width / 2 + 8;
  const pts: Vec[] = [];
  for (let i = 0; i < river.pts.length - 1; i++) {
    const a = river.pts[i], b = river.pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const n = Math.max(1, Math.ceil(d / 24));
    for (let k = 0; k < n; k++) pts.push({ x: a.x + (dx * k) / n, y: a.y + (dy * k) / n });
  }
  pts.push(river.pts[river.pts.length - 1]);
  const rTiles = Math.ceil((R + 14) / TILE);
  for (const p of pts) {
    const tcx = Math.floor(p.x / TILE), tcy = Math.floor(p.y / TILE);
    for (let dy = -rTiles; dy <= rTiles; dy++) {
      for (let dx = -rTiles; dx <= rTiles; dx++) {
        const tx = tcx + dx, ty = tcy + dy;
        if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) continue;
        const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
        const ex = cx - p.x, ey = cy - p.y;
        if (Math.sqrt(ex * ex + ey * ey) > R + 14) continue;
        let ford = false;
        for (const f of river.fords) {
          const fx = cx - f.x, fy = cy - f.y;
          if (Math.sqrt(fx * fx + fy * fy) < 110) { ford = true; break; }
        }
        if (ford) continue;
        blocked[ty * COLS + tx] = 1;
      }
    }
  }
}

export function createWorld(difficulty: World['difficulty'], seed: number, mapIndex = 0): World {
  const map = MAPS[mapIndex % MAPS.length];
  const players = map.spawns.length;
  const blocked = new Uint8Array(COLS * ROWS);
  for (const [cx, cy] of map.rocks) blocked[cy * COLS + cx] = 1;
  for (const r of map.rivers ?? []) markRiverTiles(blocked, r);

  const midX = MAP_W / 2, midY = MAP_H / 2;

  const w: World = {
    tick: 0,
    time: 0,
    seed,
    rngState: seed | 0,
    difficulty,
    map: mapIndex % MAPS.length,
    players,
    spawns: map.spawns.map(s => ({ x: s.pos.x, y: s.pos.y })),
    alive: new Array(players).fill(true),
    units: [],
    buildings: [],
    nodes: map.nodes.map((n, i) => ({ id: i + 1, x: n.x, y: n.y, mineId: null })),
    projectiles: [],
    crystals: new Array(players).fill(START_CRYSTAL),
    popUsed: new Array(players).fill(0),
    income: new Array(players).fill(0),
    queue: Array.from({ length: players }, () => [] as UnitType[]),
    // 默认集结点：从出生点朝地图质心方向收拢，双轴通用（对角 / 三角布局都成立）。
    // 距离按人数区分：1v1 320 让双方主力在中路对角线碰撞，3 人 240 贴家攒兵。
    rally: map.spawns.map(s => {
      const dx = midX - s.pos.x, dy = midY - s.pos.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const off = players === 3 ? 240 : 320;
      return { x: s.pos.x + (dx / len) * off, y: s.pos.y + (dy / len) * off };
    }),
    blocked,
    index: new Map(),
    nextId: 1,
    events: [],
    gameOver: null,
    stats: {
      kills: new Array(players).fill(0),
      trained: new Array(players).fill(0),
      peakPop: new Array(players).fill(0),
      earned: new Array(players).fill(0),
    },
    // 每个阵营一份 AI 状态（0 号位玩家不用，仅占位保持下标对齐）
    crown: { t: 0, side: null },
    rallyAuto: map.spawns.map((_, i) => i === 0),
    ai: Array.from({ length: players }, () => ({
      thinkT: 1.2, defending: false, attacking: false,
      waveCd: players === 3 ? 27 : 45, // 首波更晚：给双方留出扩张与中期拉锯的时间
      waveStart: 0, waveAt: 0,
      scout: { infantry: 0, archer: 0, heavy: 0, pikeman: 0, knight: 0, catapult: 0, champion: 0 },
      goal: null,
      waves: 0,
    })),
  };

  for (let s = 0; s < players; s++) mkBuilding(w, s as Side, 'hq', w.spawns[s].x, w.spawns[s].y, true);
  return w;
}

function mkBuilding(w: World, side: Side, type: BuildingType, x: number, y: number, instant = false): Building {
  const d = BUILDING_DEFS[type];
  const b: Building = {
    id: w.nextId++,
    side, type,
    x, y, half: d.half,
    hp: d.hp, maxHp: d.hp,
    buildT: instant ? 0 : d.buildTime,
    cd: 0,
    // 朝向按出生位置推导（面朝地图中心），不依赖"哪一方是玩家"的身份假设
    facing: Math.atan2(MAP_H / 2 - y, MAP_W / 2 - x),
    trainType: null, trainT: 0,
    rally: null,
    dead: false,
  };
  w.buildings.push(b);
  w.index.set(b.id, b);
  setBuildingTiles(w, b, 1);
  return b;
}

function setBuildingTiles(w: World, b: Building, v: number): void {
  const cx = Math.round(b.x / TILE), cy = Math.round(b.y / TILE);
  for (const [dx, dy] of [[-1, 0], [0, 0], [-1, -1], [0, -1]] as const) {
    const tx = cx + dx, ty = cy + dy;
    if (tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS) w.blocked[ty * COLS + tx] = v;
  }
}

/* ---------------- 建造放置 ---------------- */

export interface PlaceResult { ok: boolean; x: number; y: number; reason?: DenyReason }

export function nearestFreeNode(w: World, x: number, y: number, r: number) {
  let best = null as null | (typeof w.nodes)[0];
  let bd = Infinity;
  for (const n of w.nodes) {
    if (n.mineId !== null) continue;
    const d = dist(n.x, n.y, x, y);
    if (d <= r && d < bd) { bd = d; best = n; }
  }
  return best;
}

export function canPlace(w: World, side: Side, type: BuildingType, x: number, y: number): PlaceResult {
  if (type === 'mine') {
    const n = nearestFreeNode(w, x, y, 48);
    if (!n) return { ok: false, x, y, reason: 'nonode' };
    return placeAt(w, side, n.x, n.y, true);
  }
  return placeAt(w, side, x, y, false);
}

/**
 * 以主基地为原点取建筑位。偏移量定义在「+y 指向地图质心」的坐标系里，
 * 先按本方基地相对质心的方位旋转到实际朝向，再依次尝试镜像 / 缩放变体，
 * 返回第一个能放的点；都放不下返回 null。
 *
 * 1v1 两基地与质心共线，旋转角恰为 0，行为与旧的写死坐标完全一致；
 * 三方是等边三角，各基地朝向差 120°，靠旋转让每个 AI 的家都"面朝质心"布置。
 */
export function findBuildSlot(w: World, side: Side, type: BuildingType, offsets: [number, number][]): Vec | null {
  const hq = w.buildings.find(b => b.side === side && b.type === 'hq' && !b.dead);
  if (!hq) return null;
  const map = MAPS[w.map];
  const cx = map.spawns.reduce((s, p) => s + p.pos.x, 0) / map.players;
  const cy = map.spawns.reduce((s, p) => s + p.pos.y, 0) / map.players;
  const ang = Math.atan2(cy - hq.y, cx - hq.x) - Math.PI / 2;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const cands: Vec[] = [];
  // 候选顺序：先按声明顺序试完所有主位（与旧的逐偏移取位完全一致），
  // 主位全满才退到镜像 / 缩放变体 —— 否则会悄悄改变已有地图的 AI 行为。
  const add = (k: number, mirrored: boolean): void => {
    for (const [ox, oy] of offsets) {
      const mirrors: (readonly [number, number])[] = mirrored ? [[-1, 1], [1, -1], [-1, -1]] : [[1, 1]];
      for (const [sx, sy] of mirrors) {
        const dx = ox * sx * k, dy = oy * sy * k;
        cands.push({ x: hq.x + dx * cos - dy * sin, y: hq.y + dx * sin + dy * cos });
      }
    }
  };
  add(1, false);
  add(1, true);
  add(0.6, false);
  add(0.6, true);
  return cands.find(c => canPlace(w, side, type, c.x, c.y).ok) ?? null;
}

function placeAt(w: World, side: Side, x: number, y: number, isMine: boolean): PlaceResult {
  const cx = Math.round(x / TILE), cy = Math.round(y / TILE);
  if (cx < 1 || cy < 1 || cx >= COLS || cy >= ROWS) return { ok: false, x, y, reason: 'place' };
  for (const [dx, dy] of [[-1, 0], [0, 0], [-1, -1], [0, -1]] as const) {
    if (isBlockedTile(w.blocked, cx + dx, cy + dy)) return { ok: false, x, y, reason: 'place' };
  }
  // 建造区域由出生点定义（矿场除外，可争夺公共矿点）。
  // 双方图按中线切分；三方图再把上半场按列切成左右两块，分给两个 AI。
  // 边界对齐"建筑占 cy-1..cy 两行"的占位规则，各方刚好贴着自己的边界。
  if (!isMine) {
    const reg = MAPS[w.map].spawns[side].build;
    if (cx < reg.x0 || cx > reg.x1 || cy < reg.y0 || cy > reg.y1) {
      return { ok: false, x, y, reason: 'place' };
    }
    // 不能压住矿点
    for (const n of w.nodes) {
      if (Math.abs(n.x - cx * TILE) < 66 && Math.abs(n.y - cy * TILE) < 66) {
        return { ok: false, x, y, reason: 'place' };
      }
    }
  }
  return { ok: true, x: cx * TILE, y: cy * TILE };
}

function pushOutUnits(w: World, b: Building): void {
  for (const u of w.units) {
    const r = UNIT_DEFS[u.type].radius;
    const ex = b.half + r, ey = b.half + r;
    const dx = u.x - b.x, dy = u.y - b.y;
    if (Math.abs(dx) < ex && Math.abs(dy) < ey) {
      const px = ex - Math.abs(dx), py = ey - Math.abs(dy);
      if (px < py) u.x = b.x + Math.sign(dx || 1) * ex;
      else u.y = b.y + Math.sign(dy || 1) * ey;
    }
  }
}

/* ---------------- 指令 ---------------- */

export function issueCommand(w: World, c: Command): boolean {
  if (w.gameOver) return false;
  switch (c.type) {
    case 'move': {
      let any = false;
      for (const id of c.ids) {
        const u = unitOf(w, id, c.side);
        if (!u) continue;
        // 锋线阵型辅助：一次下令自动分层——近战在目标点、远程后撤 70、骑士前压 40。
        // 行军时远程自然跟在近战身后，接战近战先顶；点选精度不受影响（偏移量小）。
        const p = formationOffset(w, u, c.x, c.y);
        setMoveOrder(w, u, p.x, p.y);
        any = true;
      }
      if (any) ev(w, { type: 'moveMark', x: c.x, y: c.y });
      return any;
    }
    case 'attack': {
      const t = entityById(w, c.targetId);
      if (!t || t.dead || t.side === c.side) return false;
      let any = false;
      for (const id of c.ids) {
        const u = unitOf(w, id, c.side);
        if (!u) continue;
        u.order = { kind: 'attack', targetId: c.targetId };
        u.engageId = c.targetId;
        u.path = [];
        u.pathI = 0;
        any = true;
      }
      return any;
    }
    case 'hold': {
      let any = false;
      for (const id of c.ids) {
        const u = unitOf(w, id, c.side);
        if (!u) continue;
        u.order = { kind: 'hold' }; // 只打射程内目标，不脱战追击
        u.path = [];
        u.pathI = 0;
        any = true;
      }
      return any;
    }
    case 'retreat': {
      const hq = w.spawns[c.side];
      let any = false;
      for (const id of c.ids) {
        const u = unitOf(w, id, c.side);
        if (!u) continue;
        u.order = { kind: 'retreat' };
        u.engageId = null;
        const p = findPath(w.blocked, u.x, u.y, hq.x, hq.y);
        u.path = p ?? [];
        u.pathI = 0;
        u.repathT = 0.4;
        u.stuckT = 0;
        any = true;
      }
      return any;
    }
    case 'build': {
      const d = BUILDING_DEFS[c.building];
      const p = canPlace(w, c.side, c.building, c.x, c.y);
      if (!p.ok) { ev(w, { type: 'denied', reason: p.reason ?? 'place' }); return false; }
      if (w.crystals[c.side] < d.cost) { ev(w, { type: 'denied', reason: 'cost' }); return false; }
      w.crystals[c.side] -= d.cost;
      const b = mkBuilding(w, c.side, c.building, p.x, p.y);
      if (c.building === 'mine') {
        const n = nearestFreeNode(w, p.x, p.y, 48);
        if (n) n.mineId = b.id;
      }
      pushOutUnits(w, b);
      ev(w, { type: 'built', x: b.x, y: b.y, side: c.side });
      return true;
    }
    case 'train': {
      // 兵营施工期间也允许排队，完工后自动开训
      const hasB = w.buildings.some(b => b.side === c.side && b.type === 'barracks' && !b.dead);
      if (!hasB) { ev(w, { type: 'denied', reason: 'nobarracks' }); return false; }
      // 科技档门禁：T2 需建成的军械库、T3 需建成的攻城工坊
      const tier = UNIT_DEFS[c.unit].tier;
      if (tier >= 2) {
        const need: BuildingType = tier === 2 ? 'smithy' : 'workshop';
        const reason: DenyReason = tier === 2 ? 'nosmithy' : 'noworkshop';
        const hasTech = w.buildings.some(b => b.side === c.side && b.type === need && !b.dead && b.buildT <= 0);
        if (!hasTech) { ev(w, { type: 'denied', reason }); return false; }
      }
      const d = UNIT_DEFS[c.unit];
      if (w.crystals[c.side] < d.cost) { ev(w, { type: 'denied', reason: 'cost' }); return false; }
      if (w.queue[c.side].length >= 12) { ev(w, { type: 'denied', reason: 'queue' }); return false; }
      w.crystals[c.side] -= d.cost;
      w.queue[c.side].push(c.unit);
      return true;
    }
    case 'rally': {
      if (c.buildingId !== undefined) {
        const b = w.buildings.find(v => v.id === c.buildingId && v.side === c.side && !v.dead);
        if (!b) return false;
        b.rally = { x: c.x, y: c.y };
        return true;
      }
      w.rally[c.side] = { x: c.x, y: c.y };
      w.rallyAuto[c.side] = false; // 玩家指定固定集结点后关闭自动跟队
      return true;
    }
  }
}

/** 锋线阵型：按兵种角色对移动落点做偏移 */
/** 兵种阵型角色：前排顶线 / 远程拖后 / 骑士先锋 */
const UNIT_ROLE: Record<UnitType, 'front' | 'ranged' | 'vanguard'> = {
  infantry: 'front',
  heavy: 'front',
  pikeman: 'front',
  champion: 'front',
  archer: 'ranged',
  catapult: 'ranged',
  knight: 'vanguard',
};

function formationOffset(w: World, u: Unit, tx: number, ty: number): Vec {
  const role = UNIT_ROLE[u.type];
  const home = w.spawns[u.side];
  if (role === 'ranged') {
    const dx = home.x - tx, dy = home.y - ty;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: tx + (dx / len) * 70, y: ty + (dy / len) * 70 };
  }
  if (role === 'vanguard') {
    const dx = tx - home.x, dy = ty - home.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: tx + (dx / len) * 40, y: ty + (dy / len) * 40 };
  }
  return { x: tx, y: ty };
}

function setMoveOrder(w: World, u: Unit, x: number, y: number): void {
  u.order = { kind: 'move', x, y };
  u.engageId = null;
  const p = findPath(w.blocked, u.x, u.y, x, y);
  u.path = p ?? [];
  u.pathI = 0;
  u.repathT = 0.4;
  u.stuckT = 0;
}

/* ---------------- 单位行为 ---------------- */

function acquireTarget(w: World, u: Unit, aggro: number): Unit | Building | null {
  let best: Unit | Building | null = null;
  let bs = Infinity;
  for (const e of w.units) {
    if (e.dead || e.side === u.side) continue;
    const d = dist(e.x, e.y, u.x, u.y) - UNIT_DEFS[e.type].radius - UNIT_DEFS[u.type].radius;
    if (d <= aggro && d < bs) { bs = d; best = e; }
  }
  if (!best) {
    for (const b of w.buildings) {
      if (b.dead || b.side === u.side) continue;
      const d = dist(b.x, b.y, u.x, u.y) - b.half * 0.9 - UNIT_DEFS[u.type].radius;
      if (d <= aggro && d < bs) { bs = d; best = b; }
    }
  }
  return best;
}

function fireAt(w: World, u: Unit, t: Unit | Building, def: (typeof UNIT_DEFS)[UnitType]): void {
  let dmg = def.damage;
  if (def.dmgBonus) {
    const bonus = isUnit(t) ? def.dmgBonus[t.type] : def.dmgBonus.building;
    if (bonus) dmg *= bonus;
  }
  applyDamage(w, t, dmg, u.side);
  ev(w, {
    type: 'shot', x: u.x, y: u.y, tx: t.x, ty: t.y,
    side: u.side, big: u.type === 'heavy',
    // 混战下不能靠"攻击方不是我"推断挨打的是谁，必须显式记录
    targetSide: t.side,
    targetBuilding: !isUnit(t), melee: def.projectileSpeed === 0,
    from: u.type === 'catapult' ? 'catapult' : 'unit',
  });
  if (def.projectileSpeed > 0) {
    const d = dist(u.x, u.y, t.x, t.y);
    w.projectiles.push({
      x: u.x, y: u.y, sx: u.x, sy: u.y, tx: t.x, ty: t.y,
      t: 0, dur: Math.max(0.06, d / def.projectileSpeed),
      side: u.side, big: u.type === 'heavy', arrow: u.type === 'archer',
      lob: def.tier === 3,
    });
  }
}

function stepToward(u: Unit, tx: number, ty: number, speed: number, dt: number): boolean {
  const dx = tx - u.x, dy = ty - u.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 2) return true;
  const step = Math.min(speed * dt, d);
  u.x += dx / d * step;
  u.y += dy / d * step;
  u.facing = Math.atan2(dy, dx);
  return d - step < 2;
}

function followPath(w: World, u: Unit, dt: number, def: (typeof UNIT_DEFS)[UnitType]): void {
  // 撤退令抵达主基地后同样转为待命
  const arrived = (): boolean => u.order.kind === 'move' || u.order.kind === 'retreat';
  if (u.pathI >= u.path.length) {
    if (arrived()) u.order = { kind: 'idle' };
    u.path = [];
    return;
  }
  const wp = u.path[u.pathI];
  if (stepToward(u, wp.x, wp.y, def.speed, dt)) {
    u.pathI++;
    if (u.pathI >= u.path.length && arrived()) u.order = { kind: 'idle' };
  }
  void w;
}

function chaseTarget(w: World, u: Unit, t: Unit | Building, dt: number, def: (typeof UNIT_DEFS)[UnitType]): void {
  if (lineClear(w.blocked, u.x, u.y, t.x, t.y)) {
    u.path = [];
    stepToward(u, t.x, t.y, def.speed, dt);
    return;
  }
  u.repathT -= dt;
  if (u.repathT <= 0 || u.pathI >= u.path.length) {
    const p = findPath(w.blocked, u.x, u.y, t.x, t.y);
    if (p) { u.path = p; u.pathI = 0; }
    u.repathT = 0.5;
  }
  followPath(w, u, dt, def);
}

function updateUnit(w: World, u: Unit, dt: number): void {
  const def = UNIT_DEFS[u.type];
  if (u.cd > 0) u.cd = Math.max(0, u.cd - dt);

  let tgt: Unit | Building | null = null;
  if (u.engageId !== null) {
    tgt = entityById(w, u.engageId);
    if (!tgt || tgt.dead) { tgt = null; u.engageId = null; }
  }
  if (u.order.kind === 'attack') {
    const ot = entityById(w, u.order.targetId);
    if (!ot || ot.dead) { u.order = { kind: 'idle' }; u.engageId = null; tgt = null; }
    else { u.engageId = ot.id; tgt = ot; }
  }
  // 索敌范围：固守会迎战射程内之敌；撤退则完全脱战，否则会掉头追击、抵消撤退令
  if (!tgt && (u.order.kind === 'idle' || u.order.kind === 'move' || u.order.kind === 'hold')) {
    const a = acquireTarget(w, u, def.aggro);
    if (a) { u.engageId = a.id; tgt = a; }
  }

  let triedMove = false;
  if (tgt) {
    const tr = entRadius(tgt);
    const d = dist(tgt.x, tgt.y, u.x, u.y) - def.radius - tr;
    // hold：只打已进射程的目标，绝不脱战追击（leash 归零）
    const leash = u.order.kind === 'attack' ? Infinity : u.order.kind === 'hold' ? 0 : def.aggro + 70;
    if (d <= def.range) {
      u.facing = Math.atan2(tgt.y - u.y, tgt.x - u.x);
      if (u.cd <= 0) { fireAt(w, u, tgt, def); u.cd = def.cooldown; }
      u.stuckT = 0; u.lastX = u.x; u.lastY = u.y;
      return;
    }
    if (d <= leash) {
      chaseTarget(w, u, tgt, dt, def);
      triedMove = true;
    } else {
      u.engageId = null;
      tgt = null;
    }
  }
  const marching = u.order.kind === 'move' || u.order.kind === 'retreat';
  if (!triedMove && marching && u.path.length) followPath(w, u, dt, def);

  // 自愈：追击清空路径后目标消失，重新向目的地寻路（撤退令的目的地固定为主基地）
  if (marching && u.path.length === 0) {
    u.repathT -= dt;
    if (u.repathT <= 0) {
      const ord = u.order; // 取局部快照，让 TS 能稳定窄化（u.order 在本函数内被改写过）
      const home = w.spawns[u.side];
      const dx = ord.kind === 'retreat' ? home.x : ord.kind === 'move' ? ord.x : u.x;
      const dy = ord.kind === 'retreat' ? home.y : ord.kind === 'move' ? ord.y : u.y;
      const p = findPath(w.blocked, u.x, u.y, dx, dy);
      if (p) { u.path = p; u.pathI = 0; }
      else u.order = { kind: 'idle' };
      u.repathT = 0.8;
    }
  }

  const moving = triedMove || (marching && u.path.length > 0);
  if (moving) {
    u.stuckT += dt;
    if (u.stuckT >= 0.6) {
      const moved = dist(u.x, u.y, u.lastX, u.lastY);
      if (moved < 5) {
        let dest: Vec | null = null;
        if (tgt) dest = { x: tgt.x, y: tgt.y };
        else if (u.order.kind === 'move') dest = { x: u.order.x, y: u.order.y };
        else if (u.order.kind === 'retreat') dest = { x: w.spawns[u.side].x, y: w.spawns[u.side].y };
        if (dest) {
          const p = findPath(w.blocked, u.x, u.y, dest.x, dest.y);
          if (p) { u.path = p; u.pathI = 0; u.repathT = 0.5; }
          else { u.order = { kind: 'idle' }; u.path = []; }
        }
        u.x += (rngNext(w) - 0.5) * 6;
        u.y += (rngNext(w) - 0.5) * 6;
      }
      u.lastX = u.x; u.lastY = u.y;
      u.stuckT = 0;
    }
  } else {
    u.stuckT = 0;
    u.lastX = u.x; u.lastY = u.y;
  }
}

/* ---------------- 分离 / 推挤 ---------------- */

function separate(w: World): void {
  const us = w.units;
  const n = us.length;
  for (let i = 0; i < n; i++) {
    const a = us[i];
    if (a.dead) continue;
    const ra = UNIT_DEFS[a.type].radius;
    for (let j = i + 1; j < n; j++) {
      const b = us[j];
      if (b.dead) continue;
      const rr = ra + UNIT_DEFS[b.type].radius;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 0.01;
      const p = (rr - d) / 2 / d;
      a.x -= dx * p; a.y -= dy * p;
      b.x += dx * p; b.y += dy * p;
    }
  }
  for (const u of w.units) {
    if (u.dead) continue;
    const r = UNIT_DEFS[u.type].radius;
    u.x = Math.max(r, Math.min(MAP_W - r, u.x));
    u.y = Math.max(r, Math.min(MAP_H - r, u.y));
    for (const b of w.buildings) {
      if (b.dead) continue;
      const ex = b.half + r, ey = b.half + r;
      const dx = u.x - b.x, dy = u.y - b.y;
      if (Math.abs(dx) < ex && Math.abs(dy) < ey) {
        const px = ex - Math.abs(dx), py = ey - Math.abs(dy);
        if (px < py) u.x = b.x + Math.sign(dx || 1) * ex;
        else u.y = b.y + Math.sign(dy || 1) * ey;
      }
    }
  }
}

/* ---------------- 经济 / 生产 / 建筑 ---------------- */

function updateEconomy(w: World, dt: number): void {
  const inc = new Array<number>(w.players).fill(0);
  for (const b of w.buildings) {
    if (b.dead || b.buildT > 0) continue;
    const d = BUILDING_DEFS[b.type];
    if (d.income) inc[b.side] += d.income;
  }
  // 难度倍率只作用于 AI（1 号及之后），玩家恒为 1.0。
  // 96×96 大三角上三方相距甚远，1v2 的压力主要来自两线作战本身，AI 经济不额外补偿。
  const aiScale = 1;
  for (let s = 1; s < w.players; s++) inc[s] *= DIFFICULTY[w.difficulty].incomeMult * aiScale;
  w.income = inc;
  for (let s = 0; s < w.players; s++) {
    w.crystals[s] += inc[s] * dt;
    w.stats.earned[s] += inc[s] * dt;
    if (w.popUsed[s] > w.stats.peakPop[s]) w.stats.peakPop[s] = w.popUsed[s];
  }
}

function spawnFrom(w: World, b: Building): void {
  const t = b.trainType as UnitType;
  const d = UNIT_DEFS[t];
  let rally = b.rally ?? w.rally[b.side];
  // 阵型辅助：auto 集结（默认开）→ 新兵自动奔赴己方军队质心，不用手动带队
  if (!b.rally && w.rallyAuto[b.side]) {
    let sx = 0, sy = 0, n = 0;
    for (const u of w.units) {
      if (u.dead || u.side !== b.side) continue;
      sx += u.x; sy += u.y; n++;
    }
    if (n > 0) rally = { x: sx / n, y: sy / n };
  }
  let px = b.x + b.half + d.radius + 4, py = b.y;
  const base = Math.atan2(rally.y - b.y, rally.x - b.x);
  let found = false;
  for (let k = 0; k < 12 && !found; k++) {
    const a = base + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
    const x = b.x + Math.cos(a) * (b.half + d.radius + 4);
    const y = b.y + Math.sin(a) * (b.half + d.radius + 4);
    if (isBlockedTile(w.blocked, Math.floor(x / TILE), Math.floor(y / TILE))) continue;
    px = x; py = y; found = true;
  }
  const u = addUnit(w, b.side, t, px, py);
  w.stats.trained[b.side]++;
  setMoveOrder(w, u, rally.x, rally.y);
}

function addUnit(w: World, side: Side, type: UnitType, x: number, y: number): Unit {
  const d = UNIT_DEFS[type];
  const u: Unit = {
    id: w.nextId++,
    side, type,
    x, y,
    hp: d.hp, maxHp: d.hp,
    cd: rngNext(w) * 0.3,
    facing: Math.atan2(MAP_H / 2 - y, MAP_W / 2 - x),
    order: { kind: 'idle' },
    engageId: null,
    path: [], pathI: 0,
    repathT: 0, stuckT: 0,
    lastX: x, lastY: y,
    dead: false,
  };
  w.units.push(u);
  w.index.set(u.id, u);
  return u;
}

function updateProduction(w: World, dt: number): void {
  for (let s = 0; s < w.players; s++) {
    if (w.queue[s].length) {
      const free = w.buildings.filter(b => b.side === s && b.type === 'barracks' && !b.dead && b.buildT <= 0 && b.trainType === null);
      for (const b of free) {
        if (!w.queue[s].length) break;
        const t = w.queue[s][0];
        const d = UNIT_DEFS[t];
        if (w.popUsed[s] + d.pop > POP_CAP) break;
        w.queue[s].shift();
        b.trainType = t;
        b.trainT = d.trainTime;
        w.popUsed[s] += d.pop;
      }
    }
    for (const b of w.buildings) {
      if (b.side !== s || b.type !== 'barracks' || b.dead || b.buildT > 0 || !b.trainType) continue;
      b.trainT -= dt;
      if (b.trainT <= 0) {
        spawnFrom(w, b);
        b.trainType = null;
      }
    }
  }
}

function updateBuildings(w: World, dt: number): void {
  for (const b of w.buildings) {
    if (b.dead) continue;
    if (b.buildT > 0) {
      b.buildT -= dt;
      if (b.buildT <= 0) {
        b.buildT = 0;
        ev(w, { type: 'built', x: b.x, y: b.y, side: b.side });
      }
      continue;
    }
    const wpn = BUILDING_DEFS[b.type].weapon;
    if (!wpn) continue;
    b.cd = Math.max(0, b.cd - dt);
    let best: Unit | null = null;
    let bd = Infinity;
    for (const u of w.units) {
      if (u.dead || u.side === b.side) continue;
      const d = dist(u.x, u.y, b.x, b.y) - UNIT_DEFS[u.type].radius;
      if (d <= wpn.range && d < bd) { bd = d; best = u; }
    }
    if (best && b.cd <= 0) {
      b.cd = wpn.cooldown;
      b.facing = Math.atan2(best.y - b.y, best.x - b.x);
      applyDamage(w, best, wpn.damage, b.side);
      ev(w, {
        type: 'shot', x: b.x, y: b.y, tx: best.x, ty: best.y,
        side: b.side, big: false, targetSide: best.side, melee: false, from: 'tower',
      });
      w.projectiles.push({
        x: b.x, y: b.y, sx: b.x, sy: b.y, tx: best.x, ty: best.y,
        t: 0, dur: Math.max(0.06, bd / wpn.projectileSpeed),
        side: b.side, big: false, arrow: false,
      });
    }
  }
}

/* ---------------- 清理与胜负 ---------------- */

function cleanup(w: World): void {
  const deadIds = new Set<number>();

  const deadUnits = w.units.filter(u => u.dead);
  for (const u of deadUnits) {
    deadIds.add(u.id);
    w.index.delete(u.id);
    ev(w, {
      type: 'die', x: u.x, y: u.y, r: UNIT_DEFS[u.type].radius,
      side: u.side, big: u.type === 'heavy',
    });
    w.popUsed[u.side] -= UNIT_DEFS[u.type].pop;
  }
  if (deadUnits.length) w.units = w.units.filter(u => !u.dead);

  const deadB = w.buildings.filter(b => b.dead);
  for (const b of deadB) {
    deadIds.add(b.id);
    w.index.delete(b.id);
    ev(w, { type: 'boom', x: b.x, y: b.y, big: b.type === 'hq' });
    setBuildingTiles(w, b, 0);
    if (b.type === 'mine') {
      const n = w.nodes.find(n => n.mineId === b.id);
      if (n) n.mineId = null;
    }
    if (b.type === 'barracks') {
      if (b.trainType) {
        const d = UNIT_DEFS[b.trainType];
        w.crystals[b.side] += d.cost;
        w.popUsed[b.side] -= d.pop;
        b.trainType = null;
      }
      const hasOther = w.buildings.some(o => o !== b && !o.dead && o.side === b.side && o.type === 'barracks' && o.buildT <= 0);
      if (!hasOther) {
        for (const t of w.queue[b.side]) w.crystals[b.side] += UNIT_DEFS[t].cost;
        w.queue[b.side] = [];
      }
    }
    if (b.type === 'hq' && !w.gameOver) {
      // 混战：主基地被毁即出局，最后存活的一方获胜（同时被灭则为平局）
      w.alive[b.side] = false;
      ev(w, { type: 'eliminated', side: b.side });
      const rest: Side[] = [];
      for (let s = 0; s < w.players; s++) if (w.alive[s]) rest.push(s as Side);
      if (rest.length <= 1) {
        const winner = rest.length === 1 ? rest[0] : null;
        w.gameOver = { winner };
        ev(w, { type: 'gameOver', winner });
      }
    }
  }
  if (deadB.length) w.buildings = w.buildings.filter(b => !b.dead);

  if (deadIds.size) {
    for (const u of w.units) {
      if (u.engageId !== null && deadIds.has(u.engageId)) u.engageId = null;
    }
  }
}

/* ---------------- 主步进 ---------------- */

export function stepWorld(w: World, dt: number): void {
  if (w.gameOver) return;
  w.time += dt;
  w.tick++;
  aiThink(w, dt);
  updateEconomy(w, dt);
  updateProduction(w, dt);
  updateBuildings(w, dt);
  for (const u of w.units) {
    if (!u.dead) updateUnit(w, u, dt);
  }
  separate(w);
  for (let i = w.projectiles.length - 1; i >= 0; i--) {
    const p = w.projectiles[i];
    p.t += dt;
    if (p.t >= p.dur) {
      w.projectiles.splice(i, 1);
      continue;
    }
    const k = p.t / p.dur;
    p.x = p.sx + (p.tx - p.sx) * k;
    p.y = p.sy + (p.ty - p.sy) * k;
  }
  cleanup(w);

  // 王冠之地终局（3 人局）：600 秒后，质心 350 内唯一驻军（≥12 人口）持续 45 秒即胜
  if (w.players === 3 && w.time >= 600 && w.tick % 15 === 0) {
    const cx = MAP_W / 2, cy = MAP_H / 2;
    const popIn = new Array(w.players).fill(0);
    for (const u of w.units) {
      if (u.dead) continue;
      const dx = u.x - cx, dy = u.y - cy;
      if (dx * dx + dy * dy <= 350 * 350) popIn[u.side] += UNIT_DEFS[u.type].pop;
    }
    const holders: Side[] = [];
    for (let s2 = 0; s2 < w.players; s2++) {
      if (w.alive[s2] && popIn[s2] >= 12) holders.push(s2 as Side);
    }
    if (holders.length === 1 && holders[0] === w.crown.side) {
      w.crown.t += 0.25;
    } else if (holders.length === 1) {
      w.crown.side = holders[0];
      w.crown.t = 0.25;
    } else {
      w.crown.side = null;
      w.crown.t = 0;
    }
    if (w.crown.t >= 45 && !w.gameOver) {
      w.gameOver = { winner: w.crown.side };
      ev(w, { type: 'gameOver', winner: w.crown.side });
    }
  }
}

/* ---------------- 状态指纹 / 序列化（联机与测试用） ---------------- */

/**
 * 世界状态指纹（FNV-1a 变体）。用途：
 *  - 单元测试：同种子跑两遍必须得到同一个值
 *  - 联机：每 N 帧比对双方 hash，第一时间发现 desync
 */
export function hashWorld(w: World): number {
  let h = 2166136261 >>> 0;
  const mix = (n: number): void => {
    h = (h ^ (n | 0)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  const mixF = (n: number): void => mix(Math.round(n * 1000));
  mix(w.tick);
  mixF(w.time);
  mix(w.rngState);
  for (let s = 0; s < w.players; s++) { mixF(w.crystals[s]); mix(w.popUsed[s]); mixF(w.income[s]); }
  for (const u of w.units) {
    if (u.dead) continue;
    mix(u.id); mix(u.side); mix(u.type.length); mixF(u.x); mixF(u.y); mixF(u.hp);
  }
  for (const b of w.buildings) {
    if (b.dead) continue;
    mix(b.id); mix(b.side); mix(b.type.length); mixF(b.hp); mixF(b.buildT);
    if (b.trainType) mix(b.trainType.length);
  }
  for (let s = 0; s < w.players; s++) mix(w.queue[s].length);
  mixF(w.crown.t);
  mix(w.crown.side === null ? -1 : w.crown.side);
  for (let s2 = 0; s2 < w.players; s2++) mix(w.rallyAuto[s2] ? 1 : 0);
  return h >>> 0;
}

/** 可 JSON 化的世界快照（blocked 转普通数组，索引与事件不入库） */
interface WorldSnapshot {
  tick: number; time: number; seed: number; rngState: number; difficulty: World['difficulty'];
  map: number; players: number; spawns: Vec[]; alive: boolean[];
  units: Unit[]; buildings: Building[]; nodes: CrystalNode[]; projectiles: Projectile[];
  crystals: number[]; popUsed: number[]; income: number[]; queue: UnitType[][];
  rally: Vec[]; blocked: number[]; nextId: number;
  gameOver: World['gameOver']; stats: World['stats']; ai: World['ai'];
  crown: World['crown'];
  rallyAuto: boolean[];
}

export function serializeWorld(w: World): string {
  const s: WorldSnapshot = {
    tick: w.tick, time: w.time, seed: w.seed, rngState: w.rngState,     difficulty: w.difficulty,
    map: w.map, players: w.players, spawns: w.spawns, alive: w.alive,
    units: w.units, buildings: w.buildings, nodes: w.nodes, projectiles: w.projectiles,
    crystals: w.crystals, popUsed: w.popUsed, income: w.income, queue: w.queue,
    rally: w.rally, blocked: Array.from(w.blocked), nextId: w.nextId,
    gameOver: w.gameOver, stats: w.stats, ai: w.ai, crown: w.crown, rallyAuto: w.rallyAuto,
  };
  return JSON.stringify(s);
}

/** 反序列化。索引依据 units/buildings 重建，事件清空（事件只是表现层的输出队列） */
export function deserializeWorld(json: string): World {
  const s = JSON.parse(json) as WorldSnapshot;
  const w: World = {
    tick: s.tick, time: s.time, seed: s.seed, rngState: s.rngState,     difficulty: s.difficulty,
    map: s.map, players: s.players, spawns: s.spawns, alive: s.alive,
    units: s.units, buildings: s.buildings, nodes: s.nodes, projectiles: s.projectiles,
    crystals: s.crystals, popUsed: s.popUsed, income: s.income, queue: s.queue,
    rally: s.rally, blocked: Uint8Array.from(s.blocked), index: new Map(),
    nextId: s.nextId, events: [], gameOver: s.gameOver, stats: s.stats, ai: s.ai, crown: s.crown, rallyAuto: s.rallyAuto,
  };
  for (const u of w.units) w.index.set(u.id, u);
  for (const b of w.buildings) w.index.set(b.id, b);
  return w;
}

/* ---------------- 拾取（输入层用） ---------------- */

/** tol 为额外拾取容差（世界单位）。输入层应按 1/cam.scale 换算，保证屏幕上的触控目标大小恒定 */
export function pickUnitAt(w: World, x: number, y: number, side: Side | null, tol = 16): Unit | null {
  let best: Unit | null = null;
  let bd = Infinity;
  for (const u of w.units) {
    if (u.dead) continue;
    if (side !== null && u.side !== side) continue;
    const d = dist(u.x, u.y, x, y);
    if (d <= UNIT_DEFS[u.type].radius + tol && d < bd) { bd = d; best = u; }
  }
  return best;
}

export function pickBuildingAt(w: World, x: number, y: number): Building | null {
  for (const b of w.buildings) {
    if (b.dead) continue;
    if (Math.abs(x - b.x) <= b.half + 8 && Math.abs(y - b.y) <= b.half + 8) return b;
  }
  return null;
}

export function unitsInRect(w: World, x0: number, y0: number, x1: number, y1: number, side: Side): Unit[] {
  const ax = Math.min(x0, x1), ay = Math.min(y0, y1);
  const bx = Math.max(x0, x1), by = Math.max(y0, y1);
  return w.units.filter(u => !u.dead && u.side === side && u.x >= ax && u.x <= bx && u.y >= ay && u.y <= by);
}
