import { BUILDING_DEFS, DIFFICULTY, HQ_POS, UNIT_DEFS } from './config';
import { canPlace, issueCommand, pushEvent } from './sim';
import { rngNext } from './rng';
import type { Building, CrystalNode, Unit, UnitType, Vec, World } from './types';

const BARRACK_SLOTS: [number, number][] = [[200, 280], [520, 280], [200, 400], [520, 400]];
const TOWER_SLOTS: [number, number][] = [[280, 280], [440, 280], [360, 360]];

const TYPES: UnitType[] = ['infantry', 'archer', 'heavy'];

/**
 * 反制表：玩家主力是 T 时，AI 应多出 COUNTER[T]。
 * 对应 config.ts 的克制三角：弓手 › 重装 › 步兵 › 弓手。
 */
const COUNTER: Record<UnitType, UnitType> = {
  heavy: 'archer',
  infantry: 'heavy',
  archer: 'infantry',
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

function orderArmy(w: World, army: Unit[], x: number, y: number): void {
  if (!army.length) return;
  issueCommand(w, { type: 'move', side: 1, ids: army.map(u => u.id), x, y });
}

/** 下一个要占的矿点：有基本盘后优先抢中路（价值最高、双方都能建） */
function nextNode(w: World, hq: Building, mineCount: number): CrystalNode | null {
  const free = w.nodes.filter(n => n.mineId === null);
  if (!free.length) return null;
  let pool = free;
  if (mineCount >= 2) {
    const mid = free.filter(n => n.y > 780 && n.y < 1140);
    if (mid.length) pool = mid;
  }
  let best = pool[0], bd = Infinity;
  for (const n of pool) {
    const d = dist2(hq.x, hq.y, n.x, n.y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** 侦查：以指数衰减累计玩家兵种构成，反映"近期阵容"而非历史总和 */
function updateScout(w: World): void {
  const cnt: Record<UnitType, number> = { infantry: 0, archer: 0, heavy: 0 };
  for (const u of w.units) {
    if (u.dead || u.side !== 0) continue;
    cnt[u.type]++;
  }
  for (const t of TYPES) w.ai.scout[t] = w.ai.scout[t] * 0.9 + cnt[t] * 0.1;
}

/** 按难度权重抽兵，并对玩家主力做针对性加权 */
function pickUnit(w: World, weights: Record<UnitType, number>): UnitType {
  const scout = w.ai.scout;
  const wts: Record<UnitType, number> = { ...weights };
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

/**
 * 波次目标：奇数波去拔玩家矿场断经济，偶数波直捣主基地。
 * 交替是必须的 —— 若按"兵力不足就打矿场"来判，AI 出击时兵力刚好等于 wavePop，
 * 会永远卡在骚扰矿场、从不推主基地（无头跑批实测玩家胜率 100%）。
 */
function pickGoal(w: World, hq: Building, waveIndex: number): Vec {
  const p0 = w.buildings.filter(b => b.side === 0 && !b.dead);
  if (waveIndex % 2 === 1) {
    const mines = p0.filter(b => b.type === 'mine');
    if (mines.length) {
      let best = mines[0], bd = Infinity;
      for (const m of mines) {
        const d = dist2(hq.x, hq.y, m.x, m.y);
        if (d < bd) { bd = d; best = m; }
      }
      return { x: best.x, y: best.y };
    }
  }
  const hq0 = p0.find(b => b.type === 'hq');
  return hq0 ? { x: hq0.x, y: hq0.y } : HQ_POS[0];
}

/** AI 主思考（状态机：发展 → 波次进攻 → 回防 → 溃退） */
export function aiThink(w: World, dt: number): void {
  const st = w.ai;
  if (w.gameOver) return;
  st.waveCd = Math.max(0, st.waveCd - dt);
  st.thinkT -= dt;
  if (st.thinkT > 0) return;

  const d = DIFFICULTY[w.difficulty];
  st.thinkT = d.think + rngNext(w) * 0.2;
  const side = 1 as const;

  const myB = w.buildings.filter(b => b.side === side && !b.dead);
  const hq = myB.find(b => b.type === 'hq');
  if (!hq) return;

  updateScout(w);

  const army = w.units.filter(u => u.side === side && !u.dead);
  const armyPop = army.reduce((n, u) => n + UNIT_DEFS[u.type].pop, 0);
  const armyHp = army.reduce((n, u) => n + u.hp, 0);
  const mines = myB.filter(b => b.type === 'mine');
  const barracksAll = myB.filter(b => b.type === 'barracks');
  const barracks = barracksAll.filter(b => b.buildT <= 0);
  const towers = myB.filter(b => b.type === 'tower');
  const freeNodes = w.nodes.filter(n => n.mineId === null);

  // —— 家里受威胁 → 全军回防
  const threats = w.units.filter(u => u.side === 0 && !u.dead && myB.some(b => dist(u.x, u.y, b.x, b.y) < 300));
  if (threats.length) {
    st.defending = true;
    // 守家不等于龟缩：来犯之敌明显少于己方兵力时顺势反打，
    // 否则 AI 会被玩家的持续施压永久锁在 defending 分支里，从不组织进攻。
    const overmatch = armyPop >= d.wavePop && threats.length <= Math.max(2, army.length >> 2);
    if (overmatch) orderArmy(w, army, HQ_POS[0].x, HQ_POS[0].y);
    else orderArmy(w, army, threats[0].x, threats[0].y);
  } else if (st.defending) {
    const still = w.units.some(u => u.side === 0 && !u.dead && myB.some(b => dist(u.x, u.y, b.x, b.y) < 340));
    if (!still) {
      st.defending = false;
      st.attacking = false;
      st.goal = null;
      st.waveCd = Math.min(st.waveCd, 6);
    }
  }

  // —— 经济：扩张优先于一切（钱够就铺矿，否则 AI 会卡在 2 矿、全程缺钱）
  if (mines.length < d.maxMines && freeNodes.length && w.crystals[side] >= BUILDING_DEFS.mine.cost) {
    const n = nextNode(w, hq, mines.length);
    if (n) issueCommand(w, { type: 'build', side, building: 'mine', x: n.x, y: n.y });
  }

  // —— 兵营
  if (barracksAll.length < d.maxBarracks && w.crystals[side] >= BUILDING_DEFS.barracks.cost + 60 && (mines.length >= 2 || w.crystals[side] >= 320)) {
    const slot = BARRACK_SLOTS.find(s => canPlace(w, side, 'barracks', s[0], s[1]).ok);
    if (slot) issueCommand(w, { type: 'build', side, building: 'barracks', x: slot[0], y: slot[1] });
  }

  // —— 箭塔
  if (towers.length < d.maxTowers && w.crystals[side] >= BUILDING_DEFS.tower.cost + 140) {
    const slot = TOWER_SLOTS.find(s => canPlace(w, side, 'tower', s[0], s[1]).ok);
    if (slot) issueCommand(w, { type: 'build', side, building: 'tower', x: slot[0], y: slot[1] });
  }

  // —— 造兵（被压着打时排队更深，靠产能而非操作扳回来）
  const maxQueue = st.defending ? 6 : 3;
  if (barracks.length && w.queue[side].length < maxQueue) {
    const t = pickUnit(w, d.weights);
    const ud = UNIT_DEFS[t];
    // 矿没铺满时给扩张留足预算，避免造兵把经济钱吃光
    const reserve = freeNodes.length && mines.length < d.maxMines ? BUILDING_DEFS.mine.cost : 0;
    if (w.crystals[side] >= ud.cost + reserve && w.popUsed[side] + ud.pop <= 40) {
      issueCommand(w, { type: 'train', side, unit: t });
    }
  }

  // —— 波次进攻
  if (!st.defending && !st.attacking && st.waveCd <= 0 && armyPop >= d.wavePop && army.length >= 4) {
    st.attacking = true;
    st.waveStart = armyHp;
    st.goal = pickGoal(w, hq, st.waves); // 第 0 波直捣主基地，之后隔波骚扰矿场
    st.waves++;
    orderArmy(w, army, st.goal.x, st.goal.y);
    pushEvent(w, { type: 'wave' }); // 敌袭预警
  } else if (st.attacking) {
    const nowHp = army.reduce((n, u) => n + u.hp, 0);
    if (nowHp < st.waveStart * 0.35 || armyPop === 0) {
      st.attacking = false;
      st.goal = null;
      st.waveCd = d.waveCd;
      if (d.retreat && armyPop > 0) orderArmy(w, army, HQ_POS[1].x, HQ_POS[1].y + 160);
    } else {
      // 增援：集结点待命的新兵补入进攻（简单档不增援，保持离散波次节奏）
      const goal = st.goal ?? pickGoal(w, hq, st.waves);
      const idlers = army.filter(u => u.order.kind === 'idle');
      if (idlers.length >= 3 && w.difficulty !== 'easy') orderArmy(w, idlers, goal.x, goal.y);
    }
  }
}
