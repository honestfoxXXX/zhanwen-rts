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

/** 两点连线是否无阻挡（步进采样） */
export function lineClear(blocked: Uint8Array, x0: number, y0: number, x1: number, y1: number): boolean {
  // 显式 sqrt 而非 Math.hypot：保证跨 JS 引擎结果一致（联机 lockstep 的前提）
  const dx = x1 - x0, dy = y1 - y0;
  const d = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(d / 14));
  for (let i = 0; i <= steps; i++) {
    const x = x0 + (x1 - x0) * i / steps;
    const y = y0 + (y1 - y0) * i / steps;
    if (isBlockedTile(blocked, Math.floor(x / TILE), Math.floor(y / TILE))) return false;
  }
  return true;
}

/**
 * A* 寻路（8 方向、禁止斜穿角落），返回世界坐标路径点（含视线平滑与精确终点）。
 * 输入输出均为世界坐标。
 */
export function findPath(blocked: Uint8Array, x0: number, y0: number, x1: number, y1: number): Vec[] | null {
  const st = nearestFreeTile(blocked, Math.floor(x0 / TILE), Math.floor(y0 / TILE));
  const gt = nearestFreeTile(blocked, Math.floor(x1 / TILE), Math.floor(y1 / TILE));
  if (!st || !gt) return null;

  if (st[0] === gt[0] && st[1] === gt[1]) {
    const c = { x: gt[0] * TILE + TILE / 2, y: gt[1] * TILE + TILE / 2 };
    return lineClear(blocked, x0, y0, x1, y1) ? [{ x: x1, y: y1 }] : [c];
  }

  const N = COLS * ROWS;
  const gCost = new Float32Array(N).fill(Infinity);
  const f = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const startI = tIdx(st[0], st[1]);
  const goalI = tIdx(gt[0], gt[1]);
  const h = (i: number): number => {
    const dx = Math.abs((i % COLS) - gt[0]);
    const dy = Math.abs(((i / COLS) | 0) - gt[1]);
    return 10 * (Math.max(dx, dy) - Math.min(dx, dy)) + 14 * Math.min(dx, dy);
  };

  const heap: number[] = [startI];
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
