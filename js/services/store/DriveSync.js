// DriveSync owns the Google Drive connection: debounced saves, retries, loading and sync status.

const SAVE_DEBOUNCE_MS = 800;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;

export class DriveSync {
  // snapshot() → data to save; hasData() → is there local data worth uploading;
  // apply(data) → take over data loaded from Drive (see parseDriveData)
  constructor({ snapshot, hasData, apply }) {
    this._snapshot = snapshot;
    this._hasData = hasData;
    this._apply = apply;
    this.drive = null;
    this.status = undefined;     // 'saving' | 'synced' | 'failed' | 'offline'
    this._statusFn = () => {};

    this._saveTimer = null;
    this._saving = false;
    this._pendingSave = false;
    this._retryTimer = null;
    this._retryCount = 0;
  }

  attach(drive) { this.drive = drive; }
  onStatus(fn) { this._statusFn = fn; }

  setStatus(status) {
    this.status = status;
    this._statusFn(status);
  }

  // Show unsaved changes right away, then save once edits pause.
  scheduleSave() {
    if (this.drive && this.drive.isReady) this.setStatus('saving');

    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), SAVE_DEBOUNCE_MS);
  }

  async saveNow() {
    // A save is in flight: flag another run so the newest state still gets saved.
    if (this._saving) {
      this._pendingSave = true;
      return;
    }

    this._saving = true;
    try {
      if (!this.drive || !this.drive.isReady) {
        this.setStatus('offline');
        return;
      }

      this.setStatus('saving');
      const ok = await this.drive.save(this._snapshot());

      if (ok) {
        this.setStatus('synced');
        this._clearRetry();
      } else {
        this.setStatus('failed');
        this._scheduleRetry();
      }
    } finally {
      this._saving = false;
      if (this._pendingSave) {
        this._pendingSave = false;
        this.saveNow();
      }
    }
  }

  // Called after Google connects: last-write-wins, so Drive wins on load.
  async load() {
    if (!this.drive) {
      this.setStatus('offline');
      return;
    }
    this.setStatus('saving');
    const remote = await this.drive.load();

    if (!remote) {
      if (this._hasData()) await this.saveNow();
      else this.setStatus('synced');
      return;
    }

    const data = parseDriveData(remote);
    if (data) this._apply(data);
    this.setStatus('synced');
  }

  // exponential backoff: 2s, 4s, 8s, 16s … capped at 30s; one pending retry at a time
  _scheduleRetry() {
    if (this._retryTimer) return;
    this._retryCount = (this._retryCount || 0) + 1;
    const delay = Math.min(RETRY_BASE_MS * 2 ** (this._retryCount - 1), RETRY_MAX_MS);

    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.saveNow();
    }, delay);
  }

  _clearRetry() {
    this._retryCount = 0;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }
}

// Drive files are a bare task array (legacy) or the full saved object.
// calendarSyncEnabled / whiteboard are only present when Drive has them,
// so a missing whiteboard never overwrites the local one. Unknown → null.
function parseDriveData(remote) {
  if (Array.isArray(remote)) return { tasks: remote, completionLog: [] };
  if (typeof remote !== 'object') return null;

  const data = {
    tasks: remote.tasks || [],
    completionLog: remote.completionLog || [],
    calendarSyncEnabled: remote.calendarSyncEnabled !== false,
  };
  if (Array.isArray(remote.whiteboard)) data.whiteboard = remote.whiteboard;
  return data;
}
