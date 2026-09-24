// Keyboard/mouse state with pointer lock. Also exposes injection hooks for automated tests.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const PREVENT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote', 'F1']);

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.pressed = new Set();
    this.buttons = [false, false, false];
    this.clicked = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.onLockChange = null;
    this.onLockError = null;
    this.onKey = null; // (code) => boolean handled

    window.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (this.locked && (PREVENT.has(e.code) || (e.ctrlKey && e.code !== 'KeyR'))) e.preventDefault();
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      if (this.onKey && this.onKey(e.code, e)) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      let b = e.button;
      // macOS turns Ctrl+click into a secondary click; treat it as primary while crouching.
      if (IS_MAC && b === 2 && e.ctrlKey && this.keys.has('ControlLeft')) b = 0;
      if (b > 2) return;
      this.buttons[b] = true;
      this.clicked[b] = true;
      e.preventDefault();
    });
    document.addEventListener('mouseup', (e) => {
      let b = e.button;
      if (IS_MAC && b === 2 && e.ctrlKey) {
        this.buttons[0] = false;
      }
      if (b > 2) return;
      this.buttons[b] = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Guard against the occasional huge spike some browsers emit on lock.
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) this.releaseAll();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      if (this.onLockError) this.onLockError();
    });
  }

  requestLock() {
    const el = this.target;
    const fallback = () => {
      try {
        const p = el.requestPointerLock();
        if (p && p.catch) p.catch(() => this.onLockError && this.onLockError());
      } catch {
        if (this.onLockError) this.onLockError();
      }
    };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(fallback);
    } catch {
      fallback();
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  releaseAll() {
    this.keys.clear();
    this.buttons[0] = this.buttons[1] = this.buttons[2] = false;
  }

  down(code) { return this.keys.has(code); }

  // Edge-triggered key press since the last call to endTick().
  hit(code) { return this.pressed.has(code); }

  consumeMouse() {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  // Drop edge-triggered input gathered while menus were open (keys typed, clicks, mouse motion).
  clearEdges() {
    this.pressed.clear();
    this.clicked[0] = this.clicked[1] = this.clicked[2] = false;
    this.wheel = 0;
    this.dx = 0;
    this.dy = 0;
  }

  endTick() {
    this.pressed.clear();
    this.clicked[0] = this.clicked[1] = this.clicked[2] = false;
  }

  // ---- test hooks
  setKey(code, isDown) {
    if (isDown) { this.keys.add(code); this.pressed.add(code); } else this.keys.delete(code);
  }
  setButton(b, isDown) {
    this.buttons[b] = isDown;
    if (isDown) this.clicked[b] = true;
  }
}
