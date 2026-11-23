// Owns the ⟳ refresh buttons: reconciling the store with Google Calendar, with a spinner.

const REFRESH_SPINNER_MS = 800;

export class CalendarRefresh {
  constructor(store, gcal, { plannerView, dayView, grid, getActiveView }) {
    Object.assign(this, { store, gcal, plannerView, dayView, grid, getActiveView });

    document.getElementById('refreshBtn').addEventListener('click', () => this.reconcile());
    document.getElementById('plannerRefreshBtn').addEventListener('click', () => this.reconcile());
  }

  async reconcile() {
    const btnId = this.getActiveView() === 'planner' ? 'plannerRefreshBtn' : 'refreshBtn';
    const btn = document.getElementById(btnId);
    this.plannerView.refresh();
    this._setRefreshing(btn, true);

    try {
      await this.store.reconcileWithCalendar(this.gcal);
      await this.dayView.render();
      this.grid.render();
    } catch (e) {
      console.error('Reconcile failed:', e);
    } finally {
      setTimeout(() => this._setRefreshing(btn, false), REFRESH_SPINNER_MS);
    }
  }

  _setRefreshing(btn, refreshing) {
    if (!btn) return;
    btn.disabled = refreshing;
    btn.classList.toggle('syncing', refreshing);
  }
}
