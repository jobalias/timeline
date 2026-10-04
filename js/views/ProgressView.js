import { startOfDay, sameDay } from '../utils.js';

export class ProgressView {
  constructor(store) {
    this.store = store;
    this.isActive = false;
    this.dayStart = startOfDay(new Date()); // normalize to midnight
    this.container = document.getElementById('progressViewContainer');
    this.weekEl = document.getElementById('progressWeek');
    this.labelEl = document.getElementById('progWeekLabel');

    document.getElementById('progPrev')
      ?.addEventListener('click', () => this._shiftWeek(-7));
    document.getElementById('progNext')
      ?.addEventListener('click', () => this._shiftWeek(7));
    document.getElementById('progThisWeek')
      ?.addEventListener('click', () => this._goToday());
  }

  activate() { this.isActive = true; this.render(); }
  deactivate() { this.isActive = false; }
  refresh() { if (this.isActive) this.render(); }

  _shiftWeek(days) {
    this.dayStart.setDate(this.dayStart.getDate() + days);
    this.render();
  }
  _goToday() {
    this.dayStart = startOfDay(new Date());
    this.render();
  }

  render() {
    if (!this.isActive) return;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const log = this.store.getCompletionLog();
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

    this.weekEl.innerHTML = '';

    for (let i = 0; i < DAYS_TO_SHOW; i++) {
      const day = new Date(rangeStart);
      day.setDate(day.getDate() + i);

      const dayEntries = log.filter((e) => {
        const c = new Date(e.completedAt);
        return c.getFullYear() === day.getFullYear() &&
               c.getMonth() === day.getMonth() &&
               c.getDate() === day.getDate();
      });

      const col = document.createElement('div');
      col.className = 'prog-day';
      if (sameDay(day, today)) col.classList.add('prog-today');

      const header = `
        <div class="prog-day-header">
          <div class="prog-dow">${dayNames[day.getDay()]}</div>
          <div class="prog-date">${day.getDate()}</div>
          <div class="prog-month">${day.toLocaleDateString(undefined, { month: 'short' })}</div>
        </div>`;

      let body = '';
      if (dayEntries.length === 0) {
        body = `<div class="prog-empty"></div>`;
      } else {
        body = `<div class="prog-items">${this._renderDayEntries(dayEntries)}</div>`;
      }

      const count = dayEntries.length;
      const footer = count > 0 ? `<div class="prog-count">${count} done 🎉</div>` : '';

      col.innerHTML = header + body + footer;
      this.weekEl.appendChild(col);
    }

    this._renderRangeSummary(log, rangeStart, rangeEnd);
    this._scrollToToday();
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

    let html = '';
    byTask.forEach((taskEntries) => {
      const celebrated = taskEntries.some((e) => e.taskJustCompleted);
      const taskName = taskEntries[0].taskName;

      if (celebrated) {
        const bullets = taskEntries.map((e) =>
          `<li>${this._esc(e.subtaskName)}${
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
            <div class="prog-chip">
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

  // summary for the visible range
  _renderRangeSummary(log, rangeStart, rangeEnd) {
    const end = new Date(rangeEnd);
    end.setDate(end.getDate() + 1); // inclusive
    const entries = log.filter((e) => {
      const c = new Date(e.completedAt);
      return c >= rangeStart && c < end;
    });

    let summary = document.getElementById('progWeekSummary');
    if (!summary) {
      summary = document.createElement('div');
      summary.id = 'progWeekSummary';
      summary.className = 'prog-week-summary';
      this.container.appendChild(summary);
    }
    const total = entries.length;
    const hours = entries.reduce((s, e) => s + (parseFloat(e.hoursSpent) || 0), 0);
    if (total === 0) {
      summary.textContent = 'Nothing logged in this range yet — you\'ve got this! 🌱';
    } else {
      summary.innerHTML =
        `In view: <strong>${total}</strong> subtask${total === 1 ? '' : 's'} completed` +
        (hours > 0 ? ` · <strong>${hours}h</strong> of focused work 💪` : '');
    }
  }

  _esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
}