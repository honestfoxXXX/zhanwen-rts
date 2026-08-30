/** mulberry32：确定性随机，状态保存在 World 中（为联机锁步留确定性） */
export function rngNext(w: { rngState: number }): number {
  w.rngState = (w.rngState + 0x6d2b79f5) | 0;
  let t = w.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rngRange(w: { rngState: number }, a: number, b: number): number {
  return a + (b - a) * rngNext(w);
}
