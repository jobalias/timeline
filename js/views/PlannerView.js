import { startOfDay, sameDay, _isDueToday } from '../utils.js';
import { TimeBlock } from '../models/Subtask.js';

export class PlannerView {
  constructor(store, googleCalendar, settings) {
    this.store = store;
    this.gcal = googleCalendar;
    this.settings = settings;
    this.isMobile = window.innerWidth < 768;
    this.isActive = false;
    this.calendar = null;
    this.selectedSubtask = null; // { taskId, subIndex }
    this.selectedBlockEl = null; // currently clicked block DOM (for delete ✕)
    this.hideScheduled = false;
    this._navBlockIndex = -1;
    const hideCb = document.getElementById('hideScheduled');
    if (hideCb) {
      hideCb.addEventListener('change', () => {
        this.hideScheduled = hideCb.checked;
        this._renderBacklog();
      });
    }

    this.container = document.getElementById('plannerViewContainer');
    this.calendarEl = document.getElementById('plannerCalendar');
    this.backlogEl = document.getElementById('backlogCards');

    // keyboard delete
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this._clickedBlock) {
        this._deleteClickedBlock();
      }
    });

    window.addEventListener('resize', () => {
      const nowMobile = window.innerWidth < 768;
      if (nowMobile !== this.isMobile) {
        this.isMobile = nowMobile;
        // rebuild the calendar with the right config
        if (this.calendar) { this.calendar.destroy(); this.calendar = null; }
        if (this.isActive) { this._initCalendar(); this.render(); }
        this._applyMobilePlannerUI();   // (added in Piece 2)
      }
    });
  }

  activate() {
  this.isActive = true;
  if (!this.calendar) this._initCalendar();
  else { this.calendar.updateSize(); this.calendar.refetchEvents(); }
  this._bindMobileMenu();        
  this._applyMobilePlannerUI(); 
  this.render();
}

  deactivate() { this.isActive = false; }

  refresh() {
    if (this.isActive && this.calendar) {
      // small delay ensures store mutation is complete before refetch
      setTimeout(() => {
        this.calendar.refetchEvents();
      }, 0);
      this._renderBacklog();
      this._updateCounter();
    }
  }

  // Check if a given date matches the selected subtask's due date
  _isDueDate(date) {
    if (!this.selectedSubtask) return false;
    const task = this.store.find(this.selectedSubtask.taskId);
    const st = task?.subtasks[this.selectedSubtask.subIndex];
    if (!st || !st.due) return false;

    // compare year/month/day (local)
    const due = new Date(st.due + 'T00:00:00');
    return date.getFullYear() === due.getFullYear() &&
           date.getMonth() === due.getMonth() &&
           date.getDate() === due.getDate();
  }

  _getSortedBlocks(st) {
    return st.blocks
      .filter((b) => b.date && b.start)
      .map((b) => ({
        block: b,
        time: this._blockStart(b).getTime(),
      }))
      .sort((a, b) => a.time - b.time);
  }

  _highlightDueColumn() {
    // clear any existing highlight
    this.calendarEl.querySelectorAll('.due-date-column, .due-date-header')
      .forEach((el) => el.classList.remove('due-date-column', 'due-date-header'));

    if (!this.selectedSubtask) return;
    const task = this.store.find(this.selectedSubtask.taskId);
    const st = task?.subtasks[this.selectedSubtask.subIndex];
    if (!st || !st.due) return;

    // FullCalendar tags day cells with data-date="YYYY-MM-DD"
    const dueStr = st.due; // already YYYY-MM-DD

    // highlight the day column cells
    this.calendarEl
      .querySelectorAll(`.fc-timegrid-col[data-date="${dueStr}"], .fc-day[data-date="${dueStr}"]`)
      .forEach((el) => el.classList.add('due-date-column'));

    // highlight the header
    this.calendarEl
      .querySelectorAll(`.fc-col-header-cell[data-date="${dueStr}"]`)
      .forEach((el) => el.classList.add('due-date-header'));
  }

  _initCalendar() {
    const mobile = this.isMobile;

    this.calendar = new FullCalendar.Calendar(this.calendarEl, {
      initialView: mobile ? 'timeGridThreeDay' : 'timeGridWeek',

      // mobile: hide FC's own toolbar (we use our hamburger + Add Task instead)
      headerToolbar: mobile
        ? false
        : {
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridDay,timeGridWeek,dayGridMonth',
          },

      buttonText: {
        today: 'Today', day: 'Day', week: 'Week', month: 'Month',
      },

      views: {
        timeGridWeek: { duration: { days: 7 }, dateIncrement: { days: 1 }, buttonText: 'Week' },
        // custom 3-day view for mobile, scrolls one day at a time
        timeGridThreeDay: {
          type: 'timeGrid',
          duration: { days: 3 },
          dateIncrement: { days: 1 },
          buttonText: '3 Day',
        },
      },

      nowIndicator: true,
      slotDuration: '00:30:00',
      slotLabelInterval: '01:00:00',
      slotMinTime: '06:00:00',
      scrollTime: '08:00:00',
      allDaySlot: false,
      height: '100%',
      expandRows: true,
      firstDay: 1,
      snapDuration: '00:15:00',

      // touch: long-press to start creating/dragging on mobile
      longPressDelay: 300,
      selectLongPressDelay: 300,
      eventLongPressDelay: 300,

      selectable: true,
      selectMirror: true,
      unselectAuto: false,
      selectMinDistance: 3,

      editable: true,
      eventStartEditable: true,
      eventDurationEditable: true,

      events: (info, success, failure) => {
        this._loadEvents(info.start, info.end).then(success).catch(failure);
      },

      eventClassNames: (arg) => {
        const p = arg.event.extendedProps;
        if (p.kind !== 'block') return [];
        if (!this.selectedSubtask) return [];
        if (this._isSelected(p.taskId, p.subIndex)) return ['block-emphasized'];
        if (p.taskId === this.selectedSubtask.taskId) return ['block-sibling'];
        return ['block-dimmed'];
      },
      dayCellClassNames: (arg) => (this._isDueDate(arg.date) ? ['due-date-column'] : []),
      dayHeaderClassNames: (arg) => (this._isDueDate(arg.date) ? ['due-date-header'] : []),
      datesSet: () => {
        this._highlightDueColumn();
        this._renderBacklog();
      },
      dateClick: () => {
        this._clearClickedBlock(); 
        this.calendar.unselect();
      },
      select: (info) => this._onSelectRange(info),
      eventDrop: (info) => this._onEventChanged(info),
      eventResize: (info) => this._onEventChanged(info),
      eventClick: (info) => this._onEventClick(info),
      eventDidMount: (info) => {
        info.el.addEventListener('dblclick', () => this._onEventDblClick(info));
      },
    });

    this.calendar.render();
  }

  _getCalendarCenterTime() {
    const view = this.calendar.view;
    const start = view.currentStart.getTime();
    const end = view.currentEnd.getTime();
    return (start + end) / 2; // midpoint of the visible range
  }

  _getBlockDays(st) {
    const daySet = new Set();
    st.blocks.forEach((b) => {
      if (!b.date) return;
      const d = new Date(b.date + 'T00:00:00');
      daySet.add(startOfDay(d).getTime());
    });
    return [...daySet].sort((a, b) => a - b);
  }

  _getCenteredDay() {
    const view = this.calendar.view;
    const mid = (view.currentStart.getTime() + view.currentEnd.getTime()) / 2;
    return startOfDay(new Date(mid)).getTime();
  }

  // ---------- event loading ----------
  async _loadEvents(rangeStart, rangeEnd) {
    const events = [];

    const blockEventIds = new Set();
    this.store.getAll().forEach((t) =>
      t.subtasks.forEach((s) =>
        s.blocks.forEach((b) => { if (b.eventId) blockEventIds.add(b.eventId); })
      )
    );

    // Google events... (keep as-is)
    if (this.gcal && this.gcal.isAuthed) {
      try {
        const calIds = this.settings.getSelectedCalendars();
        const busy = await this.gcal.getEvents(rangeStart, rangeEnd, calIds);
        busy.forEach((ev) => {
          if (blockEventIds.has(ev.id)) return;
          events.push({
            id: 'gcal-' + ev.id, title: ev.title, start: ev.start, end: ev.end,
            backgroundColor: '#c7c7cc', borderColor: '#8e8e93', textColor: '#3a3a3c',
            editable: false, extendedProps: { kind: 'google' },
          });
        });
      } catch (e) { console.warn('planner google load failed', e); }
    }

    // task blocks
    let blockCount = 0, includedCount = 0;
    this.store.getAll().forEach((task) => {
      task.subtasks.forEach((st, subIndex) => {
        st.blocks.forEach((b, blockIndex) => {
          if (!b.date || !b.start) return;

          // Skip done-subtask blocks whose Google event was deleted (no eventId)
          // These are leftover from completing a task with "delete events"
          if (st.done && !b.eventId) return;

          const start = this._blockStart(b);
          const end = new Date(start.getTime() + b.hoursNum * 3600000);
          if (end < rangeStart || start > rangeEnd) return;

          const selected = this._isSelected(task.id, subIndex);
          const dueToday = !st.done && st.due && _isDueToday(st);
          events.push({
            id: b.eventId || `block-${task.id}-${subIndex}-${blockIndex}`,
            title: st.name,
            start, end,
            backgroundColor: task.color,
            borderColor: dueToday ? '#ff3b30' : task.color, // red border if due today
            textColor: '#fff',
            editable: selected && !st.done,
            classNames: dueToday ? ['block-due-today'] : [],
            extendedProps: {
              kind: 'block', taskId: task.id, taskName: task.name,
              subIndex, blockIndex, done: st.done, eventId: b.eventId,
            },
          });
        });
      });
    });

    return events;
  }

  // ---------- selection ----------
  _isSelected(taskId, subIndex) {
    return this.selectedSubtask &&
      this.selectedSubtask.taskId === taskId &&
      this.selectedSubtask.subIndex === subIndex;
  }

  _selectSubtask(taskId, subIndex) {
    if (this._isSelected(taskId, subIndex)) {
      this.selectedSubtask = null;
    } else {
      this.selectedSubtask = { taskId, subIndex };
    }
    this._clearClickedBlock();
    this._renderBacklog();
    this.calendar.refetchEvents();
    this._highlightDueColumn();
    this._updateCounter();
  }

  _switchSelection(taskId, subIndex) {
    this.selectedSubtask = { taskId, subIndex };
    this._clearClickedBlock();
    this._renderBacklog();
    this.calendar.refetchEvents();
    this._highlightDueColumn();
    this._updateCounter();
  }

  // ---------- create block by dragging empty space ----------
  async _onSelectRange(info) {
    this.calendar.unselect();
    if (this._creating) return; // ← guard against double-fire
    if (!this.selectedSubtask) {
      this._toast('Select a subtask below first, then drag to schedule it.');
      return;
    }
    this._creating = true;
    try {
      const { taskId, subIndex } = this.selectedSubtask;
      const task = this.store.find(taskId);
      const st = task.subtasks[subIndex];
      if (st.done) return;

      const hours = (info.end - info.start) / 3600000;
      const block = new TimeBlock({
        date: this._ymdLocal(info.start),
        start: this._hhmm(info.start),
        hours: Math.max(0.25, Math.round(hours * 4) / 4),
      });

      if (this.gcal.isAuthed && this.gcal.syncEnabled) {
        const eventId = await this.gcal.createEvent({
          summary: `${task.name}: ${st.name}`,
          description: st.note || '',
          startDate: block.date, startTime: block.start, hours: block.hours,
        });
        block.eventId = eventId;
      } else {
        block.eventId = null; 
      }

      this.store.addBlockToSubtask(taskId, subIndex, block);
    } catch (e) {
      alert('Failed to create: ' + (e.result?.error?.message || e.message));
    } finally {
      this._creating = false;
      this._clearClickedBlock();
    }
  }

  // ---------- drag/resize existing block ----------
  async _onEventChanged(info) {
    const p = info.event.extendedProps;
    if (p.kind !== 'block') { info.revert(); return; }
    if (!this._isSelected(p.taskId, p.subIndex)) { info.revert(); return; }

    const task = this.store.find(p.taskId);
    if (!task) { info.revert(); return; }
    const st = task.subtasks[p.subIndex];
    if (!st) { info.revert(); return; }

    // find block by eventId (stable)
    let blockIdx = -1;
    if (p.eventId) {
      blockIdx = st.blocks.findIndex((b) => b.eventId === p.eventId);
    } else {
      blockIdx = p.blockIndex;
    }
    if (blockIdx < 0) { info.revert(); return; }

    const block = st.blocks[blockIdx];
    if (!block) { info.revert(); return; }

    const newStart = info.event.start;
    const newEnd = info.event.end;
    block.date = this._ymdLocal(newStart);
    block.start = this._hhmm(newStart);
    block.hours = (newEnd - newStart) / 3600000;

    // update Google
    if (this.gcal.isAuthed && this.gcal.syncEnabled && block.eventId) {
      try {
        await this.gcal.updateEvent({
          eventId: block.eventId,
          summary: `${task.name}: ${st.name}`,
          startDate: block.date, startTime: block.start, hours: block.hours,
        });
      } catch (e) {
        alert('Failed to update event: ' + (e.result?.error?.message || e.message));
        info.revert();
        return;
      }
    }

    this.store.setSubtaskBlocks(p.taskId, p.subIndex, st.blocks);
    this._clearClickedBlock();
    this._renderBacklog();
    this._updateCounter();
  }

  // ---------- click block → show delete ✕ ----------
  // ---------- click block → select subtask, or show ✕ if already selected ----------
  _onEventClick(info) {
    const p = info.event.extendedProps;
    if (p.kind !== 'block') return;   // never select Google events
    if (p.done) return;               // done subtasks aren't selectable

    // Case 1: this block's subtask IS the selected one → show delete ✕
    if (this._isSelected(p.taskId, p.subIndex)) {
      this._clearClickedBlock();
      this._clickedBlock = { info, p };
      const el = info.el;
      const x = document.createElement('div');
      x.className = 'block-del-x';
      x.textContent = '✕';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteClickedBlock();
      });
      el.appendChild(x);
      el.classList.add('block-clicked');
      return;
    }

    // Case 2: same TASK, different subtask → single-click switches to it
    if (this.selectedSubtask && p.taskId === this.selectedSubtask.taskId) {
      this._switchSelection(p.taskId, p.subIndex);
      return;
    }

    // Case 3: different task OR nothing selected
    if (!this.selectedSubtask) {
      this._switchSelection(p.taskId, p.subIndex); // first selection = easy
      return;
    }

    if (this.isMobile) {
      this._switchSelection(p.taskId, p.subIndex);
      return;
    }
  }

  _clearClickedBlock() {
    if (this._clickedBlock) {
      const el = this._clickedBlock.info.el;
      const x = el.querySelector('.block-del-x');
      if (x) x.remove();
      el.classList.remove('block-clicked');
    }
    this._clickedBlock = null;
  }

  async _deleteClickedBlock() {
    if (!this._clickedBlock) return;
    const { p } = this._clickedBlock;
    this._clickedBlock = null; // clear immediately to prevent double-delete

    const task = this.store.find(p.taskId);
    if (!task) return;
    const st = task.subtasks[p.subIndex];
    if (!st) return;

    const blockIdx = p.eventId
      ? st.blocks.findIndex((b) => b.eventId === p.eventId)
      : p.blockIndex;
    if (blockIdx < 0 || blockIdx >= st.blocks.length) return;

    const block = st.blocks[blockIdx];
    if (!block) return;

    // delete from Google first
    if (this.gcal.isAuthed && block.eventId) {
      try {
        await this.gcal.deleteEvent(block.eventId);
      } catch (e) {
        console.warn('Google delete failed:', e);
        // continue to remove locally anyway
      }
    }

    // re-find index (store may have shifted during await) and remove
    const freshTask = this.store.find(p.taskId);
    const freshSt = freshTask?.subtasks[p.subIndex];
    if (freshSt) {
      const idx = block.eventId
        ? freshSt.blocks.findIndex((b) => b.eventId === block.eventId)
        : blockIdx;
      if (idx >= 0) {
        freshSt.blocks.splice(idx, 1);
        this.store.setSubtaskBlocks(p.taskId, p.subIndex, freshSt.blocks);
      }
    }
  }

  // ---------- double-click → switch selection ----------
  _onEventDblClick(info) {
    const p = info.event.extendedProps;
    if (p.kind !== 'block') return;
    if (p.done) return;
    this._switchSelection(p.taskId, p.subIndex);
  }

  // ---------- backlog ----------
  async render() {
    if (!this.isActive || !this.calendar) return;
    this._renderBacklog();
    this._updateCounter();
  }
 
  // Returns the earliest block start as a timestamp (ms), or Infinity if no blocks
  _getSoonestStartTime(st) {
    let soonest = Infinity;
    st.blocks.forEach((b) => {
      if (!b.date || !b.start) return;
      const [h, m] = b.start.split(':').map(Number);
      const d = new Date(b.date + 'T00:00:00');
      d.setHours(h, m, 0, 0);
      const t = d.getTime();
      if (t < soonest) soonest = t;
    });
    return soonest;
  }

  _renderBacklog() {
    const cards = [];
    this.store.getAll().forEach((task) => {
      task.subtasks.forEach((st, subIndex) => {
        if (st.done) return;

        const remaining = st.estHoursNum - st.allocatedHours;
        const fullyScheduled = st.estHoursNum > 0 && remaining <= 0;
        const isSelected = this._isSelected(task.id, subIndex);
        const soonestStart = this._getSoonestStartTime(st);

        const wouldBeHidden = this.hideScheduled && fullyScheduled;
        if (wouldBeHidden && !isSelected) return;

        const isPopped = wouldBeHidden && isSelected;

        cards.push({ task, st, subIndex, remaining, isPopped, soonestStart });
      });
    });

    cards.sort((a, b) => {
      // 1. popped (summoned-but-hidden) cards jump to front
      const aPop = a.isPopped ? 0 : 1;
      const bPop = b.isPopped ? 0 : 1;
      if (aPop !== bPop) return aPop - bPop;

      const aDue = _isDueToday(a.st) ? true : false;
      const bDue = _isDueToday(b.st) ? true : false;
      if (aDue !== bDue) return aDue ? -1 : 1;

      // 2. not-fully-allocated (needs time) before fully-allocated
      const aNeeds = a.remaining > 0 ? 0 : 1;
      const bNeeds = b.remaining > 0 ? 0 : 1;
      if (aNeeds !== bNeeds) return aNeeds - bNeeds;

      // 3a. within "needs time" group: more hours remaining first
      if (aNeeds === 0) {
        return b.remaining - a.remaining;
      }

      // 3b. within "fully allocated" group: soonest block start first
      return a.soonestStart - b.soonestStart;
    });

    if (cards.length === 0) {
      this.backlogEl.innerHTML =
        '<div class="backlog-empty">No subtasks to schedule. 🎉</div>';
      return;
    }

    this.backlogEl.innerHTML = '';
    cards.forEach(({ task, st, subIndex }) =>
      this.backlogEl.appendChild(this._makeCard(task, st, subIndex))
    );
  }

  _makeCard(task, st, subIndex) {
    const card = document.createElement('div');
    card.className = 'backlog-card';
    card.style.borderTopColor = task.color;
    const isSelected = this._isSelected(task.id, subIndex);
    if (isSelected) card.classList.add('selected');

    const dueToday = !st.done && st.due && _isDueToday(st);
    if (dueToday) card.classList.add('due-today');

    const est = st.estHoursNum;
    const remaining = est - st.allocatedHours;
    let statusHtml;
    if (est === 0) statusHtml = `<span class="card-status neutral">${st.allocatedHours}h scheduled</span>`;
    else if (remaining > 0) statusHtml = `<span class="card-status pending">${remaining}h left</span>`;
    else statusHtml = `<span class="card-status scheduled">✓ scheduled</span>`;

    const dueHtml = dueToday
      ? `<span class="card-due due-today-text">⚠️ Due today</span>`
      : (st.due ? `<span class="card-due">Due ${this._fmtDue(st.due)}</span>` : '');

    // nav arrows (only when selected + has blocks), based on current calendar center
    let navHtml = '';
    const blockDays = this._getBlockDays(st);

    if (isSelected && blockDays.length > 0) {
      const centeredDay = this._getCenteredDay();
      const hasPrev = blockDays.some((d) => d < centeredDay);
      const hasNext = blockDays.some((d) => d > centeredDay);
      const blockCount = st.blocks.filter((b) => b.date && b.start).length;

      navHtml = `
        <div class="card-nav">
          <button class="card-nav-arrow" data-nav="prev" ${hasPrev ? '' : 'disabled'}>◀</button>
          <span class="card-nav-label">${blockCount} block${blockCount === 1 ? '' : 's'}</span>
          <button class="card-nav-arrow" data-nav="next" ${hasNext ? '' : 'disabled'}>▶</button>
        </div>`;
    }

    card.innerHTML = `
      ${navHtml}
      <div class="card-task" style="color:${task.color};">${this._esc(task.name)}</div>
      <div class="card-sub">${this._esc(st.name)}</div>
      <div class="card-meta">${statusHtml}${dueHtml}</div>`;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-nav-arrow')) return;
      this._selectSubtask(task.id, subIndex);
    });

    card.querySelectorAll('.card-nav-arrow').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        this._navigateRelative(st, btn.dataset.nav);
      });
    });

    return card;
  }

  _navigateRelative(st, direction) {
    const blockDays = this._getBlockDays(st);
    if (blockDays.length === 0) return;

    const centeredDay = this._getCenteredDay();

    let targetDay;
    if (direction === 'next') {
      targetDay = blockDays.find((d) => d > centeredDay);
    } else {
      const earlier = blockDays.filter((d) => d < centeredDay);
      targetDay = earlier.length ? earlier[earlier.length - 1] : null;
    }

    if (targetDay == null) return;

    this._gotoDateCentered(new Date(targetDay));
    setTimeout(() => this._renderBacklog(), 50);
  }

  // Navigate so the target date is centered in the current view
  _gotoDateCentered(date) {
    const viewType = this.calendar.view.type;

    if (viewType === 'timeGridWeek' || viewType === 'dayGridMonth') {
      // for week view: go to ~3 days before so the target is mid-week
      const centered = new Date(date);
      centered.setDate(centered.getDate() - 3);
      this.calendar.gotoDate(centered);
    } else {
      // day view: just go to the date
      this.calendar.gotoDate(date);
    }
  }

  // Optional: flash the target block so you can spot it
  _flashBlock(block) {
    setTimeout(() => {
      const events = this.calendar.getEvents();
      const target = events.find((ev) => {
        const p = ev.extendedProps;
        return p.kind === 'block' &&
          Math.abs(ev.start.getTime() - this._blockStart(block).getTime()) < 1000;
      });
      if (target && target.el) {
        target.el.classList.add('block-flash');
        setTimeout(() => target.el.classList.remove('block-flash'), 1000);
      }
    }, 100);
  }

  // ---------- hours counter (in planner toolbar) ----------
  _updateCounter() {
    let el = document.getElementById('plannerCounter');
    if (!el) {
      el = document.createElement('span');
      el.id = 'plannerCounter';
      el.className = 'planner-counter';
      document.querySelector('.planner-toolbar').appendChild(el);
    }
    if (!this.selectedSubtask) { el.textContent = ''; return; }
    const st = this.store.find(this.selectedSubtask.taskId)
      .subtasks[this.selectedSubtask.subIndex];
    const est = st.estHoursNum, alloc = st.allocatedHours, left = est - alloc;
    if (est === 0) el.textContent = `${alloc}h scheduled`;
    else if (left <= 0) el.textContent = `✓ ${alloc}h scheduled — done!`;
    else el.textContent = `${est}h needed · ${alloc}h placed · ${left}h left`;
  }

  _toast(msg) {
    let t = document.getElementById('plannerToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'plannerToast';
      t.className = 'planner-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
  }

  // ---------- helpers ----------
  
  _blockStart(b) {
    const d = new Date(b.date + 'T00:00:00');
    const [h, m] = b.start.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  }
  _ymdLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  _hhmm(d) {
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  _fmtDue(ymd) {
    return new Date(ymd + 'T00:00:00')
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  _esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  _bindMobileMenu() {
    if (this._mobileMenuBound) return;   // bind once
    this._mobileMenuBound = true;

    const btn = document.getElementById('plannerMenuBtn');
    const panel = document.getElementById('plannerMenuPanel');
    
    if (!btn || !panel) return;
    if (!this._touchResetBound) {
      this._touchResetBound = true;
      this.calendarEl.addEventListener('touchend', () => {
        // give FC a tick, then clear any stuck selection state
        setTimeout(() => {
          if (this.calendar) this.calendar.unselect();
        }, 0);
      }, { passive: true });
    }
    // toggle panel
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._clickedBlock && !e.target.closest('.fc-event')) {
        this._clearClickedBlock();
      }
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
      this._updateMobileViewButtons();
    });

    // close when tapping outside
    document.addEventListener('click', (e) => {
      if (panel.style.display !== 'none' &&
          !panel.contains(e.target) && e.target !== btn) {
        panel.style.display = 'none';
      }
    });

    // day navigation
    document.getElementById('plannerPrevDay')?.addEventListener('click', () => this.calendar.prev());
    document.getElementById('plannerTodayBtn')?.addEventListener('click', () => this.calendar.today());
    document.getElementById('plannerNextDay')?.addEventListener('click', () => this.calendar.next());
    
    // view switcher
    panel.querySelectorAll('.pm-views button').forEach((vb) => {
      vb.addEventListener('click', () => {
        this.calendar.changeView(vb.dataset.view);
        this._updateMobileViewButtons();
      });
    });

    // refresh (reuse the same reconcile path as desktop refresh)
    document.getElementById('pmRefresh').addEventListener('click', () => {
      document.getElementById('plannerRefreshBtn')?.click();  // triggers app._reconcile()
      panel.style.display = 'none';
    });

    // hide-fully-scheduled (mobile) — sync with desktop checkbox + state
    const mobileHide = document.getElementById('hideScheduledMobile');
    if (mobileHide) {
      mobileHide.checked = this.hideScheduled;
      mobileHide.addEventListener('change', () => {
        this.hideScheduled = mobileHide.checked;
        const desktopHide = document.getElementById('hideScheduled');
        if (desktopHide) desktopHide.checked = this.hideScheduled;
        this._renderBacklog();
      });
    }
  }

  _updateMobileViewButtons() {
    const panel = document.getElementById('plannerMenuPanel');
    if (!panel) return;
    const current = this.calendar?.view?.type;
    panel.querySelectorAll('.pm-views button').forEach((vb) => {
      vb.classList.toggle('active', vb.dataset.view === current);
    });
  }

  _applyMobilePlannerUI() {
    // placeholder hook for anything that must change when crossing the breakpoint.
    // (the CSS handles show/hide; this is here so the resize handler can call it)
    this._updateMobileViewButtons();
  }
}