/**
 * 战场残骸（纯表现层）：阵亡单位留下倒地剪影，约 26 秒渐隐。
 * 画在单位层之下、地表之上——让"这里打过仗"在画面上留痕。
 * 不进 World/状态指纹：纯视觉，回放与联机不受影响。
 */
interface Corpse {
  x: number;
  y: number;
  r: number;
  rot: number;
  born: number;
}

const LIFE = 26;
const list: Corpse[] = [];
let clock = 0;

export function registerCorpse(x: number, y: number, r: number): void {
  list.push({ x, y, r, rot: Math.random() * Math.PI, born: clock });
  // 上限防堆积（大团战一局死亡数百，残骸叠满地面会脏）
  if (list.length > 90) list.splice(0, list.length - 90);
}

export function clearCorpses(): void {
  list.length = 0;
}

export function updateCorpses(dt: number): void {
  clock += dt;
  while (list.length && clock - list[0].born > LIFE) list.shift();
}

/** 画在单位层之下：倒地的身体 + 散落的小件，随时间压暗淡出 */
export function drawCorpses(g: CanvasRenderingContext2D): void {
  for (const c of list) {
    const age = (clock - c.born) / LIFE;
    const alpha = 0.42 * (1 - age);
    if (alpha <= 0.02) continue;
    g.save();
    g.translate(c.x, c.y);
    g.rotate(c.rot);
    g.globalAlpha = alpha;
    // 倒地的身体
    g.fillStyle = '#3d3a30';
    g.beginPath();
    g.ellipse(0, 0, c.r * 1.05, c.r * 0.52, 0, 0, Math.PI * 2);
    g.fill();
    // 头/盔（偏一侧的小圆）
    g.fillStyle = '#4a463a';
    g.beginPath();
    g.arc(c.r * 0.85, c.r * 0.12, c.r * 0.34, 0, Math.PI * 2);
    g.fill();
    // 掉落的武器（一道短线）
    g.strokeStyle = 'rgba(200,208,220,0.5)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-c.r * 0.4, -c.r * 0.5);
    g.lineTo(-c.r * 1.15, -c.r * 0.85);
    g.stroke();
    g.restore();
  }
  g.globalAlpha = 1;
}
