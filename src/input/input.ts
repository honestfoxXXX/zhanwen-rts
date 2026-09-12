import { BUILDING_DEFS, MAP_H, MAP_W, TILE, UNIT_DEFS } from '../core/config';
import { canPlace, pickBuildingAt, pickUnitAt, unitsInRect } from '../core/sim';
import type { BuildingType, Command, World } from '../core/types';
import type { Camera } from '../render/camera';
import type { GhostInfo } from '../render/renderer';
import { isInsideMinimap, jumpCameraTo } from '../render/minimap';
import { settings } from '../settings';

export type UIMode = 'none' | 'place' | 'rally' | 'box';

export interface UIState {
  selection: number[];
  /** 点选的自家建筑（看升级/信息）；与部队选择互斥 */
  buildingSel: number | null;
  mode: UIMode;
  placing: BuildingType | null;
  ghost: GhostInfo;
  boxRect: { x0: number; y0: number; x1: number; y1: number } | null;
  rallyFor: number | null; // 双击兵营后，为这个兵营单独设集结点
}

export interface InputHooks {
  command: (c: Command) => boolean;
  toast: (msg: string) => void;
  onEscape: () => void;
}

interface PointerRec {
  id: number;
  sx: number; sy: number;
  x: number; y: number;
  button: number;
  shift: boolean;
  moved: boolean;
  panning: boolean;
  minimap: boolean;
  pointerType: string;
}

const TAP_SLOP = 9; // px

export class Input {
  private pointers = new Map<number, PointerRec>();
  private lastTap = { t: 0, id: -1, x: 0, y: 0 };
  private pinch: { dist: number; mx: number; my: number } | null = null;
  private keys = new Set<string>();
  /** 双指轻点 → 强制移动：第二指落下时记录锚点，快速抬起且未拖动则触发 */
  private twoTap: { t: number; x: number; y: number; moved: boolean } | null = null;
  /** 鼠标悬停位置（边缘滚动用），离开画布置空 */
  private hover: { x: number; y: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private cam: Camera,
    private getWorld: () => World | null,
    private ui: UIState,
    private hooks: InputHooks,
  ) {
    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('pointercancel', e => this.onUp(e));
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const p = this.evPos(e);
      this.cam.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('keyup', e => this.keys.delete(e.key));
  }

  /** 每帧调用：方向键平移 + 鼠标边缘滚动（WASD 让位给 A 攻击移动） */
  update(dt: number): void {
    const speed = 620;
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('ArrowDown')) dy += 1;
    if (dx !== 0 || dy !== 0) this.cam.pan(dx * speed * dt, dy * speed * dt);
    // 鼠标边缘滚动：桌面端把鼠标推向画面边缘即可平移（触屏无此行为；设置可关）
    if (this.hover && settings.edgeScroll) {
      const m = 22;
      const sp = 520 * dt;
      let ex = 0, ey = 0;
      if (this.hover.x < m) ex = -1; else if (this.hover.x > this.cam.cssW - m) ex = 1;
      if (this.hover.y < m) ey = -1; else if (this.hover.y > this.cam.cssH - m) ey = 1;
      if (ex !== 0 || ey !== 0) this.cam.pan(ex * sp, ey * sp);
    }
  }

  private onKey(e: KeyboardEvent): void {
    this.keys.add(e.key);
    if (e.key === 'Escape') this.hooks.onEscape();
    if (e.key === '+' || e.key === '=') this.cam.zoomAt(1.2, this.cam.cssW / 2, this.cam.cssH / 2);
    if (e.key === '-' || e.key === '_') this.cam.zoomAt(1 / 1.2, this.cam.cssW / 2, this.cam.cssH / 2);
  }

  private evPos(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onDown(e: PointerEvent): void {
    const p = this.evPos(e);
    const rec: PointerRec = {
      id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y,
      button: e.button, shift: e.shiftKey, moved: false, panning: false,
      minimap: isInsideMinimap(p.x, p.y, this.cam.cssW, this.cam.cssH),
      pointerType: e.pointerType,
    };
    this.pointers.set(e.pointerId, rec);
    this.pinch = null; // 手指数变化，捏合基准失效
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.twoTap = {
        t: performance.now(),
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
        moved: false,
      };
    }
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const rec = this.pointers.get(e.pointerId);
    const p = this.evPos(e);
    if (!rec) {
      // 无按键的鼠标移动：放置模式下移动幽灵；同时记录悬停位（边缘滚动）
      if (e.pointerType === 'mouse') {
        this.hover = p;
        if (this.ui.mode === 'place') this.moveGhost(p.x, p.y);
      }
      return;
    }
    const dx = p.x - rec.x, dy = p.y - rec.y;
    rec.x = p.x; rec.y = p.y;
    if (!rec.moved && Math.hypot(p.x - rec.sx, p.y - rec.sy) > TAP_SLOP) rec.moved = true;

    if (rec.minimap) {
      // 小地图拖动：视野跟随
      jumpCameraTo(p.x, p.y, this.cam);
      return;
    }

    // 双指捏合：中点位移平移 + 以中点为锚缩放；明显移动则取消轻点判定
    if (this.pointers.size >= 2) {
      const pts = [...this.pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      if (this.pinch && dist > 0) {
        this.cam.pan(mx - this.pinch.mx, my - this.pinch.my);
        this.cam.zoomAt(dist / this.pinch.dist, mx, my);
        if (this.twoTap && (Math.abs(mx - this.twoTap.x) > TAP_SLOP || Math.abs(my - this.twoTap.y) > TAP_SLOP || Math.abs(dist - this.pinch.dist) > 24)) {
          this.twoTap.moved = true;
        }
      }
      this.pinch = { dist, mx, my };
      for (const r of this.pointers.values()) r.moved = true;
      return;
    }

    if (rec.moved) {
      const mouseLeft = rec.pointerType === 'mouse' && rec.button === 0;
      if (mouseLeft && (this.ui.mode === 'none' || this.ui.mode === 'box')) {
        // 鼠标左键拖动 → 框选
        this.ui.mode = 'box';
        this.ui.boxRect = { x0: rec.sx, y0: rec.sy, x1: p.x, y1: p.y };
      } else if (mouseLeft && this.ui.mode === 'place') {
        this.moveGhost(p.x, p.y);
      } else if (this.multiTouch() || rec.pointerType === 'touch' || rec.button !== 0 || this.ui.mode === 'rally') {
        // 触屏拖动 / 鼠标右键拖动 / 集结模式拖动 → 平移镜头
        rec.panning = true;
        this.cam.pan(-dx, -dy);
      }
    }
  }

  private onUp(e: PointerEvent): void {
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    const p = { x: rec.x, y: rec.y };
    const world = this.getWorld();
    if (!world || world.gameOver) return;

    // 双指轻点（未拖动、够快）→ 在中点落强制移动令（触屏的拉扯微操）
    if (this.pointers.size === 0 && this.twoTap) {
      const tt = this.twoTap;
      this.twoTap = null;
      if (!tt.moved && performance.now() - tt.t < 320 && !rec.minimap) {
        const wp = this.cam.screenToWorld(tt.x, tt.y);
        this.orderAt(world, wp.x, wp.y, true);
        return;
      }
    }

    if (rec.minimap) {
      if (!rec.moved) jumpCameraTo(p.x, p.y, this.cam); // 单击小地图跳转
      return;
    }

    // 中原箭塔「Shift+拖动」画线筑塔：拖过一段距离后沿线布置
    if (this.ui.mode === 'place' && this.ui.placing && rec.moved && rec.shift && rec.pointerType === 'mouse') {
      const from = this.cam.screenToWorld(rec.sx, rec.sy);
      const to = this.cam.screenToWorld(p.x, p.y);
      if (Math.hypot(to.x - from.x, to.y - from.y) > TILE) {
        this.confirmPlace(true, from, to);
        return;
      }
    }

    if (this.ui.mode === 'box' && this.ui.boxRect) {
      const a = this.cam.screenToWorld(Math.min(rec.sx, p.x), Math.min(rec.sy, p.y));
      const b = this.cam.screenToWorld(Math.max(rec.sx, p.x), Math.max(rec.sy, p.y));
      const picked = unitsInRect(world, a.x, a.y, b.x, b.y, 0);
      if (picked.length) {
        this.ui.selection = picked.map(u => u.id);
        this.hooks.toast(`已选中 ${picked.length} 支部队`);
      } else {
        this.ui.selection = [];
      }
      this.ui.boxRect = null;
      this.ui.mode = 'none';
      return;
    }

    if (!rec.moved) {
      const rightClick = rec.button === 2;
      this.onTap(world, p.x, p.y, rightClick, rec.shift, rec.pointerType);
    }
  }

  private multiTouch(): boolean {
    return this.pointers.size > 1;
  }

  /**
   * 拾取容差按屏幕像素恒定换算（世界单位）。
   * 相机是横向铺满，手机上 scale 约 0.54，单位直径只有 10 CSS px，
   * 若沿用固定 16 世界单位，实际只有 8.7 CSS px，远低于可点范围。
   */
  private pickTol(): number {
    return Math.max(16, 20 / this.cam.scale);
  }

  private moveGhost(sx: number, sy: number): void {
    const world = this.getWorld();
    if (!world || !this.ui.placing) return;
    const wp = this.cam.screenToWorld(sx, sy);
    const r = canPlace(world, 0, this.ui.placing, wp.x, wp.y);
    this.ui.ghost = { type: this.ui.placing, x: r.x, y: r.y, valid: r.ok, reason: r.ok ? undefined : r.reason };
  }

  /** 更新幽灵有效性（每帧，价格变化等场景） */
  refreshGhost(): void {
    if (this.ui.mode === 'place' && this.ui.ghost) {
      const world = this.getWorld();
      if (world) {
        const r = canPlace(world, 0, this.ui.ghost.type, this.ui.ghost.x, this.ui.ghost.y);
        this.ui.ghost.valid = r.ok;
        this.ui.ghost.reason = r.ok ? undefined : r.reason;
      }
    }
  }

  private onTap(world: World, sx: number, sy: number, rightClick: boolean, shift: boolean, pointerType: string): void {
    const wp = this.cam.screenToWorld(sx, sy);

    // 放置模式
    if (this.ui.mode === 'place' && this.ui.placing) {
      if (pointerType === 'mouse' && !rightClick) {
        this.confirmPlace(shift);
      } else if (pointerType !== 'mouse') {
        this.moveGhost(sx, sy); // 触屏：先挪位置，按 ✓ 确认
      }
      return;
    }

    // 集结点模式（可能是在给某个具体兵营设置）
    if (this.ui.mode === 'rally') {
      const forB = this.ui.rallyFor;
      this.hooks.command(
        forB !== null
          ? { type: 'rally', side: 0, x: wp.x, y: wp.y, buildingId: forB }
          : { type: 'rally', side: 0, x: wp.x, y: wp.y },
      );
      this.hooks.toast(forB !== null ? '该军营集结点已设置' : '集结点已设置（新兵改赴固定点）');
      this.ui.mode = 'none';
      this.ui.rallyFor = null;
      return;
    }

    // A + 左键 = 攻击移动：忽略点选，直接下令（移动沿途自动接战，等于攻击移动语义）
    if (this.keys.has('a') && !rightClick) {
      this.ui.buildingSel = null;
      this.orderAt(world, wp.x, wp.y, false);
      return;
    }

    // 右键：命令（Shift+右键 = 强制移动，沿途不接战）
    if (rightClick) {
      this.ui.buildingSel = null;
      this.orderAt(world, wp.x, wp.y, shift);
      return;
    }

    // 点选单位
    const u = pickUnitAt(world, wp.x, wp.y, null, this.pickTol());
    if (u && u.side === 0) {
      this.ui.buildingSel = null;
      const now = performance.now();
      const isDouble = now - this.lastTap.t < 350 && this.lastTap.id === u.id &&
        Math.hypot(sx - this.lastTap.x, sy - this.lastTap.y) < 28;
      this.lastTap = { t: now, id: u.id, x: sx, y: sy };
      if (isDouble) {
        // 双击：选中视野内同类（相机窗口，双轴）
        const same = world.units.filter(v => !v.dead && v.side === 0 && v.type === u.type &&
          v.x >= this.cam.x && v.x <= this.cam.x + this.cam.viewW &&
          v.y >= this.cam.y && v.y <= this.cam.y + this.cam.viewH);
        this.ui.selection = same.map(v => v.id);
        this.hooks.toast(`已选中 ${same.length} 个${UNIT_DEFS[u.type].name}`);
      } else {
        this.ui.selection = [u.id];
      }
      return;
    }

    // 点敌方单位 / 建筑 → 集火攻击（任意非我方阵营）
    if (u && u.side !== 0 && this.ui.selection.length) {
      this.hooks.command({ type: 'attack', side: 0, ids: [...this.ui.selection], targetId: u.id });
      return;
    }

    // 点自家建筑：选中（看信息/升级），双击兵营则单独给它设集结点
    const b = pickBuildingAt(world, wp.x, wp.y);
    if (b && b.side === 0) {
      const now = performance.now();
      // 用负 id 作为建筑的双击键，避免与单位 id 撞上
      const isDouble = now - this.lastTap.t < 350 && this.lastTap.id === -b.id &&
        Math.hypot(sx - this.lastTap.x, sy - this.lastTap.y) < 28;
      if (isDouble && b.type === 'barracks') {
        this.lastTap = { t: 0, id: -1, x: 0, y: 0 };
        this.ui.mode = 'rally';
        this.ui.rallyFor = b.id;
        this.hooks.toast('点击地图，为该军营设置集结点');
        return;
      }
      this.lastTap = { t: now, id: -b.id, x: sx, y: sy };
      this.ui.selection = [];
      this.ui.buildingSel = b.id;
      return;
    }
    if (b && b.side !== 0 && this.ui.selection.length) {
      this.hooks.command({ type: 'attack', side: 0, ids: [...this.ui.selection], targetId: b.id });
      return;
    }

    // 空地：清建筑选中；有部队选中则移动，否则仅取消
    this.ui.buildingSel = null;
    if (!u && !b && this.ui.selection.length) this.orderAt(world, wp.x, wp.y, false);
  }

  /** 下令：普通移动（沿途自动接战、阵型分层）/ 强制移动（精确落点、完全不接战） */
  private orderAt(world: World, wx: number, wy: number, forced: boolean): void {
    if (!this.ui.selection.length) return;
    // 优先打点中的敌方单位（强制移动不做集火，要的就是走位）
    if (!forced) {
      const enemy = pickUnitAt(world, wx, wy, null);
      if (enemy && enemy.side !== 0) {
        this.hooks.command({ type: 'attack', side: 0, ids: [...this.ui.selection], targetId: enemy.id });
        return;
      }
    }
    this.hooks.command(forced
      ? { type: 'moveForced', side: 0, ids: [...this.ui.selection], x: wx, y: wy }
      : { type: 'move', side: 0, ids: [...this.ui.selection], x: wx, y: wy });
  }

  /**
   * 确认建造。shift=true 连续放置：成功后保持放置模式继续造（钱不够自动退出）。
   * 中原箭塔可用「Shift+拖动」沿拖痕每 2 格下一个塔位（城墙阵核心操作）。
   */
  confirmPlace(shift = false, dragFrom?: { x: number; y: number }, dragTo?: { x: number; y: number }): void {
    const world = this.getWorld();
    if (!world || !this.ui.placing) return;
    // 城墙拖线：中原箭塔 + 起点/终点都有 → 沿线逐格下单
    if (dragFrom && dragTo && this.ui.placing === 'tower' && world.civs[0] === 'central') {
      const dx = dragTo.x - dragFrom.x, dy = dragTo.y - dragFrom.y;
      const len = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.round(len / (TILE * 2)));
      let placed = 0;
      for (let i = 0; i <= steps; i++) {
        const wx = dragFrom.x + (dx * i) / steps;
        const wy = dragFrom.y + (dy * i) / steps;
        const p = canPlace(world, 0, 'tower', wx, wy);
        if (p.ok && world.crystals[0] >= BUILDING_DEFS.tower.cost) {
          if (this.hooks.command({ type: 'build', side: 0, building: 'tower', x: p.x, y: p.y })) placed++;
        }
      }
      this.hooks.toast(placed > 0 ? `沿线路筑起 ${placed} 座箭塔` : '沿线没有可建塔位');
      this.cancelMode();
      return;
    }
    const g = this.ui.ghost;
    if (!g) return;
    if (!g.valid) {
      this.hooks.toast('无法在此建造');
      return;
    }
    const ok = this.hooks.command({ type: 'build', side: 0, building: g.type, x: g.x, y: g.y });
    if (ok && shift) {
      // 保持放置模式：moveGhost 吃屏幕坐标，g.x/g.y 是世界坐标——此前直接传导致幽灵跳位
      const sp = this.cam.worldToScreen(g.x, g.y);
      this.moveGhost(sp.x, sp.y);
    } else if (ok || !shift) {
      this.cancelMode();
    }
  }

  cancelMode(): void {
    this.ui.mode = 'none';
    this.ui.placing = null;
    this.ui.ghost = null;
    this.ui.boxRect = null;
    this.ui.rallyFor = null;
  }

  clearSelection(): void {
    this.ui.selection = [];
    this.ui.buildingSel = null;
  }
}

