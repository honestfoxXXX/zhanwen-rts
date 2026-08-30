import { describe, expect, it } from 'vitest';
import { COLS, MAPS, MAP_H, MAP_W, ROWS, TILE } from '../src/core/config';
import { findPath, isBlockedTile } from '../src/core/pathfinding';
import { createWorld, stepWorld } from '../src/core/sim';

/**
 * 地图是纯数据，改起来很容易埋雷：矿点不对称会让一方天然占优，
 * 岩石把路堵死则直接不可玩。这些约束用测试钉住。
 */
describe('地图', () => {
  for (const [i, map] of MAPS.entries()) {
    describe(`${map.name}（${map.players} 人）`, () => {
      it('出生点数量与声明的参战人数一致', () => {
        expect(map.spawns.length).toBe(map.players);
      });

      it('矿点满足该人数下的对称性', () => {
        if (map.players === 2) {
          // 双方上下对峙：关于地图中心点对称
          for (const n of map.nodes) {
            const mirror = map.nodes.find(m => m.x === MAP_W - n.x && m.y === MAP_H - n.y);
            expect(mirror, `矿点 (${n.x},${n.y}) 缺少中心对称的镜像点`).toBeDefined();
          }
        } else {
          // 三方：矿点绕三角形质心精确 120° 旋转对称 —— 三方到每个矿点的距离完全一致
          const cx = map.spawns.reduce((s, p) => s + p.pos.x, 0) / 3;
          const cy = map.spawns.reduce((s, p) => s + p.pos.y, 0) / 3;
          const rot = (n: { x: number; y: number }, k: number) => {
            const a = (k * 2 * Math.PI) / 3;
            const dx = n.x - cx, dy = n.y - cy;
            return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
          };
          for (const n of map.nodes) {
            for (let k = 1; k <= 2; k++) {
              const r = rot(n, k);
              const hit = map.nodes.find(m => Math.abs(m.x - r.x) <= 2 && Math.abs(m.y - r.y) <= 2);
              expect(hit, `矿点 (${n.x},${n.y}) 缺少 120° 旋转对称点`).toBeDefined();
            }
          }
        }
      });

      it('三方出生点构成等边三角形，任意两方间距相等', () => {
        if (map.players < 3) return;
        const d = (a: typeof map.spawns[0], b: typeof map.spawns[0]) =>
          Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
        const d01 = d(map.spawns[0], map.spawns[1]);
        const d12 = d(map.spawns[1], map.spawns[2]);
        const d02 = d(map.spawns[0], map.spawns[2]);
        expect(Math.abs(d01 - d12), '0-1 与 1-2 间距不等').toBeLessThanOrEqual(1);
        expect(Math.abs(d01 - d02), '0-1 与 0-2 间距不等').toBeLessThanOrEqual(1);
      });

      it('三方建造区面积相等且互不重叠', () => {
        if (map.players < 3) return;
        const areas = map.spawns.map(sp => (sp.build.x1 - sp.build.x0 + 1) * (sp.build.y1 - sp.build.y0 + 1));
        expect(new Set(areas).size, '三方建造区面积必须相等').toBe(1);
        for (let a = 0; a < map.players; a++) {
          for (let b = a + 1; b < map.players; b++) {
            const ra = map.spawns[a].build, rb = map.spawns[b].build;
            const overlap = ra.x0 <= rb.x1 && rb.x0 <= ra.x1 && ra.y0 <= rb.y1 && rb.y0 <= ra.y1;
            expect(overlap, `建造区 ${a} 与 ${b} 重叠了，会互相抢地皮`).toBe(false);
          }
        }
      });

      it('三方岩石近似 120° 旋转对称（格点取整，容差 1.2 格）', () => {
        if (map.players < 3) return;
        const cx = map.spawns.reduce((s, p) => s + p.pos.x, 0) / 3;
        const cy = map.spawns.reduce((s, p) => s + p.pos.y, 0) / 3;
        for (const [tx, ty] of map.rocks) {
          const wx = (tx + 0.5) * TILE, wy = (ty + 0.5) * TILE;
          for (let k = 1; k <= 2; k++) {
            const a = (k * 2 * Math.PI) / 3;
            const dx = wx - cx, dy = wy - cy;
            const rx = (cx + dx * Math.cos(a) - dy * Math.sin(a)) / TILE - 0.5;
            const ry = (cy + dx * Math.sin(a) + dy * Math.cos(a)) / TILE - 0.5;
            const hit = map.rocks.some(([mx, my]) => Math.abs(mx - rx) <= 1.2 && Math.abs(my - ry) <= 1.2);
            expect(hit, `岩石 (${tx},${ty}) 缺少旋转 ${k * 120}° 的对应岩石`).toBe(true);
          }
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

      it('任意两方主基地互相连通', () => {
        const w = createWorld('normal', 1, i);
        for (let a = 0; a < map.players; a++) {
          for (let b = a + 1; b < map.players; b++) {
            const p = findPath(w.blocked, w.spawns[a].x, w.spawns[a].y, w.spawns[b].x, w.spawns[b].y);
            expect(p, `阵营 ${a} 与 ${b} 之间不连通，这张图不可玩`).not.toBeNull();
          }
        }
      });

      it('每个矿点都至少能从一方主基地走到', () => {
        const w = createWorld('normal', 1, i);
        for (const n of map.nodes) {
          const ok = map.spawns.some((_, s) =>
            findPath(w.blocked, w.spawns[s].x, w.spawns[s].y, n.x, n.y) !== null);
          expect(ok, `矿点 (${n.x},${n.y}) 谁也走不到`).toBe(true);
        }
      });

      it('主基地所在格没有被岩石预先占用', () => {
        for (const sp of map.spawns) {
          const cx = Math.round(sp.pos.x / TILE), cy = Math.round(sp.pos.y / TILE);
          for (const [dx, dy] of [[-1, 0], [0, 0], [-1, -1], [0, -1]] as const) {
            const hit = map.rocks.some(([rx, ry]) => rx === cx + dx && ry === cy + dy);
            expect(hit, `出生点 (${sp.pos.x},${sp.pos.y}) 被岩石占了`).toBe(false);
          }
        }
        const w = createWorld('normal', 1, i);
        expect(w.map).toBe(i);
      });
    });
  }
});

describe('三方混战', () => {
  const idx3 = MAPS.findIndex(m => m.players === 3);

  it('存在三方地图', () => {
    expect(idx3).toBeGreaterThanOrEqual(0);
  });

  it('开局三方各有一座主基地', () => {
    const w = createWorld('normal', 7, idx3);
    expect(w.players).toBe(3);
    const hqs = w.buildings.filter(b => b.type === 'hq');
    expect(hqs.length).toBe(3);
    expect(new Set(hqs.map(h => h.side)).size).toBe(3);
  });

  it('灭掉一方不会立刻结束，最后存活者获胜', () => {
    const w = createWorld('normal', 7, idx3);

    const hq1 = w.buildings.find(b => b.side === 1 && b.type === 'hq')!;
    hq1.hp = 0; hq1.dead = true;
    stepWorld(w, 1 / 60);
    expect(w.alive[1]).toBe(false);
    expect(w.gameOver, '还剩两方时不应结束').toBeNull();

    const hq2 = w.buildings.find(b => b.side === 2 && b.type === 'hq')!;
    hq2.hp = 0; hq2.dead = true;
    stepWorld(w, 1 / 60);
    expect(w.gameOver).not.toBeNull();
    expect(w.gameOver!.winner).toBe(0);
  });

  it('各方的建造区互不重叠，谁也盖不到别人家里', () => {
    const w = createWorld('normal', 7, idx3);
    const map = MAPS[idx3];
    for (let a = 0; a < w.players; a++) {
      for (let b = 0; b < w.players; b++) {
        if (a === b) continue;
        const ra = map.spawns[a].build, rb = map.spawns[b].build;
        const overlap = ra.x0 <= rb.x1 && rb.x0 <= ra.x1 && ra.y0 <= rb.y1 && rb.y0 <= ra.y1;
        expect(overlap, `阵营 ${a} 与 ${b} 的建造区重叠`).toBe(false);
      }
    }
  });

  it('三方默认集结点各不相同', () => {
    const w = createWorld('normal', 7, idx3);
    const keys = w.rally.map(r => `${Math.round(r.x)},${Math.round(r.y)}`);
    expect(new Set(keys).size).toBe(3);
  });
});
