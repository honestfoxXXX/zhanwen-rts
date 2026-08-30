import { MAP_H, MAP_W } from '../core/config';
import { canPlace, pickBuildingAt, pickUnitAt, unitsInRect } from '../core/sim';
import type { BuildingType, Command, World } from '../core/types';
import type { Camera } from '../render/camera';
import type { GhostInfo } from '../render/renderer';
import { isInsideMinimap, jumpCameraTo } from '../render/minimap';

export type UIMode = 'none' | 'place' | 'rally' | 'box';

export interface UIState {
  selection: number[];
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
  moved: boolean;
  panning: boolean;
  minimap: boolean;
  pointerType: string;
}

const TAP_SLOP = 9; // px

export class Input {
  private pointers = new Map<number, PointerRec>();
  private lastTap = { t: 0, id: -1, x: 0, y: 0 };
  private keys = new Set<string>();

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
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.cam.pan(e.deltaY);
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('keyup', e => this.keys.delete(e.key));
  }

  /** 每帧调用：键盘平移 */
  update(dt: number): void {
    const speed = 480;
    let dy = 0;
    if (this.keys.has('w') || this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('ArrowDown')) dy += 1;
    if (dy !== 0) this.cam.pan(dy * speed * dt);
  }

  private onKey(e: KeyboardEvent): void {
    this.keys.add(e.key);
    if (e.key === 'Escape') this.hooks.onEscape();
  }

  private evPos(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onDown(e: PointerEvent): void {
    const p = this.evPos(e);
    const rec: PointerRec = {
      id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y,
      button: e.button, moved: false, panning: false,
      minimap: isInsideMinimap(p.x, p.y, this.cam.cssW, this.cam.cssH),
      pointerType: e.pointerType,
    };
    this.pointers.set(e.pointerId, rec);
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const rec = this.pointers.get(e.pointerId);
    const p = this.evPos(e);
    if (!rec) {
      // 无按键的鼠标移动：放置模式下移动幽灵
      if (this.ui.mode === 'place' && e.pointerType === 'mouse') this.moveGhost(p.x, p.y);
      return;
    }
    const dx = p.x - rec.x, dy = p.y - rec.y;
    rec.x = p.x; rec.y = p.y;
    if (!rec.moved && Math.hypot(p.x - rec.sx, p.y - rec.sy) > TAP_SLOP) rec.moved = true;

    if (rec.minimap) {
      // 小地图拖动：视野跟随
      jumpCameraTo(p.y, this.cam);
      return;
    }
    if (rec.moved) {
      const mouseLeft = rec.pointerType === 'mouse' && rec.button === 0;
      if (mouseLeft && (this.ui.mode === 'none' || this.ui.mode === 'box')) {
        // 鼠标左键拖动 → 框选（此前没有任何地方把 mode 置为 box，框选实际不可用）
        this.ui.mode = 'box';
        this.ui.boxRect = { x0: rec.sx, y0: rec.sy, x1: p.x, y1: p.y };
      } else if (mouseLeft && this.ui.mode === 'place') {
        this.moveGhost(p.x, p.y);
      } else if (this.multiTouch() || rec.pointerType === 'touch' || rec.button !== 0 || this.ui.mode === 'rally') {
        // 触屏拖动 / 多指 / 鼠标中键右键 / 集结模式拖动 → 平移镜头
        rec.panning = true;
        this.cam.pan(-dy);
      }
    }
  }

  private onUp(e: PointerEvent): void {
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    this.pointers.delete(e.pointerId);
    const p = { x: rec.x, y: rec.y };
    const world = this.getWorld();
    if (!world || world.gameOver) return;

    if (rec.minimap) {
      if (!rec.moved) jumpCameraTo(p.y, this.cam); // 单击小地图跳转
      return;
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
      this.onTap(world, p.x, p.y, rightClick, rec.pointerType);
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
    this.ui.ghost = { type: this.ui.placing, x: r.x, y: r.y, valid: r.ok };
  }

  /** 更新幽灵有效性（每帧，价格变化等场景） */
  refreshGhost(): void {
    if (this.ui.mode === 'place' && this.ui.ghost) {
      const world = this.getWorld();
      if (world) {
        const r = canPlace(world, 0, this.ui.ghost.type, this.ui.ghost.x, this.ui.ghost.y);
        this.ui.ghost.valid = r.ok;
      }
    }
  }

  private onTap(world: World, sx: number, sy: number, rightClick: boolean, pointerType: string): void {
    const wp = this.cam.screenToWorld(sx, sy);

    // 放置模式
    if (this.ui.mode === 'place' && this.ui.placing) {
      if (pointerType === 'mouse' && !rightClick) {
        this.confirmPlace();
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
      this.hooks.toast(forB !== null ? '该兵营集结点已设置' : '集结点已设置');
      this.ui.mode = 'none';
      this.ui.rallyFor = null;
      return;
    }

    // 右键：命令
    if (rightClick) {
      this.orderAt(world, wp.x, wp.y);
      return;
    }

    // 点选单位
    const u = pickUnitAt(world, wp.x, wp.y, null, this.pickTol());
    if (u && u.side === 0) {
      const now = performance.now();
      const isDouble = now - this.lastTap.t < 350 && this.lastTap.id === u.id &&
        Math.hypot(sx - this.lastTap.x, sy - this.lastTap.y) < 28;
      this.lastTap = { t: now, id: u.id, x: sx, y: sy };
      if (isDouble) {
        // 双击：选中屏幕内同类
        const vr = this.cam;
        const same = world.units.filter(v => !v.dead && v.side === 0 && v.type === u.type &&
          v.x >= 0 && v.x <= MAP_W && (v.y > vr.y && v.y < vr.y + vr.viewH));
        this.ui.selection = same.map(v => v.id);
        this.hooks.toast(`已选中 ${same.length} 个${u.type === 'infantry' ? '步兵' : u.type === 'archer' ? '弓手' : '重装'}`);
      } else {
        this.ui.selection = [u.id];
      }
      return;
    }

    // 点敌方单位 / 建筑 → 集火攻击
    if (u && u.side === 1 && this.ui.selection.length) {
      this.hooks.command({ type: 'attack', side: 0, ids: [...this.ui.selection], targetId: u.id });
      return;
    }

    // 点自家建筑：单击看信息，双击兵营则单独给它设集结点
    const b = pickBuildingAt(world, wp.x, wp.y);
    if (b && b.side === 0) {
      const name = b.type === 'hq' ? '主基地' : b.type === 'mine' ? '矿场' : b.type === 'barracks' ? '兵营' : '箭塔';
      const now = performance.now();
      // 用负 id 作为建筑的双击键，避免与单位 id 撞上
      const isDouble = now - this.lastTap.t < 350 && this.lastTap.id === -b.id &&
        Math.hypot(sx - this.lastTap.x, sy - this.lastTap.y) < 28;
      if (isDouble && b.type === 'barracks') {
        this.lastTap = { t: 0, id: -1, x: 0, y: 0 };
        this.ui.mode = 'rally';
        this.ui.rallyFor = b.id;
        this.hooks.toast('点击地图，为该兵营设置集结点');
        return;
      }
      this.lastTap = { t: now, id: -b.id, x: sx, y: sy };
      this.hooks.toast(`${name} ${Math.max(0, Math.ceil(b.hp))}/${b.maxHp}`);
      return;
    }
    if (b && b.side === 1 && this.ui.selection.length) {
      this.hooks.command({ type: 'attack', side: 0, ids: [...this.ui.selection], targetId: b.id });
      return;
    }

    // 空地 → 移动令
    if (!u && !b) this.orderAt(world, wp.x, wp.y);
  }

  private orderAt(world: World, wx: number, wy: number): void {
    if (!this.ui.selection.length) return;
    const enemy = pickUnitAt(world, wx, wy, 1);
    if (enemy) {
      this.hooks.command({ type: 'attack', side: 0, ids: [...this.ui.selection], targetId: enemy.id });
      return;
    }
    this.hooks.command({ type: 'move', side: 0, ids: [...this.ui.selection], x: wx, y: wy });
  }

  /** HUD 调用：确认建造 */
  confirmPlace(): void {
    const world = this.getWorld();
    if (!world || !this.ui.placing || !this.ui.ghost) return;
    const g = this.ui.ghost;
    if (!g.valid) {
      this.hooks.toast('无法在此建造');
      return;
    }
    const ok = this.hooks.command({ type: 'build', side: 0, building: g.type, x: g.x, y: g.y });
    if (ok) this.ui.mode = 'none';
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
  }
}
