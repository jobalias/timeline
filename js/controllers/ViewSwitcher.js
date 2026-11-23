// Owns the main tabs: which view is active, showing/hiding containers, and re-rendering it.
// Planner, progress and whiteboard are core/View subclasses; the grid tab is GridView + DayView.

export class ViewSwitcher {
  constructor({ grid, dayView, plannerView, progressView, whiteboardView }, initial = 'whiteboard') {
    Object.assign(this, { grid, dayView, plannerView, progressView, whiteboardView });
    this.active = initial;

    this.views = {
      grid: {
        tab: 'tabGrid',
        container: 'gridViewContainer',
        activate: () => {
          grid.render();
          grid.onShow();
          dayView.render();
          dayView.startNowLineTimer();
        },
        render: () => {
          grid.render();
          dayView.render();
        },
      },
      planner: {
        tab: 'tabPlanner',
        container: 'plannerViewContainer',
        activate: () => plannerView.activate(),
        render: () => plannerView.refresh(),
      },
      progress: {
        tab: 'tabProgress',
        container: 'progressViewContainer',
        activate: () => progressView.activate(),
        render: () => progressView.refresh(),
      },
      whiteboard: {
        tab: 'tabWhiteboard',
        container: 'whiteboardViewContainer',
        activate: () => whiteboardView.activate(),
        render: () => whiteboardView.refresh(),
      },
    };

    for (const [name, view] of Object.entries(this.views)) {
      view.tab = document.getElementById(view.tab);
      view.container = document.getElementById(view.container);
      view.tab.addEventListener('click', () => this.show(name));
    }
  }

  show(which) {
    for (const { tab, container } of Object.values(this.views)) {
      tab.classList.remove('active');
      container.style.display = 'none';
    }
    for (const tabView of [this.plannerView, this.progressView, this.whiteboardView]) tabView.deactivate();
    this.dayView.stopNowLineTimer();

    this.active = which;
    const view = this.views[which] || this.views.progress;
    view.tab.classList.add('active');
    view.container.style.display = 'block';
    view.activate();
  }

  // re-render the visible view after a store change
  renderActive() {
    this.views[this.active]?.render();
  }
}
