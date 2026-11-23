import { startOfDay, sameDay, parseYmd } from '../core/dates.js';
import { escapeHtml } from '../utils.js';
import { cssVar } from '../theme.js';

const HOUR_MS = 3600000;
const NOW_LINE_INTERVAL_MS = 60000;
const DEFAULT_SCROLL_HOUR = 8;
const MIN_BUSY_PX = 18;
const MIN_BLOCK_PX = 20;

const hourPx = () => cssVar('--dayview-hour-px', 44);
const hoursIntoDay = (date) => date.getHours() + date.getMinutes() / 60;

export class DayView {
  constructor(store, googleCalendar, settings) {
    this.store = store;
    this.gcal = googleCalendar;
    this.settings = settings;
    this.currentDay = startOfDay(new Date());
    this.busyEvents = [];

    this.root = document.getElementById('dayView');
    this.titleEl = document.getElementById('dayViewTitle');
    this.bodyEl = document.getElementById('dayViewBody');

    document.getElementById('dayPrev').addEventListener('click', () => this._shiftDay(-1));
    document.getElementById('dayNext').addEventListener('click', () => this._shiftDay(1));
    document.getElementById('dayToday').addEventListener('click', () => this._goToday());
  }

  // ----- Public API -----

  async render() {
    this._renderTitle();
    this.busyEvents = await this._fetchBusyEvents();
    const { taskBlocks, blockEventIds } = this._collectTaskBlocks();
    this._renderGrid(taskBlocks, blockEventIds);
  }

  startNowLineTimer() {
    this.stopNowLineTimer();
    this._nowTimer = setInterval(() => this._updateNowLine(), NOW_LINE_INTERVAL_MS);
  }

  stopNowLineTimer() {
    if (!this._nowTimer) return;
    clearInterval(this._nowTimer);
    this._nowTimer = null;
  }

  // ----- Navigation -----

  async _shiftDay(delta) {
    this.currentDay.setDate(this.currentDay.getDate() + delta);
    await this.render();
  }

  async _goToday() {
    this.currentDay = startOfDay(new Date());
    await this.render();
  }

  _isViewingToday() {
    return sameDay(this.currentDay, startOfDay(new Date()));
  }

  // ----- Data -----

  async _fetchBusyEvents() {
    if (!this.gcal || !this.gcal.isAuthed) return [];
    try {
      const dayStart = startOfDay(this.currentDay);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      return await this.gcal.getEvents(dayStart, dayEnd, this.settings.getSelectedCalendars());
    } catch {
      return [];
    }
  }

  // Returns this day's task blocks, plus the Google event ids of every app block
  // (any day) so those events aren't drawn a second time as gray busy blocks
  _collectTaskBlocks() {
    const taskBlocks = [];
    const blockEventIds = new Set();

    this.store.getAll().forEach((task) => {
      task.subtasks.forEach((st) => {
        st.blocks.forEach((b) => {
          if (b.eventId) blockEventIds.add(b.eventId);
          if (!b.date || !sameDay(parseYmd(b.date), this.currentDay)) return;
          taskBlocks.push({
            taskName: task.name,
            subName: st.name,
            color: task.color,
            start: b.start,
            hours: b.hoursNum,
            done: st.done,
          });
        });
      });
    });

    return { taskBlocks, blockEventIds };
  }

  // ----- Rendering -----

  _renderTitle() {
    const date = this.currentDay.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    this.titleEl.textContent = (this._isViewingToday() ? 'Today · ' : '') + date;
  }

  _renderGrid(taskBlocks, blockEventIds = new Set()) {
    const px = hourPx();
    let html = '<div class="dv-grid">';

    for (let h = 0; h < 24; h++) {
      html += `<div class="dv-hour" style="top:${h * px}px;">
                 <span class="dv-hour-label">${this._fmtHour(h)}</span>
               </div>`;
    }

    this.busyEvents
      .filter((ev) => !blockEventIds.has(ev.id))
      .forEach((ev) => { html += this._renderBusyEvent(ev, px); });

    taskBlocks.forEach((b) => { html += this._renderTaskBlock(b, px); });

    if (this._isViewingToday()) {
      html += `<div class="dv-now-line" style="top:${hoursIntoDay(new Date()) * px}px;"></div>`;
    }

    html += '</div>';
    this.bodyEl.innerHTML = html;
    this.bodyEl.scrollTop = DEFAULT_SCROLL_HOUR * px;
  }

  _renderBusyEvent(ev, px) {
    const top = hoursIntoDay(ev.start) * px;
    const height = Math.max(MIN_BUSY_PX, ((ev.end - ev.start) / HOUR_MS) * px);
    const title = escapeHtml(ev.title);
    return `<div class="dv-busy" style="top:${top}px;height:${height}px;"
                  title="${title}">${title}</div>`;
  }

  _renderTaskBlock(b, px) {
    const [h, m] = b.start.split(':').map(Number);
    const top = (h + m / 60) * px;
    const height = Math.max(MIN_BLOCK_PX, b.hours * px);
    const opacity = b.done ? 0.4 : 1;
    return `<div class="dv-block"
                  style="top:${top}px;height:${height}px;
                         background:${b.color};opacity:${opacity};"
                  title="${escapeHtml(b.taskName)}: ${escapeHtml(b.subName)}">
               <div class="dv-block-title">${escapeHtml(b.subName)}</div>
               <div class="dv-block-sub">${escapeHtml(b.taskName)} · ${b.hours}h</div>
             </div>`;
  }

  // Moves the now-line, adding it if we navigated back to today or removing it if we left
  _updateNowLine() {
    const line = this.bodyEl.querySelector('.dv-now-line');

    if (!this._isViewingToday()) {
      line?.remove();
      return;
    }

    const top = `${hoursIntoDay(new Date()) * hourPx()}px`;
    if (line) {
      line.style.top = top;
      return;
    }

    const el = document.createElement('div');
    el.className = 'dv-now-line';
    el.style.top = top;
    this.bodyEl.querySelector('.dv-grid')?.appendChild(el);
  }

  _fmtHour(h) {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  }
}
