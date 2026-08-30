import { BUILDING_DEFS, DIFFICULTY, HQ_POS, UNIT_DEFS } from './config';
import { canPlace, issueCommand, pushEvent } from './sim';
import { rngNext } from './rng';
import type { Building, Unit, UnitType, World } from './types';

const BARRACK_SLOTS: [number, number][] = [[200, 280], [520, 280], [200, 400], [520, 400]];
const TOWER_SLOTS: [number, number][] = [[280, 280], [440, 280], [360, 360]];

function orderArmy(w: World, army: Unit[], x: number, y: number): void {
  if (!army.length) return;
  issueCommand(w, { type: 'move', side: 1, ids: army.map(u => u.id), x, y });
}

function nearestNode(w: World, hq: Building) {
  let best = w.nodes[0];
  let bd = Infinity;
  for (const n of w.nodes) {
    if (n.mineId !== null) continue;
    const d = Math.hypot(n.x - hq.x, n.y - hq.y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function pickUnit(w: World, weights: Record<UnitType, number>): UnitType {
  const r = rngNext(w);
  let acc = 0;
  for (const t of Object.keys(weights) as UnitType[]) {
    acc += weights[t];
    if (r <= acc) return t;
  }
  return 'infantry';
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

  const army = w.units.filter(u => u.side === side && !u.dead);
  const armyPop = army.reduce((n, u) => n + UNIT_DEFS[u.type].pop, 0);
  const armyHp = army.reduce((n, u) => n + u.hp, 0);
  const mines = myB.filter(b => b.type === 'mine');
  const barracksAll = myB.filter(b => b.type === 'barracks');
  const barracks = barracksAll.filter(b => b.buildT <= 0);
  const towers = myB.filter(b => b.type === 'tower');
  const freeNodes = w.nodes.filter(n => n.mineId === null);

  // —— 家里受威胁 → 全军回防
  const threats = w.units.filter(u => u.side === 0 && !u.dead && myB.some(b => Math.hypot(u.x - b.x, u.y - b.y) < 300));
  if (threats.length) {
    st.defending = true;
    orderArmy(w, army, threats[0].x, threats[0].y);
  } else if (st.defending) {
    const still = w.units.some(u => u.side === 0 && !u.dead && myB.some(b => Math.hypot(u.x - b.x, u.y - b.y) < 340));
    if (!still) {
      st.defending = false;
      st.attacking = false;
      st.waveCd = Math.min(st.waveCd, 6);
    }
  }

  // —— 经济：优先铺矿
  if (mines.length < d.maxMines && freeNodes.length) {
    const reserve = barracksAll.length < d.maxBarracks ? 150 : 0;
    if (w.crystals[side] >= BUILDING_DEFS.mine.cost + (mines.length < 2 ? 0 : reserve)) {
      issueCommand(w, { type: 'build', side, building: 'mine', x: nearestNode(w, hq).x, y: nearestNode(w, hq).y });
    }
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

  // —— 造兵
  if (barracks.length && w.queue[side].length < 3) {
    const t = pickUnit(w, d.weights);
    const ud = UNIT_DEFS[t];
    const reserve = freeNodes.length && mines.length < d.maxMines ? 60 : 0;
    if (w.crystals[side] >= ud.cost + reserve && w.popUsed[side] + ud.pop <= 40) {
      issueCommand(w, { type: 'train', side, unit: t });
    }
  }

  // —— 波次进攻
  if (!st.defending && !st.attacking && st.waveCd <= 0 && armyPop >= d.wavePop && army.length >= 4) {
    st.attacking = true;
    st.waveStart = armyHp;
    orderArmy(w, army, HQ_POS[0].x, HQ_POS[0].y);
    pushEvent(w, { type: 'wave' }); // 敌袭预警
  } else if (st.attacking) {
    const nowHp = army.reduce((n, u) => n + u.hp, 0);
    if (nowHp < st.waveStart * 0.35 || armyPop === 0) {
      st.attacking = false;
      st.waveCd = d.waveCd;
      if (d.retreat && armyPop > 0) orderArmy(w, army, HQ_POS[1].x, HQ_POS[1].y + 160);
    } else {
      // 增援：集结点待命的新兵补入进攻（简单档不增援，保持离散波次节奏）
      const idlers = army.filter(u => u.order.kind === 'idle');
      if (idlers.length >= 3 && w.difficulty !== 'easy') orderArmy(w, idlers, HQ_POS[0].x, HQ_POS[0].y);
    }
  }
}
