import { startOfDay, sameDay, ymdLocal, fmtShortDate } from '../core/dates.js';
import { escapeHtml } from '../utils.js';
import { DragController } from '../core/DragController.js';
import { View } from '../core/View.js';

const DAYS_BEFORE = 30;   // days shown before dayStart
const DAYS_AFTER = 30;    // days shown after dayStart
const DAYS_TO_SHOW = DAYS_BEFORE + DAYS_AFTER + 1;

// Hours bar is full at 8h; past that it shifts orange (8h) → red (12h+)
const FULL_DAY = 8;
const RED_AT = 12;
const MIN_BAR_PCT = 6;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DRAG_DELAY = {
  holdMs: 350,           // touch: press-and-hold before a drag starts
  mouseThreshold: 4,     // mouse: px moved before a drag starts
  touchScrollSlop: 8,    // touch: px moved before the hold that means "scrolling"
};
const DRAG_SCROLL = {
  edge: 70,              // px from the strip's edge that triggers auto-scroll
  step: 14,
  repeatMs: 16,
};
const DRAG_TITLE = 'title="Drag to the day you actually did it"';

const fmtHours = (h) => (Math.round(h * 100) / 100).toString();
const plural = (n) => (n === 1 ? '' : 's');
const sumHours = (entries) => entries.reduce((sum, e) => sum + (parseFloat(e.hoursSpent) || 0), 0);

function groupBy(items, keyOf) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return groups;
}

export class ProgressView extends View {
  constructor(store) {
    super();
    this.store = store;
    this.dayStart = startOfDay(new Date());
    this.container = document.getElementById('progressViewContainer');
    this.weekEl = document.getElementById('progressWeek');
    this.labelEl = document.getElementById('progWeekLabel');

    document.getElementById('progPrev')?.addEventListener('click', () => this._shiftWeek(-7));
    document.getElementById('progNext')?.addEventListener('click', () => this._shiftWeek(7));
    document.getElementById('progThisWeek')?.addEventListener('click', () => this._goToday());

    this.dragger = this._createDragger();
  }

  // ----- Public API -----

  activate() {
    this.isActive = true;
    this.render({ scrollToToday: true });
  }

  deactivate() {
    super.deactivate();
    this.dragger.cancel();
  }

  // Data changed (e.g. after a drop or an undo) → redraw but keep the scroll position
  refresh() {
    if (!this.dragger.isDragging) super.refresh();
  }

  render({ scrollToToday = false } = {}) {
    if (!this.isActive) return;

    // Keep each entry's position in the log so a drag can point back at it
    const log = this.store.getCompletionLog().map((e, i) => ({ ...e, _i: i }));
    const byDay = groupBy(log, (e) => ymdLocal(new Date(e.completedAt)));
    const today = startOfDay(new Date());

    const rangeStart = startOfDay(new Date(this.dayStart));
    rangeStart.setDate(rangeStart.getDate() - DAYS_BEFORE);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + DAYS_TO_SHOW - 1);
    this.labelEl.textContent = `${fmtShortDate(rangeStart)} – ${fmtShortDate(rangeEnd)}`;

    const prevScroll = this.weekEl.scrollLeft;
    this.weekEl.innerHTML = '';

    for (let i = 0; i < DAYS_TO_SHOW; i++) {
      const day = new Date(rangeStart);
      day.setDate(day.getDate() + i);
      this.weekEl.appendChild(this._renderDayColumn(day, byDay.get(ymdLocal(day)) || [], today));
    }

    this._renderSummary(log);
    if (scrollToToday) this._scrollToToday();
    else this.weekEl.scrollLeft = prevScroll;
  }

  // ----- Navigation -----

  _shiftWeek(days) {
    this.dayStart.setDate(this.dayStart.getDate() + days);
    this.render({ scrollToToday: true });
  }

  _goToday() {
    this.dayStart = startOfDay(new Date());
    this.render({ scrollToToday: true });
  }

  _scrollToToday() {
    this.weekEl.querySelector('.prog-today')
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  // ----- Rendering -----

  _renderDayColumn(day, entries, today) {
    const col = document.createElement('div');
    col.className = 'prog-day';
    col.dataset.date = ymdLocal(day);
    if (sameDay(day, today)) col.classList.add('prog-today');
    if (day > today) col.classList.add('prog-future');

    const header = `
        <div class="prog-day-header">
          <div class="prog-dow">${DAY_NAMES[day.getDay()]}</div>
          <div class="prog-date">${day.getDate()}</div>
          <div class="prog-month">${day.toLocaleDateString(undefined, { month: 'short' })}</div>
          ${this._renderHoursRow(sumHours(entries))}
        </div>`;

    const body = entries.length === 0
      ? `<div class="prog-empty"></div>`
      : `<div class="prog-items">${this._renderDayEntries(entries)}</div>`;

    const footer = entries.length > 0 ? `<div class="prog-count">${entries.length} done 🎉</div>` : '';

    col.innerHTML = header + body + footer;
    return col;
  }

  _renderHoursRow(hours) {
    if (hours <= 0) {
      return `<div class="prog-hours-day is-empty"><div class="prog-hours-num">—</div></div>`;
    }

    const pct = Math.max(MIN_BAR_PCT, Math.min(100, Math.round((hours / FULL_DAY) * 100)));
    const isOver = hours > FULL_DAY;
    // 0% = orange … 100% = red
    const overPct = Math.round(Math.min(1, (hours - FULL_DAY) / (RED_AT - FULL_DAY)) * 100);

    return `<div class="prog-hours-day${isOver ? ' is-over' : ''}"${isOver ? ` style="--over:${overPct}%"` : ''}
               title="${fmtHours(hours)} hours logged${isOver ? ' — over 8h' : ''}">
             <div class="prog-hours-bar"><span style="width:${pct}%"></span></div>
             <div class="prog-hours-num">${fmtHours(hours)}h</div>
           </div>`;
  }

  // A task finished that day gets a trophy card; other completions are single chips
  _renderDayEntries(entries) {
    let html = '';
    groupBy(entries, (e) => e.taskId || e.taskName).forEach((taskEntries) => {
      html += taskEntries.some((e) => e.taskJustCompleted)
        ? this._renderTaskComplete(taskEntries)
        : taskEntries.map((e) => this._renderChip(e)).join('');
    });
    return html;
  }

  _renderTaskComplete(taskEntries) {
    const bullets = taskEntries.map((e) =>
      `<li class="prog-drag" data-log="${e._i}" ${DRAG_TITLE}>${escapeHtml(e.subtaskName)}${
        e.hoursSpent ? ` <span class="prog-hours">· ${e.hoursSpent}h</span>` : ''
      }</li>`
    ).join('');

    return `
          <div class="prog-task-complete">
            <div class="prog-tc-header">🏆 ${escapeHtml(taskEntries[0].taskName)}</div>
            <div class="prog-tc-label">Task Complete!</div>
            <ul class="prog-tc-list">${bullets}</ul>
          </div>`;
  }

  _renderChip(e) {
    return `
            <div class="prog-chip prog-drag" data-log="${e._i}" ${DRAG_TITLE}>
              <div class="prog-chip-check">✓</div>
              <div class="prog-chip-text">
                <div class="prog-chip-sub">${escapeHtml(e.subtaskName)}</div>
                <div class="prog-chip-task">${escapeHtml(e.taskName)}${
                  e.hoursSpent ? ` · ${e.hoursSpent}h` : ''
                }</div>
              </div>
            </div>`;
  }

  // Bottom banner: an all-time running count, just to feel good
  _renderSummary(log) {
    const summary = this._summaryEl();
    const total = log.length;
    if (total === 0) {
      summary.innerHTML = 'Nothing checked off yet — your first one is waiting! 🌱';
      return;
    }

    const tasksDone = log.filter((e) => e.taskJustCompleted).length;
    const todayKey = ymdLocal(new Date());
    const doneToday = log.filter((e) => ymdLocal(new Date(e.completedAt)) === todayKey).length;

    summary.innerHTML = `
      <div class="prog-total-num">${total.toLocaleString()}</div>
      <div class="prog-total-label">subtask${plural(total)} completed all-time 🎉</div>
      <div class="prog-total-sub">
        ${tasksDone ? `🏆 <strong>${tasksDone}</strong> whole task${plural(tasksDone)} finished` : ''}
        ${tasksDone && doneToday ? ' · ' : ''}
        ${doneToday ? `<strong>${doneToday}</strong> today` : ''}
      </div>`;
  }

  _summaryEl() {
    let summary = document.getElementById('progWeekSummary');
    if (!summary) {
      summary = document.createElement('div');
      summary.id = 'progWeekSummary';
      summary.className = 'prog-week-summary';
      this.container.appendChild(summary);
    }
    return summary;
  }

  // ----- Drag a completed item to another day -----
  //  mouse: drag after a few px · touch: press & hold, then drag

  _createDragger() {
    return new DragController(this.weekEl, {
      handle: '.prog-drag',
      delay: DRAG_DELAY,
      bodyClass: 'prog-is-dragging',
      cancelOnEscape: true,
      blockTouchScroll: true,   // once a touch drag has started, the page mustn't scroll under the finger
      autoScroll: {
        el: this.weekEl, axis: 'x', ...DRAG_SCROLL,
        onScroll: (drag, x, y) => this._updateTarget(drag, x, y),
      },
      onStart: (item, from) => this._startDrag(item, from),
      onMove: (drag, x, y) => this._moveDrag(drag, x, y),
      onEnd: (drag, cancelled) => this._endDrag(drag, cancelled),
    });
  }

  // Lifts a floating copy of the item that follows the pointer
  _startDrag(item, from) {
    const rect = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.classList.add('prog-ghost');
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);

    item.classList.add('prog-dragging');
    navigator.vibrate?.(15);
    return {
      logIndex: +item.dataset.log,
      fromDate: item.closest('.prog-day')?.dataset.date,
      item, ghost,
      offX: from.x - rect.left, offY: from.y - rect.top,
      target: null,
    };
  }

  _moveDrag(drag, x, y) {
    drag.ghost.style.transform = `translate(${x - drag.offX}px, ${y - drag.offY}px) rotate(-2deg)`;
    this._updateTarget(drag, x, y);
  }

  // Highlights the day column under the pointer; future days can't be drop targets
  _updateTarget(drag, x, y) {
    drag.ghost.style.display = 'none';
    const under = document.elementFromPoint(x, y);
    drag.ghost.style.display = '';

    const col = under?.closest?.('.prog-day');
    const target = col && !col.classList.contains('prog-future') ? col : null;
    if (drag.target === target) return;

    drag.target?.classList.remove('prog-drop-target');
    target?.classList.add('prog-drop-target');
    drag.target = target;
  }

  _endDrag(drag, cancelled) {
    drag.ghost.remove();
    drag.item.classList.remove('prog-dragging');
    drag.target?.classList.remove('prog-drop-target');

    const toDate = drag.target?.dataset.date;
    if (!cancelled && toDate && toDate !== drag.fromDate) {
      this.store.moveCompletion(drag.logIndex, toDate);   // undoable; store notifies → refresh()
    }
  }
}
