const FILE_NAME = 'taskgrid-data.json';

export class GoogleDrive {
  constructor(googleCalendar) {
    // reuse the same auth (they share the gapi client + token)
    this.gcal = googleCalendar;
    this.fileId = null; 
    this._saveChain = null;
    this._fileIdPromise = null;
  }

  get isReady() {
    return this.gcal.isAuthed && window.gapi && gapi.client.drive;
  }

  // Find our data file in the appDataFolder (returns fileId or null)
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

  async load() {
    if (!this.isReady) return null;
    try {
      this.fileId = this.fileId || (await this._findFile());
      if (!this.fileId) return null;
      const resp = await gapi.client.drive.files.get({
        fileId: this.fileId, alt: 'media',
      });
      return JSON.parse(resp.body);
    } catch (err) {
      if (this.gcal._handleApiError(err)) return null; // ← add
      console.error('Drive load error:', err);
      return null;
    }
  }

  async save(tasksArray) {
    if (!this.isReady) return false;

    // Serialize: chain this save after any in-flight save.
    // This guarantees _ensureFileId + upload never run concurrently.
    this._saveChain = (this._saveChain || Promise.resolve())
      .catch(() => {}) // don't let a prior failure break the chain
      .then(() => this._doSave(tasksArray));

    return this._saveChain;
  }

  async _doSave(tasksArray) {
    if (!this.isReady) return false;
    const content = JSON.stringify(tasksArray, null, 2);

    try {
      // Resolve the file id exactly once; never create duplicates.
      await this._ensureFileId();
      await this._uploadContent(this.fileId, content, 'PATCH');
      return true;
    } catch (err) {
      if (this.gcal && this.gcal._handleApiError(err)) return false;
      console.error('Drive save error:', err);
      return false;
    }
  }

  // Finds-or-creates the data file, memoized so concurrent/repeated
  // calls all await the SAME lookup/creation instead of racing.
  async _ensureFileId() {
    if (this.fileId) return this.fileId;

    // If a lookup/creation is already in progress, await it.
    if (!this._fileIdPromise) {
      this._fileIdPromise = (async () => {
        let id = await this._findFile();
        if (!id) {
          const createResp = await gapi.client.drive.files.create({
            resource: { name: FILE_NAME, parents: ['appDataFolder'] },
            fields: 'id',
          });
          id = createResp.result.id;
        }
        this.fileId = id;
        return id;
      })();
    }

    try {
      return await this._fileIdPromise;
    } finally {
      // Clear the in-flight promise. If it succeeded, this.fileId is set
      // so we won't re-enter. If it failed, the next save can retry.
      this._fileIdPromise = null;
    }
  }

  async _uploadContent(fileId, content, method) {
    const token = gapi.client.getToken().access_token;
    const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
    const resp = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: content,
    });
    if (resp.status === 401) {
      this.gcal._quietSignOut(); // ← fetch returns 401 differently
      throw new Error('Auth expired');
    }
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    return resp.json();
  }
}