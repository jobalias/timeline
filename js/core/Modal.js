// A popup shown by toggling the 'open' class on its backdrop element.
//
// Subclass it (override close() to reset state, calling super.close() first), or use it
// directly for a popup owned by a view — pass onClose to reset the view's state.
export class Modal {
  constructor(backdropId, { closeOnBackdrop = false, onClose = () => {} } = {}) {
    this.backdrop = document.getElementById(backdropId);
    this.onClose = onClose;

    // a click on the dimmed area itself (not inside the dialog) dismisses it
    if (closeOnBackdrop) {
      this.backdrop.addEventListener('click', (e) => {
        if (e.target === this.backdrop) this.close();
      });
    }
  }

  show() {
    this.backdrop.classList.add('open');
  }

  close() {
    this.backdrop.classList.remove('open');
    this.onClose();
  }
}
