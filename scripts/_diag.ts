import { createWorld, stepWorld, hashWorld } from '../src/core/sim';
import type { Difficulty } from '../src/core/types';

for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
  const w = createWorld(d, 1000);
  let waveEvt = 0, defFlips = 0, lastDef = false;
  for (let i = 0; i < 600 * 60 && !w.gameOver; i++) {
    stepWorld(w, 1 / 60);
    for (const e of w.events) if (e.type === 'wave') waveEvt++;
    if (w.ai.defending && !lastDef) defFlips++;
    lastDef = w.ai.defending;
    w.events.length = 0;
  }
  const mines = w.buildings.filter(b => b.side === 1 && b.type === 'mine').length;
  const army = w.units.filter(u => u.side === 1).length;
  console.log(d, {
    时长: Math.round(w.time), wave事件: waveEvt, ai波次计数: w.ai.waves,
    守家次数: defFlips, AI矿场: mines, AI部队: army,
    winner: w.gameOver?.winner ?? null, hash: hashWorld(w),
  });
}
