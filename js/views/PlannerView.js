import { startOfDay, ymdLocal, hhmm, parseLocalDate, parseLocalDateTime, fmtShortDate } from '../core/dates.js';
import { escapeHtml, _isDueToday } from '../utils.js';
import { TimeBlock } from '../models/Subtask.js';
import { View } from '../core/View.js';

const MOBILE_BREAKPOINT_PX = 768;
const MS_PER_HOUR = 3600000;
const DUE_TODAY_BORDER = '#ff3b30';
const GOOGLE_EVENT_COLORS = {
  backgroundColor: '#c7c7cc',
  borderColor: '#8e8e93',
  textColor: '#3a3a3c',
};

export class PlannerView extends View {
  constructor(store, googleCalendar, settings) {
    super();
    this.store = store;
    this.gcal = googleCalendar;
    this.settings = settings;
    this.isMobile = isMobileWidth();
    this.calendar = null;
    this.selectedSubtask = null; // { taskId, subIndex }
    this.hideScheduled = false;
    this._clickedBlock = null;   // { info, p } of the block showing the delete ✕

    this.container = document.getElementById('plannerViewContainer');
    this.calendarEl = document.getElementById('plannerCalendar');
    this.backlogEl = document.getElementById('backlogCards');

    this._bindGlobalEvents();
  }

  // ---------- lifecycle (deactivate from View) ----------
  // build FullCalendar on first show (or resize it after being hidden), then draw
  activate() {
    if (!this.calendar) {
      this._initCalendar();
    } else {
      this.calendar.updateSize();
      this.calendar.refetchEvents();
    }
    this._bindMobileMenu();
    this._updateMobileViewButtons();
    super.activate();
  }

  refresh() {
    if (!this.isActive || !this.calendar) return;
    // defer so the store mutation completes before refetching
    setTimeout(() => this.calendar.refetchEvents(), 0);
    this.render();
  }

  async render() {
    if (!this.isActive || !this.calendar) return;
    this._renderBacklog();
    this._updateCounter();
  }

  // ---------- event binding ----------
  _bindGlobalEvents() {
    const hideCheckbox = document.getElementById('hideScheduled');
    hideCheckbox?.addEventListener('change', () => {
      this.hideScheduled = hideCheckbox.checked;
      this._renderBacklog();
    });

    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this._clickedBlock) {
        this._deleteClickedBlock();
      }
    });

    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const nowMobile = isMobileWidth();
    if (nowMobile === this.isMobile) return;

    // rebuild the calendar so it picks up the mobile/desktop config
    this.isMobile = nowMobile;
    if (this.calendar) {
      this.calendar.destroy();
      this.calendar = null;
    }
    if (this.isActive) {
      this._initCalendar();
      this.render();
    }
    this._updateMobileViewButtons();
  }

  _bindMobileMenu() {
    if (this._mobileMenuBound) return;
    this._mobileMenuBound = true;

    const btn = document.getElementById('plannerMenuBtn');
    const panel = document.getElementById('plannerMenuPanel');
    if (!btn || !panel) return;

    // give FC a tick after a touch, then clear any stuck selection state
    this.calendarEl.addEventListener('touchend', () => {
      setTimeout(() => this.calendar?.unselect(), 0);
    }, { passive: true });

    const hidePanel = () => { panel.style.display = 'none'; };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._clickedBlock && !e.target.closest('.fc-event')) this._clearClickedBlock();
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
      this._updateMobileViewButtons();
    });

    document.addEventListener('click', (e) => {
      if (panel.style.display !== 'none' && !panel.contains(e.target) && e.target !== btn) {
        hidePanel();
      }
    });

    document.getElementById('plannerPrevDay')?.addEventListener('click', () => this.calendar.prev());
    document.getElementById('plannerTodayBtn')?.addEventListener('click', () => this.calendar.today());
    document.getElementById('plannerNextDay')?.addEventListener('click', () => this.calendar.next());

    panel.querySelectorAll('.pm-views button').forEach((viewBtn) => {
      viewBtn.addEventListener('click', () => {
        this.calendar.changeView(viewBtn.dataset.view);
        this._updateMobileViewButtons();
      });
    });

    // reuse the desktop refresh button so both trigger CalendarRefresh.reconcile()
    document.getElementById('pmRefresh').addEventListener('click', () => {
      document.getElementById('plannerRefreshBtn')?.click();
      hidePanel();
    });

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
    const currentView = this.calendar?.view?.type;
    panel.querySelectorAll('.pm-views button').forEach((viewBtn) => {
      viewBtn.classList.toggle('active', viewBtn.dataset.view === currentView);
    });
  }

  // ---------- calendar ----------
  _initCalendar() {
    const mobile = this.isMobile;

    this.calendar = new FullCalendar.Calendar(this.calendarEl, {
      initialView: mobile ? 'timeGridThreeDay' : 'timeGridWeek',

      // mobile hides FC's toolbar in favour of the hamburger menu
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

      eventClassNames: (arg) => this._blockClassNames(arg.event.extendedProps),
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

  _blockClassNames(props) {
    if (props.kind !== 'block' || !this.selectedSubtask) return [];
    if (this._isSelected(props.taskId, props.subIndex)) return ['block-emphasized'];
    if (props.taskId === this.selectedSubtask.taskId) return ['block-sibling'];
    return ['block-dimmed'];
  }

  // ---------- event loading ----------
  async _loadEvents(rangeStart, rangeEnd) {
    const blockEventIds = this._collectBlockEventIds();
    const googleEvents = await this._loadGoogleEvents(rangeStart, rangeEnd, blockEventIds);
    return [...googleEvents, ...this._buildBlockEvents(rangeStart, rangeEnd)];
  }

  _collectBlockEventIds() {
    const ids = new Set();
    this.store.getAll().forEach((task) =>
      task.subtasks.forEach((st) =>
        st.blocks.forEach((b) => { if (b.eventId) ids.add(b.eventId); })
      )
    );
    return ids;
  }

  // Google events that mirror app blocks are skipped; the block is shown instead.
  async _loadGoogleEvents(rangeStart, rangeEnd, blockEventIds) {
    if (!this.gcal || !this.gcal.isAuthed) return [];
    try {
      const calIds = this.settings.getSelectedCalendars();
      const busy = await this.gcal.getEvents(rangeStart, rangeEnd, calIds);
      return busy
        .filter((ev) => !blockEventIds.has(ev.id))
        .map((ev) => ({
          id: 'gcal-' + ev.id, title: ev.title, start: ev.start, end: ev.end,
          ...GOOGLE_EVENT_COLORS,
          editable: false, extendedProps: { kind: 'google' },
        }));
    } catch (e) {
      console.warn('planner google load failed', e);
      return [];
    }
  }

  _buildBlockEvents(rangeStart, rangeEnd) {
    const events = [];
    this.store.getAll().forEach((task) => {
      task.subtasks.forEach((st, subIndex) => {
        st.blocks.forEach((b, blockIndex) => {
          if (!b.date || !b.start) return;
          // done subtasks whose Google events were deleted on completion leave orphan blocks
          if (st.done && !b.eventId) return;

          const start = parseLocalDateTime(b.date, b.start);
          const end = new Date(start.getTime() + b.hoursNum * MS_PER_HOUR);
          if (end < rangeStart || start > rangeEnd) return;

          const dueToday = _isDueToday(st);
          events.push({
            id: b.eventId || `block-${task.id}-${subIndex}-${blockIndex}`,
            title: st.name,
            start, end,
            backgroundColor: task.color,
            borderColor: dueToday ? DUE_TODAY_BORDER : task.color,
            textColor: '#fff',
            editable: this._isSelected(task.id, subIndex) && !st.done,
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

  _getSelectedSubtask() {
    if (!this.selectedSubtask) return null;
    const task = this.store.find(this.selectedSubtask.taskId);
    return task?.subtasks[this.selectedSubtask.subIndex];
  }

  // Toggles: selecting the already-selected subtask deselects it.
  _selectSubtask(taskId, subIndex) {
    const selection = this._isSelected(taskId, subIndex) ? null : { taskId, subIndex };
    this._applySelection(selection);
  }

  _switchSelection(taskId, subIndex) {
    this._applySelection({ taskId, subIndex });
  }

  _applySelection(selection) {
    this.selectedSubtask = selection;
    this._clearClickedBlock();
    this._renderBacklog();
    this.calendar.refetchEvents();
    this._highlightDueColumn();
    this._updateCounter();
  }

  // ---------- calendar interactions ----------
  async _onSelectRange(info) {
    this.calendar.unselect();
    if (this._creating) return; // FC can fire select twice
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

      const hours = (info.end - info.start) / MS_PER_HOUR;
      const block = new TimeBlock({
        date: ymdLocal(info.start),
        start: hhmm(info.start),
        hours: Math.max(0.25, Math.round(hours * 4) / 4),
      });

      if (this.gcal.isAuthed && this.gcal.syncEnabled) {
        block.eventId = await this.gcal.createEvent({
          summary: `${task.name}: ${st.name}`,
          description: st.note || '',
          startDate: block.date, startTime: block.start, hours: block.hours,
        });
      }

      this.store.addBlockToSubtask(taskId, subIndex, block);
    } catch (e) {
      alert('Failed to create: ' + errorMessage(e));
    } finally {
      this._creating = false;
      this._clearClickedBlock();
    }
  }

  async _onEventChanged(info) {
    const p = info.event.extendedProps;
    const found = p.kind === 'block' && this._isSelected(p.taskId, p.subIndex)
      ? this._findBlock(p)
      : null;
    if (!found) {
      info.revert();
      return;
    }

    const { task, st, block } = found;
    const { start, end } = info.event;
    block.date = ymdLocal(start);
    block.start = hhmm(start);
    block.hours = (end - start) / MS_PER_HOUR;

    if (this.gcal.isAuthed && this.gcal.syncEnabled && block.eventId) {
      try {
        await this.gcal.updateEvent({
          eventId: block.eventId,
          summary: `${task.name}: ${st.name}`,
          startDate: block.date, startTime: block.start, hours: block.hours,
        });
      } catch (e) {
        alert('Failed to update event: ' + errorMessage(e));
        info.revert();
        return;
      }
    }

    this.store.setSubtaskBlocks(p.taskId, p.subIndex, st.blocks);
    this._clearClickedBlock();
    this._renderBacklog();
    this._updateCounter();
  }

  // Click on the selected subtask's block shows the delete ✕; otherwise it may switch selection.
  // On desktop, switching to a different task requires a double-click.
  _onEventClick(info) {
    const p = info.event.extendedProps;
    if (p.kind !== 'block' || p.done) return;

    if (this._isSelected(p.taskId, p.subIndex)) {
      this._showDeleteButton(info, p);
      return;
    }

    const isSameTask = this.selectedSubtask && p.taskId === this.selectedSubtask.taskId;
    if (!this.selectedSubtask || isSameTask || this.isMobile) {
      this._switchSelection(p.taskId, p.subIndex);
    }
  }

  _onEventDblClick(info) {
    const p = info.event.extendedProps;
    if (p.kind !== 'block' || p.done) return;
    this._switchSelection(p.taskId, p.subIndex);
  }

  // ---------- block deletion ----------
  _showDeleteButton(info, p) {
    this._clearClickedBlock();
    this._clickedBlock = { info, p };

    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'block-del-x';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._deleteClickedBlock();
    });
    info.el.appendChild(deleteBtn);
    info.el.classList.add('block-clicked');
  }

  _clearClickedBlock() {
    if (this._clickedBlock) {
      const el = this._clickedBlock.info.el;
      el.querySelector('.block-del-x')?.remove();
      el.classList.remove('block-clicked');
    }
    this._clickedBlock = null;
  }

  async _deleteClickedBlock() {
    if (!this._clickedBlock) return;
    const { p } = this._clickedBlock;
    this._clickedBlock = null; // clear immediately to prevent double-delete

    const found = this._findBlock(p);
    if (!found) return;
    const { block, blockIndex } = found;

    if (this.gcal.isAuthed && block.eventId) {
      try {
        await this.gcal.deleteEvent(block.eventId);
      } catch (e) {
        console.warn('Google delete failed:', e); // still remove locally
      }
    }

    // re-resolve: the store may have changed during the await
    const freshSt = this.store.find(p.taskId)?.subtasks[p.subIndex];
    if (!freshSt) return;
    const idx = block.eventId
      ? freshSt.blocks.findIndex((b) => b.eventId === block.eventId)
      : blockIndex;
    if (idx < 0) return;
    freshSt.blocks.splice(idx, 1);
    this.store.setSubtaskBlocks(p.taskId, p.subIndex, freshSt.blocks);
  }

  // Locates the block behind a calendar event, preferring the stable eventId over the index.
  _findBlock(p) {
    const task = this.store.find(p.taskId);
    const st = task?.subtasks[p.subIndex];
    if (!st) return null;

    const blockIndex = p.eventId
      ? st.blocks.findIndex((b) => b.eventId === p.eventId)
      : p.blockIndex;
    const block = st.blocks[blockIndex];
    if (blockIndex < 0 || !block) return null;

    return { task, st, block, blockIndex };
  }

  // ---------- due-date highlighting ----------
  _isDueDate(date) {
    const st = this._getSelectedSubtask();
    if (!st || !st.due) return false;
    const due = parseLocalDate(st.due);
    return date.getFullYear() === due.getFullYear() &&
           date.getMonth() === due.getMonth() &&
           date.getDate() === due.getDate();
  }

  _highlightDueColumn() {
    this.calendarEl.querySelectorAll('.due-date-column, .due-date-header')
      .forEach((el) => el.classList.remove('due-date-column', 'due-date-header'));

    const st = this._getSelectedSubtask();
    if (!st || !st.due) return;

    // FullCalendar tags day cells with data-date="YYYY-MM-DD", the same format as st.due
    const dateAttr = `[data-date="${st.due}"]`;
    this.calendarEl
      .querySelectorAll(`.fc-timegrid-col${dateAttr}, .fc-day${dateAttr}`)
      .forEach((el) => el.classList.add('due-date-column'));
    this.calendarEl
      .querySelectorAll(`.fc-col-header-cell${dateAttr}`)
      .forEach((el) => el.classList.add('due-date-header'));
  }

  // ---------- backlog ----------
  _renderBacklog() {
    const cards = this._collectBacklogCards().sort(compareBacklogCards);

    if (cards.length === 0) {
      this.backlogEl.innerHTML = '<div class="backlog-empty">No subtasks to schedule. 🎉</div>';
      return;
    }

    this.backlogEl.innerHTML = '';
    cards.forEach(({ task, st, subIndex }) =>
      this.backlogEl.appendChild(this._makeCard(task, st, subIndex))
    );
  }

  // A selected card stays visible ("popped") even when hide-fully-scheduled would hide it.
  _collectBacklogCards() {
    const cards = [];
    this.store.getAll().forEach((task) => {
      task.subtasks.forEach((st, subIndex) => {
        if (st.done) return;

        const remaining = st.estHoursNum - st.allocatedHours;
        const fullyScheduled = st.estHoursNum > 0 && remaining <= 0;
        const isSelected = this._isSelected(task.id, subIndex);
        const wouldBeHidden = this.hideScheduled && fullyScheduled;
        if (wouldBeHidden && !isSelected) return;

        cards.push({
          task, st, subIndex, remaining,
          isPopped: wouldBeHidden && isSelected,
          soonestStart: soonestBlockStart(st),
        });
      });
    });
    return cards;
  }

  _makeCard(task, st, subIndex) {
    const isSelected = this._isSelected(task.id, subIndex);
    const dueToday = _isDueToday(st);

    const card = document.createElement('div');
    card.className = 'backlog-card';
    card.style.borderTopColor = task.color;
    if (isSelected) card.classList.add('selected');
    if (dueToday) card.classList.add('due-today');

    card.innerHTML = `
      ${isSelected ? this._cardNavHtml(st) : ''}
      <div class="card-task" style="color:${task.color};">${escapeHtml(task.name)}</div>
      <div class="card-sub">${escapeHtml(st.name)}</div>
      <div class="card-meta">${cardStatusHtml(st)}${cardDueHtml(st, dueToday)}</div>`;

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

  // Prev/next arrows jump between days that hold this subtask's blocks,
  // relative to the day at the center of the visible range.
  _cardNavHtml(st) {
    const blockDays = getBlockDays(st);
    if (blockDays.length === 0) return '';

    const centeredDay = this._getCenteredDay();
    const hasPrev = blockDays.some((d) => d < centeredDay);
    const hasNext = blockDays.some((d) => d > centeredDay);
    const blockCount = st.blocks.filter((b) => b.date && b.start).length;

    return `
        <div class="card-nav">
          <button class="card-nav-arrow" data-nav="prev" ${hasPrev ? '' : 'disabled'}>◀</button>
          <span class="card-nav-label">${blockCount} block${blockCount === 1 ? '' : 's'}</span>
          <button class="card-nav-arrow" data-nav="next" ${hasNext ? '' : 'disabled'}>▶</button>
        </div>`;
  }

  // ---------- navigation ----------
  _navigateRelative(st, direction) {
    const blockDays = getBlockDays(st);
    if (blockDays.length === 0) return;

    const centeredDay = this._getCenteredDay();
    const targetDay = direction === 'next'
      ? blockDays.find((d) => d > centeredDay)
      : blockDays.filter((d) => d < centeredDay).at(-1);
    if (targetDay == null) return;

    this._gotoDateCentered(new Date(targetDay));
    setTimeout(() => this._renderBacklog(), 50);
  }

  _getCenteredDay() {
    const { currentStart, currentEnd } = this.calendar.view;
    const mid = (currentStart.getTime() + currentEnd.getTime()) / 2;
    return startOfDay(new Date(mid)).getTime();
  }

  // Week/month views go ~3 days earlier so the target lands mid-range.
  _gotoDateCentered(date) {
    const viewType = this.calendar.view.type;
    if (viewType === 'timeGridWeek' || viewType === 'dayGridMonth') {
      const centered = new Date(date);
      centered.setDate(centered.getDate() - 3);
      this.calendar.gotoDate(centered);
    } else {
      this.calendar.gotoDate(date);
    }
  }

  // ---------- toolbar feedback ----------
  _updateCounter() {
    let el = document.getElementById('plannerCounter');
    if (!el) {
      el = document.createElement('span');
      el.id = 'plannerCounter';
      el.className = 'planner-counter';
      document.querySelector('.planner-toolbar').appendChild(el);
    }
    if (!this.selectedSubtask) {
      el.textContent = '';
      return;
    }

    const st = this.store.find(this.selectedSubtask.taskId).subtasks[this.selectedSubtask.subIndex];
    const est = st.estHoursNum;
    const alloc = st.allocatedHours;
    const left = est - alloc;
    if (est === 0) el.textContent = `${alloc}h scheduled`;
    else if (left <= 0) el.textContent = `✓ ${alloc}h scheduled — done!`;
    else el.textContent = `${est}h needed · ${alloc}h placed · ${left}h left`;
  }

  _toast(msg) {
    let toast = document.getElementById('plannerToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'plannerToast';
      toast.className = 'planner-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  }
}

// ---------- backlog ordering & markup ----------

// Order: popped → due today → needs time (most remaining first) → fully scheduled (soonest block first)
function compareBacklogCards(a, b) {
  if (a.isPopped !== b.isPopped) return a.isPopped ? -1 : 1;

  const aDue = !!_isDueToday(a.st);
  const bDue = !!_isDueToday(b.st);
  if (aDue !== bDue) return aDue ? -1 : 1;

  const aNeeds = a.remaining > 0;
  const bNeeds = b.remaining > 0;
  if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;

  return aNeeds ? b.remaining - a.remaining : a.soonestStart - b.soonestStart;
}

function cardStatusHtml(st) {
  const est = st.estHoursNum;
  const remaining = est - st.allocatedHours;
  if (est === 0) return `<span class="card-status neutral">${st.allocatedHours}h scheduled</span>`;
  if (remaining > 0) return `<span class="card-status pending">${remaining}h left</span>`;
  return `<span class="card-status scheduled">✓ scheduled</span>`;
}

function cardDueHtml(st, dueToday) {
  if (dueToday) return `<span class="card-due due-today-text">⚠️ Due today</span>`;
  return st.due ? `<span class="card-due">Due ${fmtShortDate(parseLocalDate(st.due))}</span>` : '';
}

// ---------- block/date helpers ----------
function isMobileWidth() {
  return window.innerWidth < MOBILE_BREAKPOINT_PX;
}

// Earliest scheduled block start in ms, or Infinity if none.
function soonestBlockStart(st) {
  return st.blocks
    .filter((b) => b.date && b.start)
    .map((b) => parseLocalDateTime(b.date, b.start).getTime())
    .reduce((soonest, t) => (t < soonest ? t : soonest), Infinity);
}

// Sorted, de-duplicated day timestamps (local midnight) that hold the subtask's blocks.
function getBlockDays(st) {
  const days = new Set();
  st.blocks.forEach((b) => {
    if (b.date) days.add(startOfDay(parseLocalDate(b.date)).getTime());
  });
  return [...days].sort((a, b) => a - b);
}

function errorMessage(e) {
  return e.result?.error?.message || e.message;
}
