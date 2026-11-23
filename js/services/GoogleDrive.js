const FILE_NAME = 'taskgrid-data.json';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

// Persists tasks as a single JSON file in the app's hidden appDataFolder.
// Shares GoogleCalendar's auth, since both use the same gapi client and token.
export class GoogleDrive {
  constructor(googleCalendar) {
    this.gcal = googleCalendar;
    this.fileId = null;
    this._saveChain = null;
    this._fileIdPromise = null;
  }

  get isReady() {
    return this.gcal.isAuthed && window.gapi && gapi.client.drive;
  }

  // ── Public API ───────────────────────────────────────────

  async load() {
    if (!this.isReady) return null;
    try {
      this.fileId = this.fileId || (await this._findFile());
      if (!this.fileId) return null;
      const resp = await gapi.client.drive.files.get({ fileId: this.fileId, alt: 'media' });
      return JSON.parse(resp.body);
    } catch (err) {
      this._reportError('Drive load error:', err);
      return null;
    }
  }

  // Saves are chained so file lookup/creation and uploads never run concurrently.
  async save(tasksArray) {
    if (!this.isReady) return false;
    this._saveChain = (this._saveChain || Promise.resolve())
      .catch(() => {}) // a prior failure must not break the chain
      .then(() => this._doSave(tasksArray));
    return this._saveChain;
  }

  // ── Private helpers ──────────────────────────────────────

  async _doSave(tasksArray) {
    if (!this.isReady) return false;
    const content = JSON.stringify(tasksArray, null, 2);
    try {
      const fileId = await this._ensureFileId();
      await this._uploadContent(fileId, content);
      return true;
    } catch (err) {
      this._reportError('Drive save error:', err);
      return false;
    }
  }

  // Memoized so concurrent callers await the same lookup/creation
  // instead of racing to create duplicate files.
  async _ensureFileId() {
    if (this.fileId) return this.fileId;
    this._fileIdPromise = this._fileIdPromise || this._findOrCreateFile();
    try {
      return await this._fileIdPromise;
    } finally {
      // On success this.fileId is now set; on failure the next save can retry.
      this._fileIdPromise = null;
    }
  }

  async _findOrCreateFile() {
    let id = await this._findFile();
    if (!id) {
      const resp = await gapi.client.drive.files.create({
        resource: { name: FILE_NAME, parents: ['appDataFolder'] },
        fields: 'id',
      });
      id = resp.result.id;
    }
    this.fileId = id;
    return id;
  }

  async _findFile() {
    const resp = await gapi.client.drive.files.list({
      spaces: 'appDataFolder',
      q: `name='${FILE_NAME}'`,
      fields: 'files(id, name)',
      pageSize: 1,
    });
    const files = resp.result.files;
    return files && files.length ? files[0].id : null;
  }

  // Media uploads go through fetch against the upload endpoint, not gapi.
  async _uploadContent(fileId, content) {
    const token = gapi.client.getToken().access_token;
    const resp = await fetch(`${UPLOAD_URL}/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: content,
    });
    // fetch reports 401 as a status rather than a thrown gapi error
    if (resp.status === 401) {
      this.gcal._quietSignOut();
      throw new Error('Auth expired');
    }
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    return resp.json();
  }

  _reportError(label, err) {
    if (this.gcal._handleApiError(err)) return;
    console.error(label, err);
  }
}
