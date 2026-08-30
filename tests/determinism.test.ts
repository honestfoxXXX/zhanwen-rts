import { describe, expect, it } from 'vitest';
import { createWorld, deserializeWorld, hashWorld, issueCommand, serializeWorld, stepWorld } from '../src/core/sim';
import type { World } from '../src/core/types';

function run(w: World, seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps && !w.gameOver; i++) {
    stepWorld(w, 1 / 60);
    w.events.length = 0;
  }
}

describe('确定性', () => {
  // 这是联机 lockstep 能否成立的底线：同种子 + 同指令流必须得到逐位一致的状态
  it('同种子跑两遍得到完全一致的状态指纹', () => {
    const a = createWorld('normal', 20240830);
    const b = createWorld('normal', 20240830);
    run(a, 90);
    run(b, 90);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('不同种子会长成不同的对局', () => {
    const a = createWorld('normal', 1);
    const b = createWorld('normal', 2);
    run(a, 60);
    run(b, 60);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });

  it('同一串指令流在两个世界上产生相同结果', () => {
    const a = createWorld('hard', 777);
    const b = createWorld('hard', 777);
    for (const w of [a, b]) {
      run(w, 8);
      issueCommand(w, { type: 'build', side: 0, building: 'barracks', x: 360, y: 1100 });
      run(w, 10);
      issueCommand(w, { type: 'train', side: 0, unit: 'archer' });
      issueCommand(w, { type: 'train', side: 0, unit: 'infantry' });
      run(w, 25);
    }
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('序列化往返后指纹不变，且能继续推进出同样的结果', () => {
    const a = createWorld('normal', 4242);
    run(a, 40);
    const before = hashWorld(a);

    const b = deserializeWorld(serializeWorld(a));
    expect(hashWorld(b)).toBe(before);

    // 反序列化出来的世界必须能继续模拟，且与原本同步演进
    run(a, 20);
    run(b, 20);
    expect(hashWorld(b)).toBe(hashWorld(a));
  });

  it('序列化保留建造、生产与 AI 状态', () => {
    const a = createWorld('normal', 99);
    run(a, 30);
    issueCommand(a, { type: 'build', side: 0, building: 'barracks', x: 360, y: 1100 });
    run(a, 10);
    issueCommand(a, { type: 'train', side: 0, unit: 'heavy' });
    const b = deserializeWorld(serializeWorld(a));
    expect(b.buildings.filter(v => v.side === 0 && v.type === 'barracks').length).toBe(1);
    expect(b.queue[0]).toEqual(['heavy']);
    expect(b.ai[1].waves).toBe(a.ai[1].waves);
    expect(b.blocked).toBeInstanceOf(Uint8Array);
    expect(b.blocked.length).toBe(a.blocked.length);
  });
});
