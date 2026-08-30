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
    // HQ 位于 (360,1640) / (360,280)，覆盖 tile cols 8,9 × rows 40,41 / rows 6,7
    expect(isBlockedTile(w.blocked, 8, 41)).toBe(true);
    expect(isBlockedTile(w.blocked, 8, 7)).toBe(true);
  });

  it('能绕过中央关口找到从玩家到敌方的路径', () => {
    const w = createWorld('normal', 1);
    const p = findPath(w.blocked, 360, 1760, 360, 240);
    expect(p).not.toBeNull();
    expect(p!.length).toBeGreaterThan(2);
    const last = p![p!.length - 1];
    expect(Math.hypot(last.x - 360, last.y - 240)).toBeLessThan(TILE * 2);
    // 路径点不能踩在阻挡格上
    for (const pt of p!) {
      expect(isBlockedTile(w.blocked, Math.floor(pt.x / TILE), Math.floor(pt.y / TILE))).toBe(false);
    }
  });

  it('直线穿关口会被判定阻挡', () => {
    const w = createWorld('normal', 1);
    // 中央关口 cols 8,9 (x 320..400) × rows 23,24 (y 920..1000)
    expect(lineClear(w.blocked, 360, 880, 360, 1060)).toBe(false);
    expect(lineClear(w.blocked, 60, 880, 60, 1060)).toBe(true);
  });

  it('nearestFreeTile 返回可用格', () => {
    const w = createWorld('normal', 1);
    const t = nearestFreeTile(w.blocked, 8, 24); // 关口内部
    expect(t).not.toBeNull();
    expect(isBlockedTile(w.blocked, t![0], t![1])).toBe(false);
  });

  it('边界外视为阻挡且不崩溃', () => {
    const w = createWorld('normal', 1);
    expect(isBlockedTile(w.blocked, -1, 0)).toBe(true);
    expect(isBlockedTile(w.blocked, 0, MAP_H)).toBe(true);
    expect(findPath(w.blocked, MAP_W + 500, 500, 360, 1200)).toBeNull();
  });
});
