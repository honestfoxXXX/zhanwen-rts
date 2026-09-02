import { beforeEach, describe, expect, it } from 'vitest';
import { BUILDING_DEFS, UNIT_DEFS } from '../src/core/config';
import { createWorld, issueCommand, stepWorld } from '../src/core/sim';
import type { World } from '../src/core/types';

let w: World;

function run(seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) stepWorld(w, 1 / 60);
}

beforeEach(() => {
  w = createWorld('normal', 42);
});

describe('economy', () => {
  it('主基地被动产钱', () => {
    const before = w.crystals[0];
    run(10);
    expect(w.crystals[0]).toBeGreaterThan(before + 35); // 4/s * 10s
  });

  it('矿场建成后提升收入', () => {
    const node = w.nodes[0]; // (80,1080)
    w.crystals[0] = 1000;
    expect(issueCommand(w, { type: 'build', side: 0, building: 'mine', x: node.x, y: node.y })).toBe(true);
    expect(w.crystals[0]).toBe(1000 - BUILDING_DEFS.mine.cost);
    expect(node.mineId).not.toBeNull();
    run(6); // 建造 5s
    const incBefore = w.income[0];
    expect(incBefore).toBeGreaterThanOrEqual(8); // HQ 4 + 矿场 4
  });

  it('水晶不足时拒绝建造', () => {
    w.crystals[0] = 10;
    const node = w.nodes[0];
    expect(issueCommand(w, { type: 'build', side: 0, building: 'mine', x: node.x, y: node.y })).toBe(false);
    expect(w.events.some(e => e.type === 'denied')).toBe(true);
  });

  it('矿场不能重复建在同一矿点', () => {
    w.crystals[0] = 1000;
    const node = w.nodes[0];
    expect(issueCommand(w, { type: 'build', side: 0, building: 'mine', x: node.x, y: node.y })).toBe(true);
    expect(issueCommand(w, { type: 'build', side: 0, building: 'mine', x: node.x, y: node.y })).toBe(false);
  });

  it('建筑只能在己方建造区建造（对角图：自家角可建，敌方角不可建）', () => {
    w.crystals[0] = 1000;
    // 敌方东北角
    expect(issueCommand(w, { type: 'build', side: 0, building: 'barracks', x: 3300, y: 600 })).toBe(false);
    // 己方西南角
    expect(issueCommand(w, { type: 'build', side: 0, building: 'barracks', x: 600, y: 3300 })).toBe(true);
  });

  // 守护回归：双方建造区关于地图中心点对称（对角出生），谁也不能盖到别人家里
  it('双方的建造区点对称，谁都不能越界到对方角落', () => {
    w.crystals[0] = 5000;
    w.crystals[1] = 5000;
    expect(issueCommand(w, { type: 'build', side: 0, building: 'barracks', x: 600, y: 3300 })).toBe(true);
    expect(issueCommand(w, { type: 'build', side: 0, building: 'barracks', x: 3300, y: 600 })).toBe(false);
    expect(issueCommand(w, { type: 'build', side: 1, building: 'barracks', x: 3300, y: 600 })).toBe(true);
    expect(issueCommand(w, { type: 'build', side: 1, building: 'barracks', x: 600, y: 3300 })).toBe(false);
  });
});

describe('combat', () => {
  it('近战单位互相攻击直至一方死亡', () => {
    w.crystals[0] = 0;
    // 手动放入两个步兵
    (w as unknown as { nextId: number }).nextId = 100;
    const u1 = {
      id: 100, side: 0 as const, type: 'infantry' as const,
      x: 360, y: 1400, hp: 75, maxHp: 75, cd: 0, facing: 0,
      order: { kind: 'idle' } as const, engageId: null,
      path: [], pathI: 0, repathT: 0, stuckT: 0, lastX: 360, lastY: 1400, dead: false,
    };
    const u2 = {
      id: 101, side: 1 as const, type: 'infantry' as const,
      x: 360, y: 1410, hp: 10, maxHp: 75, cd: 0, facing: 0,
      order: { kind: 'idle' } as const, engageId: null,
      path: [], pathI: 0, repathT: 0, stuckT: 0, lastX: 360, lastY: 1410, dead: false,
    };
    w.units.push(u1, u2);
    run(3);
    expect(w.units.find(u => u.id === 101)).toBeUndefined();
    expect(w.stats.kills[0]).toBe(1);
    // 胜者仍然存活
    expect(w.units.find(u => u.id === 100)).toBeDefined();
  });

  it('追击中目标被消灭后，单位会继续向原目的地行进（自愈空路径）', () => {
    w.crystals[0] = 0;
    (w as unknown as { nextId: number }).nextId = 400;
    const mk = (id: number, side: 0 | 1, x: number, y: number, hp: number) => ({
      id, side, type: 'infantry' as const,
      x, y, hp, maxHp: 75, cd: 0, facing: 0,
      order: { kind: 'idle' } as import('../src/core/types').Order, engageId: null,
      path: [], pathI: 0, repathT: 0, stuckT: 0, lastX: x, lastY: y, dead: false,
    });
    const mover = mk(400, 0, 360, 1300, 75);
    mover.order = { kind: 'move', x: 360, y: 1640 };
    const victim = mk(401, 1, 360, 1360, 10);
    w.units.push(mover, victim);
    run(12);
    const m = w.units.find(u => u.id === 400)!;
    expect(m).toBeDefined();
    expect(m.y).toBeGreaterThan(1450); // 没有冻在交战点
    expect(w.units.find(u => u.id === 401)).toBeUndefined();
  });

  it('箭塔自动攻击进入射程的敌人', () => {
    w.crystals[0] = 1000;
    // 己方建造区内贴家建塔（对角图西南角）
    expect(issueCommand(w, { type: 'build', side: 0, building: 'tower', x: 600, y: 3280 })).toBe(true);
    run(7); // 建成
    (w as unknown as { nextId: number }).nextId = 200;
    const u = {
      id: 200, side: 1 as const, type: 'infantry' as const,
      x: 700, y: 3200, hp: UNIT_DEFS.infantry.hp, maxHp: UNIT_DEFS.infantry.hp,
      cd: 0, facing: 0,
      order: { kind: 'idle' } as const, engageId: null,
      path: [], pathI: 0, repathT: 0, stuckT: 0, lastX: 700, lastY: 3200, dead: false,
    };
    w.units.push(u);
    run(8); // 塔 dps 13，8s 足够吃掉 75hp（期间敌人会还手但打不动 520hp 的塔）
    expect(w.units.find(v => v.id === 200)).toBeUndefined();
  });

  it('摧毁敌方主基地即获胜', () => {
    const hq = w.buildings.find(b => b.side === 1 && b.type === 'hq')!;
    hq.hp = 5;
    w.crystals[0] = 0;
    (w as unknown as { nextId: number }).nextId = 300;
    const u = {
      id: 300, side: 0 as const, type: 'infantry' as const,
      x: 3440, y: 520, hp: 75, maxHp: 75, cd: 0, facing: 0,
      order: { kind: 'idle' } as const, engageId: null,
      path: [], pathI: 0, repathT: 0, stuckT: 0, lastX: 3440, lastY: 520, dead: false,
    };
    w.units.push(u);
    run(3);
    expect(w.gameOver).not.toBeNull();
    expect(w.gameOver!.winner).toBe(0);
  });
});

describe('production', () => {
  it('造兵需要兵营并从集结点推进', () => {
    w.crystals[0] = 1000;
    // 没有兵营 → 拒绝
    expect(issueCommand(w, { type: 'train', side: 0, unit: 'infantry' })).toBe(false);
    expect(issueCommand(w, { type: 'build', side: 0, building: 'barracks', x: 600, y: 3300 })).toBe(true);
    run(9); // 建成 8s
    expect(issueCommand(w, { type: 'train', side: 0, unit: 'infantry' })).toBe(true);
    expect(w.queue[0]).toContain('infantry');
    run(4); // 训练 3.2s
    expect(w.units.some(u => u.side === 0 && u.type === 'infantry')).toBe(true);
    expect(w.popUsed[0]).toBe(1);
  });

  it('兵营被毁时退还排产费用', () => {
    w.crystals[0] = 1000;
    issueCommand(w, { type: 'build', side: 0, building: 'barracks', x: 600, y: 3300 });
    run(9);
    const before = w.crystals[0];
    issueCommand(w, { type: 'train', side: 0, unit: 'heavy' }); // 200
    expect(before - w.crystals[0]).toBe(UNIT_DEFS.heavy.cost);
    const b = w.buildings.find(b => b.side === 0 && b.type === 'barracks')!;
    w.crystals[0] = 0; // 清零便于断言退款金额
    b.hp = 0;
    b.dead = true;
    run(1 / 60); // 跑 1 帧触发清理
    expect(w.crystals[0]).toBeCloseTo(UNIT_DEFS.heavy.cost, 0); // 退款 200
  });
});
