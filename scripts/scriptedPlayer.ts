/**
 * 脚本玩家：模拟一个"会玩但不算顶尖"的人类操作者，供平衡跑批与 3P 诊断探针共用。
 * 与 AI 同一套取位/科技攒钱机制；三人局残局会去质心抢王冠。
 */
import { BUILDING_DEFS, CROWN_WINDOW, MAP_H, MAP_W, UNIT_DEFS } from '../src/core/config';
import { findBuildSlot, issueCommand, type World } from '../src/core/sim';
import { rngNext } from '../src/core/rng';
import type { Side, UnitType } from '../src/core/types';

const ZW_PLAYERS = process.env.ZW_PLAYERS !== undefined ? Number(process.env.ZW_PLAYERS) : 2;

/** 建造位：与 AI 同一套「+y 指向质心」的偏移坐标系（由 findBuildSlot 旋转） */
const P_BARRACKS: [number, number][] = [[160, 140], [-160, 140], [160, 260]];
const P_TOWERS: [number, number][] = [[80, 340], [-80, 340]];
const P_MAX_MINES = 8;
// 三人图的贴身消耗战里兵力攒不起来，出击门槛也要跟着人数走；
// 1v1 大图上防守方援军近在咫尺，半军出击就是送死 —— 要攒到接近满编
const P_WAVE_POP = ZW_PLAYERS === 3 ? 24 : 50;

export function playerThink(w: World): void {
  const side = 0 as const;
  const myB = w.buildings.filter(b => b.side === side && !b.dead);
  const hq = myB.find(b => b.type === 'hq');
  if (!hq) return;

  const mines = myB.filter(b => b.type === 'mine');
  const barracksAll = myB.filter(b => b.type === 'barracks');
  const barracks = barracksAll.filter(b => b.buildT <= 0);
  const towers = myB.filter(b => b.type === 'tower');
  const free = w.nodes.filter(n => n.mineId === null);

  // 经济：铺矿（先自家附近，后全场争夺）
  if (mines.length < P_MAX_MINES && free.length && w.crystals[side] >= BUILDING_DEFS.mine.cost) {
    let pool = free.filter(n => Math.hypot(n.x - hq.x, n.y - hq.y) < 500);
    if (!pool.length || mines.length >= 2) pool = free;
    let best = pool[0], bd = Infinity;
    for (const n of pool) {
      const d = (n.x - hq.x) ** 2 + (n.y - hq.y) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    issueCommand(w, { type: 'build', side, building: 'mine', x: best.x, y: best.y });
  }

  // 兵营 / 箭塔（与 AI 同一套取位逻辑，按质心方位旋转）
  if (barracksAll.length < 3 && w.crystals[side] >= BUILDING_DEFS.barracks.cost + 60 && mines.length >= 1) {
    const slot = findBuildSlot(w, side, 'barracks', P_BARRACKS);
    if (slot) issueCommand(w, { type: 'build', side, building: 'barracks', x: slot.x, y: slot.y });
  }
  if (towers.length < 1 && w.crystals[side] >= BUILDING_DEFS.tower.cost + 140 && mines.length >= 2) {
    const slot = findBuildSlot(w, side, 'tower', P_TOWERS);
    if (slot) issueCommand(w, { type: 'build', side, building: 'tower', x: slot.x, y: slot.y });
  }
  // 科技建筑阶梯（与 AI 同规则：矿线达标后投资二/三本）
  if (!myB.some(b => b.type === 'smithy') && mines.length >= 4 && w.crystals[side] >= BUILDING_DEFS.smithy.cost + 100) {
    const slot = findBuildSlot(w, side, 'smithy', P_BARRACKS);
    if (slot) issueCommand(w, { type: 'build', side, building: 'smithy', x: slot.x, y: slot.y });
  }
  if (myB.some(b => b.type === 'smithy' && !b.dead) && !myB.some(b => b.type === 'workshop') &&
      mines.length >= 6 && w.crystals[side] >= BUILDING_DEFS.workshop.cost + 200) {
    const slot = findBuildSlot(w, side, 'workshop', P_BARRACKS);
    if (slot) issueCommand(w, { type: 'build', side, building: 'workshop', x: slot.x, y: slot.y });
  }

  // 造兵：按固定配比，钱够就排队
  if (barracks.length && w.queue[side].length < 3) {
    const hasSmithy = myB.some(b => b.type === 'smithy' && !b.dead && b.buildT <= 0);
    const hasWorkshop = myB.some(b => b.type === 'workshop' && !b.dead && b.buildT <= 0);
    // 科技攒钱（与 AI 同机制）：矿线达标而科技未建时压住出兵，让金过门槛
    const wantSmithy = !hasSmithy && mines.length >= 4;
    const wantWorkshop = hasSmithy && !hasWorkshop && mines.length >= 6;
    const saving = (wantSmithy && w.crystals[side] < BUILDING_DEFS.smithy.cost + 100) ||
      (wantWorkshop && w.crystals[side] < BUILDING_DEFS.workshop.cost + 200);
    // 攒钱期不完全停兵：仍出最便宜的步兵填线，避免两分钟兵力真空
    const t: UnitType = saving
      ? 'infantry'
      // 用世界 RNG 而非 Math.random：同种子跑批逐位可复现（Math.random 是平衡验证的噪声源）
      : w.crystals[side] > 500 && hasWorkshop ? (rngNext(w) < 0.5 ? 'catapult' : 'champion')
      : w.crystals[side] > 300 && hasSmithy ? (rngNext(w) < 0.5 ? 'knight' : 'pikeman')
      : w.crystals[side] > 260 ? 'heavy'
      : w.crystals[side] > 90 ? 'archer'
      : 'infantry';
    if (w.crystals[side] >= UNIT_DEFS[t].cost) issueCommand(w, { type: 'train', side, unit: t });
  }

  // 家园/矿线遇袭 → 全军回防拦截。这是普通玩家听到告警后的本能反应；
  // 大图上不防守的玩家会被 AI 的经济袭扰活活磨死。
  const army = w.units.filter(u => u.side === side && !u.dead);
  const idle = army.filter(u => u.order.kind === 'idle');
  const pop = army.reduce((n, u) => n + UNIT_DEFS[u.type].pop, 0);
  const raiders = w.units.filter(u => u.side !== side && !u.dead &&
    myB.some(b => Math.hypot(u.x - b.x, u.y - b.y) < 420));
  if (raiders.length && army.length >= 6) {
    issueCommand(w, { type: 'move', side, ids: army.map(u => u.id), x: raiders[0].x, y: raiders[0].y });
  } else if (w.players === 3 && w.time >= CROWN_WINDOW - 40 && pop >= 12 && idle.length >= 4) {
    // 三人局残局：像 informed 玩家一样去质心抢王冠——开窗后这是唯一的胜利出口
    issueCommand(w, { type: 'move', side, ids: idle.map(u => u.id), x: MAP_W / 2, y: MAP_H / 2 });
  } else if (w.players === 3 && w.time < CROWN_WINDOW - 40) {
    // 三人局开窗前不主动进攻：大三角上扩张最快的一方会被两个 AI 同时盯上
    // （矿线在前沿=最近的袭击目标），主动出兵等于把仅有的兵力对半送。攒兵等王冠。
  } else if (pop >= P_WAVE_POP && idle.length >= 4) {
    // 出兵：大图上城堡有零距离援军，直冲主基地必被耗死 —— 像人一样先拆最近的
    // 敌方矿断经济，矿拆光了再推家。攒到接近满编再动身。
    const foeMines = w.buildings.filter(b => b.side !== side && b.type === 'mine' && !b.dead);
    const foeHqs = w.buildings.filter(b => b.side !== side && b.type === 'hq' && !b.dead);
    const targets = foeMines.length ? foeMines : foeHqs;
    if (targets.length) {
      let best = targets[0], bd = Infinity;
      for (const h of targets) {
        const d = (h.x - hq.x) ** 2 + (h.y - hq.y) ** 2;
        if (d < bd) { bd = d; best = h; }
      }
      issueCommand(w, { type: 'move', side, ids: idle.map(u => u.id), x: best.x, y: best.y });
    }
  }
}
