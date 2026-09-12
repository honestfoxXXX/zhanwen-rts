import { COLS, ROWS, TILE } from './config';
import type { Vec } from './types';

const DIRS: [number, number, number][] = [ // dx, dy, 代价
  [1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10],
  [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14],
];

function tIdx(cx: number, cy: number): number { return cy * COLS + cx; }
function inB(cx: number, cy: number): boolean { return cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS; }

export function isBlockedTile(blocked: Uint8Array, cx: number, cy: number): boolean {
  return !inB(cx, cy) || blocked[tIdx(cx, cy)] === 1;
}

/** 找最近的可用 tile（环形扩散） */
export function nearestFreeTile(blocked: Uint8Array, cx: number, cy: number): [number, number] | null {
  if (!isBlockedTile(blocked, cx, cy)) return [cx, cy];
  for (let r = 1; r <= 10; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!isBlockedTile(blocked, cx + dx, cy + dy)) return [cx + dx, cy + dy];
      }
    }
  }
  return null;
}

/**
 * 两点连线是否无阻挡（tile 级 supercover 遍历）。
 * 旧实现按 14px 步进采样，会漏掉两个对角相邻障碍间的零宽缝，
 * 让平滑路径绕过 A*「禁斜穿」约束直接跨角——改为段经过的每个 tile 都必须可通行。
 * 显式 sqrt 而非 Math.hypot：保证跨 JS 引擎结果一致（联机 lockstep 的前提）
 */
export function lineClear(blocked: Uint8Array, x0: number, y0: number, x1: number, y1: number): boolean {
  let x = Math.floor(x0 / TILE), y = Math.floor(y0 / TILE);
  const tx = Math.floor(x1 / TILE), ty = Math.floor(y1 / TILE);
  if (isBlockedTile(blocked, x, y) || isBlockedTile(blocked, tx, ty)) return false;
  const dx = x1 - x0, dy = y1 - y0;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  // DDA：每次推进到下一个 tile 边界
  let tMaxX = dx !== 0 ? (((x + (sx > 0 ? 1 : 0)) * TILE - x0) / dx) : Infinity;
  let tMaxY = dy !== 0 ? (((y + (sy > 0 ? 1 : 0)) * TILE - y0) / dy) : Infinity;
  const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
  let guard = 0;
  while ((x !== tx || y !== ty) && guard++ < 256) {
    if (tMaxX < tMaxY) {
      x += sx; tMaxX += tDeltaX;
    } else if (tMaxY < tMaxX) {
      y += sy; tMaxY += tDeltaY;
    } else {
      // 恰好擦角：两侧正交 tile 都被占即为零宽对角缝，拒绝
      if (isBlockedTile(blocked, x + sx, y) && isBlockedTile(blocked, x, y + sy)) return false;
      x += sx; y += sy;
      tMaxX += tDeltaX; tMaxY += tDeltaY;
    }
    if (isBlockedTile(blocked, x, y)) return false;
  }
  return true;
}

/**
 * A* 寻路（8 方向、禁止斜穿角落），返回世界坐标路径点（含视线平滑与精确终点）。
 * 输入输出均为世界坐标。
 */
// A* 复用缓冲区（单线程同步调用，无重入）
const _gCost = new Float32Array(COLS * ROWS);
const _f = new Float32Array(COLS * ROWS);
const _from = new Int32Array(COLS * ROWS);
const _closed = new Uint8Array(COLS * ROWS);
const heapScratch: number[] = [];

export function findPath(blocked: Uint8Array, x0: number, y0: number, x1: number, y1: number): Vec[] | null {
  const st = nearestFreeTile(blocked, Math.floor(x0 / TILE), Math.floor(y0 / TILE));
  const gt = nearestFreeTile(blocked, Math.floor(x1 / TILE), Math.floor(y1 / TILE));
  if (!st || !gt) return null;

  if (st[0] === gt[0] && st[1] === gt[1]) {
    const c = { x: gt[0] * TILE + TILE / 2, y: gt[1] * TILE + TILE / 2 };
    return lineClear(blocked, x0, y0, x1, y1) ? [{ x: x1, y: y1 }] : [c];
  }

  // 复用模块级缓冲（每次调用 fill 重置）：大图 A* 调用频繁，逐次分配 4×9216 数组是可观的 GC 压力
  const N = COLS * ROWS;
  const gCost = _gCost; gCost.fill(Infinity);
  const f = _f; f.fill(Infinity);
  const from = _from; from.fill(-1);
  const closed = _closed; closed.fill(0);
  heapScratch.length = 0;
  const startI = tIdx(st[0], st[1]);
  const goalI = tIdx(gt[0], gt[1]);
  const h = (i: number): number => {
    const dx = Math.abs((i % COLS) - gt[0]);
    const dy = Math.abs(((i / COLS) | 0) - gt[1]);
    return 10 * (Math.max(dx, dy) - Math.min(dx, dy)) + 14 * Math.min(dx, dy);
  };

  const heap = heapScratch;
  heap.push(startI);
  gCost[startI] = 0;
  f[startI] = h(startI);
  const push = (i: number): void => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (f[heap[p]] <= f[heap[c]]) break;
      const t = heap[p]; heap[p] = heap[c]; heap[c] = t;
      c = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1, r = l + 1;
        let m = p;
        if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
        if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
        if (m === p) break;
        const t = heap[p]; heap[p] = heap[m]; heap[m] = t;
        p = m;
      }
    }
    return top;
  };

  let found = false;
  let guard = 0;
  const guardMax = COLS * ROWS * 2.5; // 大图整图路径 + 河流绕行需要足够的探索预算
  while (heap.length && guard++ < guardMax) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalI) { found = true; break; }
    const cx = cur % COLS, cy = (cur / COLS) | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (isBlockedTile(blocked, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (isBlockedTile(blocked, cx + dx, cy) || isBlockedTile(blocked, cx, cy + dy))) continue;
      const ni = tIdx(nx, ny);
      if (closed[ni]) continue;
      const ng = gCost[cur] + cost;
      if (ng < gCost[ni]) {
        gCost[ni] = ng;
        from[ni] = cur;
        f[ni] = ng + h(ni);
        push(ni);
      }
    }
  }
  if (!found) return null;

  const tiles: number[] = [];
  for (let cur = goalI; cur !== -1; cur = from[cur]) tiles.push(cur);
  tiles.reverse();
  const pts: Vec[] = tiles.map(i => ({ x: (i % COLS) * TILE + TILE / 2, y: ((i / COLS) | 0) * TILE + TILE / 2 }));

  // 视线平滑：尽量跳过中间路径点
  const sm: Vec[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    for (; j > i + 1; j--) {
      if (lineClear(blocked, pts[i].x, pts[i].y, pts[j].x, pts[j].y)) break;
    }
    sm.push(pts[j]);
    i = j;
  }

  // 终点精确化
  const last = sm[sm.length - 1];
  if (!isBlockedTile(blocked, Math.floor(x1 / TILE), Math.floor(y1 / TILE)) &&
    (Math.abs(last.x - x1) > 6 || Math.abs(last.y - y1) > 6) &&
    lineClear(blocked, last.x, last.y, x1, y1)) {
    sm.push({ x: x1, y: y1 });
  }

  // 起点若在脚边则去掉
  const d0x = sm[0].x - x0, d0y = sm[0].y - y0;
  if (sm.length > 1 && Math.sqrt(d0x * d0x + d0y * d0y) < TILE * 0.6) sm.shift();
  return sm.length ? sm : null;
}
