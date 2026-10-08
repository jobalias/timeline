export class CalendarPicker {
  constructor(gcal, settings, { onSave = () => {} } = {}) {
    this.gcal = gcal;
    this.settings = settings;
    this.onSave = onSave;

    this.list = document.getElementById('calPickerList');
  }

  // Populate the checkbox list (called when the Settings modal opens)
  async populateList() {
    if (!this.gcal.isAuthed) {
      this.list.innerHTML =
        '<div style="color:#8e8e93;">Sign in to choose calendars.</div>';
      return;
    }
    this.list.innerHTML = '<div style="color:#8e8e93;">Loading calendars…</div>';

    try {
      const calendars = await this.gcal.listCalendars();
      const selected = this.settings.getSelectedCalendars();
      this.list.innerHTML = '';
      calendars.forEach((cal) => {
        const checked = selected.includes(cal.id) ? 'checked' : '';
        const row = document.createElement('label');
        row.style.cssText =
          'display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;';
        row.innerHTML = `
          <input type="checkbox" value="${cal.id}" ${checked}
            style="width:16px;height:16px;">
          <span>${this._esc(cal.name)}${cal.primary ? ' (main)' : ''}</span>`;
        this.list.appendChild(row);
      });
    } catch (err) {
      this.list.innerHTML =
        '<div style="color:#cf222e;">Failed to load calendars.</div>';
      console.error(err);
    }
  }

  // Save the current checkbox selection (called when Settings modal saves)
  saveSelection() {
    if (!this.list) return;
    const ids = [...this.list.querySelectorAll('input:checked')].map((c) => c.value);
    if (ids.length === 0) ids.push('primary'); // never empty
    this.settings.setSelectedCalendars(ids);
    this.onSave();
  }

  _esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}