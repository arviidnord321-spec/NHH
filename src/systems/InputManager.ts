/**
 * InputManager: keyboard, mouse and touch (virtual stick + look drag + action
 * buttons). World input is ignored while the pointer is over UI. Held actions
 * are released on blur / pointercancel / visibility change.
 */
export type Action = 'dig' | 'jump' | 'sprint' | 'interact' | 'scan' | 'camp' | 'pets' | 'pause' | 'tool1' | 'tool2' | 'tool3' | 'tool4' | 'eggs' | 'upgrades' | 'view' | 'avatar';

export class InputManager {
  move = { x: 0, y: 0 }; // x right, y forward
  look = { dx: 0, dy: 0 };
  zoom = 0;
  pointer = { x: 0, y: 0, inside: false }; // CSS px relative to canvas
  isTouch = false;
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  private keys = new Set<string>();
  private rightDrag = false;
  private lastMouse = { x: 0, y: 0 };
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private stickSprint = false;
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  enabled = true;
  /** when true (first-person on desktop) a canvas click captures the mouse */
  wantPointerLock = false;
  get pointerLocked() { return document.pointerLockElement === this.canvas; }
  stickEl!: HTMLElement;
  knobEl!: HTMLElement;

  constructor(private canvas: HTMLCanvasElement, private touchRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => { this.onPointerUp(e); this.releaseAll(); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom += Math.sign(e.deltaY); }, { passive: false });
    canvas.addEventListener('pointerleave', () => { this.pointer.inside = false; });
    // prevent page scroll/zoom gestures only on the game surface
    canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.buildTouch();
  }

  private keyAction(code: string): Action | null {
    switch (code) {
      case 'Space': return 'jump';
      case 'ShiftLeft': case 'ShiftRight': return 'sprint';
      case 'KeyE': return 'interact';
      case 'KeyQ': return 'scan';
      case 'KeyR': return 'camp';
      case 'KeyP': return 'pets';
      case 'Escape': return 'pause';
      case 'Digit1': return 'tool1';
      case 'Digit2': return 'tool2';
      case 'Digit3': return 'tool3';
      case 'Digit4': return 'tool4';
      case 'KeyC': return 'avatar';
      default: return null;
    }
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    const a = this.keyAction(e.code);
    if (a) {
      if (down && !e.repeat) { this.pressed.add(a); this.held.add(a); }
      if (!down) this.held.delete(a);
      if (e.code === 'Space') e.preventDefault();
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  }

  private onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      this.isTouch = true;
      document.body.classList.add('touch');
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < rect.width * 0.42 && this.stickId === null) {
        this.stickId = e.pointerId;
        this.stickOrigin = { x: e.clientX, y: e.clientY };
        this.stickEl.style.left = `${e.clientX - 60}px`;
        this.stickEl.style.top = `${e.clientY - 60}px`;
        this.stickEl.classList.add('active');
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lookLast = { x: e.clientX, y: e.clientY };
      }
      return;
    }
    this.updatePointer(e);
    if (this.wantPointerLock && !this.pointerLocked && e.button === 0) {
      try { const r = (this.canvas.requestPointerLock as any)(); if (r && r.catch) r.catch(() => {}); } catch { /* not allowed here: drag-to-look still works */ }
    }
    if (e.button === 0) { this.held.add('dig'); this.pressed.add('dig'); }
    if (e.button === 2) { this.rightDrag = true; this.lastMouse = { x: e.clientX, y: e.clientY }; }
  }

  private onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.stickId) {
        const dx = e.clientX - this.stickOrigin.x, dy = e.clientY - this.stickOrigin.y;
        const len = Math.hypot(dx, dy);
        const max = 55;
        const k = len > max ? max / len : 1;
        this.stickVec = { x: (dx * k) / max, y: (-dy * k) / max };
        this.stickSprint = len > max * 1.35;
        this.knobEl.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      } else if (e.pointerId === this.lookId) {
        this.look.dx += (e.clientX - this.lookLast.x) * 1.4;
        this.look.dy += (e.clientY - this.lookLast.y) * 1.4;
        this.lookLast = { x: e.clientX, y: e.clientY };
      }
      return;
    }
    if (this.pointerLocked) {
      this.look.dx += e.movementX * 0.9;
      this.look.dy += e.movementY * 0.9;
      return;
    }
    this.updatePointer(e);
    if (this.rightDrag) {
      this.look.dx += e.clientX - this.lastMouse.x;
      this.look.dy += e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    }
  }

  private onPointerUp(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.stickId) {
        this.stickId = null;
        this.stickVec = { x: 0, y: 0 };
        this.stickSprint = false;
        this.knobEl.style.transform = '';
        this.stickEl.classList.remove('active');
      }
      if (e.pointerId === this.lookId) this.lookId = null;
      return;
    }
    if (e.button === 0) this.held.delete('dig');
    if (e.button === 2) this.rightDrag = false;
  }

  private updatePointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = e.clientX - r.left;
    this.pointer.y = e.clientY - r.top;
    this.pointer.inside = e.target === this.canvas;
  }

  private buildTouch() {
    const root = this.touchRoot;
    root.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <button class="tbtn t-dig" data-a="dig" aria-label="Dig">⛏<span>Dig</span></button>
      <button class="tbtn t-jump" data-a="jump" aria-label="Jump">⤒<span>Jump</span></button>
      <button class="tbtn t-scan" data-a="scan" aria-label="Echo Scan">◎<span>Scan</span></button>
      <button class="tbtn t-interact" data-a="interact" aria-label="Interact">E<span>Use</span></button>
      <div class="reticle"></div>`;
    this.stickEl = root.querySelector('.stick')!;
    this.knobEl = root.querySelector('.knob')!;
    root.querySelectorAll<HTMLButtonElement>('.tbtn').forEach((b) => {
      const a = b.dataset.a as Action;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.held.add(a); this.pressed.add(a); b.classList.add('down'); b.setPointerCapture(e.pointerId); });
      const up = () => { this.held.delete(a); b.classList.remove('down'); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
    });
    if (this.isTouch) document.body.classList.add('touch');
  }

  /** Called once per frame before gameplay reads input. */
  poll() {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    x += this.stickVec.x;
    y += this.stickVec.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move.x = x;
    this.move.y = y;
  }

  isHeld(a: Action) {
    if (!this.enabled) return false;
    if (a === 'sprint') return this.held.has('sprint') || this.stickSprint;
    return this.held.has(a);
  }
  wasPressed(a: Action) { return this.pressed.has(a); }
  /** Inject a UI-originated action (HUD buttons). */
  trigger(a: Action) { this.pressed.add(a); }

  endFrame() {
    this.pressed.clear();
    this.look.dx = 0;
    this.look.dy = 0;
    this.zoom = 0;
  }

  releaseAll() {
    this.held.clear();
    this.keys.clear();
    this.rightDrag = false;
    this.stickId = null;
    this.lookId = null;
    this.stickVec = { x: 0, y: 0 };
    this.stickSprint = false;
    if (this.knobEl) this.knobEl.style.transform = '';
    this.stickEl?.classList.remove('active');
    this.move.x = this.move.y = 0;
  }
}
