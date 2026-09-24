export class DeleteDialog {
  constructor() {
    this.backdrop = document.getElementById('delDialogBackdrop');
    this.title = document.getElementById('delDialogTitle');
    this.msg = document.getElementById('delDialogMsg');
    this._resolve = null;

    document.getElementById('delFuture')
      .addEventListener('click', () => this._choose('future'));
    document.getElementById('delAll')
      .addEventListener('click', () => this._choose('all'));
    document.getElementById('delNone')
      .addEventListener('click', () => this._choose('none'));
    document.getElementById('delCancel')
      .addEventListener('click', () => this._choose('cancel'));
  }

  // Returns a Promise resolving to: 'future' | 'all' | 'none' | 'cancel'
  open({ title = 'Delete', message = '' } = {}) {
    this.title.textContent = title;
    this.msg.textContent = message;
    this.backdrop.classList.add('open');
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  _choose(choice) {
    this.backdrop.classList.remove('open');
    if (this._resolve) {
      this._resolve(choice);
      this._resolve = null;
    }
  }
}