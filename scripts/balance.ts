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
import { canPlace, createWorld, issueCommand, stepWorld } from '../src/core/sim';
import type { Difficulty, UnitType, World } from '../src/core/types';

const STEP = 1 / 60;

const forcedMap = process.env.ZW_MAP !== undefined ? Number(process.env.ZW_MAP) : null;

// A/B 对照：关掉克制关系跑一遍基线
if (process.env.ZW_NO_COUNTER === '1') {
  for (const t of Object.keys(UNIT_DEFS) as UnitType[]) delete UNIT_DEFS[t].dmgBonus;
}

/** 脚本玩家的建造位（己方半场内，避开矿点） */
const P_BARRACKS: [number, number][] = [[200, 1500], [520, 1500], [200, 1380]];
const P_TOWERS: [number, number][] = [[280, 1300], [440, 1300]];
const P_MAX_MINES = 6;
const P_WAVE_POP = 18;

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

  // 经济：铺矿（先自家后中路）
  if (mines.length < P_MAX_MINES && free.length && w.crystals[side] >= BUILDING_DEFS.mine.cost) {
    let pool = free.filter(n => n.y > 1300);
    if (!pool.length || mines.length >= 2) pool = free;
    let best = pool[0], bd = Infinity;
    for (const n of pool) {
      const d = (n.x - hq.x) ** 2 + (n.y - hq.y) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    issueCommand(w, { type: 'build', side, building: 'mine', x: best.x, y: best.y });
  }

  // 兵营 / 箭塔
  if (barracksAll.length < 2 && w.crystals[side] >= BUILDING_DEFS.barracks.cost + 60 && mines.length >= 1) {
    const slot = P_BARRACKS.find(s => canPlace(w, side, 'barracks', s[0], s[1]).ok);
    if (slot) issueCommand(w, { type: 'build', side, building: 'barracks', x: slot[0], y: slot[1] });
  }
  if (towers.length < 1 && w.crystals[side] >= BUILDING_DEFS.tower.cost + 140 && mines.length >= 2) {
    const slot = P_TOWERS.find(s => canPlace(w, side, 'tower', s[0], s[1]).ok);
    if (slot) issueCommand(w, { type: 'build', side, building: 'tower', x: slot[0], y: slot[1] });
  }

  // 造兵：按固定配比，钱够就排队
  if (barracks.length && w.queue[side].length < 3) {
    const t: UnitType = w.crystals[side] > 260 ? 'heavy' : w.crystals[side] > 90 ? 'archer' : 'infantry';
    if (w.crystals[side] >= UNIT_DEFS[t].cost) issueCommand(w, { type: 'train', side, unit: t });
  }

  // 出兵：攒够一波就平推
  const army = w.units.filter(u => u.side === side && !u.dead);
  const pop = army.reduce((n, u) => n + UNIT_DEFS[u.type].pop, 0);
  const idle = army.filter(u => u.order.kind === 'idle');
  if (pop >= P_WAVE_POP && idle.length >= 4) {
    issueCommand(w, { type: 'move', side, ids: idle.map(u => u.id), x: 360, y: 280 });
  }
}

interface Result {
  win: number; games: number; time: number; kills: number; pop: number;
}

function runGame(diff: Difficulty, seed: number, maxSec: number, scripted: boolean): { winner: 0 | 1 | null; time: number; kills: number } {
  // ZW_MAP 指定时固定跑该图，否则按种子轮换（与 main.ts 的开局逻辑一致）
  const w = createWorld(diff, seed, forcedMap ?? seed % MAPS.length);
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
console.log(`地形：${forcedMap !== null ? MAPS[forcedMap].name : `${MAPS.length} 张轮换`}`);
run('脚本玩家 vs AI', true, games, maxSec);
run('玩家完全不操作（摆烂基线）', false, Math.max(3, Math.round(games / 3)), maxSec);
