import { BUILDING_DEFS, DIFFICULTY, NODES, POP_CAP, UNIT_DEFS } from '../core/config';
import type { BuildingType, Difficulty, Side, UnitType, World } from '../core/types';
import type { UIState } from '../input/input';
import { drawIcon } from '../render/shapes';

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
  hold: () => void;
  retreat: () => void;
  sound: () => string;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Hud {
  private diff: Difficulty = 'normal';
  private frame = 0;
  private els = {
    hud: $('hud'), menu: $('menu'), pause: $('pauseScr'), result: $('resultScr'), tips: $('tips'),
    crystal: $('resCrystal'), income: $('resIncome'), pop: $('resPop'),
    queue: $('resQueue'), time: $('resTime'),
    armyMine: $('armyMine'), armyFoe: $('armyFoe'),
    goal: $('goal'), alertBanner: $('alertBanner'),
    selchip: $('selchip'), selCount: $('selCount'),
    rowBuild: $('rowBuild'), rowUnit: $('rowUnit'), rowCommand: $('rowCommand'), placeRow: $('placeRow'),
    placeHint: $('placeHint'), placeOk: $('btnPlaceOk'), placeNo: $('btnPlaceNo'),
    toasts: $('toasts'),
    resultTitle: $('resultTitle'), resultStats: $('resultStats'), resultDetail: $('resultDetail'),
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
      this.paintIcon(b, 'unit', t); // 卡槽图形与战场内同源，避免两套美术各画各的
    });
    for (const [t, b] of this.buildBtns) this.paintIcon(b, 'building', t);
    $('btnPause').addEventListener('click', () => hooks.pause());
    $('btnAll').addEventListener('click', () => hooks.selectAll());
    $('btnRally').addEventListener('click', () => hooks.rally());
    $('btnHold').addEventListener('click', () => hooks.hold());
    $('btnRetreat').addEventListener('click', () => hooks.retreat());
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
      `用时 ${m}:${String(s).padStart(2, '0')} · 难度 ${DIFFICULTY[world.difficulty].label}`;

    // 战报：给玩家一个"再来一局"的理由 —— 看得出这局输在哪
    const st = world.stats;
    const rows: [string, string][] = [
      ['歼灭敌军', String(st.kills[0])],
      ['己方阵亡', String(st.kills[1])],
      ['累计造兵', String(st.trained[0])],
      ['峰值兵力', `${st.peakPop[0]}/${POP_CAP}`],
      ['水晶总收入', String(Math.round(st.earned[0]))],
      ['敌方总收入', String(Math.round(st.earned[1]))],
    ];
    this.els.resultDetail.textContent = '';
    for (const [k, v] of rows) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${k}</span><b>${v}</b>`;
      this.els.resultDetail.appendChild(li);
    }
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
    // 有选中部队时才出现固守/撤退，避免卡槽常年被无关按钮挤占
    this.els.rowCommand.classList.toggle('hidden', sel === 0);
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

    const mm = Math.floor(world.time / 60), ss = Math.floor(world.time % 60);
    this.els.time.textContent = `${mm}:${String(ss).padStart(2, '0')}`;

    const qRemain = this.queueRemain(world);
    this.els.queue.textContent = qRemain > 0.05 ? `· 造兵 ${qRemain.toFixed(0)}s` : '';

    // 军力对比：一眼看出现在是优势还是劣势
    const mine = armyValue(world, 0), foe = armyValue(world, 1);
    const total = mine + foe;
    const share = total > 0 ? mine / total : 0.5;
    this.els.armyMine.style.width = `${(share * 100).toFixed(1)}%`;
    this.els.armyFoe.style.width = `${((1 - share) * 100).toFixed(1)}%`;

    this.els.goal.textContent = this.goalText(world);

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

  /** 用与战场内同源的形状画卡槽图标，取代原先对不上的 unicode 字符 */
  private paintIcon(btn: HTMLButtonElement, kind: 'unit' | 'building', type: UnitType | BuildingType): void {
    const host = btn.querySelector('i');
    if (!host) return;
    const size = 26;
    const ratio = Math.min(2.5, window.devicePixelRatio || 1);
    host.textContent = '';
    const cv = document.createElement('canvas');
    cv.width = Math.round(size * ratio);
    cv.height = Math.round(size * ratio);
    cv.style.width = `${size}px`;
    cv.style.height = `${size}px`;
    host.appendChild(cv);
    const g = cv.getContext('2d');
    if (!g) return;
    g.scale(ratio, ratio);
    drawIcon(g, kind, type, 0, size);
  }

  /** 挨打告警：屏幕外发生的战况若无提示，玩家完全无感知 */
  showAlert(text: string): void {
    this.els.alertBanner.textContent = text;
    this.els.alertBanner.classList.remove('hidden');
  }

  hideAlert(): void {
    this.els.alertBanner.classList.add('hidden');
  }

  /** 动态目标：告诉玩家这会儿该干什么，而不是只给一次性的静态提示 */
  private goalText(world: World): string {
    const own = world.buildings.filter(b => b.side === 0 && !b.dead);
    if (!own.some(b => b.type === 'barracks')) return '目标：先建一座兵营';
    if (own.filter(b => b.type === 'mine').length < 2) return '目标：占水晶矿建矿场 —— 收入就是兵力';
    if (world.popUsed[0] < 12) return `目标：攒兵 ${world.popUsed[0]}/12`;
    return '目标：进军，摧毁敌方主基地';
  }

  /** 造兵队列剩余时长：排队总时长 + 正在训练的兵营里最久的那个 */
  private queueRemain(world: World): number {
    let t = 0;
    for (const u of world.queue[0]) t += UNIT_DEFS[u].trainTime;
    let active = 0;
    for (const b of world.buildings) {
      if (b.side !== 0 || b.type !== 'barracks' || b.dead || b.buildT > 0 || !b.trainType) continue;
      active = Math.max(active, b.trainT);
    }
    return t + active;
  }
}

/** 军力估值：造价 × 剩余血量比例 */
function armyValue(world: World, side: Side): number {
  let v = 0;
  for (const u of world.units) {
    if (u.dead || u.side !== side) continue;
    v += UNIT_DEFS[u.type].cost * (u.hp / u.maxHp);
  }
  return v;
}

export { DENY_TEXT, NODES };
