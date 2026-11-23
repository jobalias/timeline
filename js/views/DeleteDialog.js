import { Modal } from '../core/Modal.js';

const BUTTON_IDS = {
  future: 'delFuture',
  all: 'delAll',
  none: 'delNone',
  cancel: 'delCancel',
};

export class DeleteDialog extends Modal {
  constructor() {
    super('delDialogBackdrop');
    this.title = document.getElementById('delDialogTitle');
    this.msg = document.getElementById('delDialogMsg');
    this._resolve = null;

    this.buttons = {};
    this._defaults = {};   // original labels, restored after each use
    for (const [choice, id] of Object.entries(BUTTON_IDS)) {
      const btn = document.getElementById(id);
      this.buttons[choice] = btn;
      this._defaults[choice] = btn.textContent;
      btn.addEventListener('click', () => this._choose(choice));
    }
  }

  // Returns a Promise resolving to: 'future' | 'all' | 'none' | 'cancel'
  // Options:
  //   labels: { future, all, none, cancel } — custom button text
  //   hide:   ['future', ...] — buttons to hide for this dialog
  open({ title = 'Delete', message = '', labels = {}, hide = [] } = {}) {
    this.title.textContent = title;
    this.msg.textContent = message;
    this._configureButtons(labels, hide);
    this.show();
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  _choose(choice) {
    this.close();
    this._configureButtons();
    if (this._resolve) {
      this._resolve(choice);
      this._resolve = null;
    }
  }

  // apply custom labels / hidden buttons; with no arguments, restores the defaults
  _configureButtons(labels = {}, hide = []) {
    for (const [choice, btn] of Object.entries(this.buttons)) {
      btn.textContent = labels[choice] || this._defaults[choice];
      btn.style.display = hide.includes(choice) ? 'none' : '';
    }
  }
}
