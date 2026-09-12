import { BUILDING_DEFS, CIVS, CROWN_WINDOW, DIFFICULTY, NODES, UNIT_DEFS } from '../core/config';
import { popCapOf, trainCost } from '../core/sim';
import { settings, saveSettings } from '../settings';
import { setDamageNumbers, damageNumbersOn } from '../render/feedback';
import { setVolumes } from '../sound';
import type { BuildingType, Difficulty, Side, UnitType, World } from '../core/types';
import type { UIState } from '../input/input';
import { drawIcon, SIDE_FILL } from '../render/shapes';

const DENY_TEXT: Record<string, string> = {
  cost: '黄金不足',
  nosmithy: '需要先建军械库',
  noworkshop: '需要先建攻城工坊',
  pop: '人口已满',
  nobarracks: '需要先建军营',
  place: '无法在此建造',
  nonode: '附近没有空闲金矿',
  queue: '排队已满',
};

/** 阵营中文名，结算战报用 */
const SIDE_LABEL = ['蓝衫军', '红衫军', '金衫军'];

export interface HudHooks {
  start: (d: Difficulty, players: number) => void;
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
  pickFront: () => void;
  pickBack: () => void;
  sound: () => string;
  towerUpgrade: () => void;
  mineUpgrade: () => void;
  music: () => string;
  groupRecall: (n: number) => void;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Hud {
  private diff: Difficulty = 'normal';
  private players = 2;
  private armySegs: HTMLElement[] = [];
  private frame = 0;
  private els = {
    hud: $('hud'), menu: $('menu'), pause: $('pauseScr'), result: $('resultScr'), tips: $('tips'),
    crystal: $('resCrystal'), income: $('resIncome'), pop: $('resPop'),
    queue: $('resQueue'), time: $('resTime'),
    goal: $('goal'), alertBanner: $('alertBanner'),
    selchip: $('selchip'), selCount: $('selCount'),
    rowBuild: $('rowBuild'), rowUnit: $('rowUnit'), rowUnit2: $('rowUnit2'), rowCommand: $('rowCommand'), placeRow: $('placeRow'),
    rowUp: $('rowTower'), btnTowerUp: $('btnTowerUp'), btnMineUp: $('btnMineUp'),
    placeHint: $('placeHint'), placeOk: $('btnPlaceOk'), placeNo: $('btnPlaceNo'),
    toasts: $('toasts'),
    chain: $('goalChain'), chainHead: $('chainHead'), chainList: $('chainList'), chainToggle: $('chainToggle'),
    feed: $('feed'), selPanel: $('selPanel'), groupBar: $('groupBar'),
    codex: $('codexScr'), codexBody: $('codexBody'),
    resultTitle: $('resultTitle'), resultStats: $('resultStats'), resultDetail: $('resultDetail'),
    tipsMap: $('tipsMap'),
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
    $('btnTowerUp').addEventListener('click', () => hooks.towerUpgrade());
    $('btnMineUp').addEventListener('click', () => hooks.mineUpgrade());
    $('btnFront').addEventListener('click', () => hooks.pickFront());
    $('btnBack').addEventListener('click', () => hooks.pickBack());
    this.els.chainHead.addEventListener('click', () => this.els.chain.classList.toggle('folded'));
    // 图鉴开关（菜单 + 暂停 + 关闭）
    for (const id of ['btnCodex', 'btnCodex2']) {
      const b = document.getElementById(id);
      if (b) b.addEventListener('click', () => { this.buildCodex(); this.els.codex.classList.remove('hidden'); });
    }
    $('btnCodexOk').addEventListener('click', () => this.els.codex.classList.add('hidden'));
    // 设置面板：加载当前值 + 实时生效 + 持久化
    const applyVol = () => setVolumes(settings.master, settings.music, settings.sfx);
    const bindNum = (id: string, key: 'master' | 'music' | 'sfx') => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      el.value = String(settings[key]);
      el.addEventListener('input', () => { settings[key] = Number(el.value); applyVol(); saveSettings(); });
    };
    const bindBool = (id: string, key: 'shake' | 'edgeScroll' | 'goalChain' | 'dayNight') => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      el.checked = settings[key];
      el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); });
    };
    bindNum('setMaster', 'master');
    bindNum('setMusic', 'music');
    bindNum('setSfx', 'sfx');
    bindBool('setShake', 'shake');
    bindBool('setEdge', 'edgeScroll');
    bindBool('setChain', 'goalChain');
    bindBool('setDayNight', 'dayNight');
    const dmgEl = document.getElementById('setDmg') as HTMLInputElement | null;
    if (dmgEl) {
      dmgEl.checked = damageNumbersOn();
      dmgEl.addEventListener('change', () => setDamageNumbers(dmgEl.checked));
    }
    this.els.placeOk.addEventListener('click', () => hooks.placeOk());
    this.els.placeNo.addEventListener('click', () => hooks.placeNo());
    $('btnDesel').addEventListener('click', () => hooks.desel());

    $('btnStart').addEventListener('click', () => hooks.start(this.diff, this.players));
    document.querySelectorAll<HTMLButtonElement>('#diffSeg button').forEach(b => {
      b.addEventListener('click', () => {
        this.diff = b.dataset.d as Difficulty;
        document.querySelectorAll('#diffSeg button').forEach(v => v.classList.toggle('on', v === b));
      });
    });
    document.querySelectorAll<HTMLButtonElement>('#modeSeg button').forEach(b => {
      b.addEventListener('click', () => {
        this.players = Number(b.dataset.p);
        document.querySelectorAll('#modeSeg button').forEach(v => v.classList.toggle('on', v === b));
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
    $('btnMusic').addEventListener('click', () => {
      $('btnMusic').textContent = `音乐：${hooks.music()}`;
    });
  }

  get difficulty(): Difficulty { return this.diff; }

  /* ---- 热键入口：与卡槽点击完全同路径，保证可用性与禁用逻辑一致 ---- */
  buildByHotkey(t: BuildingType): void {
    const btn = this.buildBtns.get(t);
    if (btn && !btn.disabled && !btn.classList.contains('hidden')) this.hooks.build(t);
  }
  trainByHotkey(idx: number): void {
    const visible = [...this.trainBtns.values()].filter(b => !b.classList.contains('hidden'));
    const btn = visible[idx];
    if (btn && !btn.disabled) btn.click();
  }
  selectAll(): void { this.hooks.selectAll(); }
  rally(): void { this.hooks.rally(); }
  towerUpgrade(): void { this.hooks.towerUpgrade(); }
  mineUpgrade(): void { this.hooks.mineUpgrade(); }
  hold(): void { this.hooks.hold(); }
  retreat(): void { this.hooks.retreat(); }
  pause(): void { this.hooks.pause(); }

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

  showResult(winner: Side | null, world: World): void {
    const win = winner === 0;
    const draw = winner === null;
    this.els.resultTitle.textContent = win ? '胜 利' : draw ? '平 局' : '战 败';
    this.els.resultTitle.className = win ? 'win' : 'lose';
    const m = Math.floor(world.time / 60), s = Math.floor(world.time % 60);
    // 胜因：王冠占领 / 武力征服 / 超时
    let reason = '';
    if (world.players > 2 && world.crown.t >= 45 && winner !== null) {
      reason = winner === 0 ? ' · ⚜ 王冠之地占领成功' : ' · 敌方占领王冠之地';
    } else if (winner !== null) {
      reason = winner === 0 ? ' · 扫平全部敌方城堡' : ' · 城堡陷落';
    } else {
      reason = ' · 超时平局';
    }
    this.els.resultStats.textContent =
      `用时 ${m}:${String(s).padStart(2, '0')} · 难度 ${DIFFICULTY[world.difficulty].label}${reason}`;

    // 战报：给玩家一个"再来一局"的理由 —— 看得出这局输在哪
    const st = world.stats;
    const rows: [string, string][] = [['歼灭敌军', String(st.kills[0])]];
    for (let s = 1; s < world.players; s++) rows.push([`${SIDE_LABEL[s]}阵亡`, String(st.kills[s])]);
    rows.push(['累计造兵', String(st.trained[0])]);
    rows.push([`峰值兵力`, `${st.peakPop[0]}/${popCapOf(world, 0)}`]);
    rows.push(['黄金总收入', String(Math.round(st.earned[0]))]);
    for (let s = 1; s < world.players; s++) rows.push([`${SIDE_LABEL[s]}总收入`, String(Math.round(st.earned[s]))]);
    this.els.resultDetail.textContent = '';
    for (const [k, v] of rows) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${k}</span><b>${v}</b>`;
      this.els.resultDetail.appendChild(li);
    }
    this.els.result.classList.remove('hidden');
  }

  /** 军力条按参战人数动态重建；玩家始终在最左，颜色与战场阵营一致 */
  private buildArmyBar(players: number): void {
    const bar = document.getElementById('armyBar');
    if (!bar) return;
    bar.innerHTML = '';
    this.armySegs = [];
    for (let s = 0; s < players; s++) {
      const seg = document.createElement('i');
      seg.style.background = SIDE_FILL[s];
      if (s === 0) seg.style.borderTopLeftRadius = seg.style.borderBottomLeftRadius = '5px';
      bar.appendChild(seg);
      this.armySegs.push(seg);
    }
  }

  showTips(): void {
    this.els.tips.classList.remove('hidden');
  }

  /** 首局把地形写进提示页；之后每局靠 toast 提示 */
  setMapBrief(name: string, brief: string): void {
    this.els.tipsMap.textContent = `本局地形：${name} —— ${brief}`;
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

  /** 分级消息流：danger 红 / warn 琥珀 / info 素金。替代四处乱飞的中心 toast */
  feed(msg: string, level: 'danger' | 'warn' | 'info' = 'info'): void {
    const box = this.els.feed;
    while (box.children.length >= 4) box.firstChild?.remove();
    const t = document.createElement('div');
    t.className = `feedItem ${level}`;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 5300);
  }

  /* ---- C1 目标链：随局势自动打勾，给新手一条明确的主线 ---- */
  private chainKey = '';
  updateGoalChain(world: World): void {
    const own = world.buildings.filter(b => b.side === 0 && !b.dead);
    const has = (t: string) => own.some(b => b.type === t);
    const pop = world.popUsed[0];
    const steps: { text: string; done: boolean }[] = [
      { text: '占领一座金矿（Q）', done: has('mine') },
      { text: '建造军营（E）', done: has('barracks') },
      { text: `训练部队 ${Math.min(pop, 12)}/12`, done: pop >= 12 },
      { text: '建造军械库，解锁二本兵（T）', done: has('smithy') },
    ];
    if (world.players > 2) {
      const crownDone = world.crown.side === 0 && world.crown.t >= 45;
      steps.push({ text: '残局驻军王冠之地（质心）45s 即胜', done: crownDone });
      steps.push({ text: '或扫平其余城堡', done: false });
    } else {
      steps.push({ text: '摧毁敌方城堡', done: false });
    }
    const nowIdx = steps.findIndex(x => !x.done);
    const key = steps.map(x => (x.done ? '1' : '0')).join('') + String(nowIdx);
    if (key === this.chainKey) return; // 状态没变不重绘
    this.chainKey = key;
    this.els.chainList.textContent = '';
    steps.forEach((x, i) => {
      const li = document.createElement('li');
      // 步骤可乱序完成：完成的独立打勾，第一个未完成的成为当前目标
      if (x.done) li.className = 'done';
      else if (i === nowIdx) li.className = 'now';
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.textContent = x.done ? '✓' : i === nowIdx ? '▶' : '·';
      li.appendChild(tick);
      li.appendChild(document.createTextNode(x.text));
      this.els.chainList.appendChild(li);
    });
  }

  /* ---- C2 选中信息面板：兵种分组聚合 + 建筑情报 ---- */
  private selPanelKey = '';
  updateSelPanel(world: World, ui: UIState): void {
    const panel = this.els.selPanel;
    // 部队分组
    if (ui.selection.length) {
      const groups = new Map<string, { n: number; hp: number; max: number }>();
      for (const id of ui.selection) {
        const u = world.units.find(v => v.id === id && !v.dead);
        if (!u || u.side !== 0) continue;
        const g = groups.get(u.type) ?? { n: 0, hp: 0, max: 0 };
        g.n++; g.hp += u.hp; g.max += u.maxHp;
        groups.set(u.type, g);
      }
      const key = [...groups].map(([t, g]) => `${t}:${g.n}:${Math.round(g.hp)}`).join('|');
      if (key !== this.selPanelKey) {
        this.selPanelKey = key;
        panel.textContent = '';
        for (const [t, g] of groups) {
          const d = UNIT_DEFS[t as UnitType];
          const div = document.createElement('div');
          div.className = 'grp';
          const frac = g.max ? g.hp / g.max : 0;
          div.innerHTML =
            `<div class="nm">${UNIT_DEFS[t as UnitType].name}<b>×${g.n}</b></div>` +
            `<div class="st">攻${d.damage} · 程${d.range} · 速${d.speed}</div>` +
            `<div class="hpbar"><i style="width:${(frac * 100).toFixed(0)}%;background:${frac > 0.6 ? '#9db86a' : frac > 0.3 ? '#d9a24a' : '#f87171'}"></i></div>`;
          this.paintIconAt(div, 'unit', t as UnitType);
          panel.appendChild(div);
        }
      }
      panel.classList.remove('hidden');
      return;
    }
    // 建筑情报
    if (ui.buildingSel !== null) {
      const b = world.buildings.find(v => v.id === ui.buildingSel && !v.dead && v.side === 0);
      if (!b) { panel.classList.add('hidden'); this.selPanelKey = ''; return; }
      const d = BUILDING_DEFS[b.type];
      const q = b.trainType ? `出兵中：${UNIT_DEFS[b.trainType].name} ${Math.ceil(b.trainT)}s` : (world.queue[0].length ? '排队中' : '空闲');
      const lv = b.type === 'tower' ? ` · Lv${b.level}` : b.type === 'mine' && (b.mineLevel ?? 0) > 0 ? ` · 加固 Lv${b.mineLevel}` : '';
      const key = `b:${b.id}:${Math.ceil(b.hp)}:${b.trainType ?? ''}:${Math.ceil(b.trainT)}`;
      if (key !== this.selPanelKey) {
        this.selPanelKey = key;
        panel.textContent = '';
        const div = document.createElement('div');
        div.className = 'binfo';
        const frac = Math.max(0, b.hp / b.maxHp);
        div.innerHTML =
          `<b>${d.name}${lv}</b> · 血量 ${Math.max(0, Math.ceil(b.hp))}/${b.maxHp}（${(frac * 100).toFixed(0)}%） · ${q}` +
          (b.rally ? ` · 集结点已设` : '');
        this.paintIconAt(div, 'building', b.type);
        panel.appendChild(div);
      }
      panel.classList.remove('hidden');
      return;
    }
    panel.classList.add('hidden');
    this.selPanelKey = '';
  }

  /* ---- B2 编队栏：5 槽，显示存活数，点击召回 ---- */
  private groupKey = '';
  renderGroups(counts: number[]): void {
    const key = counts.join(',');
    if (key === this.groupKey) return;
    this.groupKey = key;
    const bar = this.els.groupBar;
    bar.textContent = '';
    counts.forEach((n, i) => {
      const slot = document.createElement('div');
      slot.className = 'gslot' + (n > 0 ? '' : ' empty');
      slot.innerHTML = `<b>${i + 1}</b><small>${n > 0 ? n + ' 支' : '空'}</small>`;
      slot.title = '点击召回（Ctrl+数字 编队 / 双击跳转）';
      if (n > 0) slot.addEventListener('click', () => this.hooks.groupRecall(i));
      bar.appendChild(slot);
    });
  }

  /* ---- C3 兵种图鉴：全部由 config 数值生成，杜绝两份数据 ---- */
  private codexBuilt = false;
  buildCodex(): void {
    if (this.codexBuilt) return;
    this.codexBuilt = true;
    const body = this.els.codexBody;
    body.textContent = '';
    const tiers: Record<number, string> = { 1: '一本', 2: '二本（军械库）', 3: '三本（攻城工坊）' };
    // 兵种表
    let html = '<h3>兵 种</h3><table><tr><th>兵种</th><th>费用</th><th>人口</th><th>生命</th><th>攻击</th><th>射程</th><th>速度</th><th>克制</th></tr>';
    for (const [t, d] of Object.entries(UNIT_DEFS)) {
      const cnt = d.dmgBonus
        ? Object.entries(d.dmgBonus)
            .filter(([k]) => k !== 'building')
            .map(([k, v]) => `${UNIT_DEFS[k as UnitType].name}×${v}`)
            .join(' ')
        : '';
      const unlock = d.tier === 2 ? '<br>需军械库' : d.tier === 3 ? '<br>需攻城工坊' : '';
      html += `<tr><td>${d.name}${unlock}<br><small style="color:#7d715c">${tiers[d.tier]}</small></td>` +
        `<td>${d.cost}</td><td>${d.pop}</td><td>${d.hp}</td><td>${d.damage}</td><td>${d.range}</td><td>${d.speed}</td>` +
        `<td class="cnt">${cnt || '—'}</td></tr>`;
    }
    html += '</table>';
    // 建筑表
    html += '<h3>建 筑</h3><table><tr><th>建筑</th><th>费用</th><th>生命</th><th>说明</th></tr>';
    for (const [t, d] of Object.entries(BUILDING_DEFS)) {
      const note = t === 'smithy' ? '解锁二本兵种' : t === 'workshop' ? '解锁三本兵种' : t === 'farm' ? '中原专属经济' : t === 'tower' ? '中原可任意建造并升级' : '—';
      html += `<tr><td>${d.name}</td><td>${d.cost}</td><td>${d.hp}</td><td>${note}</td></tr>`;
    }
    html += '</table>';
    // 文明差异
    html += '<h3>文 明</h3><table><tr><th>文明</th><th>人口</th><th>特性</th></tr>';
    for (const c of Object.values(CIVS)) {
      html += `<tr><td>${c.name}</td><td>${c.popCap}</td><td>${c.desc}</td></tr>`;
    }
    html += '</table>';
    // 克制三角说明
    html += '<h3>克 制</h3><p style="color:#d9cdb0">弓手 › 重装 › 步兵 › 弓手 · 长枪克骑士/近卫军 · 投石车拆建筑（3×）· 近卫军披甲（减伤 28%）</p>';
    body.innerHTML = html;
  }

  /** 在容器左上角画一枚与战场同源的小图标 */
  private paintIconAt(host: HTMLElement, kind: 'unit' | 'building', type: UnitType | BuildingType): void {
    const cv = document.createElement('canvas');
    const size = 20;
    const ratio = Math.min(2.5, window.devicePixelRatio || 1);
    cv.width = Math.round(size * ratio);
    cv.height = Math.round(size * ratio);
    cv.style.width = cv.style.height = `${size}px`;
    cv.style.verticalAlign = '-4px';
    cv.style.marginRight = '4px';
    const g = cv.getContext('2d');
    if (g) { g.scale(ratio, ratio); drawIcon(g, kind, type, 0, size); }
    host.prepend(cv);
  }

  /** 每 4 帧刷新数值，结构行（模式切换）每帧即时更新 */
  update(world: World, ui: UIState, modeLabel: string | null): void {
    // 结构行：立即响应，避免操作行与卡槽短暂同屏
    const sel = ui.selection.length;
    this.els.selchip.classList.toggle('hidden', sel === 0);
    this.els.selCount.textContent = `已选 ${sel}`;
    // 有选中部队时才出现固守/撤退，避免卡槽常年被无关按钮挤占
    this.els.rowCommand.classList.toggle('hidden', sel === 0);
    // 点选自家建筑 → 升级行（箭塔：中原 / 金矿：骑士团）
    this.updateUpRow(world, ui.buildingSel);
    const modeActive = ui.mode !== 'none' && modeLabel !== null;
    if (modeActive) this.els.rowUp.classList.add('hidden');
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
    this.els.chain.classList.toggle('hidden', !settings.goalChain);
    if (settings.goalChain) this.updateGoalChain(world);
    this.updateSelPanel(world, ui);
    const cr = Math.floor(world.crystals[0]);
    this.els.crystal.textContent = String(cr);
    this.els.income.textContent = `+${world.income[0].toFixed(0)}/s`;
    this.els.pop.textContent = `${world.popUsed[0]}/${popCapOf(world, 0)}`;

    const mm = Math.floor(world.time / 60), ss = Math.floor(world.time % 60);
    this.els.time.textContent = `${mm}:${String(ss).padStart(2, '0')}`;

    const qRemain = this.queueRemain(world);
    this.els.queue.textContent = qRemain > 0.05 ? `· 造兵 ${qRemain.toFixed(0)}s` : '';

    // 军力对比：一眼看出现在是优势还是劣势（按参战人数动态分段）
    if (this.armySegs.length !== world.players) this.buildArmyBar(world.players);
    const vals: number[] = [];
    for (let s = 0; s < world.players; s++) vals.push(armyValue(world, s as Side));
    const total = vals.reduce((a, b) => a + b, 0);
    for (let s = 0; s < world.players; s++) {
      this.armySegs[s].style.width = `${total > 0 ? (vals[s] / total * 100) : (100 / world.players)}%`;
    }

    // 王冠之地终局横幅（3 人局开窗前 30s 预告，开窗后播报占领进度）
    if (world.players > 2 && world.crown.side !== null && world.crown.t > 0) {
      const mine = world.crown.side === 0;
      this.els.goal.textContent = mine
        ? `⚜ 王冠之地占领中 ${Math.ceil(45 - world.crown.t)}s —— 守住！`
        : `⚠ 敌方占领王冠之地 ${Math.ceil(45 - world.crown.t)}s —— 快去阻止！`;
      this.els.goal.style.color = mine ? '#ffe9a8' : '#f87171';
    } else if (world.players > 2 && world.time >= CROWN_WINDOW - 30 && world.time < CROWN_WINDOW) {
      this.els.goal.textContent = `⚜ 王冠之地 ${Math.ceil(CROWN_WINDOW - world.time)}s 后开启 —— 驻军质心即胜`;
      this.els.goal.style.color = '#ffe9a8';
    } else {
      this.els.goal.textContent = this.goalText(world);
      this.els.goal.style.color = '';
    }

    const isCentral = world.civs[0] === 'central';
    const farmCard = this.buildBtns.get('farm');
    if (farmCard) farmCard.classList.toggle('hidden', !isCentral);
    for (const [t, btn] of this.buildBtns) {
      const d = BUILDING_DEFS[t];
      const cost = t === 'mine' ? CIVS[world.civs[0]].mineCost : d.cost;
      let ok = cr >= cost;
      if (t === 'mine' && !world.nodes.some(n => n.mineId === null)) ok = false;
      if (t === 'farm' && !isCentral) continue;
      btn.disabled = !ok;
      const em = btn.querySelector('em');
      if (em) em.textContent = String(cost);
    }
    const hasSmithy = world.buildings.some(b => b.side === 0 && b.type === 'smithy' && !b.dead && b.buildT <= 0);
    const hasWorkshop = world.buildings.some(b => b.side === 0 && b.type === 'workshop' && !b.dead && b.buildT <= 0);
    this.els.rowUnit2?.classList.toggle('hidden', !(hasSmithy || hasWorkshop));
    for (const [t, btn] of this.trainBtns) {
      const d = UNIT_DEFS[t];
      let ok = cr >= trainCost(world, 0, t) && world.popUsed[0] + d.pop <= popCapOf(world, 0);
      const locked = (d.tier === 2 && !hasSmithy) || (d.tier === 3 && !hasWorkshop);
      if (locked) ok = false;
      btn.disabled = !ok;
      btn.classList.toggle('locked', locked);
      // 文明差异：游牧弓手位替换为游骑兵；牧师是骑士团专属（互斥显隐）
      if (t === 'archer' || t === 'horsearcher') {
        const show = (t === 'horsearcher') === (world.civs[0] === 'nomad');
        btn.classList.toggle('hidden', !show);
      }
      if (t === 'healer') btn.classList.toggle('hidden', world.civs[0] !== 'knight');
      // 卡面造价显示文明修正后的实际值（骑士团 +15%）
      const em = btn.querySelector('em');
      if (em) em.textContent = String(trainCost(world, 0, t));
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
    if (!own.some(b => b.type === 'barracks')) return '目标：先建一座军营';
    if (own.filter(b => b.type === 'mine').length < 2) return '目标：占一处金矿 —— 黄金就是兵力';
    if (world.popUsed[0] < 12) return `目标：攒兵 ${world.popUsed[0]}/12`;
    const foes = world.alive.filter(Boolean).length - 1;
    return world.players > 2
      ? `目标：进军，扫平剩余 ${foes} 座城堡`
      : '目标：进军，摧毁敌方城堡';
  }

  /** 点选自家建筑后的升级行：箭塔（中原）与金矿（骑士团）各自显示等级/费用 */
  private updateUpRow(world: World, buildingSel: number | null): void {
    if (buildingSel === null) {
      this.els.rowUp.classList.add('hidden');
      return;
    }
    const b = world.buildings.find(v => v.id === buildingSel && !v.dead && v.side === 0);
    if (!b) { this.els.rowUp.classList.add('hidden'); return; }
    const civ = world.civs[0];
    if (b.type === 'tower' && civ === 'central' && b.level < 3) {
      const cost = b.level === 1 ? 150 : 300;
      this.els.btnTowerUp.textContent = `⬆ 升级箭塔 ${b.level}→${b.level + 1}（${cost}金）`;
      (this.els.btnTowerUp as HTMLButtonElement).disabled = Math.floor(world.crystals[0]) < cost;
      this.els.btnTowerUp.classList.remove('hidden');
      this.els.btnMineUp.classList.add('hidden');
      this.els.rowUp.classList.remove('hidden');
    } else if (b.type === 'mine' && civ === 'knight' && (b.mineLevel ?? 0) < 4) {
      const lv = (b.mineLevel ?? 0);
      this.els.btnMineUp.textContent = `⬆ 加固金矿 Lv${lv}→Lv${lv + 1}（100金）`;
      (this.els.btnMineUp as HTMLButtonElement).disabled = Math.floor(world.crystals[0]) < 100;
      this.els.btnMineUp.classList.remove('hidden');
      this.els.btnTowerUp.classList.add('hidden');
      this.els.rowUp.classList.remove('hidden');
    } else {
      this.els.rowUp.classList.add('hidden');
    }
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
