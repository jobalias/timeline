import { TimeBlock } from '../models/Subtask.js';
import { startOfDay, sameDay, ymdLocal, pad2, parseLocalDateTime } from '../core/dates.js';
import { escapeHtml } from '../utils.js';
import { Modal } from '../core/Modal.js';
import { cssVar } from '../theme.js';

const SLOT_MIN = 15;
const HOUR_PX = cssVar('--sched-hour-px', 48);
const PX_PER_MIN = HOUR_PX / 60;
const MIN_EVENT_PX = 16;
const MS_PER_HOUR = 3600000;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DONE_RESULT = { cancelled: false, discardTask: false };

export class CalendarView {
  constructor(store, googleCalendar, settings, { onDone = () => {} } = {}) {
    this.store = store;
    this.gcal = googleCalendar;
    this.settings = settings;
    this.onDone = onDone;
    this.context = null; // { taskId, subIndex } being scheduled
    this.weekStart = mondayOf(new Date());
    this.busyEvents = [];
    this.blocks = [];
    this._inCreationSequence = false;
    this._originalEventIds = [];

    this.overlay = new Modal('calOverlay');
    this.title = document.getElementById('calTitle');
    this.counter = document.getElementById('calCounter');
    this.gridWrap = document.getElementById('calGridWrap');
    this.pushBtn = document.getElementById('calPush');

    this._bindToolbar();
  }

  // ---------- open / close ----------
  async open(taskId, subIndex, opts = {}) {
    this.context = { taskId, subIndex };
    this._inCreationSequence = !!opts.sequence;

    const task = this.store.find(taskId);
    const st = task.subtasks[subIndex];
    const est = st.estHoursNum ? ` · ${st.estHoursNum}h` : '';
    this.title.innerHTML =
      `<span class="cal-task">${escapeHtml(task.name)}</span>
       <span class="cal-sub">▸ ${escapeHtml(st.name)}${est}</span>`;
    this.pushBtn.textContent = pushLabel(this.gcal.syncEnabled);

    this.blocks = st.blocks.map((b) => new TimeBlock(b));
    this._originalEventIds = st.blocks.map((b) => b.eventId).filter(Boolean);
    this.weekStart = mondayOf(new Date());
    this.overlay.show();
    await this._loadAndRender();
    this._scrollToHour(8);
  }

  close() {
    this.overlay.close();
    this.context = null;
  }

  _finish(result) {
    this.close();
    this._inCreationSequence = false;
    this.onDone(result);
  }

  _cancel() {
    const wasCreating = this._inCreationSequence;
    if (wasCreating && !confirm('Cancel and discard this new task? Your subtasks won\'t be saved.')) return;
    this._finish({ cancelled: true, discardTask: wasCreating });
  }

  // Keeps the task but stops the creation sequence.
  _scheduleLater() {
    this._finish({ ...DONE_RESULT });
  }

  _bindToolbar() {
    const on = (id, handler) => document.getElementById(id).addEventListener('click', handler);
    on('calScheduleLater', () => this._scheduleLater());
    on('calPrevWeek', () => this._shiftWeek(-7));
    on('calThisWeek', () => this._thisWeek());
    on('calNextWeek', () => this._shiftWeek(7));
    on('calCancel', () => this._cancel());
    on('calPush', () => this._push());
  }

  // ---------- week navigation ----------
  async _shiftWeek(days) {
    this.weekStart.setDate(this.weekStart.getDate() + days);
    await this._loadAndRender();
  }

  async _thisWeek() {
    this.weekStart = mondayOf(new Date());
    await this._loadAndRender();
  }

  // ---------- data ----------
  async _loadAndRender() {
    this.gridWrap.innerHTML = '<div class="cal-loading">Loading your calendar…</div>';

    const googleBusy = await this._fetchGoogleBusy();
    const appBlockEventIds = this._collectBlockEventIds();
    const dedupedGoogle = googleBusy.filter((ev) => !appBlockEventIds.has(ev.id));
    this.busyEvents = [...dedupedGoogle, ...this._collectOtherAppBlocks()];

    this._render();
  }

  async _fetchGoogleBusy() {
    const weekEnd = new Date(this.weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    try {
      const calIds = this.settings.getSelectedCalendars();
      return this.gcal.isAuthed ? await this.gcal.getEvents(this.weekStart, weekEnd, calIds) : [];
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  // Used to drop Google events that mirror app blocks.
  _collectBlockEventIds() {
    const ids = new Set();
    this.store.getAll().forEach((task) =>
      task.subtasks.forEach((st) =>
        st.blocks.forEach((b) => { if (b.eventId) ids.add(b.eventId); })
      )
    );
    return ids;
  }

  // Blocks from every subtask except the one being edited, shown as busy context.
  _collectOtherAppBlocks() {
    const { taskId: curTaskId, subIndex: curSubIndex } = this.context ?? {};
    const result = [];

    this.store.getAll().forEach((task) => {
      task.subtasks.forEach((st, subIndex) => {
        if (task.id === curTaskId && subIndex === curSubIndex) return;

        st.blocks.forEach((b) => {
          if (!b.date || !b.start) return;
          const start = parseLocalDateTime(b.date, b.start);
          result.push({
            title: `${task.name}: ${st.name}`,
            start,
            end: new Date(start.getTime() + b.hoursNum * MS_PER_HOUR),
            _appBlock: true,
            _color: task.color,
          });
        });
      });
    });

    return result;
  }

  // ---------- rendering ----------
  _render() {
    const days = this._weekDays();
    this.gridWrap.innerHTML = gridHtml(days);
    this._renderBusyEvents(days);
    this._renderBlocks(days);
    this._attachInteractions(days);
    this._updateCounter();
  }

  _weekDays() {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(this.weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }

  _dayColumns() {
    return this.gridWrap.querySelectorAll('.cal-daycol');
  }

  _renderBusyEvents(days) {
    const cols = this._dayColumns();
    this.busyEvents.forEach((ev) => {
      const dayIdx = days.findIndex((d) => sameDay(d, ev.start));
      if (dayIdx < 0) return;

      const el = document.createElement('div');
      el.className = ev._appBlock ? 'cal-event cal-event-app' : 'cal-event';
      el.style.top = minutesFromMidnight(ev.start) * PX_PER_MIN + 'px';
      el.style.height = Math.max(MIN_EVENT_PX, (ev.end - ev.start) / 60000 * PX_PER_MIN) + 'px';
      el.textContent = ev.title;
      if (ev._appBlock && ev._color) el.style.setProperty('--block-color', ev._color);
      cols[dayIdx].appendChild(el);
    });
  }

  _renderBlocks(days) {
    const cols = this._dayColumns();
    this.blocks.forEach((b, idx) => {
      const start = parseLocalDateTime(b.date, b.start);
      const dayIdx = days.findIndex((d) => sameDay(d, start));
      if (dayIdx < 0) return;

      const el = document.createElement('div');
      el.className = 'cal-block';
      el.dataset.blockIndex = idx;
      el.style.top = minutesFromMidnight(start) * PX_PER_MIN + 'px';
      el.style.height = b.hoursNum * 60 * PX_PER_MIN + 'px';
      el.innerHTML = `<span class="block-del" data-del="${idx}">✕</span>
                      ${b.hours}h
                      <div class="resize-handle" data-resize="${idx}"></div>`;
      cols[dayIdx].appendChild(el);
    });
  }

  _updateCounter() {
    const st = this.store.find(this.context.taskId).subtasks[this.context.subIndex];
    const est = st.estHoursNum;
    const placed = this.blocks.reduce((sum, b) => sum + b.hoursNum, 0);
    const left = est - placed;

    let text;
    if (est === 0) text = `${placed}h placed`;
    else if (left <= 0) text = `✓ ${placed}h placed — done!`;
    else text = `${est}h needed · ${placed}h placed · ${left}h left`;

    this.counter.textContent = text;
    this.counter.classList.toggle('done', est !== 0 && left <= 0);
  }

  _scrollToHour(h) {
    this.gridWrap.scrollTop = h * HOUR_PX;
  }

  // ---------- interactions ----------
  _attachInteractions(days) {
    this._dayColumns().forEach((col, dayIdx) => {
      col.addEventListener('mousedown', (e) => {
        if (e.target.closest('.cal-block') || e.target.closest('.cal-event')) return;
        this._startDragCreate(e, col, days[dayIdx]);
      });
    });

    this.gridWrap.querySelectorAll('.block-del').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.blocks.splice(parseInt(btn.dataset.del, 10), 1);
        this._render();
      });
    });

    this.gridWrap.querySelectorAll('.resize-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this._startResize(e, parseInt(handle.dataset.resize, 10));
      });
    });

    this.gridWrap.querySelectorAll('.cal-block').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.resize-handle') || e.target.closest('.block-del')) return;
        this._startMove(e, parseInt(el.dataset.blockIndex, 10), days);
      });
    });
  }

  _startDragCreate(e, col, day) {
    const rect = col.getBoundingClientRect();
    const startMin = snap((e.clientY - rect.top) / PX_PER_MIN);

    this.blocks.push(new TimeBlock({
      date: ymdLocal(day),
      start: minToTime(startMin),
      hours: 0.25,
    }));
    const blockIndex = this.blocks.length - 1;
    this._render();

    trackDrag(
      (me) => {
        const curMin = snap((me.clientY - rect.top) / PX_PER_MIN);
        this.blocks[blockIndex].hours = Math.max(SLOT_MIN, curMin - startMin) / 60;
        this._render();
      },
      () => this._render()
    );
  }

  _startResize(e, idx) {
    const block = this.blocks[idx];
    const startY = e.clientY;
    const startMinutes = block.hoursNum * 60;

    trackDrag((me) => {
      const deltaMin = snap((me.clientY - startY) / PX_PER_MIN);
      block.hours = Math.max(SLOT_MIN, startMinutes + deltaMin) / 60;
      this._render();
    });
  }

  // Vertical drag moves within the day; horizontal drag moves across day columns.
  _startMove(e, idx, days) {
    const block = this.blocks[idx];
    const startX = e.clientX;
    const startY = e.clientY;
    const origMin = timeToMin(block.start);
    const origDayIdx = days.findIndex((d) => sameDay(d, parseLocalDateTime(block.date, block.start)));
    const colWidth = this.gridWrap.querySelector('.cal-daycol').getBoundingClientRect().width;

    trackDrag((me) => {
      const deltaMin = snap((me.clientY - startY) / PX_PER_MIN);
      const maxStartMin = 24 * 60 - block.hoursNum * 60;
      block.start = minToTime(clamp(origMin + deltaMin, 0, maxStartMin));

      const deltaDays = Math.round((me.clientX - startX) / colWidth);
      block.date = ymdLocal(days[clamp(origDayIdx + deltaDays, 0, 6)]);

      this._render();
    });
  }

  // ---------- save ----------
  async _push() {
    if (!this.gcal.isAuthed) {
      alert('Please connect Google first.');
      return;
    }

    const task = this.store.find(this.context.taskId);
    const st = task.subtasks[this.context.subIndex];
    const btn = this.pushBtn;
    const syncOn = this.gcal.syncEnabled;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      // with sync off, blocks are only saved locally
      if (syncOn) await this._syncBlocksToGoogle(task, st);
      this.store.setSubtaskBlocks(this.context.taskId, this.context.subIndex, this.blocks);

      btn.textContent = '✓ Saved';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = pushLabel(syncOn);
        this._finish({ ...DONE_RESULT });
      }, 1000);
    } catch (err) {
      console.error(err);
      alert('Error: ' + (err.result?.error?.message || err.message));
      btn.disabled = false;
      btn.textContent = pushLabel(syncOn);
    }
  }

  // Creates/updates an event per block, then deletes events for blocks removed in the editor.
  async _syncBlocksToGoogle(task, st) {
    const summary = `${task.name}: ${st.name}`;

    for (const b of this.blocks) {
      const timing = { startDate: b.date, startTime: b.start, hours: b.hours };
      if (b.eventId) {
        await this.gcal.updateEvent({ eventId: b.eventId, summary, ...timing });
      } else {
        // createEvent may return null when guarded; the block then stays local
        b.eventId = await this.gcal.createEvent({ summary, description: st.note || '', ...timing });
      }
    }

    const currentIds = this.blocks.map((b) => b.eventId).filter(Boolean);
    const removedIds = this._originalEventIds.filter((id) => !currentIds.includes(id));
    for (const id of removedIds) {
      await this.gcal.deleteEvent(id);
    }
  }
}

// ---------- grid markup ----------
function gridHtml(days) {
  const today = startOfDay(new Date());

  const headers = days.map((d, i) => {
    const isToday = sameDay(d, today) ? 'today' : '';
    return `<div class="cal-day-head ${isToday}">
                 <span class="dow">${DAY_NAMES[i]}</span>${d.getMonth() + 1}/${d.getDate()}
               </div>`;
  }).join('');

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const timeLabels = hours.map((h) => `<div class="cal-time-label">${fmtHour(h)}</div>`).join('');
  const hourCells = hours.map((h) => `<div class="cal-hour-cell" data-hour="${h}"></div>`).join('');
  const dayColumns = days
    .map((_, dayIdx) => `<div class="cal-daycol" data-day-index="${dayIdx}">${hourCells}</div>`)
    .join('');

  return `<div class="cal-table"><div class="cal-corner"></div>${headers}`
    + `<div>${timeLabels}</div>${dayColumns}</div>`;
}

// Registers document-level mousemove/mouseup listeners for the duration of one drag.
function trackDrag(onMove, onEnd = () => {}) {
  const up = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', up);
    onEnd();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', up);
}

function pushLabel(syncOn) {
  return syncOn ? 'Push to Google Calendar' : 'Save blocks';
}

// ---------- time helpers ----------
function mondayOf(d) {
  const monday = startOfDay(d);
  const daysSinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - daysSinceMonday);
  return monday;
}

function snap(min) {
  return Math.round(min / SLOT_MIN) * SLOT_MIN;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function minutesFromMidnight(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minToTime(min) {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

function fmtHour(h) {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}
