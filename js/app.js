import { TaskStore } from './services/TaskStore.js';
import { GoogleCalendar } from './services/GoogleCalendar.js';
import { GoogleDrive } from './services/GoogleDrive.js';
import { GridView } from './views/GridView.js';
import { TaskModal } from './views/TaskModal.js';
import { CalendarView } from './views/CalendarView.js';
import { DeleteDialog } from './views/DeleteDialog.js';
import { DayView } from './views/DayView.js';
import { Settings } from './services/Settings.js';
import { CalendarPicker } from './views/CalendarPicker.js';
import { PlannerView } from './views/PlannerView.js';
import { ProgressView } from './views/ProgressView.js';

class App {
  constructor() {
    // ---------- Services ----------
    this.store = new TaskStore();
    this.gcal = new GoogleCalendar();
    this.drive = new GoogleDrive(this.gcal);
    this.settings = new Settings();
    this.store.attachDrive(this.drive);
    this.dayView = new DayView(this.store, this.gcal);
    this.plannerView = new PlannerView(this.store, this.gcal, this.settings);
    this.progressView = new ProgressView(this.store);

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
      onDeleteTask: (id) => this._confirmDelete(id),
      onSchedule: (taskId, subIndex) => {
        this._schedQueue = []; // one-off, not a sequence
        this.calendarView.open(taskId, subIndex);
      },
      onToggleDone: (taskId, subIndex, checked) =>
        this._handleToggleDone(taskId, subIndex, checked),
    });

    // scheduling queue for multi-subtask sequences
    this._schedQueue = [];

    // ---------- Wiring ----------
    this._bindToolbar();
    this._bindAuth();
    this._bindLogin();
    this._bindTabs();
    // re-render grid whenever data changes
    this.store.subscribe(() => {
      this.grid.render();
      this.dayView.render();
      this.plannerView.refresh();
      this.progressView.refresh();
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
        await this._reconcile();       // ← sync with calendar after loading
      } else {
        this._showLogin();
        document.getElementById('syncBadge').textContent = '';
      }
    };
  }

  _showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    this.grid.render();
    this.dayView.render();
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
  }

  async _reconcile() {
    const btn = document.getElementById('refreshBtn');
    this.plannerView.refresh();
    if (btn) { btn.disabled = true; btn.textContent = '🔄 Syncing…'; }

    try {
      const changed = await this.store.reconcileWithCalendar(this.gcal);
      // always refresh the day view (it shows live calendar state)
      await this.dayView.render();
      this.grid.render();
      if (btn) btn.textContent = changed ? '🔄 Updated!' : '🔄 Up to date';
    } catch (e) {
      console.error('Reconcile failed:', e);
      if (btn) btn.textContent = '🔄 Refresh';
    } finally {
      setTimeout(() => {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh'; }
      }, 1500);
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
      // un-completing → reset; deleted blocks are dropped so the clock
      // shows amber (needs scheduling) automatically
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
      this.grid.render(); // uncheck the box
      return;
    }
    const actual = parseFloat(input);
    if (isNaN(actual) || actual < 0) {
      alert('Please enter a valid number of hours.');
      this.grid.render();
      return;
    }

    // ask what to do with calendar events (only if there are any + connected)
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

    const loggedTask = this.store.find(taskId);
    const loggedSt = loggedTask.subtasks[subIndex];
    this.store.logCompletion({
      taskName: loggedTask.name,
      subtaskName: loggedSt.name,
      subtaskId: loggedSt.id,
      hoursSpent: actual,
    });
    console.log('Logged completion:', loggedSt.name); 
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

      if (which === 'grid') {
        tabGrid.classList.add('active'); gridC.style.display = 'block';
        this.grid.render();
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
}

// Boot up
new App();