export class DeleteDialog {
  constructor() {
    this.backdrop = document.getElementById('delDialogBackdrop');
    this.title = document.getElementById('delDialogTitle');
    this.msg = document.getElementById('delDialogMsg');
    this._resolve = null;

    this.btnFuture = document.getElementById('delFuture');
    this.btnAll = document.getElementById('delAll');
    this.btnNone = document.getElementById('delNone');
    this.btnCancel = document.getElementById('delCancel');

    // store default labels to restore later
    this._defaults = {
      future: this.btnFuture.textContent,
      all: this.btnAll.textContent,
      none: this.btnNone.textContent,
      cancel: this.btnCancel.textContent,
    };

    this.btnFuture.addEventListener('click', () => this._choose('future'));
    this.btnAll.addEventListener('click', () => this._choose('all'));
    this.btnNone.addEventListener('click', () => this._choose('none'));
    this.btnCancel.addEventListener('click', () => this._choose('cancel'));
  }

  // Returns a Promise resolving to: 'future' | 'all' | 'none' | 'cancel'
  // Options:
  //   labels: { future, all, none, cancel } — custom button text
  //   hide:   ['future', ...] — buttons to hide for this dialog
  open({ title = 'Delete', message = '', labels = {}, hide = [] } = {}) {
    this.title.textContent = title;
    this.msg.textContent = message;

    // apply custom labels (or restore defaults)
    this.btnFuture.textContent = labels.future || this._defaults.future;
    this.btnAll.textContent = labels.all || this._defaults.all;
    this.btnNone.textContent = labels.none || this._defaults.none;
    this.btnCancel.textContent = labels.cancel || this._defaults.cancel;

    // show all, then hide requested
    this.btnFuture.style.display = '';
    this.btnAll.style.display = '';
    this.btnNone.style.display = '';
    this.btnCancel.style.display = '';
    hide.forEach((key) => {
      const btn = { future: this.btnFuture, all: this.btnAll,
                    none: this.btnNone, cancel: this.btnCancel }[key];
      if (btn) btn.style.display = 'none';
    });

    this.backdrop.classList.add('open');
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  _choose(choice) {
    this.backdrop.classList.remove('open');
    // restore default labels + show all buttons for next use
    this._restore();
    if (this._resolve) {
      this._resolve(choice);
      this._resolve = null;
    }
  }

  _restore() {
    this.btnFuture.textContent = this._defaults.future;
    this.btnAll.textContent = this._defaults.all;
    this.btnNone.textContent = this._defaults.none;
    this.btnCancel.textContent = this._defaults.cancel;
    this.btnFuture.style.display = '';
    this.btnAll.style.display = '';
    this.btnNone.style.display = '';
    this.btnCancel.style.display = '';
  }
}