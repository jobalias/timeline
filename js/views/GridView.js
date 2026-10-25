import { DAYS_SHOWN, WINDOW_LOOKBACK } from '../config.js';
import { startOfDay, sameDay, parseYmd, escapeHtml, _isDueToday} from '../utils.js';

export class GridView {
constructor(store, { onEditTask, onDeleteTask, onSchedule, onToggleDone,
                       onOpenTaskNote, onOpenSubtaskNote, onToggleWaiting }) {
    this.store = store;
    this.onEditTask = onEditTask;
    this.onDeleteTask = onDeleteTask;
    this.onSchedule = onSchedule;
    this.onToggleDone = onToggleDone;
    this.onOpenTaskNote = onOpenTaskNote || (() => {});
    this.onOpenSubtaskNote = onOpenSubtaskNote || (() => {});
    this.showCompleted = false;
    this.wrap = document.getElementById('gridWrap');
    this.onToggleWaiting = onToggleWaiting || (() => {});
    this.isMobile = window.innerWidth < 768;
    this.effectiveDays = this.isMobile ? 10 : DAYS_SHOWN;
    const halfWindow = Math.floor(this.effectiveDays / 2);
    this.windowStart = startOfDay(new Date());
    this.windowStart.setDate(this.windowStart.getDate() - halfWindow);

    // click handling (edit / delete / schedule)
    this.wrap.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.task-edit');
      if (editBtn) { this.onEditTask(editBtn.dataset.taskId); return; }

      const delBtn = e.target.closest('.task-del');
      if (delBtn) { this.onDeleteTask(delBtn.dataset.taskId); return; }

      const schedBtn = e.target.closest('.sched-btn');
      if (schedBtn && !schedBtn.disabled) {
        this.onSchedule(schedBtn.dataset.taskId, parseInt(schedBtn.dataset.subIndex, 10));
        return;
      }

      // ball-in-court toggle
      const ballBtn = e.target.closest('.ball-dot');
      if (ballBtn) {
        this.onToggleWaiting(
          ballBtn.dataset.taskId,
          parseInt(ballBtn.dataset.subIndex, 10)
        );
        return;
      }
    });

    // ===== MOBILE swipe gestures on subtask rows =====
    // swipe right → toggle complete;  swipe left → toggle waiting;  tap → (handled elsewhere, note)
    this._swipe = null;
    const SWIPE_THRESHOLD = 60;   // px of horizontal travel to trigger
    const SWIPE_MAX_OFF_AXIS = 30; // max vertical drift to still count as horizontal

    this.wrap.addEventListener('touchstart', (e) => {
      if (!this.isMobile) return;
      const row = e.target.closest('.m-subtask');
      if (!row) { this._swipe = null; return; }
      // don't start a swipe if the touch began on the clock button
      if (e.target.closest('.sched-btn')) { this._swipe = null; return; }

      const t = e.touches[0];
      this._swipe = {
        row,
        startX: t.clientX,
        startY: t.clientY,
        taskId: row.dataset.taskId,
        subIndex: parseInt(row.dataset.subIndex, 10),
        done: row.dataset.done === '1',
        fired: false,
      };
    }, { passive: true });

    this.wrap.addEventListener('touchmove', (e) => {
      if (!this._swipe || this._swipe.fired) return;
      const t = e.touches[0];
      const dx = t.clientX - this._swipe.startX;
      const dy = t.clientY - this._swipe.startY;

      if (Math.abs(dy) > SWIPE_MAX_OFF_AXIS && Math.abs(dy) > Math.abs(dx)) {
        this._swipe.row.style.transform = '';
        this._swipe.row.classList.remove('swiping-left', 'swiping-right');  // ← clear
        this._swipe = null;
        return;
      }

      if (Math.abs(dx) > Math.abs(dy)) {
        const clamped = Math.max(-80, Math.min(80, dx));
        this._swipe.row.style.transform = `translateX(${clamped}px)`;

        // ← toggle reveal based on direction + past a small reveal threshold
        const row = this._swipe.row;
        if (dx > 15) {
          row.classList.add('swiping-right');
          row.classList.remove('swiping-left');
        } else if (dx < -15) {
          row.classList.add('swiping-left');
          row.classList.remove('swiping-right');
        } else {
          row.classList.remove('swiping-left', 'swiping-right');
        }
      }
    }, { passive: true });

    this.wrap.addEventListener('touchend', (e) => {
      const s = this._swipe;
      this._swipe = null;
      if (!s) return;

      s.row.classList.remove('swiping-left', 'swiping-right');   // ← clear reveal
      s.row.style.transition = 'transform 0.15s ease';
      s.row.style.transform = '';
      setTimeout(() => { s.row.style.transition = ''; }, 160);

      const t = (e.changedTouches && e.changedTouches[0]) || null;
      if (!t) return;
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;

      // must be a clear horizontal swipe past threshold
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;      // too small → treat as tap (note opens via click)
      if (Math.abs(dy) > Math.abs(dx)) return;         // too vertical → ignore

      if (dx > 0) {
        // swipe RIGHT → toggle complete (same workflow as checkbox, incl. hours prompt)
        this.onToggleDone(s.taskId, s.subIndex, !s.done);
      } else {
        // swipe LEFT → toggle waiting
        this.onToggleWaiting(s.taskId, s.subIndex);
      }
    }, { passive: true });

    // double-click anywhere on a task/subtask row → open note popup
    this.wrap.addEventListener('dblclick', (e) => {
      // ignore double-clicks on interactive controls
      if (e.target.closest('.done-check') ||
          e.target.closest('.sched-btn') ||
          e.target.closest('.task-edit') ||
          e.target.closest('.task-del') ||
          e.target.closest('.ball-dot')) {
        return;
      }

      const labelCol = e.target.closest('.label-col');
      if (!labelCol) return;

      // subtask row? (has a checkbox with the IDs)
      this.wrap.addEventListener('click', (e) => {
        if (!this.isMobile) return;

        if (e.target.closest('.sched-btn') ||
            e.target.closest('.task-edit') ||
            e.target.closest('.task-del')) {
          return;
        }

        // subtask row? (.m-sub-label carries the ids now)
        const subLabel = e.target.closest('.m-sub-label');
        if (subLabel && subLabel.dataset.subIndex !== undefined) {
          this.onOpenSubtaskNote(subLabel.dataset.taskId, parseInt(subLabel.dataset.subIndex, 10));
          return;
        }

        // task header?
        const labelCol = e.target.closest('.label-col');
        if (labelCol && labelCol.dataset.taskId && !labelCol.classList.contains('m-sub-label')) {
          this.onOpenTaskNote(labelCol.dataset.taskId);
        }
      });

      // task row? (.label-col with data-task-id but no checkbox)
      const taskId = labelCol.dataset.taskId;
      if (taskId) {
        this.onOpenTaskNote(taskId);
      }
    });

    // MOBILE: single-tap anywhere on a row opens the note (desktop keeps dblclick)
    this.wrap.addEventListener('click', (e) => {
      if (!this.isMobile) return;

      // same control-exclusions as the dblclick handler
      if (e.target.closest('.done-check') ||
          e.target.closest('.sched-btn') ||
          e.target.closest('.task-edit') ||
          e.target.closest('.task-del') ||
          e.target.closest('.ball-dot')) {
        return;
      }

      const labelCol = e.target.closest('.label-col');
      if (!labelCol) return;

      const check = labelCol.querySelector('.done-check');
      if (check) {
        this.onOpenSubtaskNote(check.dataset.taskId, parseInt(check.dataset.subIndex, 10));
        return;
      }

      const taskId = labelCol.dataset.taskId;
      if (taskId) {
        this.onOpenTaskNote(taskId);
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
        this._syncShowCompletedControls();
        this.render();
      });
    }

    // show/hide completed toggle (settings modal — used on mobile)
    const showSetting = document.getElementById('showCompletedSetting');
    if (showSetting) {
      showSetting.addEventListener('change', () => {
        this.showCompleted = showSetting.checked;
        this._syncShowCompletedControls();
        this.render();
      });
    }

    // reposition month labels on horizontal scroll
    let scrollScheduled = false;
    this.wrap.addEventListener('scroll', () => {
      if (scrollScheduled) return;
      scrollScheduled = true;
      requestAnimationFrame(() => {
        this._updateStickyMonths();
        scrollScheduled = false;
      });
    }, { passive: true });  

    // handle window resize
    window.addEventListener('resize', () => {
      const nowMobile = window.innerWidth < 768;
      if (nowMobile !== this.isMobile) {
        this.isMobile = nowMobile;
        this.render();
      }
    });

    // ----- Grid window navigation (prev/next/today) -----
    const prevBtn = document.getElementById('gridPrev');
    const nextBtn = document.getElementById('gridNext');
    const todayBtn = document.getElementById('gridToday');

    if (prevBtn) prevBtn.addEventListener('click', () => this._shiftWindow(-7));
    if (nextBtn) nextBtn.addEventListener('click', () => this._shiftWindow(7));
    if (todayBtn) todayBtn.addEventListener('click', () => this._goToday());
  }

  // ----- window navigation -----
  _shiftWindow(days) {
    this.windowStart.setDate(this.windowStart.getDate() + days);
    this.render();
    this.wrap.scrollLeft = 0; // reset horizontal scroll to show the new window start
  }

  _goToday() {
    const halfWindow = Math.floor(this.effectiveDays / 2);
    this.windowStart = startOfDay(new Date());
    this.windowStart.setDate(this.windowStart.getDate() - halfWindow);
    this.render();
    requestAnimationFrame(() => this._scrollToToday());
  }

  _scrollToToday() {
    const todayHead = this.wrap.querySelector('.day-head.today');
    if (!todayHead) return;

    const labelCol = this.wrap.querySelector('.label-col');
    const labelW = labelCol ? labelCol.offsetWidth : 0;

    // width of one day column (to offset by 2 columns)
    const dayW = todayHead.offsetWidth;

    // scroll so today sits ~2 columns from the left (after the label column)
    const target = todayHead.offsetLeft - labelW - (dayW * 2);

    this.wrap.scrollLeft = Math.max(0, target);

    requestAnimationFrame(() => this._updateStickyMonths());
  }

  _syncShowCompletedControls() {
    const a = document.getElementById('showCompleted');
    const b = document.getElementById('showCompletedSetting');
    if (a) a.checked = this.showCompleted;
    if (b) b.checked = this.showCompleted;
  }

  render() {
    const tasks = this.store.getSorted();
    if (tasks.length === 0) {
      this.wrap.innerHTML =
        '<div class="empty">No tasks yet. Click “+ Add Task” to start.</div>';
      return;
    }

    // mobile → list layout instead of the day-grid table
    if (this.isMobile) {
      this._renderMobileList(tasks);
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
      if (!task.persistent && allDone && !this.showCompleted) return;
      const taskCls = allDone ? 'task-name task-done' : 'task-name';
      const taskNoteBadge = (task.note && task.note.trim())
        ? '<span class="note-dot" title="Has a note"></span>'
        : '';

      html += `<tr class="task-tr" style="--task-color:${task.color};"><td class="label-col ${taskCls}" data-task-id="${task.id}"
                 style="--task-color:${task.color};">
                 ${taskNoteBadge}
                 <span class="task-title" title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</span>
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

  onShow() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this._scrollToToday());
    });
  }

  _renderSubtaskRow(task, st, si, days, today) {
    const dueToday = !st.done && st.due && _isDueToday(st);

    const waiting = st.waiting;
    const rowCls = st.done ? 'subtask-name subtask-done'
      : (dueToday ? 'subtask-name due-today' : 'subtask-name')
      + (waiting ? ' subtask-waiting' : '');

    // clock button state
    const clockCls = st.done
      ? 'sched-btn clock-done'
      : (st.remainingHours > 0 ? 'sched-btn clock-pending' : 'sched-btn clock-full');
    const clockDisabled = st.done ? 'disabled' : '';

    // single due-today marker (no status badge, no "time left")
    const dueBadge = `<span class="due-today-badge">${dueToday ? '⚠️' : ''}</span>`;

    const noteBadge = (st.note && st.note.trim())
      ? '<span class="note-dot" title="Has a note"></span>'
      : '';

    const ballBtn = `<button class="ball-dot" data-task-id="${task.id}"
      data-sub-index="${si}"
      title="${waiting ? 'Ball in their court — click to restore' : 'Waiting on someone? Click to minimize'}">
      ${waiting ? '🏓' : '🏐'}</button>`;

    let html = `<tr class="subtask-tr" style="--task-color:${task.color};"><td class="label-col ${rowCls}">
        ${noteBadge}
        <div class="st-row">
          ${waiting ? '' : `<input type="checkbox" class="done-check"
            data-task-id="${task.id}" data-sub-index="${si}"
            ${st.done ? 'checked' : ''}>`}
          <span class="st-name" title="${escapeHtml(st.name)}">${escapeHtml(st.name)}</span>
          ${waiting ? '' : dueBadge}
          ${waiting ? '' : `<button class="${clockCls}" data-task-id="${task.id}"
            data-sub-index="${si}" ${clockDisabled}>⏰</button>`}
          ${ballBtn}
        </div>
      </td>`;
    html += this._renderSubtaskCells(st, days, today, task.color);
    html += '</tr>';
    return html;
  }

  _buildDays() {
    const days = [];
    for (let i = 0; i < this.effectiveDays; i++) {
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

    // READ phase — gather all measurements first
    const measurements = [];
    monthHeads.forEach((th) => {
      const label = th.querySelector('.month-label');
      if (!label) return;
      measurements.push({
        label,
        thLeft: th.offsetLeft,
        thWidth: th.offsetWidth,
        labelW: label.offsetWidth,
      });
    });

    // WRITE phase — apply transforms (no interleaved reads)
    measurements.forEach(({ label, thLeft, thWidth, labelW }) => {
      const thRight = thLeft + thWidth;
      if (thRight <= viewLeft || thLeft >= viewRight) {
        label.style.transform = 'translateX(0)';
        return;
      }
      const visStart = Math.max(thLeft, viewLeft);
      const visEnd = Math.min(thRight, viewRight);
      const visCenterInCell = (visStart + visEnd) / 2 - thLeft;
      let offset = visCenterInCell - labelW / 2;
      const maxOffset = thWidth - labelW;
      if (offset < 0) offset = 0;
      if (offset > maxOffset) offset = Math.max(0, maxOffset);
      label.style.transform = `translateX(${offset}px)`;
    });
  }

  _renderMobileList(tasks) {
    const today = startOfDay(new Date());

    let html = '<div class="mobile-list">';

    tasks.forEach((task) => {
      const allDone = task.subtasks.length > 0 && task.subtasks.every((s) => s.done);
      if (!task.persistent && allDone && !this.showCompleted) return;

      const taskCls = allDone ? 'm-task-name task-done' : 'm-task-name';
      const taskNoteBadge = (task.note && task.note.trim())
        ? '<span class="note-dot" title="Has a note"></span>' : '';

      // task header (label-col + data-task-id so dblclick→note and edit/del work)
      html += `
        <div class="m-task" style="--task-color:${task.color};">
          <div class="label-col ${taskCls}" data-task-id="${task.id}" style="--task-color:${task.color};">
            ${taskNoteBadge}
            <span class="task-title" title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</span>
            <span class="task-btns">
              <button class="task-edit" data-task-id="${task.id}" title="Edit">✎</button>
              <button class="task-del" data-task-id="${task.id}" title="Delete">🗑</button>
            </span>
          </div>`;

      // subtasks (incomplete first, done last)
      const sortedSubs = task.subtasks
        .map((st, si) => ({ st, si }))
        .sort((a, b) => (a.st.done ? 1 : 0) - (b.st.done ? 1 : 0));

      sortedSubs.forEach(({ st, si }) => {
        if (st.done && !this.showCompleted) return;
        html += this._renderMobileSubtask(task, st, si, today);
      });

      html += '</div>'; // .m-task
    });

    html += '</div>';
    this.wrap.innerHTML = html;
  }

  _renderMobileSubtask(task, st, si, today) {
    const dueToday = !st.done && st.due && _isDueToday(st);
    const waiting = st.waiting;

    const rowCls = st.done ? 'm-subtask subtask-done'
      : (waiting ? 'm-subtask subtask-waiting' : 'm-subtask');

    const noteBadge = (st.note && st.note.trim())
      ? '<span class="note-dot" title="Has a note"></span>' : '';

    const clockCls = st.done ? 'sched-btn clock-done'
      : (st.remainingHours > 0 ? 'sched-btn clock-pending' : 'sched-btn clock-full');
    const clockDisabled = st.done ? 'disabled' : '';

    const dueChip = this._mobileDueChip(st, today);

    // paddle shown only when waiting (visual marker)
    const waitMark = waiting ? '<span class="m-wait-mark" title="Waiting">🏓</span>' : '';

    return `
      <div class="${rowCls}" data-task-id="${task.id}" data-sub-index="${si}"
          data-done="${st.done ? '1' : '0'}">
        <div class="label-col m-sub-label" data-task-id="${task.id}" data-sub-index="${si}">
          ${noteBadge}
          ${waitMark}
          <span class="m-sub-name" title="${escapeHtml(st.name)}">${escapeHtml(st.name)}</span>
        </div>
        <div class="m-sub-right">
          ${dueChip}
          ${st.done ? '' : `<button class="${clockCls}" data-task-id="${task.id}"
            data-sub-index="${si}" ${clockDisabled}>⏰</button>`}
        </div>
      </div>`;
  }

  // due-date chip colored by time left
  _mobileDueChip(st, today) {
    if (!st.due) return '<span class="m-due m-due-none">—</span>';

    const due = parseYmd(st.due);
    const msPerDay = 86400000;
    const daysLeft = Math.round((startOfDay(due) - today) / msPerDay);

    let cls, label;
    if (daysLeft < 0) { cls = 'm-due-overdue'; label = `${Math.abs(daysLeft)}d ago`; }
    else if (daysLeft === 0) { cls = 'm-due-overdue'; label = 'Today'; }
    else if (daysLeft <= 3) { cls = 'm-due-soon'; label = `${daysLeft}d`; }
    else if (daysLeft <= 7) { cls = 'm-due-week'; label = `${daysLeft}d`; }
    else { cls = 'm-due-far'; label = this._fmtShortDate(due); }

    if (st.done) cls = 'm-due-done';

    return `<span class="m-due ${cls}">${label}</span>`;
  }

  _fmtShortDate(d) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}