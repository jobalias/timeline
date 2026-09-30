import { startOfDay, sameDay } from '../utils.js';
import { TimeBlock } from '../models/Subtask.js';

export class PlannerView {
  constructor(store, googleCalendar, settings) {
    this.store = store;
    this.gcal = googleCalendar;
    this.settings = settings;
    this.isActive = false;
    this.calendar = null;
    this.selectedSubtask = null; // { taskId, subIndex }
    this.selectedBlockEl = null; // currently clicked block DOM (for delete ✕)
    this.hideScheduled = false;

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
  }

  activate() {
    this.isActive = true;
    if (!this.calendar) this._initCalendar();
    else { this.calendar.updateSize(); this.calendar.refetchEvents(); }
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

  _initCalendar() {
    this.calendar = new FullCalendar.Calendar(this.calendarEl, {
      initialView: 'timeGridWeek',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'timeGridDay,timeGridWeek,dayGridMonth',
      },
      views: {
        timeGridWeek: { duration: { days: 7 }, dateIncrement: { days: 1 } },
      },
      nowIndicator: true,
      slotMinTime: '06:00:00',
      scrollTime: '08:00:00',
      allDaySlot: false,
      height: '100%',
      expandRows: true,
      firstDay: 1,
      snapDuration: '00:15:00',

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

      // emphasis via classes (re-runs on every render — reliable)
      eventClassNames: (arg) => {
        const p = arg.event.extendedProps;
        if (p.kind !== 'block') return [];       // Google events unaffected
        if (!this.selectedSubtask) return [];    // nothing selected → normal
        if (this._isSelected(p.taskId, p.subIndex)) return ['block-emphasized'];
        return ['block-dimmed'];
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
          events.push({
            id: b.eventId || `block-${task.id}-${subIndex}-${blockIndex}`,
            title: st.name,
            start, end,
            backgroundColor: task.color,
            borderColor: task.color,
            textColor: '#fff',
            editable: selected && !st.done,
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
      this.selectedSubtask = null; // toggle off
    } else {
      this.selectedSubtask = { taskId, subIndex };
    }
    this._clearClickedBlock();
    this._renderBacklog();
    this.calendar.refetchEvents(); // re-render with new editability/emphasis
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

      if (this.gcal.isAuthed) {
        const eventId = await this.gcal.createEvent({
          summary: `${task.name}: ${st.name}`,
          startDate: block.date, startTime: block.start, hours: block.hours,
        });
        block.eventId = eventId;
      }

      this.store.addBlockToSubtask(taskId, subIndex, block);
    } catch (e) {
      alert('Failed to create: ' + (e.result?.error?.message || e.message));
    } finally {
      this._creating = false;
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
    if (this.gcal.isAuthed && block.eventId) {
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
    this._renderBacklog();
    this._updateCounter();
  }

  // ---------- click block → show delete ✕ ----------
  _onEventClick(info) {
    const p = info.event.extendedProps;
    if (p.kind !== 'block') return;
    if (!this._isSelected(p.taskId, p.subIndex)) return; // only selected editable

    this._clearClickedBlock();
    this._clickedBlock = { info, p };

    // inject a delete ✕ button into the event element
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

    const task = this.store.find(p.taskId);
    const st = task?.subtasks[p.subIndex];
    if (!task || !st) return;

    // selecting it will summon its card (via the isSelected check in _renderBacklog)
    this.selectedSubtask = { taskId: p.taskId, subIndex: p.subIndex };
    this._clearClickedBlock();
    this._renderBacklog();
    this.calendar.refetchEvents();
    this._updateCounter();
  }

  _selectSubtask(taskId, subIndex) {
    if (this._isSelected(taskId, subIndex)) {
      this.selectedSubtask = null; // deselect
    } else {
      this.selectedSubtask = { taskId, subIndex };
    }
    this._clearClickedBlock();
    this._renderBacklog();
    this.calendar.refetchEvents();
    this._updateCounter();
  }

  // ---------- backlog ----------
  async render() {
    if (!this.isActive || !this.calendar) return;
    this._renderBacklog();
    this._updateCounter();
  }
 
  _renderBacklog() {
    const cards = [];
    this.store.getAll().forEach((task) => {
      task.subtasks.forEach((st, subIndex) => {
        if (st.done) return;

        const remaining = st.estHoursNum - st.allocatedHours;
        const fullyScheduled = st.estHoursNum > 0 && remaining <= 0;
        const isSelected = this._isSelected(task.id, subIndex);

        // would this card normally be hidden?
        const wouldBeHidden = this.hideScheduled && fullyScheduled;

        // show it if not hidden, OR if it's selected (summoned)
        if (wouldBeHidden && !isSelected) return;

        // "popped" = a card that's only visible because it was summoned
        const isPopped = wouldBeHidden && isSelected;

        cards.push({ task, st, subIndex, remaining, isPopped });
      });
    });

    // Sort: popped (summoned-but-otherwise-hidden) cards first;
    // everyone else keeps natural order (needs-time first, then rest)
    cards.sort((a, b) => {
      // only popped cards jump to front
      const aPop = a.isPopped ? 0 : 1;
      const bPop = b.isPopped ? 0 : 1;
      if (aPop !== bPop) return aPop - bPop;

      // otherwise: natural order — needs-time first, more hours first
      const aNeeds = a.remaining > 0 ? 0 : 1;
      const bNeeds = b.remaining > 0 ? 0 : 1;
      if (aNeeds !== bNeeds) return aNeeds - bNeeds;
      return b.remaining - a.remaining;
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
    if (this._isSelected(task.id, subIndex)) card.classList.add('selected');

    const est = st.estHoursNum;
    const remaining = est - st.allocatedHours;
    let statusHtml;
    if (est === 0) statusHtml = `<span class="card-status neutral">${st.allocatedHours}h scheduled</span>`;
    else if (remaining > 0) statusHtml = `<span class="card-status pending">${remaining}h left</span>`;
    else statusHtml = `<span class="card-status scheduled">✓ scheduled</span>`;

    const dueHtml = st.due ? `<span class="card-due">Due ${this._fmtDue(st.due)}</span>` : '';

    card.innerHTML = `
      <div class="card-task" style="color:${task.color};">${this._esc(task.name)}</div>
      <div class="card-sub">${this._esc(st.name)}</div>
      <div class="card-meta">${statusHtml}${dueHtml}</div>`;

    card.addEventListener('click', () => this._selectSubtask(task.id, subIndex));
    return card;
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
}