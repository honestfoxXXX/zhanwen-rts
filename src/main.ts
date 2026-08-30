import { BUILDING_DEFS } from './core/config';
import { canPlace, createWorld, issueCommand, STEP, stepWorld } from './core/sim';
import { findPath } from './core/pathfinding';
import type { World } from './core/types';
import { Camera } from './render/camera';
import { Effects } from './render/effects';
import { draw, initRenderer } from './render/renderer';
import * as minimap from './render/minimap';
import { Input } from './input/input';
import type { UIState } from './input/input';
import { Hud, DENY_TEXT } from './ui/hud';
import { initAudio, isMuted, play, toggleMute } from './sound';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const frame = document.getElementById('frame') as HTMLDivElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

const cam = new Camera();
const fx = new Effects();
const ui: UIState = { selection: [], mode: 'none', placing: null, ghost: null, boxRect: null, rallyFor: null };

let world: World | null = null;
let state: 'menu' | 'play' | 'pause' | 'over' = 'menu';
let acc = 0;
let lastTs = 0;
let dpr = 1;

initRenderer();

/* ---------------- 布局：手机全屏 / 桌面竖幅居中 ---------------- */

function layout(): void {
  const vw = window.innerWidth, vh = window.innerHeight;
  const portraitish = vw / vh < 0.72;
  let fw: number, fh: number;
  if (portraitish) {
    fw = vw;
    fh = vh;
  } else {
    fh = Math.min(vh - 28, 1040);
    fw = Math.round(fh * 0.585);
    if (fw > vw - 40) {
      fw = vw - 40;
      fh = Math.round(fw / 0.585);
    }
  }
  frame.style.width = `${fw}px`;
  frame.style.height = `${fh}px`;
  dpr = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(fw * dpr);
  canvas.height = Math.round(fh * dpr);
  cam.resize(fw, fh);
}
window.addEventListener('resize', layout);
layout();
cam.y = 1e9;
cam.clamp();

/* ---------------- HUD 与输入接线 ---------------- */

const hud = new Hud({
  start: d => startGame(d),
  pause: () => { if (state === 'play') { state = 'pause'; hud.showPause(true); } },
  resume: () => { if (state === 'pause') { state = 'play'; acc = 0; hud.showPause(false); } },
  restart: () => { startGame(hud.difficulty); },
  quit: () => { state = 'menu'; world = null; hud.showMenu(); },
  build: t => {
    if (!world || state !== 'play') return;
    initAudio();
    ui.mode = 'place';
    ui.placing = t;
    const wp = cam.screenToWorld(cam.cssW / 2, cam.cssH * 0.55);
    const r = canPlace(world, 0, t, wp.x, wp.y);
    ui.ghost = { type: t, x: r.x, y: r.y, valid: r.ok };
    play('ui');
  },
  train: t => {
    if (!world || state !== 'play') return;
    initAudio();
    issueCommand(world, { type: 'train', side: 0, unit: t });
  },
  selectAll: () => {
    if (!world) return;
    ui.selection = world.units.filter(u => !u.dead && u.side === 0).map(u => u.id);
    if (!ui.selection.length) hud.toast('没有可用的部队');
  },
  rally: () => { if (world && state === 'play') { ui.mode = 'rally'; play('ui'); } },
  hold: () => {
    if (!world || state !== 'play' || !ui.selection.length) return;
    issueCommand(world, { type: 'hold', side: 0, ids: [...ui.selection] });
    hud.toast(`${ui.selection.length} 支部队就地固守`);
    play('ui');
  },
  retreat: () => {
    if (!world || state !== 'play' || !ui.selection.length) return;
    issueCommand(world, { type: 'retreat', side: 0, ids: [...ui.selection] });
    hud.toast(`${ui.selection.length} 支部队撤退`);
    play('ui');
  },
  placeOk: () => { input.confirmPlace(); },
  placeNo: () => { input.cancelMode(); },
  desel: () => { input.clearSelection(); },
  sound: () => toggleMute(),
});

const input = new Input(canvas, cam, () => world, ui, {
  command: c => (world ? issueCommand(world, c) : false),
  toast: m => hud.toast(m),
  onEscape: () => {
    if (state !== 'play') return;
    if (ui.mode !== 'none') input.cancelMode();
    else input.clearSelection();
  },
});

hud.setSoundLabel(isMuted() ? '关' : '开');

function startGame(diff: World['difficulty']): void {
  initAudio();
  world = createWorld(diff, (Date.now() & 0x7fffffff) || 12345);
  ui.selection = [];
  input.cancelMode();
  fx.clear();
  alert = null;
  hud.hideAlert();
  cam.y = 1e9;
  cam.clamp();
  acc = 0;
  state = 'play';
  hud.showGame();
  let seen = false;
  try { seen = localStorage.getItem('zw_tips') === '1'; } catch { /* ignore */ }
  if (!seen) {
    hud.showTips();
    state = 'pause'; // 关闭提示后恢复
  }
}

/* ---------------- 挨打告警 ---------------- */

interface AlertState { x: number; y: number; building: boolean; life: number }
let alert: AlertState | null = null;
const alertCd = { building: 0, unit: 0 };

/** 必须节流：否则敌人每一次开火都会弹提示，等于没有提示 */
function triggerAlert(x: number, y: number, building: boolean): void {
  const now = performance.now() / 1000;
  const key = building ? 'building' : 'unit';
  if (now - alertCd[key] < (building ? 3 : 6)) return;
  alertCd[key] = now;
  alert = { x, y, building, life: 2.4 };
  hud.showAlert(building ? '⚠ 我方建筑遇袭' : '⚠ 部队遭遇敌军');
  play('alarm');
}

/** 屏幕边缘泛红：让发生在屏幕外的战况有存在感 */
function drawAlertGlow(g: CanvasRenderingContext2D): void {
  if (!alert) return;
  const k = Math.min(1, alert.life / 0.5);
  const w = Math.min(26, cam.cssW * 0.09);
  g.save();
  g.globalAlpha = 0.5 * k;
  const edges: [number, number, number, number][] = [
    [0, 0, 0, w],
    [0, cam.cssH - w, 0, cam.cssH],
    [0, 0, w, 0],
    [cam.cssW - w, 0, cam.cssW, 0],
  ];
  for (const [x0, y0, x1, y1] of edges) {
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, 'rgba(248,113,113,0.9)');
    grad.addColorStop(1, 'rgba(248,113,113,0)');
    g.fillStyle = grad;
    g.fillRect(
      Math.min(x0, x1), Math.min(y0, y1),
      Math.abs(x1 - x0) || cam.cssW, Math.abs(y1 - y0) || cam.cssH,
    );
  }
  g.restore();
}

/* ---------------- 事件 → 特效 / 音效 / 提示 ---------------- */

function drainEvents(): void {
  if (!world) return;
  let ended = false;
  for (const e of world.events) {
    switch (e.type) {
      case 'shot':
        if (e.x !== undefined && e.y !== undefined) {
          // 近战没有弹道，用一道挥砍弧线表现，与远程的枪口闪光区分开
          if (e.melee) fx.slash(e.x, e.y, e.big ?? false);
          else fx.flash(e.x, e.y, e.big ?? false);
        }
        play('shot');
        // 敌方开火 ⇒ 我方挨打（实体都有阵营且只打对方），发生在屏幕外也必须让玩家知道
        if (e.side === 1 && e.tx !== undefined && e.ty !== undefined && state === 'play') {
          triggerAlert(e.tx, e.ty, e.targetBuilding ?? false);
        }
        break;
      case 'die':
        if (e.x !== undefined && e.y !== undefined && e.r !== undefined && e.side !== undefined) {
          fx.dieEvent(e.x, e.y, e.r, e.side, e.big ?? false);
        }
        play('die');
        break;
      case 'boom':
        if (e.x !== undefined && e.y !== undefined) fx.boomEvent(e.x, e.y, e.big ?? false);
        play('boom');
        break;
      case 'built':
        if (e.x !== undefined && e.y !== undefined && e.side !== undefined) fx.builtEvent(e.x, e.y, e.side);
        play('built');
        break;
      case 'moveMark':
        if (e.x !== undefined && e.y !== undefined) fx.mark(e.x, e.y);
        play('move');
        break;
      case 'wave':
        hud.toast('⚠ 敌军大举进攻！');
        play('alarm');
        break;
      case 'denied':
        hud.toast(DENY_TEXT[e.reason ?? 'place'] ?? '无法执行');
        play('deny');
        break;
      case 'gameOver':
        ended = true;
        break;
    }
  }
  world.events.length = 0;
  if (ended && world.gameOver && state !== 'over') {
    state = 'over';
    input.cancelMode();
    hud.showResult(world.gameOver.winner, world);
    play(world.gameOver.winner === 0 ? 'win' : 'lose');
  }
}

/* ---------------- 主循环 ---------------- */

const rallyBtn = document.getElementById('btnRally') as HTMLButtonElement;
const buildBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-build]'))
  .map(b => [b.dataset.build as string, b] as const);

function loop(ts: number): void {
  requestAnimationFrame(loop);
  const dtReal = Math.min(0.25, (ts - lastTs) / 1000 || 0);
  lastTs = ts;

  if (state === 'play' && world && !world.gameOver) {
    input.update(dtReal);
    acc += dtReal;
    let steps = 0;
    while (acc >= STEP && steps < 6) {
      stepWorld(world, STEP);
      acc -= STEP;
      steps++;
      if (world.gameOver) break;
    }
    if (acc > STEP * 6) acc = 0;
  }
  fx.update(dtReal);
  if (world) drainEvents();
  if (alert) {
    alert.life -= dtReal;
    if (alert.life <= 0) { alert = null; hud.hideAlert(); }
  }
  renderFrame();
}

function renderFrame(): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (world) {
    input.refreshGhost();
    const modeLabel = ui.mode === 'place' && ui.placing
      ? `建造：${BUILDING_DEFS[ui.placing].name}`
      : ui.mode === 'rally' ? '点击地图设置集结点'
        : null; // 框选不占用操作行，避免拖动时底部卡槽闪烁
    draw(ctx, world, cam, ui, fx); // 内部已在末尾绘制小地图
    minimap.drawAlert(ctx, alert, cam, world.time);
    drawAlertGlow(ctx);
    hud.update(world, ui, modeLabel);
    rallyBtn.classList.toggle('armed', ui.mode === 'rally');
    for (const [t, btn] of buildBtns) btn.classList.toggle('armed', ui.mode === 'place' && ui.placing === t);
  } else {
    ctx.fillStyle = '#070c16';
    ctx.fillRect(0, 0, cam.cssW, cam.cssH);
  }
}

// 调试句柄（自动化测试 / 控制台调试用）
declare global {
  interface Window {
    __zw?: {
      world: () => World | null;
      ui: UIState;
      findPath: (x0: number, y0: number, x1: number, y1: number) => import('./core/types').Vec[] | null;
      nudge: (sec: number) => number;
    };
  }
}
window.__zw = {
  world: () => world,
  ui,
  findPath: (...a) => findPath(world ? world.blocked : new Uint8Array(0), ...a),
  // 测试用：确定性快进（仅游戏中有效）
  nudge: (sec: number) => {
    if (!world || state !== 'play') return 0;
    const n = Math.min(Math.round(sec * 60), 60 * 600);
    for (let i = 0; i < n && !world.gameOver; i++) stepWorld(world, STEP);
    drainEvents();
    renderFrame();
    return n;
  },
};

requestAnimationFrame(loop);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'play') {
    state = 'pause';
    hud.showPause(true);
  }
});

// 阻止移动端双击缩放
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
