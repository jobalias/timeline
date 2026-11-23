// Pointer-event drag plumbing (mouse + touch) shared by the views: detecting the start,
// following one pointer, edge auto-scroll and cancelling. What a drag actually *does*
// stays in the view, through three callbacks:
//
//   onStart(handleEl, { x, y })  → a state object for this drag, or null to ignore the press
//                                  ({ x, y } = where the pointer went down)
//   onMove(state, x, y)          → pointer moved (also called once right after onStart)
//   onEnd(state, cancelled)      → drag finished; isDragging is already false here
//
// Options:
//   handle          selector inside `root` that starts a drag
//   listenOn        where pointermove / up / cancel are heard (default window)
//   delay           null = start on press, with the default prevented (no text selection);
//                   or { mouseThreshold, holdMs, touchScrollSlop }: mouse starts after moving
//                   mouseThreshold px, touch after holding holdMs (moving > touchScrollSlop
//                   first means the finger is scrolling, so no drag)
//   capturePointer  route the pointer's events to the handle while dragging
//   bodyClass       class put on <body> while dragging
//   cancelOnEscape  Escape cancels the drag
//   blockTouchScroll  stop the page scrolling under the finger while dragging
//   autoScroll      { el, axis: 'x' | 'y', edge, step, repeatMs?, onScroll?(state, x, y) }
//                   scrolls `el` (an element or window) when the pointer is within `edge` px
//                   of its side. With repeatMs it keeps scrolling while the pointer rests
//                   there (onScroll runs after each step); without, each move scrolls one step.
export class DragController {
  constructor(root, {
    handle,
    listenOn = window,
    delay = null,
    capturePointer = false,
    bodyClass = '',
    cancelOnEscape = false,
    blockTouchScroll = false,
    autoScroll = null,
    onStart,
    onMove = () => {},
    onEnd = () => {},
  }) {
    Object.assign(this, { handle, delay, capturePointer, bodyClass, autoScroll, onStart, onMove, onEnd });
    this.pending = null;     // pointer is down on a handle, drag not started yet (delay mode)
    this.state = null;       // the view's state for the drag in progress
    this.pointerId = null;
    this._scrollTimer = null;

    root.addEventListener('pointerdown', (e) => this._onDown(e));
    listenOn.addEventListener('pointermove', (e) => this._onMove(e), { passive: false });
    listenOn.addEventListener('pointerup', (e) => this._onUp(e, false));
    listenOn.addEventListener('pointercancel', (e) => this._onUp(e, true));
    if (cancelOnEscape) {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.state) this._finish(true);
      });
    }
    if (blockTouchScroll) {
      document.addEventListener('touchmove', (e) => {
        if (this.state) e.preventDefault();
      }, { passive: false });
    }
  }

  get isDragging() { return !!this.state; }

  // Ends a drag in progress as cancelled (a pending press is left alone)
  cancel() {
    if (this.state) this._finish(true);
  }

  // ---------- pointer events ----------
  _onDown(e) {
    const handle = e.target.closest(this.handle);
    if (!handle || e.button > 0) return;

    if (!this.delay) {
      e.preventDefault();
      this._begin(handle, e.pointerId, e.clientX, e.clientY, e.clientX, e.clientY);
      return;
    }

    const pending = {
      handle, pointerId: e.pointerId, type: e.pointerType,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
    };
    this.pending = pending;
    if (pending.type !== 'mouse') {
      pending.holdTimer = setTimeout(() => {
        if (this.pending === pending) this._activate(pending);
      }, this.delay.holdMs);
    }
  }

  _onMove(e) {
    const pending = this.pending;
    if (pending && e.pointerId === pending.pointerId) {
      const moved = Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0);
      if (pending.type === 'mouse') {
        if (moved > this.delay.mouseThreshold) {
          pending.x = e.clientX;
          pending.y = e.clientY;
          this._activate(pending);
        }
      } else if (moved > this.delay.touchScrollSlop) {
        clearTimeout(pending.holdTimer);   // finger moved before the hold → it's a scroll
        this.pending = null;
      }
      return;
    }

    if (this.state && e.pointerId === this.pointerId) {
      e.preventDefault();
      this._position(e.clientX, e.clientY, true);
    }
  }

  _onUp(e, cancelled) {
    if (this.pending && e.pointerId === this.pending.pointerId) {
      clearTimeout(this.pending.holdTimer);
      this.pending = null;
    }
    if (this.state && e.pointerId === this.pointerId) this._finish(cancelled);
  }

  // ---------- lifecycle ----------
  _activate(pending) {
    this.pending = null;
    this._begin(pending.handle, pending.pointerId, pending.x0, pending.y0, pending.x, pending.y);
  }

  // (x0, y0) = where the pointer went down, (x, y) = where it is now
  _begin(handle, pointerId, x0, y0, x, y) {
    const state = this.onStart(handle, { x: x0, y: y0 });
    if (!state) return;
    this.state = state;
    this.pointerId = pointerId;
    if (this.capturePointer) handle.setPointerCapture?.(pointerId);
    if (this.bodyClass) document.body.classList.add(this.bodyClass);
    this._position(x, y, false);
  }

  _position(x, y, isMove) {
    this.onMove(this.state, x, y);
    if (this.autoScroll) this._autoScroll(x, y, isMove);
  }

  _finish(cancelled) {
    const state = this.state;
    if (!state) return;
    clearInterval(this._scrollTimer);
    this.state = null;
    if (this.bodyClass) document.body.classList.remove(this.bodyClass);
    this.onEnd(state, cancelled);
  }

  // ---------- edge auto-scroll ----------
  _autoScroll(x, y, isMove) {
    const { axis, repeatMs, onScroll } = this.autoScroll;
    const dir = this._edgeDirection(axis === 'x' ? x : y);

    if (!repeatMs) {
      if (isMove && dir) this._scrollStep(dir);
      return;
    }

    clearInterval(this._scrollTimer);
    if (!dir) return;
    this._scrollTimer = setInterval(() => {
      this._scrollStep(dir);
      if (this.state) onScroll?.(this.state, x, y);   // content slides under a still pointer
    }, repeatMs);
  }

  // -1 / 1 when `pos` is within `edge` px of the scroll area's start / end, else 0
  _edgeDirection(pos) {
    const { el, axis, edge } = this.autoScroll;
    let start, end;
    if (el === window) {
      [start, end] = [0, axis === 'x' ? window.innerWidth : window.innerHeight];
    } else {
      const r = el.getBoundingClientRect();
      [start, end] = axis === 'x' ? [r.left, r.right] : [r.top, r.bottom];
    }
    if (pos < start + edge) return -1;
    if (pos > end - edge) return 1;
    return 0;
  }

  _scrollStep(dir) {
    const { el, axis, step } = this.autoScroll;
    const delta = dir * step;
    if (el === window) window.scrollBy(axis === 'x' ? delta : 0, axis === 'y' ? delta : 0);
    else if (axis === 'x') el.scrollLeft += delta;
    else el.scrollTop += delta;
  }
}
