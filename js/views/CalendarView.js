import { TimeBlock } from '../models/Subtask.js';
import { startOfDay, sameDay } from '../utils.js';

const SLOT_MIN = 15;          // snap granularity (minutes)
const HOUR_PX = 48;           // pixel height of one hour
const PX_PER_MIN = HOUR_PX / 60;

export class CalendarView {
  constructor(store, googleCalendar, { onDone = () => {} } = {}) {
    this.store = store;
    this.gcal = googleCalendar;
    this.onDone = onDone;
    this.context = null;
    this.weekStart = this._mondayOf(new Date());
    this.busyEvents = [];
    this.blocks = [];

    // DOM refs
    this.overlay = document.getElementById('calOverlay');
    this.title = document.getElementById('calTitle');
    this.counter = document.getElementById('calCounter');
    this.gridWrap = document.getElementById('calGridWrap');

    document.getElementById('calPrevWeek').addEventListener('click', () => this._shiftWeek(-7));
    document.getElementById('calThisWeek').addEventListener('click', () => this._thisWeek());
    document.getElementById('calNextWeek').addEventListener('click', () => this._shiftWeek(7));
    document.getElementById('calCancel').addEventListener('click', () => this._cancel());
    document.getElementById('calPush').addEventListener('click', () => this._push());
  }

  // ---------- open / close ----------
  async open(taskId, subIndex) {
    this.context = { taskId, subIndex };
    const task = this.store.find(taskId);
    const st = task.subtasks[subIndex];

    // Title shows: Task name → Subtask name (with hours)
    const est = st.estHours ? ` — ${st.estHours}h needed` : '';
    this.title.innerHTML =
      `<span class="cal-task">${this._esc(task.name)}</span>
       <span class="cal-sub">▸ ${this._esc(st.name)}${est}</span>`;

    this.blocks = st.blocks.map((b) => new TimeBlock(b));
    this.weekStart = this._mondayOf(new Date());
    this.overlay.classList.add('open');
    await this._loadAndRender();
    this._scrollToHour(8);
  }

  close() {
    this.overlay.classList.remove('open');
    const finished = this.context;
    this.context = null;
    this.onDone(finished); // signal which subtask we just finished
  }

  // ---------- week nav ----------
  _mondayOf(d) {
    const x = startOfDay(d);
    const day = (x.getDay() + 6) % 7; // Mon=0
    x.setDate(x.getDate() - day);
    return x;
  }
  async _shiftWeek(days) { this.weekStart.setDate(this.weekStart.getDate() + days); await this._loadAndRender(); }
  async _thisWeek() { this.weekStart = this._mondayOf(new Date()); await this._loadAndRender(); }

  // ---------- data ----------
  async _loadAndRender() {
    this.gridWrap.innerHTML = '<div class="cal-loading">Loading your calendar…</div>';
    const weekEnd = new Date(this.weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    try {
      this.busyEvents = this.gcal.isAuthed
        ? await this.gcal.getEvents(this.weekStart, weekEnd)
        : [];
    } catch (e) {
      console.error(e);
      this.busyEvents = [];
    }
    this._render();
  }

  // ---------- render ----------
  _render() {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(this.weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const today = startOfDay(new Date());

    let html = '<div class="cal-table">';
    // header row
    html += '<div class="cal-corner"></div>';
    days.forEach((d, i) => {
      const isToday = sameDay(d, today) ? 'today' : '';
      html += `<div class="cal-day-head ${isToday}">
                 <span class="dow">${dow[i]}</span>${d.getMonth() + 1}/${d.getDate()}
               </div>`;
    });

    // time label column
    html += '<div>';
    for (let h = 0; h < 24; h++) {
      html += `<div class="cal-time-label">${this._fmtHour(h)}</div>`;
    }
    html += '</div>';

    // day columns
    days.forEach((d, dayIdx) => {
      html += `<div class="cal-daycol" data-day-index="${dayIdx}">`;
      for (let h = 0; h < 24; h++) {
        html += `<div class="cal-hour-cell" data-hour="${h}"></div>`;
      }
      html += '</div>';
    });

    html += '</div>';
    this.gridWrap.innerHTML = html;

    this._renderBusyEvents(days);
    this._renderBlocks(days);
    this._attachInteractions(days);
    this._updateCounter();
  }

  _renderBusyEvents(days) {
    const cols = this.gridWrap.querySelectorAll('.cal-daycol');
    this.busyEvents.forEach((ev) => {
      const dayIdx = days.findIndex((d) => sameDay(d, ev.start));
      if (dayIdx < 0) return;
      const el = document.createElement('div');
      el.className = 'cal-event';
      el.style.top = this._minutesFromMidnight(ev.start) * PX_PER_MIN + 'px';
      el.style.height = Math.max(16, (ev.end - ev.start) / 60000 * PX_PER_MIN) + 'px';
      el.textContent = ev.title;
      cols[dayIdx].appendChild(el);
    });
  }

  _renderBlocks(days) {
    const cols = this.gridWrap.querySelectorAll('.cal-daycol');
    this.blocks.forEach((b, idx) => {
      const bStart = this._blockStartDate(b);
      const dayIdx = days.findIndex((d) => sameDay(d, bStart));
      if (dayIdx < 0) return;
      const el = document.createElement('div');
      el.className = 'cal-block';
      el.dataset.blockIndex = idx;
      el.style.top = this._minutesFromMidnight(bStart) * PX_PER_MIN + 'px';
      el.style.height = b.hoursNum * 60 * PX_PER_MIN + 'px';
      el.innerHTML = `<span class="block-del" data-del="${idx}">✕</span>
                      ${b.hours}h
                      <div class="resize-handle" data-resize="${idx}"></div>`;
      cols[dayIdx].appendChild(el);
    });
  }

  // ---------- interactions ----------
  _attachInteractions(days) {
    const cols = this.gridWrap.querySelectorAll('.cal-daycol');

    cols.forEach((col, dayIdx) => {
      // Click empty space → drag-create a block
      col.addEventListener('mousedown', (e) => {
        if (e.target.closest('.cal-block') || e.target.closest('.cal-event')) return;
        this._startDragCreate(e, col, dayIdx, days);
      });
    });

    // Delete buttons
    this.gridWrap.querySelectorAll('.block-del').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.del, 10);
        this.blocks.splice(idx, 1);
        this._render();
      });
    });

    // Resize handles
    this.gridWrap.querySelectorAll('.resize-handle').forEach((h) => {
      h.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this._startResize(e, parseInt(h.dataset.resize, 10), days);
      });
    });

    // Move blocks
    this.gridWrap.querySelectorAll('.cal-block').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.resize-handle') || e.target.closest('.block-del')) return;
        this._startMove(e, parseInt(el.dataset.blockIndex, 10), days);
      });
    });
  }

  _startDragCreate(e, col, dayIdx, days) {
    const rect = col.getBoundingClientRect();
    const startMin = this._snap((e.clientY - rect.top) / PX_PER_MIN);
    const day = days[dayIdx];

    const block = new TimeBlock({
      date: this._ymdLocal(day),
      start: this._minToTime(startMin),
      hours: 0.25,
    });
    this.blocks.push(block);
    const blockIndex = this.blocks.length - 1;
    this._render();

    const move = (me) => {
      const curMin = this._snap((me.clientY - rect.top) / PX_PER_MIN);
      let dur = curMin - startMin;
      if (dur < SLOT_MIN) dur = SLOT_MIN;
      this.blocks[blockIndex].hours = (dur / 60);
      this._render();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      this._render();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  _startResize(e, idx, days) {
    const block = this.blocks[idx];
    const startY = e.clientY;
    const startHours = block.hoursNum;

    const move = (me) => {
      const deltaMin = this._snap((me.clientY - startY) / PX_PER_MIN);
      let newDur = startHours * 60 + deltaMin;
      if (newDur < SLOT_MIN) newDur = SLOT_MIN;
      block.hours = newDur / 60;
      this._render();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  _startMove(e, idx, days) {
    const block = this.blocks[idx];
    const startY = e.clientY;
    const startX = e.clientX;
    const origMin = this._timeToMin(block.start);
    const origDayIdx = days.findIndex((d) => sameDay(d, this._blockStartDate(block)));
    const colWidth = this.gridWrap.querySelector('.cal-daycol').getBoundingClientRect().width;

    const move = (me) => {
      const deltaMin = this._snap((me.clientY - startY) / PX_PER_MIN);
      let newMin = origMin + deltaMin;
      newMin = Math.max(0, Math.min(newMin, 24 * 60 - block.hoursNum * 60));
      block.start = this._minToTime(newMin);

      const deltaDays = Math.round((me.clientX - startX) / colWidth);
      let newDayIdx = origDayIdx + deltaDays;
      newDayIdx = Math.max(0, Math.min(6, newDayIdx));
      block.date = this._ymdLocal(days[newDayIdx]);

      this._render();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  // ---------- counter ----------
  _updateCounter() {
    const st = this.store.find(this.context.taskId).subtasks[this.context.subIndex];
    const est = st.estHoursNum;
    const placed = this.blocks.reduce((s, b) => s + b.hoursNum, 0);
    const left = est - placed;
    if (est === 0) {
      this.counter.textContent = `${placed}h placed`;
      this.counter.classList.remove('done');
    } else if (left <= 0) {
      this.counter.textContent = `✓ ${placed}h placed — done!`;
      this.counter.classList.add('done');
    } else {
      this.counter.textContent = `${est}h needed · ${placed}h placed · ${left}h left`;
      this.counter.classList.remove('done');
    }
  }

  // ---------- push ----------
  async _push() {
    if (!this.gcal.isAuthed) { alert('Please connect Google first.'); return; }
    if (this.blocks.length === 0) { alert('Place at least one block.'); return; }

    const task = this.store.find(this.context.taskId);
    const st = task.subtasks[this.context.subIndex];
    const btn = document.getElementById('calPush');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
      for (const b of this.blocks) {
        // Skip blocks that already have an event (avoid duplicates)
        if (b.eventId) continue;
        const eventId = await this.gcal.createEvent({
          summary: `${task.name}: ${st.name}`,
          startDate: b.date, startTime: b.start, hours: b.hours,
        });
        b.eventId = eventId; // store it on the block
      }
      // save now that blocks have event IDs
      this.store.setSubtaskBlocks(this.context.taskId, this.context.subIndex, this.blocks);

      btn.textContent = '✓ Added';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Push to Google Calendar';
        this.close();
      }, 1000);
    } catch (err) {
      console.error(err);
      alert('Error: ' + (err.result?.error?.message || err.message));
      btn.disabled = false; btn.textContent = 'Push to Google Calendar';
    }
  }

  // ---------- helpers ----------
  _snap(min) { return Math.round(min / SLOT_MIN) * SLOT_MIN; }
  _minutesFromMidnight(d) { return d.getHours() * 60 + d.getMinutes(); }
  _blockStartDate(b) {
    const d = new Date(b.date + 'T00:00:00');
    const [h, m] = b.start.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  }
  _timeToMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
  _minToTime(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  _fmtHour(h) {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  }
  _ymdLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  _scrollToHour(h) {
    this.gridWrap.scrollTop = h * HOUR_PX;
  }
  _esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  _cancel() {
    this.overlay.classList.remove('open');
    this.context = null;
    this.onDone(null); // null = user cancelled, stop the sequence
  }
}