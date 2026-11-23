import { DAYS_SHOWN } from '../config.js';
import { startOfDay, sameDay, parseYmd, fmtShortDate } from '../core/dates.js';
import { escapeHtml, _isDueToday } from '../utils.js';

const MOBILE_BREAKPOINT = 768;   // same as the phone breakpoint in css/grid.css
const MOBILE_DAYS_SHOWN = 10;
const DAY_MS = 86400000;

const DOW_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Clicks on these never open a note
const CONTROL_SELECTOR = '.done-check, .sched-btn, .task-edit, .task-del, .ball-dot';

const SWIPE = {
  threshold: 60,       // px of horizontal travel that commits the action
  maxOffAxis: 30,      // vertical px that cancels the swipe (it's a scroll)
  maxSlide: 80,        // max px the row slides
  fullStrengthAt: 80,  // px of drag where overlay/icon reach full opacity
  snapBackMs: 200,
};

const HOURS_FILTER_KEY = 'hoursFilterX';
const NOTE_BADGE = '<span class="note-dot" title="Has a note"></span>';

const isMobileWidth = () => window.innerWidth <= MOBILE_BREAKPOINT;
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const hasNote = (item) => Boolean(item.note && item.note.trim());
const subIndexOf = (el) => parseInt(el.dataset.subIndex, 10);

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
    this.hoursFilter = null;   // "⏱ Under X h" threshold; null = off
    this.wrap = document.getElementById('gridWrap');

    this.isMobile = isMobileWidth();
    this.effectiveDays = this.isMobile ? MOBILE_DAYS_SHOWN : DAYS_SHOWN;
    this.windowStart = this._todayWindowStart();

    this._bindEvents();
  }

  // ----- Public API -----

  onShow() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this._scrollToToday());
    });
  }

  render() {
    const tasks = this.store.getSorted();
    this._updateHoursCount(tasks);

    if (tasks.length === 0) {
      this.wrap.innerHTML =
        '<div class="empty">No tasks yet. Click “+ Add Task” to start.</div>';
      return;
    }

    if (this.isMobile) this._renderMobileList(tasks);
    else this._renderDesktopGrid(tasks);
  }

  // ----- Window navigation -----

  _todayWindowStart() {
    const start = startOfDay(new Date());
    start.setDate(start.getDate() - Math.floor(this.effectiveDays / 2));
    return start;
  }

  _shiftWindow(days) {
    this.windowStart.setDate(this.windowStart.getDate() + days);
    this.render();
    this.wrap.scrollLeft = 0;
  }

  _goToday() {
    this.windowStart = this._todayWindowStart();
    this.render();
    requestAnimationFrame(() => this._scrollToToday());
  }

  _scrollToToday() {
    const todayHead = this.wrap.querySelector('.day-head.today');
    if (!todayHead) return;

    const target = todayHead.offsetLeft - this._labelColWidth() - todayHead.offsetWidth * 2;
    this.wrap.scrollLeft = Math.max(0, target);
    requestAnimationFrame(() => this._updateStickyMonths());
  }

  _buildDays() {
    return Array.from({ length: this.effectiveDays }, (_, i) => {
      const d = new Date(this.windowStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }

  // ----- Event binding -----

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
    this._bindHoursFilter();
  }

  _bindButtonClicks() {
    this.wrap.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.task-edit');
      if (editBtn) return this.onEditTask(editBtn.dataset.taskId);

      const delBtn = e.target.closest('.task-del');
      if (delBtn) return this.onDeleteTask(delBtn.dataset.taskId);

      const schedBtn = e.target.closest('.sched-btn');
      if (schedBtn && !schedBtn.disabled) {
        return this.onSchedule(schedBtn.dataset.taskId, subIndexOf(schedBtn));
      }

      const ballBtn = e.target.closest('.ball-dot');
      if (ballBtn) this.onToggleWaiting(ballBtn.dataset.taskId, subIndexOf(ballBtn));
    });
  }

  _bindDesktopNoteDblClick() {
    this.wrap.addEventListener('dblclick', (e) => {
      if (e.target.closest(CONTROL_SELECTOR)) return;

      const labelCol = e.target.closest('.label-col');
      if (!labelCol) return;

      // subtask rows carry their ids on the checkbox; task rows on the cell itself
      const check = labelCol.querySelector('.done-check');
      if (check) {
        this.onOpenSubtaskNote(check.dataset.taskId, subIndexOf(check));
      } else if (labelCol.dataset.taskId) {
        this.onOpenTaskNote(labelCol.dataset.taskId);
      }
    });
  }

  _bindMobileNoteTap() {
    this.wrap.addEventListener('click', (e) => {
      if (!this.isMobile || e.target.closest(CONTROL_SELECTOR)) return;

      const subRow = e.target.closest('.m-subtask');
      if (subRow && subRow.dataset.subIndex !== undefined) {
        this.onOpenSubtaskNote(subRow.dataset.taskId, subIndexOf(subRow));
        return;
      }

      const taskHeader = e.target.closest('.m-task-name');
      if (taskHeader && taskHeader.dataset.taskId) {
        this.onOpenTaskNote(taskHeader.dataset.taskId);
      }
    });
  }

  // Subtask rows: swipe right → toggle complete, swipe left → toggle waiting
  _bindMobileSwipe() {
    this._swipe = null;

    this.wrap.addEventListener('touchstart', (e) => {
      if (!this.isMobile) return;
      const row = e.target.closest('.m-subtask');
      if (!row || e.target.closest('.sched-btn')) { this._swipe = null; return; }

      const touch = e.touches[0];
      this._swipe = {
        row,
        startX: touch.clientX,
        startY: touch.clientY,
        taskId: row.dataset.taskId,
        subIndex: subIndexOf(row),
        done: row.dataset.done === '1',
      };
    }, { passive: true });

    this.wrap.addEventListener('touchmove', (e) => {
      if (!this._swipe) return;
      const touch = e.touches[0];
      const dx = touch.clientX - this._swipe.startX;
      const dy = touch.clientY - this._swipe.startY;
      const row = this._swipe.row;

      if (Math.abs(dy) > SWIPE.maxOffAxis && Math.abs(dy) > Math.abs(dx)) {
        this._resetSwipeRow(row);
        this._swipe = null;
        return;
      }
      if (Math.abs(dx) <= Math.abs(dy)) return;

      const strength = Math.min(1, Math.abs(dx) / SWIPE.fullStrengthAt);
      const slide = Math.max(-SWIPE.maxSlide, Math.min(SWIPE.maxSlide, dx));

      row.classList.toggle('swiping-right', dx > 0);
      row.classList.toggle('swiping-left', dx < 0);
      row.style.setProperty('--swipe-x', `${slide}px`);
      row.style.setProperty('--swipe-strength', strength.toFixed(3));
    }, { passive: true });

    this.wrap.addEventListener('touchend', (e) => {
      const swipe = this._swipe;
      this._swipe = null;
      if (!swipe) return;

      this._resetSwipeRow(swipe.row);

      const touch = e.changedTouches && e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - swipe.startX;
      const dy = touch.clientY - swipe.startY;
      if (Math.abs(dx) < SWIPE.threshold || Math.abs(dy) > Math.abs(dx)) return;

      if (dx > 0) this.onToggleDone(swipe.taskId, swipe.subIndex, !swipe.done);
      else this.onToggleWaiting(swipe.taskId, swipe.subIndex);
    }, { passive: true });
  }

  _resetSwipeRow(row) {
    row.classList.add('swipe-animating');   // enables the snap-back transition
    row.style.setProperty('--swipe-x', '0px');
    row.style.setProperty('--swipe-strength', '0');
    setTimeout(() => {
      row.classList.remove('swiping-left', 'swiping-right', 'swipe-animating');
      row.style.removeProperty('--swipe-x');
      row.style.removeProperty('--swipe-strength');
    }, SWIPE.snapBackMs);
  }

  _bindCheckboxChange() {
    this.wrap.addEventListener('change', (e) => {
      const cb = e.target.closest('.done-check');
      if (cb) this.onToggleDone(cb.dataset.taskId, subIndexOf(cb), cb.checked);
    });
  }

  // Grid header checkbox and settings-modal checkbox stay in sync
  _bindShowCompletedToggles() {
    ['showCompleted', 'showCompletedSetting'].forEach((id) => {
      const checkbox = document.getElementById(id);
      checkbox?.addEventListener('change', () => {
        this.showCompleted = checkbox.checked;
        this._syncShowCompletedControls();
        this.render();
      });
    });
  }

  _syncShowCompletedControls() {
    ['showCompleted', 'showCompletedSetting'].forEach((id) => {
      const checkbox = document.getElementById(id);
      if (checkbox) checkbox.checked = this.showCompleted;
    });
  }

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

  _bindResize() {
    window.addEventListener('resize', () => {
      const nowMobile = isMobileWidth();
      if (nowMobile === this.isMobile) return;
      this.isMobile = nowMobile;
      this.render();
    });
  }

  _bindWindowNav() {
    document.getElementById('gridPrev')?.addEventListener('click', () => this._shiftWindow(-7));
    document.getElementById('gridNext')?.addEventListener('click', () => this._shiftWindow(7));
    document.getElementById('gridToday')?.addEventListener('click', () => this._goToday());
  }

  // ----- "⏱ Under X h" filter: highlights subtasks with a small estimate -----

  _bindHoursFilter() {
    const box = document.getElementById('hoursFilter');
    if (!box) return;
    const input = document.getElementById('hoursFilterInput');
    const toggle = document.getElementById('hoursFilterToggle');
    const clear = document.getElementById('hoursFilterClear');

    try {
      const saved = localStorage.getItem(HOURS_FILTER_KEY);
      if (saved) input.value = saved;
    } catch { /* storage unavailable */ }

    const turnOn = () => {
      const x = parseFloat(input.value);
      this.hoursFilter = Number.isFinite(x) && x > 0 ? x : null;
      box.classList.toggle('on', this.hoursFilter !== null);
      try { if (input.value) localStorage.setItem(HOURS_FILTER_KEY, input.value); } catch {}
      this.render();
    };

    const turnOff = () => {
      this.hoursFilter = null;
      box.classList.remove('on');
      this.render();
    };

    input.addEventListener('input', turnOn);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.blur(); turnOff(); }
      if (e.key === 'Enter') input.blur();
    });
    toggle.addEventListener('click', () => {
      if (this.hoursFilter !== null) turnOff();           // keeps the number for next time
      else if (parseFloat(input.value) > 0) turnOn();
      else input.focus();                                 // no number yet → type one
    });
    clear.addEventListener('click', turnOff);
  }

  _matchesHours(st) {
    const x = this.hoursFilter;
    return x !== null && !st.done && st.estHoursNum > 0 && st.estHoursNum < x;
  }

  _hasHoursMatch(task) {
    return task.subtasks.some((st) => this._matchesHours(st));
  }

  _updateHoursCount(tasks) {
    const el = document.getElementById('hoursFilterCount');
    if (!el) return;

    this.wrap.classList.toggle('hf-on', this.hoursFilter !== null);
    if (this.hoursFilter === null) { el.textContent = ''; return; }

    const n = tasks.reduce((sum, t) => sum + t.subtasks.filter((st) => this._matchesHours(st)).length, 0);
    el.textContent = String(n);
    el.title = `${n} subtask${n === 1 ? '' : 's'} under ${this.hoursFilter}h`;
  }

  // ----- Desktop grid -----

  _renderDesktopGrid(tasks) {
    const days = this._buildDays();
    const today = startOfDay(new Date());

    let html = '<table><thead>'
      + this._renderMonthRow(days)
      + this._renderDayHeadRow(days, today)
      + '</thead><tbody>';

    this._visibleTasks(tasks).forEach((task) => {
      html += this._renderTaskRow(task, days);
      this._visibleSubtasks(task).forEach(({ st, si }) => {
        html += this._renderSubtaskRow(task, st, si, days, today);
      });
    });

    html += '</tbody></table>';
    this.wrap.innerHTML = html;
    this._updateStickyMonths();
  }

  // One header cell per run of consecutive same-month days
  _renderMonthRow(days) {
    let html = '<tr><th class="label-col month-corner"></th>';
    let i = 0;
    while (i < days.length) {
      const month = days[i].getMonth();
      const year = days[i].getFullYear();
      let span = 1;
      while (i + span < days.length &&
             days[i + span].getMonth() === month &&
             days[i + span].getFullYear() === year) {
        span++;
      }
      html += `<th class="month-head" colspan="${span}">
                 <span class="month-label">${MONTH_NAMES[month]} ${year}</span>
               </th>`;
      i += span;
    }
    return html + '</tr>';
  }

  _renderDayHeadRow(days, today) {
    let html = '<tr><th class="label-col">Task / Subtask</th>';
    days.forEach((d) => {
      const wknd = isWeekend(d) ? 'weekend' : '';
      const isToday = sameDay(d, today) ? 'today' : '';
      html += `<th class="day-head ${wknd} ${isToday}">
                 <span class="dow">${DOW_SHORT[d.getDay()]}</span>${d.getDate()}
               </th>`;
    });
    return html + '</tr>';
  }

  _renderTaskRow(task, days) {
    const hfTask = this._hasHoursMatch(task) ? ' hf-has-match' : '';
    return `<tr class="task-tr${hfTask}" style="--task-color:${task.color};">
              ${this._renderTaskLabel('td', 'task-name', task)}
              ${'<td class="cell"></td>'.repeat(days.length)}</tr>`;
  }

  _renderSubtaskRow(task, st, si, days, today) {
    const dueToday = !st.done && st.due && _isDueToday(st);
    const waiting = st.waiting;

    const rowCls = st.done
      ? 'subtask-name subtask-done'
      : (dueToday ? 'subtask-name due-today' : 'subtask-name') + (waiting ? ' subtask-waiting' : '');

    // A waiting subtask swaps the checkbox for a spacer and shows 🏓 where ⏰ would be,
    // with a trailing spacer so 🏓 lines up with the clocks above and below it
    const leadSlot = waiting
      ? '<span class="check-spacer"></span>'
      : `<input type="checkbox" class="done-check"
           data-task-id="${task.id}" data-sub-index="${si}" ${st.done ? 'checked' : ''}>`;

    const clockSlot = waiting
      ? `<button class="ball-dot ball-waiting" data-task-id="${task.id}"
           data-sub-index="${si}" title="Ball in their court — click to restore">🏓</button>`
      : this._renderClockButton(task, st, si);

    const trailSlot = waiting
      ? '<span class="ball-spacer"></span>'
      : `<button class="ball-dot" data-task-id="${task.id}" data-sub-index="${si}"
           title="Waiting on someone? Click to minimize">🏐</button>`;

    const hf = this._matchesHours(st);
    return `<tr class="subtask-tr${hf ? ' hf-match' : ''}" style="--task-color:${task.color};">
      <td class="label-col ${rowCls}">
        ${hasNote(st) ? NOTE_BADGE : ''}
        <div class="st-row">
          <span class="st-lead">${leadSlot}</span>
          <span class="st-name" title="${escapeHtml(st.name)}">${escapeHtml(st.name)}</span>
          ${hf ? `<span class="hf-chip" title="Estimated ${st.estHoursNum}h">${st.estHoursNum}h</span>` : ''}
          <span class="st-controls">
            <span class="due-today-badge">${!waiting && dueToday ? '⚠️' : ''}</span>
            ${clockSlot}
            ${trailSlot}
          </span>
        </div>
      </td>${this._renderSubtaskCells(st, days, today, task.color)}</tr>`;
  }

  _renderSubtaskCells(st, days, today, color) {
    const dueDate = parseYmd(st.due);

    return days.map((d) => {
      const isDue = dueDate && sameDay(d, dueDate);
      let cls = 'cell';
      if (isWeekend(d)) cls += ' weekend';
      if (sameDay(d, today)) cls += ' today';
      if (isDue) cls += ' due';
      if (st.done) cls += ' cell-done';

      const dayHours = st.blocks
        .filter((b) => sameDay(parseYmd(b.date), d))
        .reduce((sum, b) => sum + b.hoursNum, 0);

      let content = '';
      if (isDue) {
        content = '<div class="square"></div>';
      } else if (dayHours > 0) {
        const textColor = st.done ? 'var(--muted)' : color;
        content = `<span class="hours-centered" style="color:${textColor};">${dayHours}h</span>`;
      }
      return `<td class="${cls}">${content}</td>`;
    }).join('');
  }

  // Keeps each month label centered in the visible part of its header cell
  _updateStickyMonths() {
    const scrollLeft = this.wrap.scrollLeft;
    const viewLeft = scrollLeft + this._labelColWidth();
    const viewRight = scrollLeft + this.wrap.clientWidth;

    // Measure everything before writing any transform to avoid layout thrashing
    const measurements = [];
    this.wrap.querySelectorAll('.month-head').forEach((th) => {
      const label = th.querySelector('.month-label');
      if (!label) return;
      measurements.push({
        label,
        thLeft: th.offsetLeft,
        thWidth: th.offsetWidth,
        labelW: label.offsetWidth,
      });
    });

    measurements.forEach(({ label, thLeft, thWidth, labelW }) => {
      const thRight = thLeft + thWidth;
      if (thRight <= viewLeft || thLeft >= viewRight) {
        label.style.transform = 'translateX(0)';
        return;
      }
      const visibleCenter = (Math.max(thLeft, viewLeft) + Math.min(thRight, viewRight)) / 2 - thLeft;
      const offset = Math.max(0, Math.min(visibleCenter - labelW / 2, thWidth - labelW));
      label.style.transform = `translateX(${offset}px)`;
    });
  }

  _labelColWidth() {
    const labelCol = this.wrap.querySelector('.label-col');
    return labelCol ? labelCol.offsetWidth : 0;
  }

  // ----- Mobile list -----

  _renderMobileList(tasks) {
    const today = startOfDay(new Date());
    let html = '<div class="mobile-list">';

    this._visibleTasks(tasks).forEach((task) => {
      const hfTask = this._hasHoursMatch(task) ? ' hf-has-match' : '';
      html += `
        <div class="m-task${hfTask}" style="--task-color:${task.color};">
          ${this._renderTaskLabel('div', 'm-task-name', task)}`;

      this._visibleSubtasks(task).forEach(({ st, si }) => {
        html += this._renderMobileSubtask(task, st, si, today);
      });

      html += '</div>';
    });

    html += '</div>';
    this.wrap.innerHTML = html;
  }

  _renderMobileSubtask(task, st, si, today) {
    const waiting = st.waiting;
    const hf = this._matchesHours(st);

    let rowCls = 'm-subtask';
    if (st.done) rowCls += ' subtask-done';
    else if (waiting) rowCls += ' subtask-waiting';
    if (hf) rowCls += ' hf-match';

    // Mouse/trackpad users (e.g. a narrow laptop window) can't swipe, so they get a
    // checkbox and a 🏐/🏓 button. CSS hides these on touch screens, where swipe works.
    const check = `<input type="checkbox" class="done-check m-click-only"
        data-task-id="${task.id}" data-sub-index="${si}" ${st.done ? 'checked' : ''}
        title="${st.done ? 'Mark not done' : 'Mark done'}" aria-label="Done">`;
    const ball = st.done ? '' : `<button class="ball-dot m-click-only${waiting ? ' ball-waiting' : ''}"
        data-task-id="${task.id}" data-sub-index="${si}"
        title="${waiting ? 'Ball in their court — click to restore' : 'Waiting on someone? Click to minimize'}">${waiting ? '🏓' : '🏐'}</button>`;

    return `
      <div class="${rowCls}" data-task-id="${task.id}" data-sub-index="${si}" data-done="${st.done ? '1' : '0'}" data-waiting="${waiting ? '1' : '0'}">
        <div class="label-col m-sub-label">
          ${check}
          ${hasNote(st) ? NOTE_BADGE : ''}
          ${waiting ? '<span class="m-wait-mark" title="Waiting">🏓</span>' : ''}
          <span class="m-sub-name" title="${escapeHtml(st.name)}">${escapeHtml(st.name)}</span>
          ${hf ? `<span class="hf-chip">${st.estHoursNum}h</span>` : ''}
        </div>
        <div class="m-sub-right">
          ${this._renderMobileDueChip(st, today)}
          ${st.done ? '' : this._renderClockButton(task, st, si)}
          ${ball}
        </div>
      </div>`;
  }

  // Due-date chip colored by how much time is left
  _renderMobileDueChip(st, today) {
    if (!st.due) return '<span class="m-due m-due-none">—</span>';

    const due = parseYmd(st.due);
    const daysLeft = Math.round((startOfDay(due) - today) / DAY_MS);

    let cls, label;
    if (daysLeft < 0)        { cls = 'm-due-overdue'; label = `${Math.abs(daysLeft)}d ago`; }
    else if (daysLeft === 0) { cls = 'm-due-overdue'; label = 'Today'; }
    else if (daysLeft <= 3)  { cls = 'm-due-soon';    label = `${daysLeft}d`; }
    else if (daysLeft <= 7)  { cls = 'm-due-week';    label = `${daysLeft}d`; }
    else                     { cls = 'm-due-far';     label = fmtShortDate(due); }

    if (st.done) cls = 'm-due-done';
    return `<span class="m-due ${cls}">${label}</span>`;
  }

  // ----- Shared rendering helpers -----

  _isTaskDone(task) {
    return task.subtasks.length > 0 && task.subtasks.every((st) => st.done);
  }

  _visibleTasks(tasks) {
    return tasks.filter((task) =>
      task.persistent || this.showCompleted || !this._isTaskDone(task));
  }

  // Open subtasks first, keeping each one's original index for data attributes
  _visibleSubtasks(task) {
    return task.subtasks
      .map((st, si) => ({ st, si }))
      .sort((a, b) => (a.st.done ? 1 : 0) - (b.st.done ? 1 : 0))
      .filter(({ st }) => !st.done || this.showCompleted);
  }

  _renderTaskLabel(tag, nameCls, task) {
    const cls = this._isTaskDone(task) ? `${nameCls} task-done` : nameCls;
    return `<${tag} class="label-col ${cls}" data-task-id="${task.id}" style="--task-color:${task.color};">
              ${hasNote(task) ? NOTE_BADGE : ''}
              <span class="task-title" title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</span>
              <span class="task-btns">
                <button class="task-edit" data-task-id="${task.id}" title="Edit">✎</button>
                <button class="task-del" data-task-id="${task.id}" title="Delete">🗑</button>
              </span>
            </${tag}>`;
  }

  _renderClockButton(task, st, si) {
    let cls = 'sched-btn clock-full';
    if (st.done) cls = 'sched-btn clock-done';
    else if (st.remainingHours > 0) cls = 'sched-btn clock-pending';

    return `<button class="${cls}" data-task-id="${task.id}"
           data-sub-index="${si}" ${st.done ? 'disabled' : ''}>⏰</button>`;
  }
}
