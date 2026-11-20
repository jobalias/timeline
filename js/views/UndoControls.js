// Undo / redo controls: ↶ ↷ buttons on the tab bar, ⌘Z / ⌘⇧Z (Ctrl on Windows),
// and a "Deleted … · Undo" toast whenever something disappears.
export class UndoControls {
  constructor(store) {
    this.store = store;
    this.undoBtn = document.getElementById('undoBtn');
    this.redoBtn = document.getElementById('redoBtn');
    this.toast = document.getElementById('undoToast');
    this.toastText = document.getElementById('undoToastText');
    this._toastTimer = null;

    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
    document.getElementById('undoToastBtn').addEventListener('click', () => this.undo());
    document.getElementById('undoToastClose').addEventListener('click', () => this._hideToast());

    store.onHistory((info) => {
      this._sync(info);
      if (info.deleted) this._showToast(info.deleted);
    });
    this._sync({ canUndo: store.canUndo(), canRedo: store.canRedo() });

    document.addEventListener('keydown', (e) => this._onKey(e));
  }

  undo() {
    this._blurWhiteboard();
    if (this.store.undo()) this._showToast('Undone', false);
  }

  redo() {
    this._blurWhiteboard();
    if (this.store.redo()) this._showToast('Redone', false);
  }

  _onKey(e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const isUndo = k === 'z' && !e.shiftKey;
    const isRedo = (k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey && !e.metaKey);
    if (!isUndo && !isRedo) return;

    // a dialog is open → leave it alone
    if (document.querySelector('.modal-backdrop.open, .cal-overlay.open')) return;
    // typing in an ordinary text field → let the browser undo the text
    const el = document.activeElement;
    const inField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    const inWhiteboard = el && el.closest && el.closest('#wbList');
    if (inField && !inWhiteboard) return;

    e.preventDefault();
    isUndo ? this.undo() : this.redo();
  }

  // the whiteboard doesn't redraw while you're typing in it — step out so it can
  _blurWhiteboard() {
    const el = document.activeElement;
    if (el && el.closest && el.closest('#wbList')) el.blur();
  }

  _sync({ canUndo, canRedo }) {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  _showToast(text, withUndo = true) {
    this.toastText.textContent = text;
    this.toast.classList.toggle('no-action', !withUndo || !this.store.canUndo());
    this.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._hideToast(), withUndo ? 7000 : 2000);
  }

  _hideToast() {
    this.toast.classList.remove('show');
    clearTimeout(this._toastTimer);
  }
}
