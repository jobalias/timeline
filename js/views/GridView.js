import { DAYS_SHOWN, WINDOW_LOOKBACK } from '../config.js';
import { startOfDay, sameDay, parseYmd, escapeHtml } from '../utils.js';

export class GridView {
  constructor(store, { onEditTask, onDeleteTask, onSchedule, onToggleDone }) {
    this.store = store;
    this.onEditTask = onEditTask;
    this.onDeleteTask = onDeleteTask;
    this.onSchedule = onSchedule;
    this.onToggleDone = onToggleDone;
    this.showCompleted = false;
    this.wrap = document.getElementById('gridWrap');

    this.windowStart = startOfDay(new Date());
    this.windowStart.setDate(this.windowStart.getDate() - WINDOW_LOOKBACK);

    // click handling (edit / delete / schedule)
    this.wrap.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.task-edit');
      if (editBtn) { this.onEditTask(editBtn.dataset.taskId); return; }

      const delBtn = e.target.closest('.task-del');
      if (delBtn) { this.onDeleteTask(delBtn.dataset.taskId); return; }

      const schedBtn = e.target.closest('.sched-btn');
      if (schedBtn && !schedBtn.disabled) {
        this.onSchedule(schedBtn.dataset.taskId, parseInt(schedBtn.dataset.subIndex, 10));
      }
    });

    // checkbox toggling (complete / un-complete)
    this.wrap.addEventListener('change', (e) => {
      const cb = e.target.closest('.done-check');
      if (cb) {
        this.onToggleDone(cb.dataset.taskId, parseInt(cb.dataset.subIndex, 10), cb.checked);
      }
    });

    // show/hide completed toggle
    const showCb = document.getElementById('showCompleted');
    if (showCb) {
      showCb.addEventListener('change', () => {
        this.showCompleted = showCb.checked;
        this.render();
      });
    }

    // reposition month labels on horizontal scroll
    this.wrap.addEventListener('scroll', () => this._updateStickyMonths());
  }

  render() {
    const tasks = this.store.getSorted();
    if (tasks.length === 0) {
      this.wrap.innerHTML =
        '<div class="empty">No tasks yet. Click “+ Add Task” to start.</div>';
      return;
    }

    const days = this._buildDays();
    const today = startOfDay(new Date());
    const dow = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    // ----- Month header row (spans consecutive same-month days) -----
    const monthNames = ['January','February','March','April','May','June',
      'July','August','September','October','November','December'];
    let monthRow = '<tr><th class="label-col month-corner"></th>';
    let mi = 0;
    while (mi < days.length) {
      const m = days[mi].getMonth();
      const y = days[mi].getFullYear();
      let span = 1;
      while (mi + span < days.length &&
             days[mi + span].getMonth() === m &&
             days[mi + span].getFullYear() === y) {
        span++;
      }
      monthRow += `<th class="month-head" colspan="${span}">
                     <span class="month-label">${monthNames[m]} ${y}</span>
                   </th>`;
      mi += span;
    }
    monthRow += '</tr>';

    // ----- Day header row -----
    let dayRow = '<tr><th class="label-col">Task / Subtask</th>';
    days.forEach((d) => {
      const wknd = d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : '';
      const isToday = sameDay(d, today) ? 'today' : '';
      dayRow += `<th class="day-head ${wknd} ${isToday}">
                   <span class="dow">${dow[d.getDay()]}</span>${d.getDate()}
                 </th>`;
    });
    dayRow += '</tr>';

    let html = '<table><thead>' + monthRow + dayRow + '</thead><tbody>';

    // ----- Task + subtask rows -----
    tasks.forEach((task) => {
      const allDone = task.subtasks.length > 0 && task.subtasks.every((s) => s.done);
      if (allDone && !this.showCompleted) return;

      const taskCls = allDone ? 'task-name task-done' : 'task-name';
      html += `<tr><td class="label-col ${taskCls}" data-task-id="${task.id}"
                 style="border-left:4px solid ${task.color};">
                 <span class="task-title">${escapeHtml(task.name)}</span>
                 <span class="task-btns">
                   <button class="task-edit" data-task-id="${task.id}" title="Edit">✎</button>
                   <button class="task-del" data-task-id="${task.id}" title="Delete">🗑</button>
                 </span>
               </td>`;
      days.forEach(() => (html += '<td class="cell"></td>'));
      html += '</tr>';

      // sort subtasks: incomplete first, done last
      const sortedSubs = task.subtasks
        .map((st, si) => ({ st, si }))
        .sort((a, b) => (a.st.done ? 1 : 0) - (b.st.done ? 1 : 0));

      sortedSubs.forEach(({ st, si }) => {
        if (st.done && !this.showCompleted) return;
        html += this._renderSubtaskRow(task, st, si, days, today);
      });
    });

    html += '</tbody></table>';
    this.wrap.innerHTML = html;

    this._updateStickyMonths();
  }

  _renderSubtaskRow(task, st, si, days, today) {
    const est = st.estHours ? ` (${st.estHours}h)` : '';
    const rowCls = st.done ? 'subtask-name subtask-done' : 'subtask-name';

    // clock button state
    const clockCls = st.done
      ? 'sched-btn clock-done'
      : (st.remainingHours > 0 ? 'sched-btn clock-pending' : 'sched-btn clock-full');
    const clockDisabled = st.done ? 'disabled' : '';

    // status badge
    let statusHtml;
    if (st.done) {
      const spent = st.actualHours != null ? `${st.actualHours}h spent` : 'done';
      statusHtml = `<span class="alloc-badge done">✓ ${spent}</span>`;
    } else if (st.estHoursNum > 0) {
      statusHtml = st.remainingHours > 0
        ? `<span class="alloc-badge pending">${st.remainingHours}h left</span>`
        : `<span class="alloc-badge done">✓ scheduled</span>`;
    } else {
      statusHtml = '';
    }

    let html = `<tr><td class="label-col ${rowCls}"
        style="border-left:4px solid ${task.color};">
        <span class="st-left">
          <input type="checkbox" class="done-check"
            data-task-id="${task.id}" data-sub-index="${si}"
            ${st.done ? 'checked' : ''}>
          <span class="st-label">
            ${escapeHtml(st.name)}${est}
            ${statusHtml}
          </span>
        </span>
        <button class="${clockCls}" data-task-id="${task.id}"
          data-sub-index="${si}" ${clockDisabled}>⏰</button>
      </td>`;
    html += this._renderSubtaskCells(st, days, today, task.color);
    html += '</tr>';
    return html;
  }

  _buildDays() {
    const days = [];
    for (let i = 0; i < DAYS_SHOWN; i++) {
      const d = new Date(this.windowStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }

  _renderSubtaskCells(st, days, today, color) {
    const dueD = parseYmd(st.due);
    let html = '';

    days.forEach((d) => {
      let cls = 'cell';
      if (d.getDay() === 0 || d.getDay() === 6) cls += ' weekend';
      if (sameDay(d, today)) cls += ' today';

      const isDue = dueD && sameDay(d, dueD);
      if (isDue) cls += ' due';
      if (st.done) cls += ' cell-done';

      const dayHours = st.blocks
        .filter((b) => sameDay(parseYmd(b.date), d))
        .reduce((sum, b) => sum + b.hoursNum, 0);

      let content = '';
      if (isDue) {
        content = '<div class="square"></div>'; // red ✕ for due date
      } else if (dayHours > 0) {
        const clr = st.done ? 'var(--muted)' : color;
        content = `<span class="hours-centered" style="color:${clr};">${dayHours}h</span>`;
      }

      html += `<td class="${cls}">${content}</td>`;
    });
    return html;
  }

  // ----- Sticky, centered month labels on horizontal scroll -----
  _updateStickyMonths() {
    const scrollLeft = this.wrap.scrollLeft;
    const wrapWidth = this.wrap.clientWidth;

    const labelCol = this.wrap.querySelector('.label-col');
    const labelWidth = labelCol ? labelCol.offsetWidth : 0;

    const viewLeft = scrollLeft + labelWidth;
    const viewRight = scrollLeft + wrapWidth;

    const monthHeads = this.wrap.querySelectorAll('.month-head');
    monthHeads.forEach((th) => {
      const label = th.querySelector('.month-label');
      if (!label) return;

      const thLeft = th.offsetLeft;
      const thRight = thLeft + th.offsetWidth;
      const labelW = label.offsetWidth;

      // fully off-screen → reset
      if (thRight <= viewLeft || thLeft >= viewRight) {
        label.style.transform = 'translateX(0)';
        return;
      }

      // visible slice of this month (excluding the frozen label column)
      const visStart = Math.max(thLeft, viewLeft);
      const visEnd = Math.min(thRight, viewRight);
      const visCenterInCell = (visStart + visEnd) / 2 - thLeft;

      let offset = visCenterInCell - labelW / 2;

      const minOffset = 0;
      const maxOffset = th.offsetWidth - labelW;
      if (offset < minOffset) offset = minOffset;
      if (offset > maxOffset) offset = Math.max(0, maxOffset);

      label.style.transform = `translateX(${offset}px)`;
    });
  }
}