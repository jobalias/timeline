// Owns the ⚙️ settings popup: calendar sync on/off flows, calendar picker, show-completed,
// the two expanders, and (via AlwaysTasksList) the Always Tasks section.

import { Modal } from '../core/Modal.js';
import { AlwaysTasksList } from './AlwaysTasksList.js';

export class SettingsController extends Modal {
  constructor(store, gcal, deleteDialog, { calendarPicker, grid, onSaved, onDeleteTask }) {
    super('settingsBackdrop');
    this.store = store;
    this.gcal = gcal;
    this.deleteDialog = deleteDialog;
    this.calendarPicker = calendarPicker;
    this.grid = grid;
    this.onSaved = onSaved;

    this.syncToggle = document.getElementById('syncToggle');
    this.saveBtn = document.getElementById('settingsSaveBtn');
    this.cancelBtn = document.getElementById('settingsCancelBtn');

    this.alwaysTasks = new AlwaysTasksList(store, { onDeleteTask });

    this._bindExpander('calExpandBtn', 'calChevron', 'calExpandBody');
    this._bindExpander('alwaysExpandBtn', 'alwaysChevron', 'alwaysExpandBody',
      () => this.alwaysTasks.render());

    document.getElementById('settingsBtn').addEventListener('click', () => this.open());
    this.cancelBtn.addEventListener('click', () => this.close());
    this.saveBtn.addEventListener('click', () => this._save());
  }

  open() {
    this.syncToggle.checked = this.store.getCalendarSyncEnabled();
    this.calendarPicker.populateList();
    this.alwaysTasks.render();
    const showCompleted = document.getElementById('showCompletedSetting');
    if (showCompleted) showCompleted.checked = this.grid.showCompleted;
    this.show();
  }

  async _save() {
    const newSync = this.syncToggle.checked;
    const oldSync = this.store.getCalendarSyncEnabled();

    this.calendarPicker.saveSelection();

    if (newSync !== oldSync) {
      const completed = await this._withButtonsLocked(() =>
        newSync ? this._turnSyncOn() : this._turnSyncOff());
      if (!completed) {
        this.syncToggle.checked = oldSync; // cancelled → revert
        return;
      }
    }

    this.close();
    this.onSaved();
  }

  _bindExpander(btnId, chevronId, bodyId, onOpen = null) {
    const chevron = document.getElementById(chevronId);
    const body = document.getElementById(bodyId);

    document.getElementById(btnId).addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      chevron.classList.toggle('open', !isOpen);
      if (!isOpen && onOpen) onOpen();
    });
  }

  async _withButtonsLocked(action) {
    this.saveBtn.disabled = true;
    this.cancelBtn.disabled = true;
    const result = await action();
    this.saveBtn.disabled = false;
    this.cancelBtn.disabled = false;
    this.saveBtn.textContent = 'Save';
    return result;
  }

  _showProgress(text) {
    this.saveBtn.textContent = text;
  }

  _setCalendarSync(enabled) {
    this.store.setCalendarSyncEnabled(enabled);
    this.gcal.syncEnabled = enabled;
  }

  // Both return true if the transition completed, false if cancelled.
  async _turnSyncOn() {
    // enable first so the pushes below are allowed to write
    this._setCalendarSync(true);
    if (!this.gcal.isAuthed) return true;

    const count = this.store.countBlocksWithoutEvents();
    if (count === 0) return true;

    const single = count === 1;
    const choice = await this.deleteDialog.open({
      title: 'Turn on calendar sync?',
      message: `You have ${count} scheduled block${single ? '' : 's'} not yet on your Google Calendar. ` +
               `Add ${single ? 'it' : 'them'} now?`,
      labels: {
        all: `📅 Add ${single ? 'it' : 'all'} to my calendar`,
        none: 'Only sync new blocks from now on',
        cancel: 'Cancel',
      },
      hide: ['future'],
    });

    if (choice === 'cancel') {
      this._setCalendarSync(false);
      return false;
    }

    // 'none' leaves existing blocks app-only; only future blocks sync
    if (choice === 'all') {
      await this.store.pushUnsyncedBlocks(this.gcal, (done, total) =>
        this._showProgress(`Adding ${done} of ${total}…`));
    }
    return true;
  }

  async _turnSyncOff() {
    const count = this.store.countBlocksWithEvents();

    if (count === 0 || !this.gcal.isAuthed) {
      this._setCalendarSync(false);
      return true;
    }

    const choice = await this.deleteDialog.open({
      title: 'Turn off calendar sync?',
      message: `You have ${count} event${count === 1 ? '' : 's'} on your Google Calendar from this app. ` +
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
      await this.store.deleteAllCalendarEvents(this.gcal, (done, total) =>
        this._showProgress(`Deleting ${done} of ${total}…`));
    }

    this._setCalendarSync(false);
    return true;
  }
}
