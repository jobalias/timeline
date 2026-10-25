import { DAYS_SHOWN, WINDOW_LOOKBACK } from '../config.js';
import { startOfDay, sameDay, parseYmd, escapeHtml, _isDueToday } from '../utils.js';

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
    this.onToggleWaiting = onToggleWaiting || (() => {});

    this.showCompleted = false;
    this.wrap = document.getElementById('gridWrap');

    this.isMobile = window.innerWidth < 768;
    this.effectiveDays = this.isMobile ? 10 : DAYS_SHOWN;
    const halfWindow = Math.floor(this.effectiveDays / 2);
    this.windowStart = startOfDay(new Date());
    this.windowStart.setDate(this.windowStart.getDate() - halfWindow);

    this._bindEvents();
  }

  // ==================================================================
  //  EVENT BINDING
  // ==================================================================
  _bindEvents() {
    this._bindButtonClicks();
    this._bindDesktopNoteDblClick();
    this._bindMobileNoteTap();
    this._bindMobileSwipe();
    this._bindCheckboxChange();
    this._bindShowCompletedToggles();
    this._bindScroll();
    this._bindResize();
    this._bindWindowNav();
  }

  // ----- Button clicks: edit / delete / schedule / waiting -----
  _bindButtonClicks() {
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

      const ballBtn = e.target.closest('.ball-dot');
      if (ballBtn) {
        this.onToggleWaiting(ballBtn.dataset.taskId, parseInt(ballBtn.dataset.subIndex, 10));
        return;
      }
    });
  }

  // ----- DESKTOP: double-click a row → open note -----
  _bindDesktopNoteDblClick() {
    this.wrap.addEventListener('dblclick', (e) => {
      if (e.target.closest('.done-check') ||
          e.target.closest('.sched-btn') ||
          e.target.closest('.task-edit') ||
          e.target.closest('.task-del') ||
          e.target.closest('.ball-dot')) {
        return;
      }

      const labelCol = e.target.closest('.label-col');
      if (!labelCol) return;

      // subtask row has a checkbox carrying the ids
      const check = labelCol.querySelector('.done-check');
      if (check) {
        this.onOpenSubtaskNote(check.dataset.taskId, parseInt(check.dataset.subIndex, 10));
        return;
      }

      // task row: .label-col with data-task-id, no checkbox
      const taskId = labelCol.dataset.taskId;
      if (taskId) this.onOpenTaskNote(taskId);
    });
  }

  // ----- MOBILE: single-tap a row → open note -----
  _bindMobileNoteTap() {
    this.wrap.addEventListener('click', (e) => {
      if (!this.isMobile) return;

      // ignore interactive controls
      if (e.target.closest('.sched-btn') ||
          e.target.closest('.task-edit') ||
          e.target.closest('.task-del')) {
        return;
      }

      // subtask row? (whole .m-subtask row carries the ids)
      const subRow = e.target.closest('.m-subtask');
      if (subRow && subRow.dataset.subIndex !== undefined) {
        this.onOpenSubtaskNote(subRow.dataset.taskId, parseInt(subRow.dataset.subIndex, 10));
        return;
      }

      // task header? (.m-task-name specifically → unambiguous)
      const taskHeader = e.target.closest('.m-task-name');
      if (taskHeader && taskHeader.dataset.taskId) {
        this.onOpenTaskNote(taskHeader.dataset.taskId);
      }
    });
  }

  // ----- MOBILE: swipe gestures on subtask rows -----
  //  swipe right → toggle complete;  swipe left → toggle waiting;  tap → note
  _bindMobileSwipe() {
    this._swipe = null;
    const SWIPE_THRESHOLD = 60;    // px horizontal travel to trigger
    const SWIPE_MAX_OFF_AXIS = 30; // max vertical drift to still count as horizontal
    const REVEAL_AT = 15;          // px before the colored reveal shows

    this.wrap.addEventListener('touchstart', (e) => {
      if (!this.isMobile) return;
      const row = e.target.closest('.m-subtask');
      if (!row) { this._swipe = null; return; }
      if (e.target.closest('.sched-btn')) { this._swipe = null; return; } // don't swipe on the clock

      const t = e.touches[0];
      this._swipe = {
        row,
        startX: t.clientX,
        startY: t.clientY,
        taskId: row.dataset.taskId,
        subIndex: parseInt(row.dataset.subIndex, 10),
        done: row.dataset.done === '1',
      };
    }, { passive: true });

    this.wrap.addEventListener('touchmove', (e) => {
      if (!this._swipe) return;
      const t = e.touches[0];
      const dx = t.clientX - this._swipe.startX;
      const dy = t.clientY - this._swipe.startY;

      // vertical-dominant → it's a scroll, abandon the swipe
      if (Math.abs(dy) > SWIPE_MAX_OFF_AXIS && Math.abs(dy) > Math.abs(dx)) {
        this._resetSwipeRow(this._swipe.row);
        this._swipe = null;
        return;
      }

      // horizontal-dominant → follow the finger + reveal the action color
      if (Math.abs(dx) > Math.abs(dy)) {
        const row = this._swipe.row;
        row.style.transform = `translateX(${Math.max(-80, Math.min(80, dx))}px)`;

        if (dx > REVEAL_AT) {
          row.classList.add('swiping-right');
          row.classList.remove('swiping-left');
        } else if (dx < -REVEAL_AT) {
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

      // snap back + clear reveal
      s.row.style.transition = 'transform 0.15s ease';
      this._resetSwipeRow(s.row);
      setTimeout(() => { s.row.style.transition = ''; }, 160);

      const t = (e.changedTouches && e.changedTouches[0]) || null;
      if (!t) return;
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;

      if (Math.abs(dx) < SWIPE_THRESHOLD) return;  // too small → tap (note opens via click)
      if (Math.abs(dy) > Math.abs(dx)) return;     // too vertical → ignore

      if (dx > 0) {
        this.onToggleDone(s.taskId, s.subIndex, !s.done);  // swipe right → toggle complete
      } else {
        this.onToggleWaiting(s.taskId, s.subIndex);         // swipe left → toggle waiting
      }
    }, { passive: true });
  }

  _resetSwipeRow(row) {
    row.style.transform = '';
    row.classList.remove('swiping-left', 'swiping-right');
  }

  // ----- Checkbox change (desktop complete/un-complete) -----
  _bindCheckboxChange() {
    this.wrap.addEventListener('change', (e) => {
      const cb = e.target.closest('.done-check');
      if (cb) {
        this.onToggleDone(cb.dataset.taskId, parseInt(cb.dataset.subIndex, 10), cb.checked);
      }
    });
  }

  // ----- Show completed toggles (grid header + settings modal) -----
  _bindShowCompletedToggles() {
    const showCb = document.getElementById('showCompleted');
    if (showCb) {
      showCb.addEventListener('change', () => {
        this.showCompleted = showCb.checked;
        this._syncShowCompletedControls();
        this.render();
      });
    }

    const showSetting = document.getElementById('showCompletedSetting');
    if (showSetting) {
      showSetting.addEventListener('change', () => {
        this.showCompleted = showSetting.checked;
        this._syncShowCompletedControls();
        this.render();
      });
    }
  }

  _syncShowCompletedControls() {
    const a = document.getElementById('showCompleted');
    const b = document.getElementById('showCompletedSetting');
    if (a) a.checked = this.showCompleted;
    if (b) b.checked = this.showCompleted;
  }

  // ----- Sticky month labels on horizontal scroll -----
  _bindScroll() {
    let scheduled = false;
    this.wrap.addEventListener('scroll', () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        this._updateStickyMonths();
        scheduled = false;
      });
    }, { passive: true });
  }

  // ----- Re-render when crossing the mobile breakpoint -----
  _bindResize() {
    window.addEventListener('resize', () => {
      const nowMobile = window.innerWidth < 768;
      if (nowMobile !== this.isMobile) {
        this.isMobile = nowMobile;
        this.render();
      }
    });
  }

  // ----- Grid window navigation (prev / next / today) -----
  _bindWindowNav() {
    const prevBtn = document.getElementById('gridPrev');
    const nextBtn = document.getElementById('gridNext');
    const todayBtn = document.getElementById('gridToday');

    if (prevBtn) prevBtn.addEventListener('click', () => this._shiftWindow(-7));
    if (nextBtn) nextBtn.addEventListener('click', () => this._shiftWindow(7));
    if (todayBtn) todayBtn.addEventListener('click', () => this._goToday());
  }

  // ==================================================================
  //  WINDOW NAVIGATION
  // ==================================================================
  _shiftWindow(days) {
    this.windowStart.setDate(this.windowStart.getDate() + days);
    this.render();
    this.wrap.scrollLeft = 0;
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
    const dayW = todayHead.offsetWidth;
    const target = todayHead.offsetLeft - labelW - (dayW * 2);

    this.wrap.scrollLeft = Math.max(0, target);
    requestAnimationFrame(() => this._updateStickyMonths());
  }

  onShow() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this._scrollToToday());
    });
  }

  // ==================================================================
  //  RENDER (entry point)
  // ==================================================================
  render() {
    const tasks = this.store.getSorted();
    if (tasks.length === 0) {
      this.wrap.innerHTML =
        '<div class="empty">No tasks yet. Click “+ Add Task” to start.</div>';
      return;
    }

    if (this.isMobile) {
      this._renderMobileList(tasks);
      return;
    }

    this._renderDesktopGrid(tasks);
  }

  // ==================================================================
  //  DESKTOP GRID RENDER
  // ==================================================================
  _renderDesktopGrid(tasks) {
    const days = this._buildDays();
    const today = startOfDay(new Date());
    const dow = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    // ----- Month header row (spans consecutive same-month days) -----
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
        ? '<span class="note-dot" title="Has a note"></span>' : '';

      html += `<tr class="task-tr" style="--task-color:${task.color};">
                 <td class="label-col ${taskCls}" data-task-id="${task.id}" style="--task-color:${task.color};">
                   ${taskNoteBadge}
                   <span class="task-title" title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</span>
                   <span class="task-btns">
                     <button class="task-edit" data-task-id="${task.id}" title="Edit">✎</button>
                     <button class="task-del" data-task-id="${task.id}" title="Delete">🗑</button>
                   </span>
                 </td>`;
      days.forEach(() => (html += '<td class="cell"></td>'));
      html += '</tr>';

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
    const dueToday = !st.done && st.due && _isDueToday(st);
    const waiting = st.waiting;

    const rowCls = st.done ? 'subtask-name subtask-done'
      : (dueToday ? 'subtask-name due-today' : 'subtask-name')
      + (waiting ? ' subtask-waiting' : '');

    const clockCls = st.done ? 'sched-btn clock-done'
      : (st.remainingHours > 0 ? 'sched-btn clock-pending' : 'sched-btn clock-full');
    const clockDisabled = st.done ? 'disabled' : '';

    const dueBadge = `<span class="due-today-badge">${dueToday ? '⚠️' : ''}</span>`;
    const noteBadge = (st.note && st.note.trim())
      ? '<span class="note-dot" title="Has a note"></span>' : '';

    const ballBtn = `<button class="ball-dot" data-task-id="${task.id}" data-sub-index="${si}"
      title="${waiting ? 'Ball in their court — click to restore' : 'Waiting on someone? Click to minimize'}">
      ${waiting ? '🏓' : '🏐'}</button>`;

    let html = `<tr class="subtask-tr" style="--task-color:${task.color};">
        <td class="label-col ${rowCls}">
          ${noteBadge}
          <div class="st-row">
            ${waiting ? '' : `<input type="checkbox" class="done-check"
              data-task-id="${task.id}" data-sub-index="${si}" ${st.done ? 'checked' : ''}>`}
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
        content = '<div class="square"></div>';
      } else if (dayHours > 0) {
        const clr = st.done ? 'var(--muted)' : color;
        content = `<span class="hours-centered" style="color:${clr};">${dayHours}h</span>`;
      }

      html += `<td class="${cls}">${content}</td>`;
    });
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

  // ----- Sticky, centered month labels on horizontal scroll -----
  _updateStickyMonths() {
    const scrollLeft = this.wrap.scrollLeft;
    const wrapWidth = this.wrap.clientWidth;
    const labelCol = this.wrap.querySelector('.label-col');
    const labelWidth = labelCol ? labelCol.offsetWidth : 0;
    const viewLeft = scrollLeft + labelWidth;
    const viewRight = scrollLeft + wrapWidth;

    const monthHeads = this.wrap.querySelectorAll('.month-head');

    // READ phase
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

    // WRITE phase
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

  // ==================================================================
  //  MOBILE LIST RENDER
  // ==================================================================
  _renderMobileList(tasks) {
    const today = startOfDay(new Date());
    let html = '<div class="mobile-list">';

    tasks.forEach((task) => {
      const allDone = task.subtasks.length > 0 && task.subtasks.every((s) => s.done);
      if (!task.persistent && allDone && !this.showCompleted) return;

      const taskCls = allDone ? 'm-task-name task-done' : 'm-task-name';
      const taskNoteBadge = (task.note && task.note.trim())
        ? '<span class="note-dot" title="Has a note"></span>' : '';

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
    const waiting = st.waiting;
    const rowCls = st.done ? 'm-subtask subtask-done'
      : (waiting ? 'm-subtask subtask-waiting' : 'm-subtask');

    const noteBadge = (st.note && st.note.trim())
      ? '<span class="note-dot" title="Has a note"></span>' : '';

    const clockCls = st.done ? 'sched-btn clock-done'
      : (st.remainingHours > 0 ? 'sched-btn clock-pending' : 'sched-btn clock-full');
    const clockDisabled = st.done ? 'disabled' : '';

    const dueChip = this._mobileDueChip(st, today);
    const waitMark = waiting ? '<span class="m-wait-mark" title="Waiting">🏓</span>' : '';

    return `
      <div class="${rowCls}" data-task-id="${task.id}" data-sub-index="${si}" data-done="${st.done ? '1' : '0'}">
        <div class="label-col m-sub-label">
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
    const daysLeft = Math.round((startOfDay(due) - today) / 86400000);

    let cls, label;
    if (daysLeft < 0)        { cls = 'm-due-overdue'; label = `${Math.abs(daysLeft)}d ago`; }
    else if (daysLeft === 0) { cls = 'm-due-overdue'; label = 'Today'; }
    else if (daysLeft <= 3)  { cls = 'm-due-soon';    label = `${daysLeft}d`; }
    else if (daysLeft <= 7)  { cls = 'm-due-week';    label = `${daysLeft}d`; }
    else                     { cls = 'm-due-far';     label = this._fmtShortDate(due); }

    if (st.done) cls = 'm-due-done';

    return `<span class="m-due ${cls}">${label}</span>`;
  }

  _fmtShortDate(d) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}