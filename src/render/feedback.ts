/**
 * 打击感反馈层：受击闪白 + 伤害数字开关。
 * 独立于模拟（World）之外，只服务表现层；开关存 localStorage。
 */
const flashes = new Map<number, number>();

/** 命中反馈：实体 id → 剩余闪白时间 */
export function notifyHit(id: number): void {
  flashes.set(id, 0.1);
}

/** 当前闪白强度（0-1），draw 循环里读取 */
export function flashOf(id: number): number {
  const t = flashes.get(id);
  if (t === undefined) return 0;
  return Math.min(1, t / 0.1);
}

export function tickFlash(dt: number): void {
  if (flashes.size === 0) return;
  for (const [k, v] of flashes) {
    const nv = v - dt;
    if (nv <= 0) flashes.delete(k);
    else flashes.set(k, nv);
  }
}

/* ---- 伤害数字开关（设置面板写入） ---- */
const KEY = 'zw_show_dmg';
let showDamage = true;
try { showDamage = localStorage.getItem(KEY) !== '0'; } catch { /* ignore */ }

export function damageNumbersOn(): boolean {
  return showDamage;
}

export function setDamageNumbers(v: boolean): void {
  showDamage = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
}
