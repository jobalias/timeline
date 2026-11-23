// Owns the Drive sync badge + warning banner, and the save-retry / unsaved-changes guards.

const SYNC_STATES = {
  synced: { badge: '● Synced ✓' },
  saving: { badge: '● Saving…' },
  failed: {
    badge: '● SAVE FAILED',
    warning: 'Your changes are NOT saving to Google Drive. Check your connection and try re-signing in. Do not rely on this data until it says Synced.',
  },
  offline: {
    badge: '● Offline',
    warning: 'Not connected to Google Drive. Changes are only saved in this browser. Sign in to sync.',
  },
};
const UNKNOWN_SYNC_STATE = { badge: '● …' };

export class SyncStatus {
  constructor(store) {
    this.store = store;
    this.badge = document.getElementById('syncBadge');
    this.warning = document.getElementById('syncWarning');
    this.warningText = document.getElementById('syncWarningText');

    this.store.onSyncStatus((status) => this._render(status));
    this._bindConnectivity();
  }

  // signed out: no badge at all
  clear() {
    this.badge.textContent = '';
  }

  _render(status) {
    const state = SYNC_STATES[status] || UNKNOWN_SYNC_STATE;
    this.badge.className = 'sync-badge ' + status;
    this.badge.textContent = state.badge;
    this.warning.style.display = state.warning ? 'block' : 'none';
    if (state.warning) this.warningText.textContent = state.warning;
  }

  _bindConnectivity() {
    // browser's "unsaved changes" prompt while a save is pending or failed
    window.addEventListener('beforeunload', (e) => {
      const status = this.store.syncStatus;
      if (status === 'saving' || status === 'failed') {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    window.addEventListener('online', () => {
      const status = this.store.syncStatus;
      if (status === 'failed' || status === 'offline') this.store.retrySave();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.store.syncStatus === 'failed') this.store.retrySave();
    });
  }
}
