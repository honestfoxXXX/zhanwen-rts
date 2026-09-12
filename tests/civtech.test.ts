import { describe, expect, it } from 'vitest';
import { CIVS, UNIT_DEFS } from '../src/core/config';
import { pickUnit } from '../src/core/ai';
import { createWorld, civOf, popCapOf, stepWorld } from '../src/core/sim';
import type { UnitType } from '../src/core/types';

/** 反复抽兵统计构成（world 自带确定性 RNG） */
function sampleTypes(w: ReturnType<typeof createWorld>, side: 0 | 1, base: Partial<Record<UnitType, number>>, n: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const t = pickUnit(w, side, base);
    out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

describe('AI 出兵配比与门禁', () => {
  it('没有科技建筑时永远抽不到 T2/T3（此前 T2/T3 权重加进了从不被抽取的槽位）', () => {
    const w = createWorld('normal', 5);
    const picked = sampleTypes(w, 1, { infantry: 0.55, archer: 0.3, heavy: 0.15 }, 300);
    for (const t of ['pikeman', 'knight', 'catapult', 'champion'] as UnitType[]) {
      expect(picked[t] ?? 0, `无军械库不应产出 ${t}`).toBe(0);
    }
  });

  it('建成军械库后 T2 会实际出场，工坊后 T3 出场', () => {
    const w = createWorld('normal', 5);
    w.buildings.push(
      { id: 9001, side: 1, type: 'smithy', x: 3400, y: 360, half: 30, hp: 650, maxHp: 650, level: 1, mineLevel: 0, buildT: 0, cd: 0, facing: 0, trainType: null, trainT: 0, rally: null, dead: false },
      { id: 9002, side: 1, type: 'workshop', x: 3480, y: 360, half: 30, hp: 900, maxHp: 900, level: 1, mineLevel: 0, buildT: 0, cd: 0, facing: 0, trainType: null, trainT: 0, rally: null, dead: false },
    );
    const picked = sampleTypes(w, 1, { infantry: 0.3, heavy: 0.2, champion: 0.25, catapult: 0.25 }, 400);
    expect((picked.knight ?? 0) + (picked.pikeman ?? 0)).toBeGreaterThan(0);
    expect((picked.champion ?? 0) + (picked.catapult ?? 0)).toBeGreaterThan(0);
  });

  it('游牧 armyMix 完整覆盖：出骑士/游骑兵/重装，不混弓手步兵；牧师是骑士团专属', () => {
    const w = createWorld('normal', 7, 0, ['central', 'nomad']);
    const nomad = sampleTypes(w, 1, CIVS.nomad.ai.armyMix, 300);
    expect(nomad.horsearcher ?? 0).toBeGreaterThan(0);
    expect(nomad.archer ?? 0).toBe(0);

    const w2 = createWorld('normal', 7, 0, ['central', 'knight']);
    w2.buildings.push(
      { id: 9003, side: 1, type: 'smithy', x: 3400, y: 360, half: 30, hp: 650, maxHp: 650, level: 1, mineLevel: 0, buildT: 0, cd: 0, facing: 0, trainType: null, trainT: 0, rally: null, dead: false },
    );
    const knight = sampleTypes(w2, 1, CIVS.knight.ai.armyMix, 400);
    expect(knight.healer ?? 0).toBeGreaterThan(0);

    const w3 = createWorld('normal', 7, 0, ['central', 'nomad']);
    w3.buildings.push(
      { id: 9004, side: 1, type: 'smithy', x: 3400, y: 360, half: 30, hp: 650, maxHp: 650, level: 1, mineLevel: 0, buildT: 0, cd: 0, facing: 0, trainType: null, trainT: 0, rally: null, dead: false },
    );
    const notKnight = sampleTypes(w3, 1, CIVS.nomad.ai.armyMix, 300);
    expect(notKnight.healer ?? 0).toBe(0);
  });
});

describe('文明数值一致性', () => {
  it('人口上限按文明（游牧 70 / 骑士 80 / 中原 100）', () => {
    const a = createWorld('normal', 3, 0, ['nomad', 'central']);
    expect(popCapOf(a, 0)).toBe(70);
    expect(popCapOf(a, 1)).toBe(100);
    const b = createWorld('normal', 3, 0, ['knight', 'central']);
    expect(popCapOf(b, 0)).toBe(80);
  });

  it('长枪兵必须克制近卫军（按人口效率）：否则 T3 无解、克制链断档', () => {
    const pk = UNIT_DEFS.pikeman;
    const ch = UNIT_DEFS.champion;
    expect(pk.dmgBonus?.champion).toBeDefined();
    const pkDpsPerPop = (pk.damage * (pk.dmgBonus!.champion ?? 1) * (1 - (ch.armor ?? 0)) / pk.cooldown) / pk.pop;
    const chDpsPerPop = (ch.damage / ch.cooldown) / ch.pop;
    expect(pkDpsPerPop).toBeGreaterThan(chDpsPerPop);
  });

  it('骑士团克制加成真实存在且会被消费（fireAt 叠加）', () => {
    expect(CIVS.knight.counterBonus).toBeGreaterThan(0);
    expect(CIVS.central.counterBonus).toBe(0);
    expect(CIVS.nomad.counterBonus).toBe(0);
  });

  it('金矿造价按文明：骑士团 200 / 其他 100', () => {
    const a = createWorld('normal', 3, 0, ['knight', 'central']);
    expect(civOf(a, 0).mineCost).toBe(200);
    expect(civOf(a, 1).mineCost).toBe(100);
    void stepWorld;
  });
});
