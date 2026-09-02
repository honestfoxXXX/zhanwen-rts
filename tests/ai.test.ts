import { describe, expect, it } from 'vitest';
import { DIFFICULTY } from '../src/core/config';
import { createWorld, stepWorld } from '../src/core/sim';

function run(w: ReturnType<typeof createWorld>, seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    stepWorld(w, 1 / 60);
    if (w.gameOver) return;
  }
}

describe('AI', () => {
  it('普通难度 AI 会铺矿、建兵营并造兵', () => {
    const w = createWorld('normal', 7);
    run(w, 180);
    if (w.gameOver) return; // 极小概率推平了自己
    const mines = w.buildings.filter(b => b.side === 1 && b.type === 'mine');
    const barracks = w.buildings.filter(b => b.side === 1 && b.type === 'barracks');
    const army = w.units.filter(u => u.side === 1);
    expect(mines.length).toBeGreaterThanOrEqual(2);
    expect(barracks.length).toBeGreaterThanOrEqual(1);
    expect(army.length).toBeGreaterThan(0);
  });

  it('AI 会发起波次进攻（向玩家城堡推进）', () => {
    const w = createWorld('normal', 11);
    let sawWave = false;
    const p0 = w.spawns[0];
    const steps = 300 * 60; // 5 分钟
    for (let i = 0; i < steps && !w.gameOver; i++) {
      stepWorld(w, 1 / 60);
      if (i % 30 === 0) {
        const marching = w.units.some(u => u.side === 1 && u.order.kind === 'move' &&
          Math.hypot(u.order.x - p0.x, u.order.y - p0.y) < 800);
        if (marching) sawWave = true;
      }
    }
    expect(sawWave).toBe(true);
  });

  it('难度影响收入倍率（收入 = 基础 + 矿场，乘以倍率）', () => {
    const easy = createWorld('easy', 3);
    const hard = createWorld('hard', 3);
    // 相同建筑规模下，仅倍率不同
    run(easy, 5);
    run(hard, 5);
    expect(hard.income[1]).toBeCloseTo(easy.income[1] * (DIFFICULTY.hard.incomeMult / DIFFICULTY.easy.incomeMult), 0);
    expect(DIFFICULTY.hard.incomeMult).toBeGreaterThan(DIFFICULTY.easy.incomeMult);
  });

  it('AI 在家被打时会回防（防守标记生效）', () => {
    const w = createWorld('normal', 5);
    // 在 AI 基地旁放一个玩家步兵（AI 城堡在东北角 (3440,400)）
    (w as unknown as { nextId: number }).nextId = 900;
    w.units.push({
      id: 900, side: 0, type: 'infantry',
      x: 3440, y: 520, hp: 75, maxHp: 75, cd: 0, facing: 0,
      order: { kind: 'idle' }, engageId: null,
      path: [], pathI: 0, repathT: 0, stuckT: 0, lastX: 3440, lastY: 520, dead: false,
    });
    const steps = 10 * 60;
    for (let i = 0; i < steps; i++) {
      stepWorld(w, 1 / 60);
      if (w.ai[1].defending) break;
    }
    expect(w.ai[1].defending).toBe(true);
  });
});
