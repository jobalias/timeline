import { startOfDay, sameDay } from '../utils.js';

export class ProgressView {
  constructor(store) {
    this.store = store;
    this.isActive = false;

    // week start (Monday) of the currently viewed week
    this.weekStart = this._mondayOf(new Date());

    this.container = document.getElementById('progressViewContainer');
    this.weekEl = document.getElementById('progressWeek');
    this.labelEl = document.getElementById('progWeekLabel');

    document.getElementById('progPrev')
      .addEventListener('click', () => this._shiftWeek(-7));
    document.getElementById('progNext')
      .addEventListener('click', () => this._shiftWeek(7));
    document.getElementById('progThisWeek')
      .addEventListener('click', () => this._goToday());
  }

  activate() { this.isActive = true; this.render(); }
  deactivate() { this.isActive = false; }
  refresh() { if (this.isActive) this.render(); }

  _shiftWeek(days) {
    this.weekStart.setDate(this.weekStart.getDate() + days);
    this.render();
  }
  _goToday() {
    this.weekStart = this._mondayOf(new Date());
    this.render();
  }

  _mondayOf(date) {
    const d = startOfDay(new Date(date));
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
    d.setDate(d.getDate() + diff);
    return d;
  }

  render() {
    if (!this.isActive) return;

    const weekEnd = new Date(this.weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const isThisWeek = this._sameWeek(this.weekStart, this._mondayOf(new Date()));
    const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    this.labelEl.textContent = isThisWeek
      ? 'This Week'
      : `${fmt(this.weekStart)} – ${fmt(weekEnd)}`;

    const log = this.store.getCompletionLog();
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const today = startOfDay(new Date());

    this.weekEl.innerHTML = '';

    for (let i = 0; i < 7; i++) {
      const day = new Date(this.weekStart);
      day.setDate(day.getDate() + i);

      // entries completed this day
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
          <div class="prog-dow">${dayNames[i]}</div>
          <div class="prog-date">${day.getDate()}</div>
        </div>`;

      let body = '';
      if (dayEntries.length === 0) {
        body = `<div class="prog-empty"></div>`;
      } else {
        body = `<div class="prog-items">${this._renderDayEntries(dayEntries)}</div>`;
      }

      const count = dayEntries.length;
      const footer = count > 0
        ? `<div class="prog-count">${count} done 🎉</div>`
        : '';

      col.innerHTML = header + body + footer;
      this.weekEl.appendChild(col);
    }

    this._renderWeekSummary(log);
  }

  // Render a day's entries: celebration cards for completed tasks, chips for the rest
  _renderDayEntries(entries) {
    // group entries by taskId
    const byTask = new Map();
    entries.forEach((e) => {
      const key = e.taskId || e.taskName; // fallback for old entries without taskId
      if (!byTask.has(key)) byTask.set(key, []);
      byTask.get(key).push(e);
    });

    let html = '';
    byTask.forEach((taskEntries) => {
      // did this task get fully completed on this day?
      const celebrated = taskEntries.some((e) => e.taskJustCompleted);
      const taskName = taskEntries[0].taskName;

      if (celebrated) {
        // CELEBRATION card — task complete, subtasks as bullets
        const bullets = taskEntries.map((e) =>
          `<li>${this._esc(e.subtaskName)}${
            e.hoursSpent ? ` <span class="prog-hours">· ${e.hoursSpent}h</span>` : ''
          }</li>`
        ).join('');

        html += `
          <div class="prog-task-complete">
            <div class="prog-tc-header">${this._esc(taskName)}</div>
            <ul class="prog-tc-list">${bullets}</ul>
          </div>`;
      } else {
        // normal: individual subtask chips (not fully complete)
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

  _renderWeekSummary(log) {
    const weekEnd = new Date(this.weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEntries = log.filter((e) => {
      const c = new Date(e.completedAt);
      return c >= this.weekStart && c < weekEnd;
    });

    let summary = document.getElementById('progWeekSummary');
    if (!summary) {
      summary = document.createElement('div');
      summary.id = 'progWeekSummary';
      summary.className = 'prog-week-summary';
      this.container.appendChild(summary);
    }
    const total = weekEntries.length;
    const hours = weekEntries.reduce((s, e) => s + (parseFloat(e.hoursSpent) || 0), 0);
    if (total === 0) {
      summary.textContent = 'Nothing logged this week yet — you\'ve got this! 🌱';
    } else {
      summary.innerHTML =
        `This week: <strong>${total}</strong> subtask${total === 1 ? '' : 's'} completed` +
        (hours > 0 ? ` · <strong>${hours}h</strong> of focused work 💪` : '');
    }
  }

  _sameWeek(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }

  _esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
}