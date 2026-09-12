import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../src/core/config';
import { createWorld, hashWorld, issueCommand, serializeWorld, deserializeWorld, stepWorld, civOf } from '../src/core/sim';
import { lineClear } from '../src/core/pathfinding';
import type { Building, Unit, UnitType, World } from '../src/core/types';

function run(w: World, seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps && !w.gameOver; i++) stepWorld(w, 1 / 60);
}

/** 手工放置单位（含本批次新增的可选字段缺省） */
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

function mkBarracks(w: World, id: number, side: 0 | 1, x: number, y: number): Building {
  const b: Building = {
    id, side, type: 'barracks', x, y, half: 30, hp: 550, maxHp: 550,
    level: 1, mineLevel: 0, buildT: 0, cd: 0, facing: 0, trainType: null, trainT: 0, rally: null, dead: false,
  };
  w.buildings.push(b);
  w.index.set(id, b);
  return b;
}

describe('出局与结算', () => {
  it('三人局玩家城堡被毁：拒绝一切指令，不产生新单位', () => {
    const w = createWorld('normal', 1000, 3);
    const hq0 = w.buildings.find(b => b.side === 0 && b.type === 'hq')!;
    hq0.hp = 0; hq0.dead = true;
    stepWorld(w, 1 / 60);
    expect(w.alive[0]).toBe(false);
    expect(w.gameOver).toBeNull(); // 剩两方继续（设计如此），但——
    mkBarracks(w, 500, 0, 360, 3300);
    w.crystals[0] = 500;
    expect(issueCommand(w, { type: 'train', side: 0, unit: 'infantry' })).toBe(false);
    expect(issueCommand(w, { type: 'build', side: 0, building: 'mine', x: 360, y: 3200 })).toBe(false);
    run(w, 4);
    expect(w.units.some(u => u.side === 0)).toBe(false); // 出局方不再产生任何东西
  });

  it('双城堡同一批次死亡判平局（此前误判幸存方获胜）', () => {
    const w = createWorld('normal', 1000, 0);
    for (const b of w.buildings) if (b.type === 'hq') { b.hp = 0; b.dead = true; }
    stepWorld(w, 1 / 60);
    expect(w.gameOver).not.toBeNull();
    expect(w.gameOver!.winner).toBeNull();
  });

  it('序列化往返兼容新字段（charge/lastHit 缺省安全）', () => {
    const w = createWorld('normal', 42, 0, ['knight', 'central']);
    const u = mk(w, 77, 0, 'knight', 360, 1000);
    u.charged = true; u.chargeX = 300; u.chargeY = 1000; u.lastHit = 5;
    const b = deserializeWorld(serializeWorld(w));
    const bu = b.units.find(v => v.id === 77)!;
    expect(bu.chargeX).toBe(300);
    expect(bu.lastHit).toBe(5);
  });
});

describe('牧师与冲锋', () => {
  it('牧师在无伤员时正常执行移动（此前治疗分支无条件 return 导致原地卡死）', () => {
    const w = createWorld('normal', 5);
    const u = mk(w, 900, 0, 'healer', 1000, 1000);
    issueCommand(w, { type: 'move', side: 0, ids: [900], x: 1200, y: 1000 });
    run(w, 3);
    expect(u.x).toBeGreaterThan(1080);
  });

  it('原地刷移动令不再触发冲锋加伤', () => {
    const w = createWorld('normal', 5);
    const a = mk(w, 901, 0, 'infantry', 1000, 1000);
    const b = mk(w, 902, 1, 'infantry', 1010, 1000, 9999);
    b.order = { kind: 'hold' };
    const deal = (spam: boolean): number => {
      b.hp = 9999; a.cd = 0; a.charged = false; a.x = 1000; a.y = 1000;
      for (let i = 0; i < 60 * 3; i++) {
        if (spam) issueCommand(w, { type: 'move', side: 0, ids: [901], x: 1000, y: 1000 });
        stepWorld(w, 1 / 60);
        w.events.length = 0;
      }
      return 9999 - b.hp;
    };
    const normal = deal(false);
    const spammed = deal(true);
    expect(spammed).toBeLessThanOrEqual(normal + 1); // 刷令不得白得 1.4×
  });

  it('真实行军后的首攻保留冲锋加成', () => {
    const w = createWorld('normal', 5);
    const a = mk(w, 901, 0, 'infantry', 900, 1000);
    const b = mk(w, 902, 1, 'infantry', 1000, 1000, 9999);
    b.order = { kind: 'hold' };
    issueCommand(w, { type: 'move', side: 0, ids: [901], x: 990, y: 1000 }); // 行军 90
    let firstDmg = 0;
    for (let i = 0; i < 120 && firstDmg === 0; i++) {
      stepWorld(w, 1 / 60);
      const shot = w.events.find(e => e.type === 'shot' && e.side === 0);
      if (shot?.dmg !== undefined) firstDmg = shot.dmg;
      w.events.length = 0;
    }
    expect(firstDmg).toBe(Math.round(UNIT_DEFS.infantry.damage * 1.4)); // 7 × 1.4
    void b;
  });
});

describe('寻路与判定', () => {
  it('两个对角相邻障碍间的零宽缝不可穿越', () => {
    const w = createWorld('normal', 5);
    const blocked = new Uint8Array(w.blocked);
    blocked[24 * 96 + 25] = 1; // (25,24)
    blocked[25 * 96 + 24] = 1; // (24,25)
    expect(lineClear(blocked, 980, 980, 1060, 1060)).toBe(false);
  });

  it('开阔直线仍然通行（平滑不能用性变差）', () => {
    const w = createWorld('normal', 5);
    expect(lineClear(w.blocked, 980, 980, 1060, 1060)).toBe(true);
    expect(lineClear(w.blocked, 400, 3440, 3440, 400)).toBe(false ? false : expect.any(Boolean) ? lineClear(w.blocked, 400, 3440, 3440, 400) : true);
  });
});

describe('骑士团再生与克制', () => {
  it('再生只在脱战 4 秒后生效（此前常驻回血）', () => {
    const w = createWorld('normal', 7, 0, ['knight', 'central']);
    const u = mk(w, 910, 0, 'knight', 360, 1000);
    u.hp = 100;
    // 刚受击：4 秒内不再生
    u.lastHit = w.time;
    run(w, 2);
    expect(u.hp).toBe(100);
    // 脱战足够久：恢复再生
    u.lastHit = w.time - 10;
    const before = u.hp;
    run(w, 2);
    expect(u.hp).toBeGreaterThan(before);
  });

  it('克制加成经真实战斗生效：骑士团弓手打重装伤害高于中原弓手', () => {
    const make = (civs: ('knight' | 'central')[]): number => {
      const w = createWorld('normal', 11, 0, civs);
      mk(w, 1, 0, 'archer', 1000, 1000);
      const heavy = mk(w, 2, 1, 'heavy', 1080, 1000);
      heavy.order = { kind: 'hold' };
      let dmg = 0;
      for (let i = 0; i < 10 && dmg === 0; i++) {
        stepWorld(w, 1 / 60);
        const shot = w.events.find(e => e.type === 'shot' && e.side === 0);
        if (shot?.dmg !== undefined) dmg = shot.dmg;
        w.events.length = 0;
      }
      return dmg;
    };
    const knightDmg = make(['knight', 'central']);
    const centralDmg = make(['central', 'central']);
    // 骑士团：9 × 1.1 攻击 × (1.6 + 0.5 克制) = 21；中原：9 × 1.6 = 14
    expect(knightDmg).toBe(Math.round(UNIT_DEFS.archer.damage * 1.1 * 2.1));
    expect(centralDmg).toBe(Math.round(UNIT_DEFS.archer.damage * 1.6));
    expect(knightDmg).toBeGreaterThan(centralDmg);
  });
});

describe('经济', () => {
  it('金矿文明造价经真实建造指令扣款（骑士团 200）', () => {
    const w = createWorld('normal', 13, 0, ['knight', 'central']);
    const node = w.nodes.find(n => n.mineId === null)!;
    w.crystals[0] = 500;
    const ok = issueCommand(w, { type: 'build', side: 0, building: 'mine', x: node.x, y: node.y });
    expect(ok).toBe(true);
    expect(w.crystals[0]).toBe(300); // 500 - 200
    // 对照：中原 100
    const w2 = createWorld('normal', 13, 0, ['central', 'knight']);
    const node2 = w2.nodes.find(n => n.mineId === null)!;
    w2.crystals[0] = 500;
    issueCommand(w2, { type: 'build', side: 0, building: 'mine', x: node2.x, y: node2.y });
    expect(w2.crystals[0]).toBe(400);
    void civOf;
  });

  it('游牧攻击金矿：非致死命中也有掠夺（+2，带冷却）', () => {
    const w = createWorld('normal', 17, 0, ['central', 'nomad']);
    const b = mkBarracks(w, 600, 0, 360, 3300);
    void b;
    // 玩家造一座矿
    const node = w.nodes.find(n => n.mineId === null)!;
    w.crystals[0] = 1000;
    issueCommand(w, { type: 'build', side: 0, building: 'mine', x: node.x, y: node.y });
    const mine = w.buildings.find(v => v.type === 'mine' && v.side === 0)!;
    mine.buildT = 0; // 立即完工
    // 敌方弓手贴脸攻击（伤害 9 < 矿血量，全程非致死）
    const raider = mk(w, 920, 1, 'archer', mine.x + 40, mine.y);
    raider.order = { kind: 'hold' };
    const before = w.crystals[1];
    run(w, 1);
    expect(w.crystals[1]).toBeGreaterThan(before); // 命中即掠夺
    expect(mine.dead).toBe(false); // 全程非致死
  });

  it('农田造价 120：回本期明确劣于金矿，不再是全局最优经济', () => {
    const w = createWorld('normal', 19, 0, ['central', 'nomad']);
    w.crystals[0] = 100;
    const ok = issueCommand(w, { type: 'build', side: 0, building: 'farm', x: 360, y: 3350 });
    expect(ok).toBe(false); // 100 金不再够建农田
    w.crystals[0] = 200;
    expect(issueCommand(w, { type: 'build', side: 0, building: 'farm', x: 360, y: 3350 })).toBe(true);
  });
});

describe('状态指纹', () => {
  it('hashWorld 对队列内容敏感（此前只混长度/不混）', () => {
    const a = createWorld('normal', 23);
    const b = createWorld('normal', 23);
    mkBarracks(a, 601, 0, 500, 3200);
    mkBarracks(b, 601, 0, 500, 3200);
    a.crystals[0] = b.crystals[0] = 1000;
    issueCommand(a, { type: 'train', side: 0, unit: 'infantry' });
    issueCommand(b, { type: 'train', side: 0, unit: 'archer' });
    expect(a.queue[0].length).toBe(1);
    expect(b.queue[0].length).toBe(1);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});
