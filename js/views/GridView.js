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
    // reposition month labels on horizontal scroll
    this.wrap.addEventListener('scroll', () => this._updateStickyMonths());

    this.windowStart = startOfDay(new Date());
    this.windowStart.setDate(this.windowStart.getDate() - WINDOW_LOOKBACK);

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

    // checkbox toggling
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
  }

  shiftWindow(days) {
    this.windowStart.setDate(this.windowStart.getDate() + days);
    this.render();
  }

  jumpToday() {
    this.windowStart = startOfDay(new Date());
    this.windowStart.setDate(this.windowStart.getDate() - WINDOW_LOOKBACK);
    this.render();
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

    // Build month header row (spans consecutive days in the same month)
    // Build month header row (spans consecutive days in the same month)
    const monthNames = ['January','February','March','April','May','June',
      'July','August','September','October','November','December'];
    let monthRow = '<tr><th class="label-col month-corner"></th>';
    let i = 0;
    while (i < days.length) {
      const m = days[i].getMonth();
      const y = days[i].getFullYear();
      let span = 1;
      while (i + span < days.length &&
             days[i + span].getMonth() === m &&
             days[i + span].getFullYear() === y) {
        span++;
      }
      monthRow += `<th class="month-head" colspan="${span}">
                     <span class="month-label">${monthNames[m]} ${y}</span>
                   </th>`;
      i += span;
    }
    monthRow += '</tr>';

    // Day header row
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

    tasks.forEach((task) => {
      const allDone = task.subtasks.length > 0 && task.subtasks.every((s) => s.done);
      // skip fully-done tasks if hidden
      if (allDone && !this.showCompleted) return;

      const taskCls = allDone ? 'task-name task-done' : 'task-name';
      html += `<tr><td class="label-col ${taskCls}" data-task-id="${task.id}">
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

    _updateStickyMonths() {
        const scrollLeft = this.wrap.scrollLeft;
        const wrapWidth = this.wrap.clientWidth;

        // width of the frozen label column (months should never slide under it)
        const labelCol = this.wrap.querySelector('.label-col');
        const labelWidth = labelCol ? labelCol.offsetWidth : 0;

        // The visible day-area window, in scroll coordinates
        const viewLeft = scrollLeft + labelWidth;
        const viewRight = scrollLeft + wrapWidth;

        const monthHeads = this.wrap.querySelectorAll('.month-head');
        monthHeads.forEach((th) => {
        const label = th.querySelector('.month-label');
        if (!label) return;

        const thLeft = th.offsetLeft;
        const thRight = thLeft + th.offsetWidth;
        const labelW = label.offsetWidth;

        // Fully off-screen → reset
        if (thRight <= viewLeft || thLeft >= viewRight) {
            label.style.transform = 'translateX(0)';
            return;
        }

        // The visible slice of THIS month (clamped to the viewport, excluding label col)
        const visStart = Math.max(thLeft, viewLeft);
        const visEnd = Math.min(thRight, viewRight);
        const visWidth = visEnd - visStart;

        // Center of the visible slice, relative to the month cell's own left edge
        const visCenterInCell = (visStart + visEnd) / 2 - thLeft;

        // Desired label offset so its center sits at the visible slice's center
        let offset = visCenterInCell - labelW / 2;

        // Clamp so the label never leaves its own month cell
        const minOffset = 0;
        const maxOffset = th.offsetWidth - labelW;
        if (offset < minOffset) offset = minOffset;
        if (offset > maxOffset) offset = Math.max(0, maxOffset);

        label.style.transform = `translateX(${offset}px)`;
        });
    }
    
  _renderSubtaskRow(task, st, si, days, today) {
    const est = st.estHours ? ` (${st.estHours}h)` : '';
    const rowCls = st.done ? 'subtask-name subtask-done' : 'subtask-name';

    // clock button state
    const clockCls = st.done
      ? 'sched-btn clock-done'
      : (st.remainingHours > 0 ? 'sched-btn clock-pending' : 'sched-btn clock-full');
    const clockDisabled = st.done ? 'disabled' : '';

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

    let html = `<tr><td class="label-col ${rowCls}">
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
    html += this._renderSubtaskCells(st, days, today);
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

_renderSubtaskCells(st, days, today) {
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

      // Show centered hour number instead of filled square
      let content = '';
      if (isDue) {
        content = '<div class="square"></div>'; // keep the ✕ for due date
      } else if (dayHours > 0) {
        content = `<span class="hours-centered">${dayHours}h</span>`;
      }

      html += `<td class="${cls}">${content}</td>`;
    });
    return html;
  }
}