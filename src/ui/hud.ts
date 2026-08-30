import { BUILDING_DEFS, DIFFICULTY, NODES, POP_CAP, UNIT_DEFS } from '../core/config';
import type { BuildingType, Difficulty, Side, UnitType, World } from '../core/types';
import type { UIState } from '../input/input';

const DENY_TEXT: Record<string, string> = {
  cost: '水晶不足',
  pop: '人口已满',
  nobarracks: '需要先建兵营',
  place: '无法在此建造',
  nonode: '附近没有空闲矿点',
  queue: '排队已满',
};

export interface HudHooks {
  start: (d: Difficulty) => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  quit: () => void;
  build: (t: BuildingType) => void;
  train: (t: UnitType) => void;
  selectAll: () => void;
  rally: () => void;
  placeOk: () => void;
  placeNo: () => void;
  desel: () => void;
  sound: () => string;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Hud {
  private diff: Difficulty = 'normal';
  private frame = 0;
  private els = {
    hud: $('hud'), menu: $('menu'), pause: $('pauseScr'), result: $('resultScr'), tips: $('tips'),
    crystal: $('resCrystal'), income: $('resIncome'), pop: $('resPop'),
    selchip: $('selchip'), selCount: $('selCount'),
    rowBuild: $('rowBuild'), rowUnit: $('rowUnit'), placeRow: $('placeRow'),
    placeHint: $('placeHint'), placeOk: $('btnPlaceOk'), placeNo: $('btnPlaceNo'),
    toasts: $('toasts'),
    resultTitle: $('resultTitle'), resultStats: $('resultStats'),
    sound: $('btnSound'),
  };
  private buildBtns = new Map<BuildingType, HTMLButtonElement>();
  private trainBtns = new Map<UnitType, HTMLButtonElement>();

  constructor(private hooks: HudHooks) {
    document.querySelectorAll<HTMLButtonElement>('[data-build]').forEach(b => {
      const t = b.dataset.build as BuildingType;
      this.buildBtns.set(t, b);
      b.addEventListener('click', () => hooks.build(t));
    });
    document.querySelectorAll<HTMLButtonElement>('[data-train]').forEach(b => {
      const t = b.dataset.train as UnitType;
      this.trainBtns.set(t, b);
      b.addEventListener('click', () => hooks.train(t));
    });
    $('btnPause').addEventListener('click', () => hooks.pause());
    $('btnAll').addEventListener('click', () => hooks.selectAll());
    $('btnRally').addEventListener('click', () => hooks.rally());
    this.els.placeOk.addEventListener('click', () => hooks.placeOk());
    this.els.placeNo.addEventListener('click', () => hooks.placeNo());
    $('btnDesel').addEventListener('click', () => hooks.desel());

    $('btnStart').addEventListener('click', () => hooks.start(this.diff));
    document.querySelectorAll<HTMLButtonElement>('#diffSeg button').forEach(b => {
      b.addEventListener('click', () => {
        this.diff = b.dataset.d as Difficulty;
        document.querySelectorAll('#diffSeg button').forEach(v => v.classList.toggle('on', v === b));
      });
    });
    $('btnResume').addEventListener('click', () => hooks.resume());
    $('btnRestart').addEventListener('click', () => hooks.restart());
    $('btnQuit').addEventListener('click', () => hooks.quit());
    $('btnAgain').addEventListener('click', () => hooks.restart());
    $('btnMenu2').addEventListener('click', () => hooks.quit());
    $('btnTipsOk').addEventListener('click', () => {
      this.hideTips();
      hooks.resume(); // 首局提示期间游戏处于暂停
    });
    this.els.sound.addEventListener('click', () => {
      this.els.sound.textContent = `音效：${hooks.sound()}`;
    });
  }

  get difficulty(): Difficulty { return this.diff; }

  showMenu(): void {
    this.els.menu.classList.remove('hidden');
    this.els.hud.classList.add('hidden');
    this.els.pause.classList.add('hidden');
    this.els.result.classList.add('hidden');
    this.els.tips.classList.add('hidden');
  }

  showGame(): void {
    this.els.menu.classList.add('hidden');
    this.els.hud.classList.remove('hidden');
    this.els.pause.classList.add('hidden');
    this.els.result.classList.add('hidden');
  }

  showPause(v: boolean): void {
    this.els.pause.classList.toggle('hidden', !v);
  }

  showResult(winner: Side, world: World): void {
    const win = winner === 0;
    this.els.resultTitle.textContent = win ? '胜 利' : '战 败';
    this.els.resultTitle.className = win ? 'win' : 'lose';
    const m = Math.floor(world.time / 60), s = Math.floor(world.time % 60);
    this.els.resultStats.textContent =
      `用时 ${m}:${String(s).padStart(2, '0')} · 歼灭敌军 ${world.stats.kills[0]} · 难度 ${DIFFICULTY[world.difficulty].label}`;
    this.els.result.classList.remove('hidden');
  }

  showTips(): void {
    this.els.tips.classList.remove('hidden');
  }

  hideTips(): void {
    this.els.tips.classList.add('hidden');
    try { localStorage.setItem('zw_tips', '1'); } catch { /* ignore */ }
  }

  toast(msg: string): void {
    const box = this.els.toasts;
    while (box.children.length >= 3) box.firstChild?.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 1900);
  }

  setSoundLabel(v: string): void {
    this.els.sound.textContent = `音效：${v}`;
  }

  /** 每 4 帧刷新数值，结构行（模式切换）每帧即时更新 */
  update(world: World, ui: UIState, modeLabel: string | null): void {
    // 结构行：立即响应，避免操作行与卡槽短暂同屏
    const sel = ui.selection.length;
    this.els.selchip.classList.toggle('hidden', sel === 0);
    this.els.selCount.textContent = `已选 ${sel}`;
    const modeActive = ui.mode !== 'none' && modeLabel !== null;
    this.els.rowBuild.classList.toggle('hidden', modeActive);
    this.els.rowUnit.classList.toggle('hidden', modeActive);
    this.els.placeRow.classList.toggle('hidden', !modeActive);
    if (modeActive) {
      this.els.placeHint.textContent = modeLabel ?? '';
      const isPlace = ui.mode === 'place';
      this.els.placeOk.classList.toggle('hidden', !isPlace);
      if (isPlace) (this.els.placeOk as HTMLButtonElement).disabled = !(ui.ghost && ui.ghost.valid);
    }

    if (++this.frame % 4 !== 0) return;
    const cr = Math.floor(world.crystals[0]);
    this.els.crystal.textContent = String(cr);
    this.els.income.textContent = `+${world.income[0].toFixed(0)}/s`;
    this.els.pop.textContent = `${world.popUsed[0]}/${POP_CAP}`;

    for (const [t, btn] of this.buildBtns) {
      const d = BUILDING_DEFS[t];
      let ok = cr >= d.cost;
      if (t === 'mine' && !world.nodes.some(n => n.mineId === null)) ok = false;
      btn.disabled = !ok;
    }
    for (const [t, btn] of this.trainBtns) {
      const d = UNIT_DEFS[t];
      btn.disabled = cr < d.cost || world.popUsed[0] + d.pop > POP_CAP;
      const q = world.queue[0].filter(v => v === t).length;
      let badge = btn.querySelector('.badge');
      if (q > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'badge';
          btn.appendChild(badge);
        }
        badge.textContent = String(q);
      } else if (badge) badge.remove();
    }
  }
}

export { DENY_TEXT, NODES };
