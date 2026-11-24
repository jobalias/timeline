// Composition root: creates the services, views and controllers, wires them together, starts.

import { TaskStore } from './services/TaskStore.js';
import { GoogleCalendar } from './services/GoogleCalendar.js';
import { GoogleDrive } from './services/GoogleDrive.js';
import { Settings } from './services/Settings.js';
import { GridView } from './views/GridView.js';
import { TaskModal } from './views/TaskModal.js';
import { NoteModal } from './views/NoteModal.js';
import { CalendarView } from './views/CalendarView.js';
import { DeleteDialog } from './views/DeleteDialog.js';
import { DayView } from './views/DayView.js';
import { CalendarPicker } from './views/CalendarPicker.js';
import { PlannerView } from './views/PlannerView.js';
import { ProgressView } from './views/ProgressView.js';
import { WhiteboardView } from './views/WhiteboardView.js';
import { UndoControls } from './views/UndoControls.js';
import { SyncStatus } from './controllers/SyncStatus.js';
import { ViewSwitcher } from './controllers/ViewSwitcher.js';
import { SettingsController } from './controllers/SettingsController.js';
import { TaskActions } from './controllers/TaskActions.js';
import { SchedulingQueue } from './controllers/SchedulingQueue.js';
import { CalendarRefresh } from './controllers/CalendarRefresh.js';

class App {
  constructor() {
    this.store = new TaskStore();
    this.gcal = new GoogleCalendar();
    this.drive = new GoogleDrive(this.gcal);
    this.settings = new Settings();
    this.store.attachDrive(this.drive);

    this._createViews();
    this._createControllers();
    this.store.subscribe(() => this.viewSwitcher.renderActive());

    // will auto-restore the session if a token is saved
    this.gcal.init();
  }

  // name of the visible tab: 'grid' | 'planner' | 'progress' | 'whiteboard'
  get activeView() {
    return this.viewSwitcher.active;
  }

  _createViews() {
    this.plannerView = new PlannerView(this.store, this.gcal, this.settings);
    this.progressView = new ProgressView(this.store);
    this.noteModal = new NoteModal(this.store, {
      onSaved: (saved) => this.taskActions.syncNoteToCalendar(saved),
    });
    this.deleteDialog = new DeleteDialog();

    this.calendarView = new CalendarView(this.store, this.gcal, this.settings, {
      onDone: (result) => this.scheduling.advance(result),
    });
    this.dayView = new DayView(this.store, this.gcal, this.settings);
    this.calendarPicker = new CalendarPicker(this.gcal, this.settings, {
      onSave: () => this.dayView.render(),
    });

    this.taskModal = new TaskModal(this.store, this.gcal, this.deleteDialog, {
      onAfterSave: (taskId, newSubtaskIndices) => this.scheduling.start(taskId, newSubtaskIndices),
    });
    this.whiteboardView = new WhiteboardView(this.store, this.taskModal);
    this.undoControls = new UndoControls(this.store);

    this.grid = new GridView(this.store, {
      onEditTask: (id) => this.taskModal.openEdit(id),
      onDeleteTask: (id) => this.taskActions.deleteTask(id),
      onSchedule: (taskId, subIndex) => {
        this.scheduling.clear();
        this.calendarView.open(taskId, subIndex);
      },
      onToggleDone: (taskId, subIndex, checked) => this.taskActions.toggleDone(taskId, subIndex, checked),
      onOpenTaskNote: (taskId) => this.noteModal.openForTask(taskId),
      onOpenSubtaskNote: (taskId, subIndex) => this.noteModal.openForSubtask(taskId, subIndex),
      onToggleWaiting: (taskId, subIndex) => this.store.toggleWaiting(taskId, subIndex),
    });
  }

  _createControllers() {
    this.taskActions = new TaskActions(this.store, this.gcal, this.deleteDialog, this.grid, {
      onAlwaysTasksChanged: () => this.settingsPanel.alwaysTasks.render(),
    });
    this.scheduling = new SchedulingQueue(this.store, {
      openScheduler: (taskId, subIndex, opts) => this.calendarView.open(taskId, subIndex, opts),
      onDiscardTask: (taskId) => this.taskActions.discardTask(taskId),
      onAdvanced: () => {
        this.grid.render();
        this.dayView.render();
      },
    });

    this.syncStatus = new SyncStatus(this.store);
    document.getElementById('addTaskBtn').addEventListener('click', () => this.taskModal.openNew());
    this.refresher = new CalendarRefresh(this.store, this.gcal, {
      plannerView: this.plannerView,
      dayView: this.dayView,
      grid: this.grid,
      getActiveView: () => this.activeView,
    });
    this._bindAuth();
    this.viewSwitcher = new ViewSwitcher(this);
    document.getElementById('plannerAddTaskBtn')?.addEventListener('click', () => this.taskModal.openNew());
    this.settingsPanel = new SettingsController(this.store, this.gcal, this.deleteDialog, {
      calendarPicker: this.calendarPicker,
      grid: this.grid,
      onDeleteTask: (id) => this.taskActions.deleteTask(id),
      onSaved: () => {
        this.dayView.render();
        this.plannerView.refresh();
        this.grid.render();
      },
    });

    for (const id of ['clearCompletedBtn', 'clearCompletedSettingBtn']) {
      document.getElementById(id).addEventListener('click', () => this.taskActions.clearCompleted());
    }
  }

  // ==================== Login / Auth ====================
  _bindAuth() {
    for (const id of ['authBtn', 'loginBtn']) {
      document.getElementById(id).addEventListener('click', () => this.gcal.toggleAuth());
    }

    this.gcal.onAuthChange = async (connected) => {
      if (connected) {
        this._showApp();
        await this.store.loadFromDrive();
        this.gcal.syncEnabled = this.store.getCalendarSyncEnabled();
        await this.refresher.reconcile();
      } else {
        this._showLogin();
        this.syncStatus.clear();
      }
    };
  }

  _showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    this.viewSwitcher.show(this.activeView);
  }

  _showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
  }
}

new App();
