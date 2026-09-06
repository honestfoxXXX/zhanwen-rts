import { BUILDING_DEFS, DIFFICULTY, MAP_H, MAP_W, POP_CAP, UNIT_DEFS } from './config';
import { canPlace, findBuildSlot, issueCommand, pushEvent } from './sim';
import { rngNext } from './rng';
import type { Building, CrystalNode, Side, Unit, UnitType, Vec, World } from './types';

type DifficultyDef = (typeof DIFFICULTY)[World['difficulty']];

/**
 * 建筑位用相对主基地的偏移表示，而不是写死坐标 ——
 * 偏移定义在「+y 指向地图质心」的坐标系里，由 findBuildSlot 按本方基地的方位旋转。
 * 三方等边三角布局下各基地朝向差 120°，每个 AI 的家都能面朝质心布置。
 */
const BARRACK_OFFSETS: [number, number][] = [[-80, 40], [80, 40], [-80, -60], [80, -60]];
const TOWER_OFFSETS: [number, number][] = [[-40, 80], [40, 80], [0, -90]];

const TYPES: UnitType[] = ['infantry', 'archer', 'heavy'];

/**
 * 反制表：对手主力是 T 时，应多出 COUNTER[T]。
 * 对应 config.ts 的克制三角：弓手 › 重装 › 步兵 › 弓手。
 */
const COUNTER: Record<UnitType, UnitType> = {
  heavy: 'archer',
  infantry: 'heavy',
  archer: 'infantry',
  knight: 'pikeman',
  pikeman: 'knight',
  catapult: 'knight',
  champion: 'pikeman',
};

/** 确定性距离（与 sim 保持一致：不用 Math.hypot） */
function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}
function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}

function orderArmy(w: World, side: Side, army: Unit[], x: number, y: number): void {
  if (!army.length) return;
  issueCommand(w, { type: 'move', side, ids: army.map(u => u.id), x, y });
}

/** 撤退集结点：沿「出生点背离地图质心」方向后撤，双轴通用（对角 / 三角都成立） */
function retreatSpot(w: World, side: Side): Vec {
  const home = w.spawns[side];
  const dx = home.x - MAP_W / 2, dy = home.y - MAP_H / 2;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const x = Math.max(60, Math.min(MAP_W - 60, home.x + (dx / len) * 160));
  const y = Math.max(60, Math.min(MAP_H - 60, home.y + (dy / len) * 160));
  return { x, y };
}

/** 下一个要占的矿点：有基本盘后优先抢「比自家更靠近质心」的矿（中路价值最高） */
function nextNode(w: World, hq: Building, mineCount: number): CrystalNode | null {
  const free = w.nodes.filter(n => n.mineId === null);
  if (!free.length) return null;
  let pool = free;
  if (mineCount >= 2) {
    const cx = MAP_W / 2, cy = MAP_H / 2;
    const myCenterD = dist2(hq.x, hq.y, cx, cy);
    const mid = free.filter(n => dist2(n.x, n.y, cx, cy) < myCenterD);
    if (mid.length) pool = mid;
  }
  let best = pool[0], bd = Infinity;
  for (const n of pool) {
    const d = dist2(hq.x, hq.y, n.x, n.y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** 侦查：以指数衰减累计所有敌对单位的兵种构成，反映"近期威胁" */
function updateScout(w: World, side: Side): void {
  const cnt: Record<UnitType, number> = { infantry: 0, archer: 0, heavy: 0, pikeman: 0, knight: 0, catapult: 0, champion: 0 };
  for (const u of w.units) {
    if (u.dead || u.side === side) continue;
    cnt[u.type]++;
  }
  for (const t of TYPES) w.ai[side].scout[t] = w.ai[side].scout[t] * 0.9 + cnt[t] * 0.1;
}

/** 按难度权重抽兵，并对当前主要威胁做针对性加权（缺失兵种权重按 0） */
function pickUnit(w: World, side: Side, weights: Partial<Record<UnitType, number>>): UnitType {
  const scout = w.ai[side].scout;
  const hasSmithy = w.buildings.some(b => b.side === side && b.type === 'smithy' && !b.dead && b.buildT <= 0);
  const hasWorkshop = w.buildings.some(b => b.side === side && b.type === 'workshop' && !b.dead && b.buildT <= 0);
  const wts = Object.assign(
    { infantry: 0, archer: 0, heavy: 0, pikeman: 0, knight: 0, catapult: 0, champion: 0 } as Record<UnitType, number>,
    weights,
  );
  if (hasSmithy) {
    wts.pikeman += 0.35;
    wts.knight += 0.4;
    wts.infantry *= 0.5;
    wts.archer *= 0.5;
    wts.heavy *= 0.5;
  }
  if (hasWorkshop) {
    wts.catapult += 0.35;
    wts.champion += 0.4;
  }
  const seen = scout.infantry + scout.archer + scout.heavy;
  if (seen >= 3) {
    let dom: UnitType = 'infantry';
    for (const t of TYPES) if (scout[t] > scout[dom]) dom = t;
    wts[COUNTER[dom]] += 0.35;
  }
  const sum = wts.infantry + wts.archer + wts.heavy;
  const r = rngNext(w);
  let acc = 0;
  for (const t of TYPES) {
    acc += wts[t] / sum;
    if (r <= acc) return t;
  }
  return 'infantry';
}

/** 波次目标：奇数波拔最近的敌方矿场断经济，偶数波推最近的敌方主基地 */
function pickGoal(w: World, side: Side, hq: Building, waveIndex: number): Vec {
  const foes = w.buildings.filter(b => b.side !== side && !b.dead);
  const wantType = waveIndex % 2 === 1 ? 'mine' : 'hq';
  let pool = foes.filter(b => b.type === wantType);
  if (!pool.length) pool = foes; // 目标类型打光了就打剩下的
  if (!pool.length) return { x: hq.x, y: hq.y };
  let best = pool[0], bd = Infinity;
  for (const m of pool) {
    const d = dist2(hq.x, hq.y, m.x, m.y);
    if (d < bd) { bd = d; best = m; }
  }
  return { x: best.x, y: best.y };
}

/** 单个 AI 阵营的一次思考 */
function aiSide(w: World, side: Side, d: DifficultyDef, dt: number): void {
  const st = w.ai[side];
  st.waveCd = Math.max(0, st.waveCd - dt);
  st.thinkT -= dt;
  if (st.thinkT > 0) return;
  st.thinkT = d.think + rngNext(w) * 0.2;

  const myB = w.buildings.filter(b => b.side === side && !b.dead);
  const hq = myB.find(b => b.type === 'hq');
  if (!hq) return;

  updateScout(w, side);

  const army = w.units.filter(u => u.side === side && !u.dead);
  const armyPop = army.reduce((n, u) => n + UNIT_DEFS[u.type].pop, 0);
  const armyHp = army.reduce((n, u) => n + u.hp, 0);
  const mines = myB.filter(b => b.type === 'mine');
  const barracksAll = myB.filter(b => b.type === 'barracks');
  const barracks = barracksAll.filter(b => b.buildT <= 0);
  const towers = myB.filter(b => b.type === 'tower');
  const smithy = myB.find(b => b.type === 'smithy');
  const workshop = myB.find(b => b.type === 'workshop');
  const freeNodes = w.nodes.filter(n => n.mineId === null);

  // 96×96 大三角上三方相距 2300+，开局不再贴脸消耗，旧强特调（门槛/间隔/建设缩放）作废；
  // 保留温和缩放：出兵门槛 ×0.75 / 间隔 ×0.85，小队袭扰在大图上啃不动满编防守，
  // 必须 30 人口级的波次才能在三方混战里滚出胜负。
  const scale = 1;
  const waveScale = w.players === 3 ? 0.75 : 1;
  const cdScale = w.players === 3 ? 0.85 : 1;
  const maxMines = Math.round(d.maxMines * scale);
  const maxBarracks = Math.round(d.maxBarracks * scale);
  const maxTowers = Math.round(d.maxTowers * scale);
  const wavePop = d.wavePop * waveScale;

  // —— 家里进了敌人（任意他方）→ 回防。
  // 威胁半径在三人图收紧：三角几何下各家前哨矿与邻居的集结部队相距 ~220-300，
  // 用 1v1 的 300 会让邻居的常备兵力永远算作"来犯之敌"，三方全部锁死在防御态、
  // 波次永不触发、全员对峙到超时。只有真正踩到建筑（<180）才算入侵。
  const homeR = w.players === 3 ? 180 : 300;
  const threats = w.units.filter(u => u.side !== side && !u.dead && myB.some(b => dist(u.x, u.y, b.x, b.y) < homeR));
  if (threats.length) {
    st.defending = true;
    // 守家不等于龟缩：来犯之敌明显少于己方兵力时顺势反打，
    // 否则 AI 会被持续施压永久锁在 defending 分支里，从不组织进攻。
    const overmatch = armyPop >= wavePop && threats.length <= Math.max(2, army.length >> 2);
    if (overmatch) {
      const g = pickGoal(w, side, hq, st.waves);
      orderArmy(w, side, army, g.x, g.y);
    } else {
      orderArmy(w, side, army, threats[0].x, threats[0].y);
    }
  } else if (st.defending) {
    const still = w.units.some(u => u.side !== side && !u.dead && myB.some(b => dist(u.x, u.y, b.x, b.y) < homeR + 40));
    if (!still) {
      st.defending = false;
      st.attacking = false;
      st.goal = null;
      st.waveCd = Math.min(st.waveCd, 6);
    }
  }

  // —— 经济：扩张优先于一切
  if (mines.length < maxMines && freeNodes.length && w.crystals[side] >= BUILDING_DEFS.mine.cost) {
    const n = nextNode(w, hq, mines.length);
    if (n) issueCommand(w, { type: 'build', side, building: 'mine', x: n.x, y: n.y });
  }

  // —— 兵营（相对主基地取位，按质心方位旋转）
  if (barracksAll.length < maxBarracks && w.crystals[side] >= BUILDING_DEFS.barracks.cost + 60 && (mines.length >= 2 || w.crystals[side] >= 320)) {
    const slot = findBuildSlot(w, side, 'barracks', BARRACK_OFFSETS);
    if (slot) issueCommand(w, { type: 'build', side, building: 'barracks', x: slot.x, y: slot.y });
  }

  // —— 箭塔
  if (towers.length < maxTowers && w.crystals[side] >= BUILDING_DEFS.tower.cost + 140) {
    const slot = findBuildSlot(w, side, 'tower', TOWER_OFFSETS);
    if (slot) issueCommand(w, { type: 'build', side, building: 'tower', x: slot.x, y: slot.y });
  }
  // —— 科技建筑阶梯：军械库（T2）→ 攻城工坊（T3）
  if (!smithy && mines.length >= 4 && w.crystals[side] >= BUILDING_DEFS.smithy.cost + 100) {
    const slot = findBuildSlot(w, side, 'smithy', [[-140, 60], [140, 60], [0, 200]]);
    if (slot) issueCommand(w, { type: 'build', side, building: 'smithy', x: slot.x, y: slot.y });
  }
  if (smithy && !workshop && mines.length >= 6 && w.crystals[side] >= BUILDING_DEFS.workshop.cost + 200) {
    const slot = findBuildSlot(w, side, 'workshop', [[-140, -60], [140, -60], [0, -180]]);
    if (slot) issueCommand(w, { type: 'build', side, building: 'workshop', x: slot.x, y: slot.y });
  }

  // —— 造兵（被压着打时排队更深，靠产能而非操作扳回来）
  // 科技攒钱：矿线达标而科技建筑未建时，出兵队列压到 1 让黄金攒过门槛——
  // 否则造兵优先级永远吸金，军械库/工坊 500/1100 金门槛永远达不到（实测 6 分钟零科技）。
  let maxQueue = st.defending ? 6 : 3;
  if (!smithy && mines.length >= 4 && w.crystals[side] < BUILDING_DEFS.smithy.cost + 100) maxQueue = 1;
  else if (smithy && !workshop && mines.length >= 6 && w.crystals[side] < BUILDING_DEFS.workshop.cost + 200) maxQueue = 1;
  if (barracks.length && w.queue[side].length < maxQueue) {
    const t = pickUnit(w, side, d.weights);
    const ud = UNIT_DEFS[t];
    // 矿没铺满时给扩张留足预算，避免造兵把经济钱吃光
    const reserve = freeNodes.length && mines.length < maxMines ? BUILDING_DEFS.mine.cost : 0;
    if (w.crystals[side] >= ud.cost + reserve && w.popUsed[side] + ud.pop <= POP_CAP) {
      issueCommand(w, { type: 'train', side, unit: t });
    }
  }

  // —— 波次进攻
  if (!st.defending && !st.attacking && st.waveCd <= 0 && armyPop >= wavePop && army.length >= 4) {
    st.attacking = true;
    st.waveStart = armyHp;
    st.waveAt = w.time;
    st.goal = pickGoal(w, side, hq, st.waves); // 第 0 波推主基地，之后隔波骚扰矿场
    st.waves++;
    orderArmy(w, side, army, st.goal.x, st.goal.y);
    pushEvent(w, { type: 'wave' }); // 敌袭预警
  } else if (st.attacking) {
    const nowHp = army.reduce((n, u) => n + u.hp, 0);
    // 波次必须有终点。否则首波一旦占上风，AI 会一直续攻、永远走不到收兵分支，
    // 于是 st.waveCd 永远不会被写回，waveCd 这个难度参数彻底失效，"波次"也名存实亡。
    const expired = w.time - st.waveAt > d.waveMax;
    if (nowHp < st.waveStart * 0.35 || armyPop === 0 || expired) {
      st.attacking = false;
      st.goal = null;
      st.waveCd = d.waveCd * cdScale;
      if (d.retreat && armyPop > 0) {
        const spot = retreatSpot(w, side);
        orderArmy(w, side, army, spot.x, spot.y);
      }
    } else {
      // 增援：集结点待命的新兵补入进攻（简单档不增援，保持离散波次节奏）
      const goal = st.goal ?? pickGoal(w, side, hq, st.waves);
      const idlers = army.filter(u => u.order.kind === 'idle');
      if (idlers.length >= 3 && w.difficulty !== 'easy') orderArmy(w, side, idlers, goal.x, goal.y);
    }
  }
}

/** AI 主思考：逐个 AI 阵营推进（1 号及之后，0 号是玩家） */
export function aiThink(w: World, dt: number): void {
  if (w.gameOver) return;
  const d = DIFFICULTY[w.difficulty];
  for (let s = 1; s < w.players; s++) {
    if (!w.alive[s]) continue;
    aiSide(w, s as Side, d, dt);
  }
}
