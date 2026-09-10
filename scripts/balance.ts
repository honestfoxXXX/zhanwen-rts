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
import { BUILDING_DEFS, CROWN_WINDOW, DIFFICULTY, MAP_H, MAPS, MAP_W, UNIT_DEFS } from '../src/core/config';
import { createWorld, issueCommand, stepWorld } from '../src/core/sim';
import { playerThink } from './scriptedPlayer';
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
