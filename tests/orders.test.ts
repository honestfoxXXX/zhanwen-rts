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
    path: [], pathI: 0, repathT: 0, stuckT: 0,
    lastX: x, lastY: y, dead: false,
  };
  w.units.push(u);
  w.index.set(u.id, u);
  return u;
}

describe('固守与撤退', () => {
  it('固守令的部队不会脱战追击', () => {
    const w = createWorld('normal', 8);
    const a = mk(w, 1, 0, 'infantry', 360, 1000);
    const b = mk(w, 2, 1, 'infantry', 360, 1100); // 在 aggro(130) 内、射程(12) 外
    a.order = { kind: 'hold' };
    b.order = { kind: 'hold' };
    run(w, 3);
    expect(Math.abs(a.y - 1000)).toBeLessThan(1);
    expect(Math.abs(a.x - 360)).toBeLessThan(1);
  });

  it('没有固守令时，同样的距离下部队会主动追击', () => {
    const w = createWorld('normal', 8);
    const a = mk(w, 1, 0, 'infantry', 360, 1000);
    mk(w, 2, 1, 'infantry', 360, 1100);
    run(w, 2);
    expect(a.y).toBeGreaterThan(1010); // 向敌人推进了
  });

  it('撤退令让部队撤回己方主基地', () => {
    const w = createWorld('normal', 9);
    const u = mk(w, 1, 0, 'infantry', 360, 600);
    expect(issueCommand(w, { type: 'retreat', side: 0, ids: [1] })).toBe(true);
    run(w, 30);
    expect(u.y).toBeGreaterThan(1450); // 玩家主基地在 (360,1640)
    expect(u.order.kind).toBe('idle'); // 抵达后转为待命
  });
});

describe('兵种克制', () => {
  it('弓手打重装享受加成（9 × 1.6 = 14.4 每发）', () => {
    const w = createWorld('normal', 5);
    mk(w, 1, 0, 'archer', 360, 900);
    const heavy = mk(w, 2, 1, 'heavy', 360, 1000, 3000); // 血厚，保证打不死
    heavy.order = { kind: 'hold' }; // 只挨打，不还手也不前进
    run(w, 3);
    const lost = 3000 - heavy.hp;
    expect(lost).toBeGreaterThan(0);
    const perShot = UNIT_DEFS.archer.damage * (UNIT_DEFS.archer.dmgBonus?.heavy ?? 1);
    expect(Math.abs(lost / perShot - Math.round(lost / perShot))).toBeLessThan(0.02);
  });

  it('克制加成不对建筑生效', () => {
    const w = createWorld('normal', 6);
    mk(w, 1, 0, 'archer', 360, 400);
    const hq = w.buildings.find(b => b.side === 1 && b.type === 'hq')!;
    const start = hq.hp;
    run(w, 3);
    const lost = start - hq.hp;
    expect(lost).toBeGreaterThan(0);
    const perShot = UNIT_DEFS.archer.damage; // 打建筑按基础伤害
    expect(Math.abs(lost / perShot - Math.round(lost / perShot))).toBeLessThan(0.02);
  });
});

describe('集结点', () => {
  it('可以为单个兵营单独设置集结点，不影响全局集结点', () => {
    const w = createWorld('normal', 10);
    w.crystals[0] = 1000;
    issueCommand(w, { type: 'build', side: 0, building: 'barracks', x: 240, y: 1200 });
    run(w, 9);
    const b = w.buildings.find(v => v.side === 0 && v.type === 'barracks')!;
    expect(b).toBeDefined();

    issueCommand(w, { type: 'rally', side: 0, x: 300, y: 1300, buildingId: b.id });
    expect(b.rally).toEqual({ x: 300, y: 1300 });
    expect(w.rally[0]).not.toEqual({ x: 300, y: 1300 });
  });
});
