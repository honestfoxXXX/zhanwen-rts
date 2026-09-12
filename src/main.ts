import { BUILDING_DEFS, CIVS, MAPS, MAP_H, MAP_W, UNIT_DEFS } from './core/config';
import { canPlace, createWorld, findBuildSlot, issueCommand, STEP, stepWorld } from './core/sim';
import { findPath } from './core/pathfinding';
import type { BuildingType, CivId, Projectile, World } from './core/types';
import { Camera } from './render/camera';
import { Effects } from './render/effects';
import { draw, initRenderer } from './render/renderer';
import * as minimap from './render/minimap';
import { Input } from './input/input';
import type { UIState } from './input/input';
import { Hud, DENY_TEXT } from './ui/hud';
import { initAudio, isMuted, play, setBattleIntensity, toggleMute, toggleMusic } from './sound';
import { notifyHit, tickFlash, damageNumbersOn } from './render/feedback';
import { settings } from './settings';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const frame = document.getElementById('frame') as HTMLDivElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

const cam = new Camera();
const fx = new Effects();
const ui: UIState = { selection: [], buildingSel: null, mode: 'none', placing: null, ghost: null, boxRect: null, rallyFor: null };

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
cam.resetZoom();
cam.centerOn(MAP_W / 2, MAP_H / 2);

/* ---------------- HUD 与输入接线 ---------------- */

const hud = new Hud({
  start: (d, p) => startGame(d, p),
  pause: () => { if (state === 'play') { state = 'pause'; hud.showPause(true); } },
  resume: () => { if (state === 'pause') { state = 'play'; acc = 0; hud.showPause(false); } },
  restart: () => { startGame(hud.difficulty, hud.selectedPlayers); },
  quit: () => { state = 'menu'; world = null; hud.showMenu(); },
  build: t => {
    if (!world || state !== 'play') return;
    initAudio();
    ui.mode = 'place';
    ui.placing = t;
    // 初始幽灵优先落在 HQ 附近（朝质心方向）的合法位，保证点开建造时 ✓ 可用；
    // 之后仍跟随指针自由拖动。屏幕中心点在三人图可能压住 HQ/矿点或落在区域外。
    const slot = findBuildSlot(world, 0, t, [[-80, 80], [80, 80], [0, 160], [-80, 160], [80, 160]]);
    if (slot) {
      ui.ghost = { type: t, x: slot.x, y: slot.y, valid: true };
    } else {
      const wp = cam.screenToWorld(cam.cssW / 2, cam.cssH * 0.55);
      const r = canPlace(world, 0, t, wp.x, wp.y);
      ui.ghost = { type: t, x: r.x, y: r.y, valid: r.ok };
    }
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
  pickFront: () => {
    if (!world || state !== 'play') return;
    ui.selection = world.units.filter(u => !u.dead && u.side === 0 && u.type !== 'archer' && u.type !== 'catapult').map(u => u.id);
    hud.toast(ui.selection.length ? `前排 ${ui.selection.length} 支` : '没有前排部队');
    play('ui');
  },
  pickBack: () => {
    if (!world || state !== 'play') return;
    ui.selection = world.units.filter(u => !u.dead && u.side === 0 && (u.type === 'archer' || u.type === 'catapult')).map(u => u.id);
    hud.toast(ui.selection.length ? `后排 ${ui.selection.length} 支` : '没有后排部队');
    play('ui');
  },
  towerUpgrade: () => {
    if (!world || state !== 'play' || ui.buildingSel === null) return;
    const b = world.buildings.find(v => v.id === ui.buildingSel && v.type === 'tower' && !v.dead);
    if (!b) { hud.toast('请先点选一座自己的箭塔'); return; }
    if (b.level >= 3) { hud.toast('已达最高等级'); return; }
    const cost = b.level === 1 ? 150 : 300;
    const ok = issueCommand(world, { type: 'upgradeTower', side: 0, buildingId: b.id });
    hud.toast(ok ? `箭塔升级中（${b.level}→${b.level + 1} 级）` : `黄金不足（需 ${cost}）`);
    play('ui');
  },
  mineUpgrade: () => {
    if (!world || state !== 'play' || ui.buildingSel === null) return;
    const b = world.buildings.find(v => v.id === ui.buildingSel && v.type === 'mine' && !v.dead);
    if (!b) { hud.toast('请先点选一座自己的金矿'); return; }
    const ok = issueCommand(world, { type: 'upgradeMine', side: 0, buildingId: b.id });
    hud.toast(ok ? '金矿升级中 —— 更厚更硬' : '已达最高等级或黄金不足');
    play('ui');
  },
  groupRecall: (n: number) => recallGroup(n),
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
  music: () => toggleMusic(),
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

let civSel: CivId = 'central';

function startGame(diff: World['difficulty'], players = 2): void {
  initAudio();
  // 地形随种子轮换，避免每局都是同一张图；地面是预渲染的，换图必须重建。
  // 轮换池只取「与所选人数匹配」的图，否则 1v1 和 1v2 会被混在一起统计。
  const seed = (Date.now() & 0x7fffffff) || 12345;
  const pool = MAPS.map((m, i) => [m, i] as const).filter(([m]) => m.players === players).map(([, i]) => i);
  const mapIndex = pool[seed % pool.length];
  const map = MAPS[mapIndex];
  initRenderer(map);
  // 玩家选文明，AI 分配剩余文明（1v1 随机一个、三人局按序分配）
  const civPool: CivId[] = (['central', 'nomad', 'knight'] as CivId[]).filter(c => c !== civSel);
  const civs: CivId[] = [civSel];
  for (let i = 1; i < players; i++) civs.push(civPool[(seed + i) % civPool.length]);
  world = createWorld(diff, seed, mapIndex, civs);
  hud.setMapBrief(map.name, map.brief);
  hud.toast(`地形：${map.name} —— ${map.brief}`);
  // 对手文明情报：直接引用文明描述，单一出处
  for (let i = 1; i < players; i++) hud.feed(`对手：${CIVS[world.civs[i]].name} —— ${CIVS[world.civs[i]].desc}`, 'warn');
  ui.selection = [];
  input.cancelMode();
  fx.clear();
  prevProjectiles = [];
  shakeT = shakeDur = shakeAmp = shakeY = 0;
  alert = null;
  alertLog.length = 0;
  for (const g of groups) g.length = 0; // 实体 ID 每局从头编号，旧编队会串到新世界的单位
  hud.resetForNewGame();
  hud.hideAlert();
  cam.resetZoom();
  cam.centerOn(world.spawns[0].x, world.spawns[0].y); // 开场镜头对准己方城堡
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

/* ---------------- 命中火花：弹道消失即命中（模拟不发命中事件，渲染层自行对比前后帧） ---------------- */

let prevProjectiles: Projectile[] = [];

function updateImpactFx(): void {
  if (!world) { prevProjectiles = []; return; }
  const alive = new Set(world.projectiles);
  for (const p of prevProjectiles) {
    if (!alive.has(p)) fx.spark(p.tx, p.ty, p.side);
  }
  prevProjectiles = [...world.projectiles];
}

/* ---------------- 镜头震动（纯视觉，大爆炸时给一点冲击感） ---------------- */

let shakeT = 0;
let shakeDur = 0;
let shakeAmp = 0;
let shakeY = 0;

function shake(amp: number, dur: number): void {
  if (!settings.shake) return; // 设置面板可关
  shakeAmp = Math.max(shakeAmp, amp);
  shakeDur = Math.max(shakeDur, dur);
  shakeT = Math.max(shakeT, dur);
}

/* ---------------- 挨打告警 ---------------- */

interface AlertState { x: number; y: number; building: boolean; life: number }
let alert: AlertState | null = null;
const alertCd = { building: 0, unit: 0 };
/** 告警历史（Tab 循环跳转）：只记位置，不抢镜头 */
const alertLog: { x: number; y: number }[] = [];
let alertLogI = 0;

/** 必须节流：否则敌人每一次开火都会弹提示，等于没有提示 */
function triggerAlert(x: number, y: number, building: boolean): void {
  const now = performance.now() / 1000;
  const key = building ? 'building' : 'unit';
  if (now - alertCd[key] < (building ? 3 : 6)) return;
  alertCd[key] = now;
  alert = { x, y, building, life: 2.4 };
  alertLog.push({ x, y });
  if (alertLog.length > 8) alertLog.shift();
  alertLogI = alertLog.length; // Tab 从最新开始往回翻
  hud.showAlert(building ? '⚠ 城堡遇袭' : '⚠ 部队遭遇敌军');
  hud.feed(building ? '⚠ 城堡遇袭 —— Tab 前往支援' : '⚠ 部队接敌', building ? 'danger' : 'warn');
  play('alarm');
}

/** Tab：循环跳到最近的告警点（大图导航的核心键） */
function cycleAlert(): void {
  if (!alertLog.length || !world) return;
  alertLogI = (alertLogI - 1 + alertLog.length) % alertLog.length;
  const a = alertLog[alertLogI];
  cam.centerOn(a.x, a.y);
}

/** 告警方向指示：屏幕内→四边泛红；屏幕外→对应边缘红晕 + 指向箭头，威胁方位一眼可读 */
function drawAlertGlow(g: CanvasRenderingContext2D): void {
  if (!alert) return;
  const k = Math.min(1, alert.life / 0.5);
  const sx = (alert.x - cam.x) * cam.scale;
  const sy = (alert.y - cam.y) * cam.scale;
  const onScreen = sx >= -40 && sx <= cam.cssW + 40 && sy >= -40 && sy <= cam.cssH + 40;
  g.save();
  g.globalAlpha = 0.55 * k;
  if (onScreen) {
    const w = Math.min(26, cam.cssW * 0.09);
    const edges: [number, number, number, number][] = [
      [0, 0, 0, w], [0, cam.cssH - w, 0, cam.cssH], [0, 0, w, 0], [cam.cssW - w, 0, cam.cssW, 0],
    ];
    for (const [x0, y0, x1, y1] of edges) {
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, 'rgba(248,113,113,0.85)');
      grad.addColorStop(1, 'rgba(248,113,113,0)');
      g.fillStyle = grad;
      g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || cam.cssW, Math.abs(y1 - y0) || cam.cssH);
    }
  } else {
    // 方向边缘：把威胁方向钉在对应边上
    const cx = cam.cssW / 2, cy = cam.cssH / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const halfW = cam.cssW / 2, halfH = cam.cssH / 2;
    const t = Math.min(
      halfW / Math.abs(Math.cos(ang) || 1e-6),
      halfH / Math.abs(Math.sin(ang) || 1e-6),
    );
    const ex = cx + Math.cos(ang) * t, ey = cy + Math.sin(ang) * t;
    const grad = g.createRadialGradient(ex, ey, 0, ex, ey, 90);
    grad.addColorStop(0, 'rgba(248,113,113,0.75)');
    grad.addColorStop(1, 'rgba(248,113,113,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(ex, ey, 90, 0, Math.PI * 2); g.fill();
    // 指向箭头
    g.translate(ex, ey); g.rotate(ang);
    g.fillStyle = 'rgba(252,165,165,0.95)';
    const pulse = 4 + Math.sin(performance.now() / 120) * 2;
    g.beginPath();
    g.moveTo(pulse, 0); g.lineTo(-8, -11); g.lineTo(-8, 11);
    g.closePath(); g.fill();
  }
  g.restore();
}

/* ---------------- 事件 → 特效 / 音效 / 提示 ---------------- */

/** 声音随事件与视口中心的距离衰减：远处的战斗更安静，近处的更响 */
function volAt(x: number, y: number): number {
  const cx = cam.x + cam.viewW / 2, cy = cam.y + cam.viewH / 2;
  const d = Math.hypot(x - cx, y - cy);
  const viewR = Math.max(cam.viewW, cam.viewH) * 0.65;
  return Math.max(0.12, 1 - d / viewR);
}

/** 命中点附近最近实体（闪白反馈定位用）：先部队后建筑，容差 = 半径 + 10 */
function entityNear(w: World, x: number, y: number): { id: number } | null {
  let best: { id: number; d: number } | null = null;
  for (const u of w.units) {
    if (u.dead) continue;
    const d = Math.hypot(u.x - x, u.y - y) - UNIT_DEFS[u.type].radius;
    if (d <= 10 && (!best || d < best.d)) best = { id: u.id, d };
  }
  if (best) return { id: best.id };
  for (const b of w.buildings) {
    if (b.dead) continue;
    const d = Math.hypot(b.x - x, b.y - y) - b.half;
    if (d <= 12) return { id: b.id };
  }
  return null;
}

function drainEvents(): void {
  if (!world) return;
  let ended = false;
  let combat = 0;
  for (const e of world.events) {
    switch (e.type) {
      case 'shot': {
        combat++;
        // 打击感：命中实体闪白 + 伤害数字（容差内找最近的受击实体）
        if (e.tx !== undefined && e.ty !== undefined) {
          const victim = entityNear(world, e.tx, e.ty);
          if (victim) notifyHit(victim.id);
          if (damageNumbersOn() && e.dmg) fx.dmgText(e.tx, e.ty, String(e.dmg));
        }
        if (e.x !== undefined && e.y !== undefined) {
          // 近战没有弹道，用一道挥砍弧线表现，与远程的枪口闪光区分开
          if (e.melee) fx.slash(e.x, e.y, e.big ?? false);
          else fx.flash(e.x, e.y, e.big ?? false);
        }
        if (e.from === 'catapult') {
          // 碎裂声对齐弹道落地：飞行时间 = 距离 / 投石车弹速 220
          const fly = e.x !== undefined && e.y !== undefined && e.tx !== undefined && e.ty !== undefined
            ? Math.hypot(e.tx - e.x, e.ty - e.y) / 220 : 0.6;
          play('siege', e.x !== undefined && e.y !== undefined ? volAt(e.x, e.y) : 1, fly);
        }
        else if (e.melee) play('clash', e.x !== undefined && e.y !== undefined ? volAt(e.x, e.y) : 1);
        else play('shot', e.x !== undefined && e.y !== undefined ? volAt(e.x, e.y) : 1);
        // 混战里不能靠"攻击方不是我"判断挨打（AI 互相打也算），必须看事件里记录的挨打方
        if (e.targetSide === 0 && e.tx !== undefined && e.ty !== undefined && state === 'play') {
          triggerAlert(e.tx, e.ty, e.targetBuilding ?? false);
        }
        break;
      }
      case 'die':
        combat += 2;
        if (e.x !== undefined && e.y !== undefined && e.r !== undefined && e.side !== undefined) {
          fx.dieEvent(e.x, e.y, e.r, e.side, e.big ?? false);
        }
        play('die', e.x !== undefined && e.y !== undefined ? volAt(e.x, e.y) : 1);
        break;
      case 'boom':
        if (e.x !== undefined && e.y !== undefined) fx.boomEvent(e.x, e.y, e.big ?? false);
        play('boom', e.big ? 1 : e.x !== undefined && e.y !== undefined ? volAt(e.x, e.y) : 1);
        if (e.big) shake(5, 0.32); // 大建筑被毁：镜头震一下
        break;
      case 'built':
        if (e.x !== undefined && e.y !== undefined && e.side !== undefined) fx.builtEvent(e.x, e.y, e.side);
        play('built', e.x !== undefined && e.y !== undefined ? volAt(e.x, e.y) : 1);
        if (e.side === 0 && !e.placed) hud.feed('一座建筑完工', 'info');
        break;
      case 'moveMark':
        if (e.x !== undefined && e.y !== undefined) fx.mark(e.x, e.y, e.forced ?? false);
        play('move');
        break;
      case 'wave':
        hud.feed('⚠ 敌军大举来犯！', 'danger');
        play('alarm');
        break;
      case 'eliminated':
        // 我方被灭由结算处理；这里只报敌方出局，给玩家"局势推进"的反馈
        if (e.side !== 0 && world.alive) {
          const remain = world.alive.filter(Boolean).length;
          hud.feed(`敌一支军团覆灭，还剩 ${remain} 方`, 'info');
        }
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
  setBattleIntensity(Math.min(1, combat / 10));
  // 三人局：己方城堡被毁即出局。模拟继续（另两方分胜负），但玩家对局到此为止——
  // 此前 alive[0]=false 而 gameOver=null，玩家被晾在死局里看 AI 互殴
  if (state === 'play' && !world.gameOver && !world.alive[0]) {
    state = 'over';
    input.cancelMode();
    hud.showResult(1, world, '你的城堡已陷落 —— 出局');
    play('lose');
  }
  if (ended && world.gameOver && state !== 'over') {
    state = 'over';
    input.cancelMode();
    const winner = world.gameOver.winner;
    hud.showResult(winner, world);
    play(winner === 0 ? 'win' : winner === null ? 'draw' : 'lose');
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

  cam.update(dtReal);
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
  tickFlash(dtReal);
  // 震动衰减：简谐衰减，比线性自然
  if (shakeT > 0) {
    shakeT -= dtReal;
    shakeY = Math.sin(shakeT * 52) * shakeAmp * Math.max(0, shakeT / shakeDur);
  } else shakeY = 0;
  if (world) {
    updateImpactFx();
    drainEvents();
  }
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
    // 震动期间临时偏移相机（渲染完立即还原，不污染输入/HUD 用的相机状态）
    const camY0 = cam.y;
    if (shakeY) { cam.y += shakeY; cam.clamp(); }
    draw(ctx, world, cam, ui, fx); // 内部已在末尾绘制小地图
    minimap.drawAlert(ctx, alert, cam, world.time);
    drawAlertGlow(ctx);
    if (shakeY) cam.y = camY0;
    hud.update(world, ui, modeLabel);
    hud.renderGroups(groups.map(g => g.filter(id => world!.units.some(v => v.id === id && !v.dead)).length));
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
      cam: () => import('./render/camera').Camera;
      ui: UIState;
      findPath: (x0: number, y0: number, x1: number, y1: number) => import('./core/types').Vec[] | null;
      nudge: (sec: number) => number;
    };
  }
}
window.__zw = {
  world: () => world,
  cam: () => cam,
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

// 热键总调度：
//   空格 跳交战/军队 · C 回城堡 · Tab 循环告警点 · P 暂停
//   Q/E/R/T/Y/B 建造 · 1-7 出兵（按卡槽可见顺序） · F 全选 · G 集结
//   U 升级箭塔 · I 升级金矿 · H 固守 · X 撤退 · Esc 取消
//   A+左键 攻击移动 · Shift+右键/双指轻点 强制移动
/* ---- B2 编队：Ctrl+1..5 编队，1..5 召回（双击跳质心），空槽回落出兵热键 ---- */
const groups: number[][] = [[], [], [], [], []];
let lastGroupKey = '';
let lastGroupT = 0;

function recallGroup(n: number): void {
  if (!world || state !== 'play') return;
  groups[n] = groups[n].filter(id => {
    const u = world!.units.find(v => v.id === id);
    return u && !u.dead;
  });
  if (!groups[n].length) return;
  ui.selection = [...groups[n]];
  ui.buildingSel = null;
  let sx = 0, sy = 0;
  for (const id of groups[n]) {
    const u = world.units.find(v => v.id === id);
    if (u) { sx += u.x; sy += u.y; }
  }
  void sx; void sy;
}

const BUILD_KEYS: Record<string, BuildingType> = { q: 'mine', e: 'barracks', r: 'tower', t: 'smithy', y: 'workshop', b: 'farm' };
window.addEventListener('keydown', e => {
  if (state !== 'play' || !world) return;
  const k = e.key.toLowerCase();
  if (e.key === ' ') {
    e.preventDefault();
    if (alertLog.length) {
      const a = alertLog[alertLog.length - 1];
      cam.centerOn(a.x, a.y);
    } else {
      let sx = 0, sy = 0, n = 0;
      for (const u of world.units) {
        if (u.side === 0 && !u.dead) { sx += u.x; sy += u.y; n++; }
      }
      if (n) cam.centerOn(sx / n, sy / n);
      else cam.centerOn(world.spawns[0].x, world.spawns[0].y);
    }
    return;
  }
  if (k === 'c') { cam.centerOn(world.spawns[0].x, world.spawns[0].y); return; }
  if (e.key === 'Tab') { e.preventDefault(); cycleAlert(); return; }
  if (k === 'p') { hud.pause(); return; }
  if (e.key >= '1' && e.key <= '5') {
    const n = Number(e.key) - 1;
    const w0 = world;
    if (!w0) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      groups[n] = ui.selection.filter(id => w0.units.some(v => v.id === id && !v.dead));
      if (groups[n].length) hud.feed(`编队 ${n + 1} 已设（${groups[n].length} 支）`, 'info');
      return;
    }
    if (groups[n].length) {
      const now2 = performance.now();
      const isDouble = lastGroupKey === e.key && now2 - lastGroupT < 350;
      lastGroupKey = e.key;
      lastGroupT = now2;
      recallGroup(n);
      if (isDouble && groups[n].length) {
        // 双击数字：镜头跳到编队质心
        let sx2 = 0, sy2 = 0;
        for (const id of groups[n]) {
          const u2 = world.units.find(v => v.id === id);
          if (u2) { sx2 += u2.x; sy2 += u2.y; }
        }
        cam.centerOn(sx2 / groups[n].length, sy2 / groups[n].length);
      }
      return;
    }
    // 空编队槽 → 回落为出兵热键
    hud.trainByHotkey(n);
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const buildT = BUILD_KEYS[k];
  if (buildT) {
    if (buildT !== 'farm' || world.civs[0] === 'central') hud.buildByHotkey(buildT);
    return;
  }
  if (k >= '1' && k <= '8') { hud.trainByHotkey(Number(k) - 1); return; }
  switch (k) {
    case 'f': hud.selectAll(); break;
    case 'g': hud.rally(); break;
    case 'u': hud.towerUpgrade(); break;
    case 'i': hud.mineUpgrade(); break;
    case 'h': hud.hold(); break;
    case 'x': hud.retreat(); break;
  }
});

// 阻止移动端双击缩放
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

// 菜单：文明选择（三选一）——描述统一读 CIVS.desc，杜绝第二份文案漂移
document.querySelectorAll('#civSeg button').forEach(b => {
  b.addEventListener('click', () => {
    civSel = (b as HTMLElement).dataset.civ as CivId;
    document.querySelectorAll('#civSeg button').forEach(v => v.classList.toggle('on', v === b));
    const desc = document.getElementById('civDesc');
    if (desc) desc.textContent = CIVS[civSel].desc;
  });
});
