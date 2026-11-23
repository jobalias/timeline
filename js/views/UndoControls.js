// Undo / redo controls: ↶ ↷ buttons on the tab bar, ⌘Z / ⌘⇧Z (Ctrl on Windows),
// and a "Deleted … · Undo" toast whenever something disappears.

const TOAST_MS = 7000;           // toast offering an Undo action
const TOAST_SHORT_MS = 2000;     // plain "Undone" / "Redone" confirmation

const isTextField = (el) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
const isInWhiteboard = (el) => !!el?.closest?.('#wbList');

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
    document.addEventListener('keydown', (e) => this._onKey(e));

    store.onHistory((info) => {
      this._syncButtons(info);
      if (info.deleted) this._showToast(info.deleted);
    });
    this._syncButtons({ canUndo: store.canUndo(), canRedo: store.canRedo() });
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
    const key = e.key.toLowerCase();
    const isUndo = key === 'z' && !e.shiftKey;
    const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.metaKey);
    if (!isUndo && !isRedo) return;

    // a dialog is open → leave it alone
    if (document.querySelector('.modal-backdrop.open, .cal-overlay.open')) return;
    // typing in an ordinary text field → let the browser undo the text
    const el = document.activeElement;
    if (el && isTextField(el) && !isInWhiteboard(el)) return;

    e.preventDefault();
    if (isUndo) this.undo();
    else this.redo();
  }

  // the whiteboard doesn't redraw while you're typing in it — step out so it can
  _blurWhiteboard() {
    const el = document.activeElement;
    if (isInWhiteboard(el)) el.blur();
  }

  _syncButtons({ canUndo, canRedo }) {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  _showToast(text, withUndo = true) {
    this.toastText.textContent = text;
    this.toast.classList.toggle('no-action', !withUndo || !this.store.canUndo());
    this.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._hideToast(), withUndo ? TOAST_MS : TOAST_SHORT_MS);
  }

  _hideToast() {
    this.toast.classList.remove('show');
    clearTimeout(this._toastTimer);
  }
}
