import { describe, expect, it } from 'vitest';
import { COLS, HQ_POS, MAP_H, MAPS, MAP_W, ROWS, TILE } from '../src/core/config';
import { findPath, isBlockedTile } from '../src/core/pathfinding';
import { createWorld } from '../src/core/sim';

/**
 * 地图是纯数据，改起来很容易埋雷：矿点不对称会让一边天然占优，
 * 岩石把路堵死则直接不可玩。这些约束用测试钉住。
 */
describe('地图', () => {
  for (const [i, map] of MAPS.entries()) {
    describe(map.name, () => {
      it('矿点关于地图中心对称，否则一方天然占优', () => {
        for (const n of map.nodes) {
          const mirror = map.nodes.find(m => m.x === MAP_W - n.x && m.y === MAP_H - n.y);
          expect(mirror, `矿点 (${n.x},${n.y}) 缺少中心对称的镜像点`).toBeDefined();
        }
      });

      it('矿点不越界、不压在岩石上', () => {
        const w = createWorld('normal', 1, i);
        for (const n of map.nodes) {
          const cx = Math.round(n.x / TILE), cy = Math.round(n.y / TILE);
          expect(cx).toBeGreaterThanOrEqual(0);
          expect(cx).toBeLessThan(COLS);
          expect(cy).toBeGreaterThanOrEqual(0);
          expect(cy).toBeLessThan(ROWS);
          expect(isBlockedTile(w.blocked, cx, cy), `矿点 (${n.x},${n.y}) 压在岩石上`).toBe(false);
        }
      });

      it('双方主基地互相连通', () => {
        const w = createWorld('normal', 1, i);
        const p = findPath(w.blocked, HQ_POS[0].x, HQ_POS[0].y, HQ_POS[1].x, HQ_POS[1].y);
        expect(p, '主基地之间不连通，这张图不可玩').not.toBeNull();
      });

      it('每个矿点都能从对应半场的主基地走到', () => {
        const w = createWorld('normal', 1, i);
        for (const n of map.nodes) {
          const from = HQ_POS[n.y > MAP_H / 2 ? 0 : 1];
          const p = findPath(w.blocked, from.x, from.y, n.x, n.y);
          expect(p, `矿点 (${n.x},${n.y}) 不可达`).not.toBeNull();
        }
      });

      it('主基地所在格没有被岩石占用', () => {
        const w = createWorld('normal', 1, i);
        for (const p of HQ_POS) {
          const cx = Math.round(p.x / TILE), cy = Math.round(p.y / TILE);
          for (const [dx, dy] of [[-1, 0], [0, 0], [-1, -1], [0, -1]] as const) {
            // 主基地自身会占格，这里只检查没有被岩石预先占住
            const blockedByRock = map.rocks.some(([rx, ry]) => rx === cx + dx && ry === cy + dy);
            expect(blockedByRock).toBe(false);
          }
        }
        expect(w.map).toBe(i);
      });
    });
  }
});
