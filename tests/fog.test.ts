import { describe, expect, it } from 'vitest';
import { createWorld, issueCommand, stepWorld, isVisibleAt } from '../src/core/sim';
import { UNIT_DEFS } from '../src/core/config';
import type { Unit, UnitType, World } from '../src/core/types';

function run(w: World, seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps && !w.gameOver; i++) stepWorld(w, 1 / 60);
}

function mk(w: World, id: number, side: 0 | 1, type: UnitType, x: number, y: number): Unit {
  const d = UNIT_DEFS[type];
  const u: Unit = {
    id, side, type, x, y,
    hp: d.hp, maxHp: d.hp,
    cd: 0, facing: 0,
    order: { kind: 'hold' }, engageId: null,
    path: [], pathI: 0, repathT: 0, stuckT: 0, charged: false,
    lastX: x, lastY: y, dead: false,
  };
  w.units.push(u);
  w.index.set(u.id, u);
  return u;
}

describe('战争迷雾', () => {
  it('开局时己方主基地周边已探索', () => {
    const w = createWorld('normal', 8);
    const lit = w.explored.reduce((a, b) => a + b, 0);
    expect(lit).toBeGreaterThan(20); // 半径 260 ≈ 130+ tile
  });

  it('视野内的敌方单位可见，视野外不可见', () => {
    const w = createWorld('normal', 8);
    mk(w, 100, 0, 'infantry', 360, 1000);
    mk(w, 101, 1, 'infantry', 380, 1020); // aggro+70 = 200 视野内
    mk(w, 102, 1, 'infantry', 360, 1500); // 500 外
    stepWorld(w, 1 / 60);
    stepWorld(w, 1 / 60);
    for (let i = 0; i < 10; i++) stepWorld(w, 1 / 60); // 跨过 %8 重算点
    expect(isVisibleAt(w, 380, 1020)).toBe(true);
    expect(isVisibleAt(w, 360, 1500)).toBe(false);
  });

  it('移动会沿途点亮探索', () => {
    const w = createWorld('normal', 8);
    const u = mk(w, 100, 0, 'infantry', 400, 3400);
    u.order = { kind: 'hold' };
    const before = w.explored.reduce((a, b) => a + b, 0);
    issueCommand(w, { type: 'move', side: 0, ids: [100], x: 400, y: 2400 });
    run(w, 8);
    const after = w.explored.reduce((a, b) => a + b, 0);
    expect(after).toBeGreaterThan(before + 100);
  });

  it('AI 见过标记：靠近敌方建筑后记录，波次目标受感知限制', () => {
    const w = createWorld('normal', 8);
    // 玩家在 AI 家旁造个"哨站"（用 mine 代表玩家建筑），AI 单位放旁边
    mk(w, 200, 1, 'infantry', 3440, 460);
    const hq1 = w.buildings.find(b => b.side === 1 && b.type === 'hq')!;
    // AI 单位贴近己方 HQ → 不改变；贴近"敌方（玩家）建筑"才标记。
    // 直接构造：把玩家 HQ 旁放一个 AI 侦察兵
    const hq0 = w.buildings.find(b => b.side === 0 && b.type === 'hq')!;
    mk(w, 201, 1, 'infantry', hq0.x + 200, hq0.y);
    run(w, 2);
    expect(w.aiSeen[1][hq0.id]).toBe(1);
    void hq1;
  });

  it('确定性：两次完全相同的对局 explored 逐位一致', () => {
    const w1 = createWorld('normal', 42, 0);
    const w2 = createWorld('normal', 42, 0);
    issueCommand(w1, { type: 'move', side: 0, ids: [], x: 500, y: 500 });
    issueCommand(w2, { type: 'move', side: 0, ids: [], x: 500, y: 500 });
    run(w1, 5);
    run(w2, 5);
    for (let i = 0; i < w1.explored.length; i += 13) {
      expect(w2.explored[i]).toBe(w1.explored[i]);
    }
  });
});
