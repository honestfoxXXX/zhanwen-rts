import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../src/core/config';
import { createWorld, issueCommand, stepWorld } from '../src/core/sim';
import type { Unit, UnitType, World } from '../src/core/types';

function run(w: World, seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps && !w.gameOver; i++) {
    stepWorld(w, 1 / 60);
    w.events.length = 0;
  }
}

/** 手工放置单位（同时写入索引，与 addUnit 保持一致） */
function mk(w: World, id: number, side: 0 | 1, type: UnitType, x: number, y: number, hp?: number): Unit {
  const d = UNIT_DEFS[type];
  const u: Unit = {
    id, side, type, x, y,
    hp: hp ?? d.hp, maxHp: hp ?? d.hp,
    cd: 0, facing: 0,
    order: { kind: 'idle' }, engageId: null,
    path: [], pathI: 0, repathT: 0, stuckT: 0, charged: false,
    lastX: x, lastY: y, dead: false,
  };
  w.units.push(u);
  w.index.set(u.id, u);
  return u;
}

describe('强制移动', () => {
  it('强制移动穿过敌人阵前不接战（普通移动同样场景会脱战追击）', () => {
    const w = createWorld('normal', 8);
    const a = mk(w, 1, 0, 'infantry', 360, 1000);
    mk(w, 2, 1, 'infantry', 360, 1090); // 敌人挡在路径上、aggro(130) 内
    const ok = issueCommand(w, { type: 'moveForced', side: 0, ids: [1], x: 360, y: 1200 });
    expect(ok).toBe(true);
    expect(a.order.kind).toBe('moveForced');
    expect(a.engageId).toBeNull(); // 下令瞬间不锁定目标
    run(w, 1.2);
    expect(a.order.kind === 'moveForced' || a.order.kind === 'idle').toBe(true);
    if (a.order.kind === 'moveForced') expect(a.engageId).toBeNull();
    // 朝目的地推进了相当距离（没有停下来打架）
    expect(a.y).toBeGreaterThan(1040);
  });

  it('普通移动在同样场景会自动接战（对照）', () => {
    const w = createWorld('normal', 8);
    const a = mk(w, 1, 0, 'infantry', 360, 1000);
    const b = mk(w, 2, 1, 'infantry', 360, 1090);
    issueCommand(w, { type: 'move', side: 0, ids: [1], x: 360, y: 1200 });
    run(w, 1.0);
    // 接战： engage 锁定敌人，双方距离不再拉大（打起来了）
    expect(a.engageId).not.toBeNull();
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    expect(d).toBeLessThan(UNIT_DEFS.infantry.aggro);
  });

  it('抵达目的地后恢复 idle 并重新自动接战', () => {
    const w = createWorld('normal', 8);
    const a = mk(w, 1, 0, 'infantry', 360, 1000);
    const b = mk(w, 2, 1, 'infantry', 360, 1250); // 目的地附近
    issueCommand(w, { type: 'moveForced', side: 0, ids: [1], x: 360, y: 1230 });
    run(w, 4);
    expect(a.order.kind).toBe('idle'); // 到位
    expect(a.engageId).toBe(b.id); // 到位后重新索敌
  });

  it('moveMark 事件带 forced 标记（表现层区分落点标记样式）', () => {
    const w = createWorld('normal', 8);
    mk(w, 1, 0, 'infantry', 360, 1000);
    issueCommand(w, { type: 'moveForced', side: 0, ids: [1], x: 360, y: 1100 });
    const ev = w.events.find(e => e.type === 'moveMark');
    expect(ev).toBeDefined();
    expect((ev as { forced?: boolean }).forced).toBe(true);
    w.events.length = 0;
    issueCommand(w, { type: 'move', side: 0, ids: [1], x: 360, y: 1050 });
    const ev2 = w.events.find(e => e.type === 'moveMark');
    expect(ev2).toBeDefined();
    expect((ev2 as { forced?: boolean }).forced).toBeFalsy();
  });
});
