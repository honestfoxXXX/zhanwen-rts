/** 探针：AI 实际出厂兵种构成——钉住 pickUnit 修复的回归 */
import { createWorld, stepWorld } from '../src/core/sim';
import { playerThink } from './scriptedPlayer';
import type { Difficulty } from '../src/core/types';

for (const diff of ['normal', 'hard'] as Difficulty[]) {
  for (const civs of [['central', 'nomad'], ['central', 'knight']] as const) {
    const w = createWorld(diff, 1000, 0, [...civs]);
    const trained: Record<string, number> = {};
    const known = new Set<number>();
    let acc = 0;
    for (let i = 0; i < 60 * 520 && !w.gameOver; i++) {
      stepWorld(w, 1 / 60);
      acc += 1 / 60;
      if (acc >= 0.6) { acc = 0; playerThink(w); }
      w.events.length = 0;
      for (const u of w.units) if (!known.has(u.id)) { known.add(u.id); if (u.side === 1) trained[u.type] = (trained[u.type] ?? 0) + 1; }
    }
    const tech = w.buildings.filter(b => b.side === 1 && !b.dead).map(b => b.type);
    console.log(`[${diff} AI=${civs[1]}] 胜者=${w.gameOver ? w.gameOver.winner : '超时'} t=${Math.round(w.time)}s`);
    console.log(`   AI 出厂: ${JSON.stringify(Object.fromEntries(Object.entries(trained).sort()))}`);
    console.log(`   AI 科技: 军械库=${tech.includes('smithy')} 工坊=${tech.includes('workshop')}`);
  }
}
