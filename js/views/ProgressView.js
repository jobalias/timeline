import { startOfDay, sameDay } from '../utils.js';

// local YYYY-MM-DD (no UTC shift)
const ymdLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtHours = (h) => (Math.round(h * 100) / 100).toString();

export class ProgressView {
  constructor(store) {
    this.store = store;
    this.isActive = false;
    this.dayStart = startOfDay(new Date()); // normalize to midnight
    this.container = document.getElementById('progressViewContainer');
    this.weekEl = document.getElementById('progressWeek');
    this.labelEl = document.getElementById('progWeekLabel');
    this._drag = null;

    document.getElementById('progPrev')
      ?.addEventListener('click', () => this._shiftWeek(-7));
    document.getElementById('progNext')
      ?.addEventListener('click', () => this._shiftWeek(7));
    document.getElementById('progThisWeek')
      ?.addEventListener('click', () => this._goToday());

    this._bindDrag();
  }

  activate() { this.isActive = true; this.render({ scrollToToday: true }); }
  deactivate() { this.isActive = false; this._cancelDrag(); }
  // data changed (e.g. after a drop or an undo) → redraw but keep the scroll position
  refresh() { if (this.isActive && !this._drag) this.render(); }

  _shiftWeek(days) {
    this.dayStart.setDate(this.dayStart.getDate() + days);
    this.render({ scrollToToday: true });
  }
  _goToday() {
    this.dayStart = startOfDay(new Date());
    this.render({ scrollToToday: true });
  }

  render({ scrollToToday = false } = {}) {
    if (!this.isActive) return;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    // keep each entry's position in the log so a drag can point back at it
    const log = this.store.getCompletionLog().map((e, i) => ({ ...e, _i: i }));
    const today = startOfDay(new Date());

    const DAYS_BEFORE = 30;   // days to show before dayStart
    const DAYS_AFTER = 30;   // days to show after dayStart
    const DAYS_TO_SHOW = DAYS_BEFORE + DAYS_AFTER + 1;

    // range starts DAYS_BEFORE before dayStart
    const rangeStart = startOfDay(new Date(this.dayStart));
    rangeStart.setDate(rangeStart.getDate() - DAYS_BEFORE);

    const rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + DAYS_TO_SHOW - 1);
    const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    this.labelEl.textContent = `${fmt(rangeStart)} – ${fmt(rangeEnd)}`;

    // group log entries by local day once
    const byDay = new Map();
    log.forEach((e) => {
      const key = ymdLocal(new Date(e.completedAt));
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(e);
    });

    // busiest day in view → scales the little hours bar
    let maxHours = 0;
    const hoursOf = (entries) => entries.reduce((s, e) => s + (parseFloat(e.hoursSpent) || 0), 0);
    for (let i = 0; i < DAYS_TO_SHOW; i++) {
      const d = new Date(rangeStart); d.setDate(d.getDate() + i);
      maxHours = Math.max(maxHours, hoursOf(byDay.get(ymdLocal(d)) || []));
    }

    const prevScroll = this.weekEl.scrollLeft;
    this.weekEl.innerHTML = '';

    for (let i = 0; i < DAYS_TO_SHOW; i++) {
      const day = new Date(rangeStart);
      day.setDate(day.getDate() + i);
      const key = ymdLocal(day);
      const dayEntries = byDay.get(key) || [];
      const hours = hoursOf(dayEntries);

      const col = document.createElement('div');
      col.className = 'prog-day';
      col.dataset.date = key;
      if (sameDay(day, today)) col.classList.add('prog-today');
      if (day > today) col.classList.add('prog-future');

      const pct = maxHours > 0 ? Math.max(6, Math.round((hours / maxHours) * 100)) : 0;
      const hoursRow = hours > 0
        ? `<div class="prog-hours-day" title="${fmtHours(hours)} hours logged">
             <div class="prog-hours-bar"><span style="width:${pct}%"></span></div>
             <div class="prog-hours-num">${fmtHours(hours)}h</div>
           </div>`
        : `<div class="prog-hours-day is-empty"><div class="prog-hours-num">—</div></div>`;

      const header = `
        <div class="prog-day-header">
          <div class="prog-dow">${dayNames[day.getDay()]}</div>
          <div class="prog-date">${day.getDate()}</div>
          <div class="prog-month">${day.toLocaleDateString(undefined, { month: 'short' })}</div>
          ${hoursRow}
        </div>`;

      const body = dayEntries.length === 0
        ? `<div class="prog-empty"></div>`
        : `<div class="prog-items">${this._renderDayEntries(dayEntries)}</div>`;

      const count = dayEntries.length;
      const footer = count > 0 ? `<div class="prog-count">${count} done 🎉</div>` : '';

      col.innerHTML = header + body + footer;
      this.weekEl.appendChild(col);
    }

    this._renderSummary(log);
    if (scrollToToday) this._scrollToToday();
    else this.weekEl.scrollLeft = prevScroll;
  }

  _scrollToToday() {
    const todayCol = this.weekEl.querySelector('.prog-today');
    if (todayCol) {
      todayCol.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  _renderDayEntries(entries) {
    const byTask = new Map();
    entries.forEach((e) => {
      const key = e.taskId || e.taskName;
      if (!byTask.has(key)) byTask.set(key, []);
      byTask.get(key).push(e);
    });

    const drag = 'title="Drag to the day you actually did it"';
    let html = '';
    byTask.forEach((taskEntries) => {
      const celebrated = taskEntries.some((e) => e.taskJustCompleted);
      const taskName = taskEntries[0].taskName;

      if (celebrated) {
        const bullets = taskEntries.map((e) =>
          `<li class="prog-drag" data-log="${e._i}" ${drag}>${this._esc(e.subtaskName)}${
            e.hoursSpent ? ` <span class="prog-hours">· ${e.hoursSpent}h</span>` : ''
          }</li>`
        ).join('');

        html += `
          <div class="prog-task-complete">
            <div class="prog-tc-header">🏆 ${this._esc(taskName)}</div>
            <div class="prog-tc-label">Task Complete!</div>
            <ul class="prog-tc-list">${bullets}</ul>
          </div>`;
      } else {
        taskEntries.forEach((e) => {
          html += `
            <div class="prog-chip prog-drag" data-log="${e._i}" ${drag}>
              <div class="prog-chip-check">✓</div>
              <div class="prog-chip-text">
                <div class="prog-chip-sub">${this._esc(e.subtaskName)}</div>
                <div class="prog-chip-task">${this._esc(e.taskName)}${
                  e.hoursSpent ? ` · ${e.hoursSpent}h` : ''
                }</div>
              </div>
            </div>`;
        });
      }
    });

    return html;
  }

  // bottom banner: an all-time running count, just to feel good
  _renderSummary(log) {
    let summary = document.getElementById('progWeekSummary');
    if (!summary) {
      summary = document.createElement('div');
      summary.id = 'progWeekSummary';
      summary.className = 'prog-week-summary';
      this.container.appendChild(summary);
    }
    const total = log.length;
    const tasksDone = log.filter((e) => e.taskJustCompleted).length;
    if (total === 0) {
      summary.innerHTML = 'Nothing checked off yet — your first one is waiting! 🌱';
      return;
    }
    const today = ymdLocal(new Date());
    const doneToday = log.filter((e) => ymdLocal(new Date(e.completedAt)) === today).length;
    summary.innerHTML = `
      <div class="prog-total-num">${total.toLocaleString()}</div>
      <div class="prog-total-label">subtask${total === 1 ? '' : 's'} completed all-time 🎉</div>
      <div class="prog-total-sub">
        ${tasksDone ? `🏆 <strong>${tasksDone}</strong> whole task${tasksDone === 1 ? '' : 's'} finished` : ''}
        ${tasksDone && doneToday ? ' · ' : ''}
        ${doneToday ? `<strong>${doneToday}</strong> today` : ''}
      </div>`;
  }

  // ==================================================================
  //  DRAG A COMPLETED ITEM TO ANOTHER DAY
  //  mouse: drag after a few px · touch: press & hold, then drag
  // ==================================================================
  _bindDrag() {
    const HOLD_MS = 350;

    this.weekEl.addEventListener('pointerdown', (e) => {
      const item = e.target.closest('.prog-drag');
      if (!item || e.button > 0) return;
      const p = {
        item, pointerId: e.pointerId, type: e.pointerType,
        x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false,
      };
      this._pending = p;
      if (p.type !== 'mouse') {
        p.holdTimer = setTimeout(() => {
          if (this._pending === p) this._startDrag(p);
        }, HOLD_MS);
      }
    });

    window.addEventListener('pointermove', (e) => {
      const p = this._pending;
      if (p && e.pointerId === p.pointerId && !p.started) {
        const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
        if (p.type === 'mouse') {
          if (moved > 4) { p.x = e.clientX; p.y = e.clientY; this._startDrag(p); }
        } else if (moved > 8) {
          clearTimeout(p.holdTimer);   // finger moved before the hold → it's a scroll
          this._pending = null;
        }
        return;
      }
      if (this._drag && e.pointerId === this._drag.pointerId) {
        e.preventDefault();
        this._moveDrag(e.clientX, e.clientY);
      }
    }, { passive: false });

    const finish = (e, cancelled) => {
      if (this._pending && e.pointerId === this._pending.pointerId) {
        clearTimeout(this._pending.holdTimer);
        this._pending = null;
      }
      if (this._drag && e.pointerId === this._drag.pointerId) this._endDrag(cancelled);
    };
    window.addEventListener('pointerup', (e) => finish(e, false));
    window.addEventListener('pointercancel', (e) => finish(e, true));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this._drag) this._endDrag(true); });

    // once a touch drag has started, stop the page from scrolling under the finger
    document.addEventListener('touchmove', (e) => { if (this._drag) e.preventDefault(); }, { passive: false });
  }

  _startDrag(p) {
    p.started = true;
    this._pending = null;
    const item = p.item;
    const rect = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.classList.add('prog-ghost');
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);

    const fromCol = item.closest('.prog-day');
    this._drag = {
      pointerId: p.pointerId,
      logIndex: +item.dataset.log,
      fromDate: fromCol?.dataset.date,
      item, ghost,
      offX: p.x0 - rect.left, offY: p.y0 - rect.top,
      target: null,
    };
    item.classList.add('prog-dragging');
    document.body.classList.add('prog-is-dragging');
    navigator.vibrate?.(15);
    this._moveDrag(p.x, p.y);
  }

  _moveDrag(x, y) {
    const d = this._drag;
    d.ghost.style.transform = `translate(${x - d.offX}px, ${y - d.offY}px) rotate(-2deg)`;
    this._updateTarget(x, y);

    // auto-scroll the strip near its left/right edges
    const r = this.weekEl.getBoundingClientRect();
    const edge = 70;
    clearInterval(d.scrollTimer);
    let dir = 0;
    if (x < r.left + edge) dir = -1;
    else if (x > r.right - edge) dir = 1;
    if (dir) {
      d.scrollTimer = setInterval(() => {
        this.weekEl.scrollLeft += dir * 14;
        if (this._drag) this._updateTarget(x, y);   // columns slide under a still pointer
      }, 16);
    }
  }

  _updateTarget(x, y) {
    const d = this._drag;
    // which day column is under the pointer?
    d.ghost.style.display = 'none';
    const under = document.elementFromPoint(x, y);
    d.ghost.style.display = '';
    const col = under?.closest?.('.prog-day');
    const ok = col && !col.classList.contains('prog-future') ? col : null;

    if (d.target !== ok) {
      d.target?.classList.remove('prog-drop-target');
      ok?.classList.add('prog-drop-target');
      d.target = ok;
    }
  }

  _endDrag(cancelled) {
    const d = this._drag;
    if (!d) return;
    clearInterval(d.scrollTimer);
    d.ghost.remove();
    d.item.classList.remove('prog-dragging');
    d.target?.classList.remove('prog-drop-target');
    document.body.classList.remove('prog-is-dragging');
    this._drag = null;

    const to = d.target?.dataset.date;
    if (!cancelled && to && to !== d.fromDate) {
      this.store.moveCompletion(d.logIndex, to);   // undoable; store notifies → refresh()
    }
  }

  _cancelDrag() { if (this._drag) this._endDrag(true); }

  _esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
}
