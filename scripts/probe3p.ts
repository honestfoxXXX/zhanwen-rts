/**
 * 3P 诊断探针：三方混战里 side 0（脚本玩家）为何全败。
 * 每 60s 输出三方经济/兵力快照 + 攻击关系矩阵；出局时报告击杀者。
 * 用法：ZW_PLAYERS=3 vite-node scripts/probe3p.ts [难度=normal] [局数=3]
 */
import { UNIT_DEFS } from '../src/core/config';
import { createWorld, stepWorld, type World, type Side } from '../src/core/sim';
import { playerThink } from './scriptedPlayer';
import type { Difficulty } from '../src/core/types';

const STEP = 1 / 60;
const diff = (process.argv[2] ?? 'normal') as Difficulty;
const games = Number(process.argv[3] ?? 3);

// 攻击关系累计：dmg[a][b] = a 对 b 造成的总伤害（含建筑）
const dmgTo: number[][] = [];
let lastMinute = -1;

function snapshot(w: World, label: string): void {
  const parts: string[] = [];
  for (let s = 0 as Side; s < w.players; s++) {
    const army = w.units.filter(u => u.side === s && !u.dead);
    const pop = army.reduce((n, u) => n + UNIT_DEFS[u.type].pop, 0);
    const mines = w.buildings.filter(b => b.side === s && b.type === 'mine' && !b.dead).length;
    const hq = w.buildings.find(b => b.side === s && b.type === 'hq');
    const hqHp = hq ? Math.round((hq.hp / hq.maxHp) * 100) : 0;
    parts.push(`s${s} 金${Math.round(w.crystals[s])} 矿${mines} 兵${pop} 城堡${hqHp}%`);
  }
  const matrix = dmgTo.map((row, a) =>
    row.map((v, b) => (a === b || v < 200 ? null : `${a}->${b}:${Math.round(v)}`)).filter(Boolean).join(' '),
  ).filter(Boolean).join('  ');
  console.log(`[${label}] ${parts.join(' | ')}   攻击: ${matrix || '—'}`);
}

for (let g = 0; g < games; g++) {
  const seed = 1000 + g * 7919;
  const mapPool = (await import('../src/core/config')).MAPS.map((m, i) => [m, i] as const).filter(([m]) => m.players === 3);
  const mapIndex = mapPool[seed % mapPool.length][1];
  const w = createWorld(diff, seed, mapIndex);
  console.log(`\n=== 局 ${g + 1}（seed=${seed}，图=${mapIndex}，civs=${w.civs.join(',')}）===`);
  for (let s = 0; s < 3; s++) dmgTo[s] = [0, 0, 0];
  lastMinute = -1;
  const steps = Math.round(600 / STEP);
  for (let i = 0; i < steps && !w.gameOver; i++) {
    stepWorld(w, STEP);
    for (const e of w.events) {
      if (e.type === 'shot' && e.side !== undefined && e.targetSide !== undefined && e.side !== e.targetSide) {
        // 粗略记伤害：每次开火记一次固定值（命中率不计），只看攻击倾向
        dmgTo[e.side][e.targetSide] += 10;
      }
    }
    w.events.length = 0;
    const minute = Math.floor(w.time / 60);
    if (minute > lastMinute) { lastMinute = minute; snapshot(w, `${minute}min`); }
    if (i % 36 === 0) playerThink(w);
  }
  console.log(`结局: ${w.gameOver ? `胜者 s${w.gameOver.winner}` : '超时'}  时长 ${Math.round(w.time)}s`);
}
