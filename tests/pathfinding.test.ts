import { describe, expect, it } from 'vitest';
import { MAP_H, MAP_W, ROCK_TILES, TILE } from '../src/core/config';
import { findPath, isBlockedTile, lineClear, nearestFreeTile } from '../src/core/pathfinding';
import { createWorld } from '../src/core/sim';

describe('pathfinding', () => {
  it('岩石格被标记为阻挡', () => {
    const w = createWorld('normal', 1);
    for (const [cx, cy] of ROCK_TILES) {
      expect(isBlockedTile(w.blocked, cx, cy)).toBe(true);
    }
    expect(isBlockedTile(w.blocked, 2, 2)).toBe(false);
  });

  it('主基地格被标记为阻挡', () => {
    const w = createWorld('normal', 1);
    // 对角出生：玩家 HQ (400,3440) 覆盖 tile 9,10 × 85,86；敌方 (3440,400) 覆盖 85,86 × 9,10
    expect(isBlockedTile(w.blocked, 9, 86)).toBe(true);
    expect(isBlockedTile(w.blocked, 86, 9)).toBe(true);
  });

  it('能跨越整张对角地图找到从玩家到敌方的路径', () => {
    const w = createWorld('normal', 1);
    const p = findPath(w.blocked, 400, 3400, 3440, 400);
    expect(p).not.toBeNull();
    expect(p!.length).toBeGreaterThan(2);
    const last = p![p!.length - 1];
    expect(Math.hypot(last.x - 3440, last.y - 400)).toBeLessThan(TILE * 2);
    // 路径点不能踩在阻挡格上
    for (const pt of p!) {
      expect(isBlockedTile(w.blocked, Math.floor(pt.x / TILE), Math.floor(pt.y / TILE))).toBe(false);
    }
  });

  it('直线穿中央隘口会被判定阻挡', () => {
    const w = createWorld('normal', 1);
    // 中央隘口岩石 tile 45,46 → 世界 (1800..1880)
    expect(lineClear(w.blocked, 1780, 1780, 2060, 2060)).toBe(false);
    expect(lineClear(w.blocked, 1000, 1780, 1000, 2060)).toBe(true);
  });

  it('nearestFreeTile 返回可用格', () => {
    const w = createWorld('normal', 1);
    const t = nearestFreeTile(w.blocked, 45, 45); // 隘口岩石内部
    expect(t).not.toBeNull();
    expect(isBlockedTile(w.blocked, t![0], t![1])).toBe(false);
  });

  it('边界外视为阻挡且不崩溃', () => {
    const w = createWorld('normal', 1);
    expect(isBlockedTile(w.blocked, -1, 0)).toBe(true);
    expect(isBlockedTile(w.blocked, 0, MAP_H)).toBe(true);
    expect(findPath(w.blocked, MAP_W + 500, 500, 1920, 1920)).toBeNull();
  });
});
