/**
 * 无头平衡跑批：不依赖浏览器，直接驱动确定性内核。
 *
 *   npm run balance              # 每档 12 局
 *   npm run balance -- 30 900    # 每档 30 局，单局上限 900 秒
 *   ZW_NO_COUNTER=1 npm run balance   # 关闭兵种克制，用于 A/B 对照
 *
 * 脚本内置一个"脚本玩家"（ heuristics ），模拟普通玩家的操作节奏，
 * 用来观察不同难度下的胜率与单局时长。改完 config.ts 后跑一遍，
 * 就能判断数值改动是变好还是变坏。
 */
import { BUILDING_DEFS, DIFFICULTY, MAPS, UNIT_DEFS } from '../src/core/config';
import { findBuildSlot, createWorld, issueCommand, stepWorld } from '../src/core/sim';
import type { Difficulty, UnitType, World } from '../src/core/types';

const STEP = 1 / 60;

const forcedMap = process.env.ZW_MAP !== undefined ? Number(process.env.ZW_MAP) : null;
// 跑批默认按 2 人图校准；ZW_PLAYERS=3 时才在三方图里测，避免把 1v2 和 1v1 混在一起统计
const forcedPlayers = process.env.ZW_PLAYERS !== undefined ? Number(process.env.ZW_PLAYERS) : 2;
const mapPool = MAPS
  .map((m, i) => [m, i] as const)
  .filter(([m]) => m.players === forcedPlayers)
  .map(([, i]) => i);

// A/B 对照：关掉克制关系跑一遍基线
if (process.env.ZW_NO_COUNTER === '1') {
  for (const t of Object.keys(UNIT_DEFS) as UnitType[]) delete UNIT_DEFS[t].dmgBonus;
}

/**
 * 脚本玩家的建造位：与 AI 同一套「+y 指向质心」的偏移坐标系（由 findBuildSlot 旋转）。
 * 1v1 里玩家基地在正南方、质心在正上方，旋转 180° 后与旧写死坐标完全一致。
 */
const P_BARRACKS: [number, number][] = [[160, 140], [-160, 140], [160, 260]];
const P_TOWERS: [number, number][] = [[80, 340], [-80, 340]];
const P_MAX_MINES = 8;
// 三人图的贴身消耗战里兵力攒不起来，脚本玩家的出击门槛也要跟着人数走；
// 1v1 大图上防守方援军近在咫尺，半军出击就是送死 —— 要攒到接近满编
const P_WAVE_POP = forcedPlayers === 3 ? 24 : 50;

function playerThink(w: World): void {
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
      : w.crystals[side] > 500 && hasWorkshop ? (Math.random() < 0.5 ? 'catapult' : 'champion')
      : w.crystals[side] > 300 && hasSmithy ? (Math.random() < 0.5 ? 'knight' : 'pikeman')
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

interface Result {
  win: number; games: number; time: number; kills: number; pop: number;
}

function runGame(diff: Difficulty, seed: number, maxSec: number, scripted: boolean): { winner: Side | null; time: number; kills: number } {
  // ZW_MAP 指定时固定跑该图，否则在对应人数的地图池里按种子轮换（与 main.ts 开局逻辑一致）
  const mapIndex = forcedMap ?? mapPool[seed % mapPool.length];
  const w = createWorld(diff, seed, mapIndex);
  let acc = 0;
  const steps = Math.round(maxSec / STEP);
  for (let i = 0; i < steps && !w.gameOver; i++) {
    stepWorld(w, STEP);
    acc += STEP;
    // 脚本玩家每 0.6 秒决策一次，接近人的操作频率
    if (scripted && acc >= 0.6) { acc = 0; playerThink(w); }
    w.events.length = 0;
  }
  return {
    winner: w.gameOver ? w.gameOver.winner : null,
    time: w.time,
    kills: w.stats.kills[0],
  };
}

function fmt(n: number, w = 7): string { return String(n).padStart(w); }

function run(label: string, scripted: boolean, games: number, maxSec: number): void {
  console.log(`\n== ${label} （单局上限 ${maxSec}s，每档 ${games} 局）==`);
  console.log(['难度', '玩家胜率', '平均时长', '平均击杀', '超时局'].map(s => s.padStart(7)).join(''));
  for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const r: Result = { win: 0, games: 0, time: 0, kills: 0, pop: 0 };
    let timeout = 0;
    for (let i = 0; i < games; i++) {
      const g = runGame(d, 1000 + i * 7919, maxSec, scripted);
      r.games++;
      r.time += g.time;
      r.kills += g.kills;
      if (g.winner === 0) r.win++;
      if (g.winner === null) timeout++;
    }
    const rate = ((r.win / r.games) * 100).toFixed(0) + '%';
    console.log(
      fmt(DIFFICULTY[d].label) + fmt(rate) +
      fmt((r.time / r.games).toFixed(0) + 's') +
      fmt((r.kills / r.games).toFixed(1)) +
      fmt(String(timeout)),
    );
  }
}

const games = Number(process.argv[2] ?? 12);
const maxSec = Number(process.argv[3] ?? 600);
console.log(`兵种克制：${process.env.ZW_NO_COUNTER === '1' ? '关闭（对照基线）' : '开启'}`);
console.log(`地形：${forcedMap !== null ? MAPS[forcedMap].name : `${mapPool.length} 张 ${forcedPlayers} 人图轮换`}`);
run('脚本玩家 vs AI', true, games, maxSec);
run('玩家完全不操作（摆烂基线）', false, Math.max(3, Math.round(games / 3)), maxSec);
