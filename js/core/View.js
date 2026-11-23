// Base for a tab view: remembers whether its tab is showing, and only redraws while it is.
//
// Subclasses override render() (and guard it with `if (!this.isActive) return;` when it is
// also called from inside the view). Override activate/deactivate/refresh for special cases,
// calling super where the default still applies.
export class View {
  constructor() {
    this.isActive = false;
  }

  // tab became visible → draw it
  activate() {
    this.isActive = true;
    this.render();
  }

  // tab hidden → stop drawing
  deactivate() {
    this.isActive = false;
  }

  // data changed → redraw, but only if the tab is showing
  refresh() {
    if (this.isActive) this.render();
  }

  render() {}
}
