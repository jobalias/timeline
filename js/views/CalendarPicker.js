import { escapeHtml } from '../utils.js';

export class CalendarPicker {
  constructor(gcal, settings, { onSave = () => {} } = {}) {
    this.gcal = gcal;
    this.settings = settings;
    this.onSave = onSave;
    this.list = document.getElementById('calPickerList');
  }

  // Fill the checkbox list (called when the Settings modal opens)
  async populateList() {
    if (!this.gcal.isAuthed) {
      this._showStatus('Sign in to choose calendars.', '#8e8e93');
      return;
    }
    this._showStatus('Loading calendars…', '#8e8e93');

    try {
      const calendars = await this.gcal.listCalendars();
      const selected = this.settings.getSelectedCalendars();
      this.list.innerHTML = '';
      calendars.forEach((cal) => this.list.appendChild(this._calendarRow(cal, selected.includes(cal.id))));
    } catch (err) {
      this._showStatus('Failed to load calendars.', '#cf222e');
      console.error(err);
    }
  }

  // Save the current checkbox selection (called when the Settings modal saves)
  saveSelection() {
    if (!this.list) return;
    const ids = [...this.list.querySelectorAll('input:checked')].map((c) => c.value);
    if (ids.length === 0) ids.push('primary');   // never empty
    this.settings.setSelectedCalendars(ids);
    this.onSave();
  }

  _calendarRow(cal, checked) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;';
    row.innerHTML = `
          <input type="checkbox" value="${cal.id}" ${checked ? 'checked' : ''}
            style="width:16px;height:16px;">
          <span>${escapeHtml(cal.name)}${cal.primary ? ' (main)' : ''}</span>`;
    return row;
  }

  _showStatus(text, color) {
    this.list.innerHTML = `<div style="color:${color};">${text}</div>`;
  }
}
