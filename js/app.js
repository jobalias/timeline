import { TaskStore } from './services/TaskStore.js';
import { GoogleCalendar } from './services/GoogleCalendar.js';
import { GoogleDrive } from './services/GoogleDrive.js';
import { GridView } from './views/GridView.js';
import { TaskModal } from './views/TaskModal.js';
import { NoteModal } from './views/NoteModal.js';
import { CalendarView } from './views/CalendarView.js';
import { DeleteDialog } from './views/DeleteDialog.js';
import { DayView } from './views/DayView.js';
import { Settings } from './services/Settings.js';
import { CalendarPicker } from './views/CalendarPicker.js';
import { PlannerView } from './views/PlannerView.js';
import { ProgressView } from './views/ProgressView.js';
import { escapeHtml } from './utils.js'; 
import { Task } from './models/Task.js'; 

class App {
  constructor() {
    // ---------- Services ----------
    this.store = new TaskStore();
    this.gcal = new GoogleCalendar();
    this.drive = new GoogleDrive(this.gcal);
    this.settings = new Settings();
    this.store.attachDrive(this.drive);
    this.plannerView = new PlannerView(this.store, this.gcal, this.settings);
    this.progressView = new ProgressView(this.store);
    this.noteModal = new NoteModal(this.store, {
          onSaved: (saved) => this._onNoteSaved(saved), // Chunk 2 syncs to calendar
        });
    this.activeView = 'grid';
    // sync status → toolbar
    const syncEl = document.getElementById('syncStatus');
    // sync status → badge + warning banner
    const badge = document.getElementById('syncBadge');
    const warning = document.getElementById('syncWarning');
    const warningText = document.getElementById('syncWarningText');
    // warn if closing while a save is pending or failed
    window.addEventListener('beforeunload', (e) => {
      const s = this.store._status;
      if (s === 'saving' || s === 'failed') {
        e.preventDefault();
        e.returnValue = ''; // triggers browser's "unsaved changes" prompt
      }
    });
    window.addEventListener('online', () => {
      const s = this.store._status;
      if (s === 'failed' || s === 'offline') {
        this.store._saveRemote();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.store._status === 'failed') {
        this.store._saveRemote();
      }
    });
    this.store.onSyncStatus((status) => {
      badge.className = 'sync-badge ' + status;
      warning.style.display = 'none';

      switch (status) {
        case 'synced':
          badge.textContent = '● Synced ✓';
          break;
        case 'saving':
          badge.textContent = '● Saving…';
          break;
        case 'failed':
          badge.textContent = '● SAVE FAILED';
          warning.style.display = 'block';
          warningText.textContent =
            'Your changes are NOT saving to Google Drive. Check your connection and try re-signing in. Do not rely on this data until it says Synced.';
          break;
        case 'offline':
          badge.textContent = '● Offline';
          warning.style.display = 'block';
          warningText.textContent =
            'Not connected to Google Drive. Changes are only saved in this browser. Sign in to sync.';
          break;
        default:
          badge.textContent = '● …';
      }
    });

    // ---------- Dialogs / Modals / Views ----------
    this.deleteDialog = new DeleteDialog();

    this.calendarView = new CalendarView(this.store, this.gcal, this.settings, {
      onDone: (finishedContext) => this._advanceScheduling(finishedContext),
    });

    this.dayView = new DayView(this.store, this.gcal, this.settings);

    this.calendarPicker = new CalendarPicker(this.gcal, this.settings, {
      onSave: () => this.dayView.render(), // refresh day view with new selection
    });

    this.deleteDialog = new DeleteDialog();

    this.taskModal = new TaskModal(this.store, this.gcal, this.deleteDialog, {
      onAfterSave: (taskId, newSubtaskIndices) =>
        this._startSchedulingSequence(taskId, newSubtaskIndices),
    });

    this.grid = new GridView(this.store, {
      onEditTask: (id) => this.taskModal.openEdit(id),
      onDeleteTask: (id) => this._handleDeleteTask(id),
      onSchedule: (taskId, subIndex) => {
        this._schedQueue = [];
        this.calendarView.open(taskId, subIndex);
      },
      onToggleDone: (taskId, subIndex, checked) =>
        this._handleToggleDone(taskId, subIndex, checked),
      onOpenTaskNote: (taskId) => this.noteModal.openForTask(taskId),        
      onOpenSubtaskNote: (taskId, subIndex) =>                               
        this.noteModal.openForSubtask(taskId, subIndex),
      onToggleWaiting: (taskId, subIndex) => {
        this.store.toggleWaiting(taskId, subIndex);
      },
    });

    this.grid.onOpenTaskNote = (taskId) => this.noteModal.openForTask(taskId);
    this.grid.onOpenSubtaskNote = (taskId, subIndex) =>
    this.noteModal.openForSubtask(taskId, subIndex);

    // scheduling queue for multi-subtask sequences
    this._schedQueue = [];

    // ---------- Wiring ----------
    this._bindToolbar();
    this._bindAuth();
    this._bindLogin();
    this._bindTabs();
    this._bindSettings();
    this.store.subscribe(() => {
      const view = this.activeView || 'grid';
      if (view === 'grid') {
        this.grid.render();
        this.dayView.render();
      } else if (view === 'planner') {
        this.plannerView.refresh();
      } else if (view === 'progress') {
        this.progressView.refresh();
      }
    });

    // start Google (will auto-restore session if a token is saved)
    this.gcal.init();
  }

  // ==================== Login / Auth ====================
  _bindLogin() {
    document.getElementById('loginBtn')
      .addEventListener('click', () => this.gcal.toggleAuth());
  }

  _bindAuth() {
    const authBtn = document.getElementById('authBtn');
    authBtn.addEventListener('click', () => this.gcal.toggleAuth());

    this.gcal.onAuthChange = async (connected) => {
      if (connected) {
        this._showApp();
        await this.store.loadFromDrive();
        this.gcal.syncEnabled = this.store.getCalendarSyncEnabled(); // ← apply loaded setting
        await this._reconcile();
      } else {
        this._showLogin();
        document.getElementById('syncBadge').textContent = '';
      }
    };
  }

  _bindSettings() {
    const backdrop = document.getElementById('settingsBackdrop');
    const toggle = document.getElementById('syncToggle');
    const expandBtn = document.getElementById('calExpandBtn');
    const chevron = document.getElementById('calChevron');
    const expandBody = document.getElementById('calExpandBody');
    const alwaysExpandBtn = document.getElementById('alwaysExpandBtn');
    const alwaysChevron = document.getElementById('alwaysChevron');
    const alwaysBody = document.getElementById('alwaysExpandBody');
    const alwaysAddBtn = document.getElementById('alwaysAddBtn');
    const alwaysAddInput = document.getElementById('alwaysAddInput');

    alwaysExpandBtn.addEventListener('click', () => {
      const isOpen = alwaysBody.style.display !== 'none';
      alwaysBody.style.display = isOpen ? 'none' : 'block';
      alwaysChevron.classList.toggle('open', !isOpen);
      if (!isOpen) this._renderAlwaysList();
    });

    const addAlways = () => {
      const name = alwaysAddInput.value.trim();
      if (!name) return;
      this._addAlwaysTask(name);
    };
    alwaysAddBtn.addEventListener('click', addAlways);
    alwaysAddInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addAlways(); });

    // open settings
    document.getElementById('settingsBtn').addEventListener('click', () => {
      toggle.checked = this.store.getCalendarSyncEnabled();
      this.calendarPicker.populateList();
      this._renderAlwaysList();
      const sc = document.getElementById('showCompletedSetting');   // ← ADD
      if (sc) sc.checked = this.grid.showCompleted;                 // ← ADD
      backdrop.classList.add('open');
    });

    // expandable calendar section
    expandBtn.addEventListener('click', () => {
      const isOpen = expandBody.style.display !== 'none';
      expandBody.style.display = isOpen ? 'none' : 'block';
      chevron.classList.toggle('open', !isOpen);
    });

    // cancel
    document.getElementById('settingsCancelBtn').addEventListener('click', () => {
      backdrop.classList.remove('open');
    });

    // save
    document.getElementById('settingsSaveBtn').addEventListener('click', async () => {
      const saveBtn = document.getElementById('settingsSaveBtn');
      const cancelBtn = document.getElementById('settingsCancelBtn');
      const newSync = toggle.checked;
      const oldSync = this.store.getCalendarSyncEnabled();

      this.calendarPicker.saveSelection();

      if (newSync !== oldSync) {
        if (!newSync) {
          // Turning sync OFF
          saveBtn.disabled = true;
          cancelBtn.disabled = true;
          const handled = await this._handleSyncOff(saveBtn);
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
          saveBtn.textContent = 'Save';
          if (!handled) {
            toggle.checked = true;
            return;
          }
        } else {
          // Turning sync ON
          saveBtn.disabled = true;
          cancelBtn.disabled = true;
          const handled = await this._handleSyncOn(saveBtn);
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
          saveBtn.textContent = 'Save';
          if (!handled) {
            toggle.checked = false; // cancelled → revert
            return;
          }
        }
      }

      backdrop.classList.remove('open');
      this.dayView.render();
      this.plannerView.refresh();
      this.grid.render();
    });
  }

  // Returns true if the transition completed, false if cancelled
  async _handleSyncOn(saveBtn) {
    // enable sync first so writes work
    this.store.setCalendarSyncEnabled(true);
    this.gcal.syncEnabled = true;

    if (!this.gcal.isAuthed) return true;

    const unsyncedCount = this.store.countBlocksWithoutEvents();
    console.log('🔍 unsyncedCount:', unsyncedCount);  // ← add

    // also log block details
    this.store.getAll().forEach((t) => {
      t.subtasks.forEach((st) => {
        st.blocks.forEach((b) => {
          console.log(`block: ${t.name}/${st.name} date=${b.date} eventId=${b.eventId} done=${st.done}`);
        });
      });
    });
    // nothing to push → done
    if (unsyncedCount === 0) return true;

    const choice = await this.deleteDialog.open({
      title: 'Turn on calendar sync?',
      message: `You have ${unsyncedCount} scheduled block${unsyncedCount === 1 ? '' : 's'} not yet on your Google Calendar. ` +
               `Add ${unsyncedCount === 1 ? 'it' : 'them'} now?`,
      labels: {
        all: `📅 Add ${unsyncedCount === 1 ? 'it' : 'all'} to my calendar`,
        none: 'Only sync new blocks from now on',
        cancel: 'Cancel',
      },
      hide: ['future'],
    });

    if (choice === 'cancel') {
      // revert sync (user backed out)
      this.store.setCalendarSyncEnabled(false);
      this.gcal.syncEnabled = false;
      return false;
    }

    if (choice === 'all') {
      await this.store.pushUnsyncedBlocks(this.gcal, (done, total) => {
        if (saveBtn) saveBtn.textContent = `Adding ${done} of ${total}…`;
      });
    }
    // 'none' → leave existing blocks app-only; only future blocks sync

    return true;
  }

  async _handleSyncOff(saveBtn) {
    const eventCount = this.store.countBlocksWithEvents();

    if (eventCount === 0 || !this.gcal.isAuthed) {
      this.store.setCalendarSyncEnabled(false);
      this.gcal.syncEnabled = false;
      return true;
    }

    const choice = await this.deleteDialog.open({
      title: 'Turn off calendar sync?',
      message: `You have ${eventCount} event${eventCount === 1 ? '' : 's'} on your Google Calendar from this app. ` +
               `Your blocks stay in the app either way. What should happen to the calendar events?`,
      labels: {
        all: '🗑 Delete all calendar events',
        none: '📌 Keep events on my calendar',
        cancel: 'Cancel',
      },
      hide: ['future'],
    });

    if (choice === 'cancel') return false;

    if (choice === 'all') {
      await this.store.deleteAllCalendarEvents(this.gcal, (done, total) => {
        if (saveBtn) saveBtn.textContent = `Deleting ${done} of ${total}…`;
      });
    }

    this.store.setCalendarSyncEnabled(false);
    this.gcal.syncEnabled = false;
    return true;
  }

  // ==================== Task deletion ====================
// ==================== Task deletion ====================
async _handleDeleteTask(id) {
  const task = this.store.find(id);
  if (!task) return;

  // --- Persistent task WITH subtasks → delete-all vs. demote ---
  if (task.persistent && task.subtasks.length > 0) {
    const choice = await this.deleteDialog.open({
      title: `Delete "${task.name}"?`,
      message: 'This is an Always Task with subtasks. Delete everything, or just make it a normal task?',
      labels: {
        all: '🗑 Delete task and all subtasks',
        none: '📌 Keep it — just make it non-persistent',
        cancel: 'Cancel',
      },
      hide: ['future'],
    });

    if (choice === 'cancel') return;

    if (choice === 'none') {
      // demote: keep task + subtasks, no calendar changes
      task.persistent = false;
      this.store._save();            // persists + notifies (re-renders grid)
      this._renderAlwaysList();      // refresh settings list if open
      return;
    }
    // choice === 'all' → fall through to normal deletion below
    // (if it has calendar events, a 2nd dialog asks about them — you're OK with that)
  }

  // --- Persistent task with NO subtasks → just delete (per Q1) ---
  if (task.persistent && task.subtasks.length === 0) {
    await this.store.removeTask(id, 'none', this.gcal);
    this._renderAlwaysList();
    return;
  }

  // --- Normal deletion (handles calendar events) ---
  const hasEvents = task.subtasks.some((s) => s.blocks.some((b) => b.eventId));

  if (!hasEvents || !this.gcal.isAuthed) {
    if (confirm(`Delete "${task.name}" and all its subtasks?`)) {
      await this.store.removeTask(id, 'none', this.gcal);
    }
    this._renderAlwaysList();
    return;
  }

  const choice = await this.deleteDialog.open({
    title: `Delete "${task.name}"?`,
    message: 'This task has calendar events. What should happen to them?',
  });
  if (choice === 'cancel') return;

  await this.store.removeTask(id, choice, this.gcal);
  this._renderAlwaysList();
}

  _showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    this.grid.render();
    this.grid.onShow();
    this.dayView.render();
    this.dayView.startNowLineTimer(); 
  }

  _showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
  }

  // ==================== Toolbar ====================
  _bindToolbar() {
    document.getElementById('addTaskBtn')
      .addEventListener('click', () => this.taskModal.openNew());
    document.getElementById('refreshBtn')
      .addEventListener('click', () => this._reconcile());
    document.getElementById('plannerRefreshBtn')
      .addEventListener('click', () => this._reconcile());
  }

  async _reconcile() {
  const gridBtn = document.getElementById('refreshBtn');
  const plannerBtn = document.getElementById('plannerRefreshBtn');
  const btn = this.activeView === 'planner' ? plannerBtn : gridBtn;
  this.plannerView.refresh();
  if (btn) { btn.disabled = true; btn.classList.add('syncing'); }   // ← class, not text

  try {
    const changed = await this.store.reconcileWithCalendar(this.gcal);
    await this.dayView.render();
    this.grid.render();
  } catch (e) {
    console.error('Reconcile failed:', e);
  } finally {
    setTimeout(() => {
      if (btn) { btn.disabled = false; btn.classList.remove('syncing'); }  // ← class
    }, 800);
  }
}

  // ==================== Task deletion ====================
  async _confirmDelete(id) {
    const task = this.store.find(id);
    if (!task) return;

    const hasEvents = task.subtasks.some((s) =>
      s.blocks.some((b) => b.eventId)
    );

    // no events or not connected → simple confirm
    if (!hasEvents || !this.gcal.isAuthed) {
      if (confirm(`Delete "${task.name}" and all its subtasks?`)) {
        await this.store.removeTask(id, 'none', this.gcal);
      }
      return;
    }

    // has events → three-option dialog
    const choice = await this.deleteDialog.open({
      title: `Delete "${task.name}"?`,
      message: 'This task has calendar events. What should happen to them?',
    });
    if (choice === 'cancel') return;

    await this.store.removeTask(id, choice, this.gcal);
  }

  // ==================== Complete / Un-complete ====================
  async _handleToggleDone(taskId, subIndex, checked) {
    if (!checked) {
      this.store.uncompleteSubtask(taskId, subIndex);
      return;
    }

    const st = this.store.find(taskId).subtasks[subIndex];
    const suggested = st.allocatedHours || st.estHoursNum || 0;
    const input = prompt(
      `Marking "${st.name}" as done.\nHow many hours did you actually spend?`,
      suggested
    );

    if (input === null) {
      this.grid.render();
      this.grid.onShow();
      return;
    }
    const actual = parseFloat(input);
    if (isNaN(actual) || actual < 0) {
      alert('Please enter a valid number of hours.');
      this.grid.render();
      this.grid.onShow();
      return;
    }

    let scope = 'none';
    const hasEvents = st.blocks.some((b) => b.eventId);
    if (hasEvents && this.gcal.isAuthed) {
      scope = await this.deleteDialog.open({
        title: 'Task complete!',
        message: 'What should happen to the remaining calendar events?',
      });
      if (scope === 'cancel') {
        this.grid.render();
        return;
      }
    }

    await this.store.completeSubtask(taskId, subIndex, actual, scope, this.gcal);

    // check if the WHOLE task is now complete (re-fetch fresh references)
    const t = this.store.find(taskId);
    const completedSt = t.subtasks[subIndex];   // ← renamed from `st` to avoid redeclare
    const taskJustCompleted = t.subtasks.every((s) => s.done);

    this.store.logCompletion({
      taskId: t.id,
      taskName: t.name,
      subtaskName: completedSt.name,            // ← use renamed var
      subtaskId: completedSt.id,
      hoursSpent: actual,
      taskJustCompleted,
    });
  }

  // ==================== Sequential scheduling ====================
  _startSchedulingSequence(taskId, newSubtaskIndices) {
    const task = this.store.find(taskId);
    if (!task || task.subtasks.length === 0) return;

    this._currentSchedulingTaskId = taskId;

    // If newSubtaskIndices is provided (even if empty), use it exactly.
    // Empty array = nothing new = don't schedule anything.
    // Only fall back to "all" if it's truly undefined/null.
    const indices = Array.isArray(newSubtaskIndices)
      ? newSubtaskIndices
      : task.subtasks.map((_, i) => i);

    this._schedQueue = indices
      .map((i) => ({ taskId, subIndex: i, st: task.subtasks[i] }))
      .filter((x) => x.st && x.st.estHoursNum > 0 && !x.st.done);

    this._nextInQueue();
  }

  _nextInQueue() {
    if (!this._schedQueue || this._schedQueue.length === 0) {
      this._currentSchedulingTaskId = null; // sequence done
      return;
    }
    const next = this._schedQueue.shift();
    this.calendarView.open(next.taskId, next.subIndex, { sequence: true });
  }

  _advanceScheduling(result) {
    // result: { cancelled, discardTask } or null (legacy)
    const cancelled = result === null || result?.cancelled;
    const discardTask = result?.discardTask;

    if (discardTask && this._currentSchedulingTaskId) {
      // delete the freshly-created task (user cancelled during creation)
      this._discardTask(this._currentSchedulingTaskId);
    }

    if (cancelled) {
      this._schedQueue = [];
      this._currentSchedulingTaskId = null;
      return;
    }

    this._nextInQueue();
    this.grid.render();
    this.dayView.render();
  }

  _bindTabs() {
    const tabGrid = document.getElementById('tabGrid');
    const tabPlanner = document.getElementById('tabPlanner');
    const tabProgress = document.getElementById('tabProgress');
    const gridC = document.getElementById('gridViewContainer');
    const planC = document.getElementById('plannerViewContainer');
    const progC = document.getElementById('progressViewContainer');

    const show = (which) => {
      [tabGrid, tabPlanner, tabProgress].forEach((t) => t.classList.remove('active'));
      [gridC, planC, progC].forEach((c) => (c.style.display = 'none'));
      this.plannerView.deactivate();
      this.progressView.deactivate();
      this.dayView.stopNowLineTimer(); 
      this.activeView = which;
      if (which === 'grid') {
        tabGrid.classList.add('active'); gridC.style.display = 'block';
        this.grid.render();
        this.grid.onShow(); 
        this.dayView.startNowLineTimer();
      } else if (which === 'planner') {
        tabPlanner.classList.add('active'); planC.style.display = 'block';
        this.plannerView.activate();
      } else {
        tabProgress.classList.add('active'); progC.style.display = 'block';
        this.progressView.activate();
      }
    };

    tabGrid.addEventListener('click', () => show('grid'));
    tabPlanner.addEventListener('click', () => show('planner'));
    tabProgress.addEventListener('click', () => show('progress'));

    // reuse for plannerAddTask etc. if needed
    document.getElementById('plannerAddTaskBtn')
      ?.addEventListener('click', () => this.taskModal.openNew());
  }

  async _discardTask(taskId) {
    const task = this.store.find(taskId);
    if (!task) return;

    // if any blocks were already created (earlier subtasks in the sequence),
    // delete their Google events too
    const hasEvents = task.subtasks.some((s) => s.blocks.some((b) => b.eventId));
    if (hasEvents && this.gcal.isAuthed) {
      await this.store.removeTask(taskId, 'all', this.gcal); // deletes events + task
    } else {
      await this.store.removeTask(taskId, 'none', this.gcal); // just remove task
    }
  }

  async _onNoteSaved(saved) {
    // saved = { type, taskId, subIndex?, note }
    if (saved.type !== 'subtask') return; // task notes are app-only

    if (!this.gcal.isAuthed) return;

    const task = this.store.find(saved.taskId);
    if (!task) return;
    const st = task.subtasks[saved.subIndex];
    if (!st) return;

    // write the note to every event's description for this subtask
    for (const b of st.blocks) {
      if (!b.eventId) continue;
      try {
        await this.gcal.updateEventDescription(b.eventId, saved.note);
      } catch (e) {
        console.warn('Failed to sync note to event:', e);
      }
    }
  }

  // ==================== Always Tasks (settings) ====================
  _renderAlwaysList() {
    const list = document.getElementById('alwaysTaskList');
    if (!list) return;
    const always = this.store.getAll().filter((t) => t.persistent);

    if (always.length === 0) {
      list.innerHTML = '<div class="always-empty">No always-tasks yet.</div>';
      return;
    }

    list.innerHTML = always.map((t) => `
      <div class="always-row" data-task-id="${t.id}">
        <span>${escapeHtml(t.name)}</span>
        <button class="always-del" data-task-id="${t.id}" title="Remove">➖</button>
      </div>
    `).join('');

    list.querySelectorAll('.always-del').forEach((btn) => {
      btn.addEventListener('click', () => this._handleDeleteTask(btn.dataset.taskId));
    });
  }

  // case-insensitive, trimmed name match
  _findTaskByName(name) {
    const norm = name.trim().toLowerCase();
    return this.store.getAll().find((t) => t.name.trim().toLowerCase() === norm);
  }
  _addAlwaysTask(name) {
    const input = document.getElementById('alwaysAddInput');
    const match = this._findTaskByName(name);

    if (match) {
      if (match.persistent) {
        this._flashAlwaysError('Already an always task.');   // red + blocked
        return;
      }
      // normal task (completed or ongoing) → confirm convert
      const ok = confirm(
        `"${match.name}" already exists. Make it an always task?\n\n` +
        `(It keeps its current subtasks — click Cancel to use a different name.)`
      );
      if (!ok) { input.focus(); return; }

      match.persistent = true;
      this.store._save();            // persist + re-render grid
      input.value = '';
      this._clearAlwaysError();
      this._renderAlwaysList();
      return;
    }

    // no match → create new persistent task
    const task = new Task({ name: name.trim(), persistent: true });
    this.store.add(task);
    input.value = '';
    this._clearAlwaysError();
    this._renderAlwaysList();
  }

  _flashAlwaysError(msg) {
    const input = document.getElementById('alwaysAddInput');
    input.classList.add('input-error');
    let note = document.getElementById('alwaysAddNote');
    if (!note) {
      note = document.createElement('div');
      note.id = 'alwaysAddNote';
      note.style.cssText = 'color:var(--danger);font-size:12px;margin-top:4px;';
      input.closest('.settings-expand-body').appendChild(note);
    }
    note.textContent = msg;
    const clear = () => this._clearAlwaysError();
    input.addEventListener('input', clear, { once: true });
  }
  _clearAlwaysError() {
    const input = document.getElementById('alwaysAddInput');
    input.classList.remove('input-error');
    const note = document.getElementById('alwaysAddNote');
    if (note) note.textContent = '';
  }
}

// Boot up
new App();