import { startOfDay, sameDay, parseYmd } from '../utils.js';

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

    document.getElementById('dayPrev')
      .addEventListener('click', () => this._shiftDay(-1));
    document.getElementById('dayNext')
      .addEventListener('click', () => this._shiftDay(1));
    document.getElementById('dayToday')
      .addEventListener('click', () => this._goToday());
  }

  async _shiftDay(delta) {
    this.currentDay.setDate(this.currentDay.getDate() + delta);
    await this.render();
  }
  async _goToday() {
    this.currentDay = startOfDay(new Date());
    await this.render();
  }

  async render() {
    // title
    const opts = { weekday: 'long', month: 'short', day: 'numeric' };
    const isToday = sameDay(this.currentDay, startOfDay(new Date()));
    this.titleEl.textContent =
      (isToday ? 'Today · ' : '') + this.currentDay.toLocaleDateString(undefined, opts);

    // fetch Google busy events for this day (gray blocks)
    if (this.gcal && this.gcal.isAuthed) {
      try {
        const dayStart = startOfDay(this.currentDay);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        const calIds = this.settings.getSelectedCalendars();
        this.busyEvents = await this.gcal.getEvents(dayStart, dayEnd, calIds);
      } catch (e) {
        this.busyEvents = [];
      }
    } else {
      this.busyEvents = [];
    }

    // collect task blocks for this day
    const taskBlocks = [];
    this.store.getAll().forEach((task) => {
      task.subtasks.forEach((st) => {
        st.blocks.forEach((b) => {
          if (b.date && sameDay(parseYmd(b.date), this.currentDay)) {
            taskBlocks.push({
              taskName: task.name,
              subName: st.name,
              color: task.color,
              start: b.start,
              hours: b.hoursNum,
              done: st.done,
            });
          }
        });
      });
    });

    this._renderGrid(taskBlocks);
  }

  _renderGrid(taskBlocks) {
    const HOUR_PX = 44;
    let html = '<div class="dv-grid">';

    // hour lines + labels
    for (let h = 0; h < 24; h++) {
      html += `<div class="dv-hour" style="top:${h * HOUR_PX}px;">
                 <span class="dv-hour-label">${this._fmtHour(h)}</span>
               </div>`;
    }

    // gray busy events (behind task blocks)
    this.busyEvents.forEach((ev) => {
      const top = (ev.start.getHours() + ev.start.getMinutes() / 60) * HOUR_PX;
      const height = Math.max(18, ((ev.end - ev.start) / 3600000) * HOUR_PX);
      html += `<div class="dv-busy" style="top:${top}px;height:${height}px;"
                    title="${this._esc(ev.title)}">${this._esc(ev.title)}</div>`;
    });

    // colored task blocks
    taskBlocks.forEach((b) => {
      const [h, m] = b.start.split(':').map(Number);
      const top = (h + m / 60) * HOUR_PX;
      const height = Math.max(20, b.hours * HOUR_PX);
      const opacity = b.done ? 0.4 : 1;
      html += `<div class="dv-block"
                    style="top:${top}px;height:${height}px;
                           background:${b.color};opacity:${opacity};"
                    title="${this._esc(b.taskName)}: ${this._esc(b.subName)}">
                 <div class="dv-block-title">${this._esc(b.subName)}</div>
                 <div class="dv-block-sub">${this._esc(b.taskName)} · ${b.hours}h</div>
               </div>`;
    });

    html += '</div>';
    this.bodyEl.innerHTML = html;

    // scroll to 8am on first render of a day
    this.bodyEl.scrollTop = 8 * HOUR_PX;
  }

  _fmtHour(h) {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  }
  _esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}