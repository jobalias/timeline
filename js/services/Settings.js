const KEY = 'taskgrid_settings';

export class Settings {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  }

  _save() {
    localStorage.setItem(KEY, JSON.stringify(this.data));
  }

  // which calendar IDs to display (defaults to primary)
  getSelectedCalendars() {
    return this.data.selectedCalendars || ['primary'];
  }

  setSelectedCalendars(ids) {
    this.data.selectedCalendars = ids;
    this._save();
  }
}