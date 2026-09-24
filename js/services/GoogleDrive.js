const FILE_NAME = 'taskgrid-data.json';

export class GoogleDrive {
  constructor(googleCalendar) {
    // reuse the same auth (they share the gapi client + token)
    this.gcal = googleCalendar;
    this.fileId = null; // cached once found/created
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

  // Load tasks JSON from Drive. Returns array (or null if no file yet).
  async load() {
    if (!this.isReady) return null;
    try {
      this.fileId = this.fileId || (await this._findFile());
      if (!this.fileId) return null; // no file yet

      const resp = await gapi.client.drive.files.get({
        fileId: this.fileId,
        alt: 'media',
      });
      // resp.body is the raw JSON string
      return JSON.parse(resp.body);
    } catch (err) {
      console.error('Drive load error:', err);
      return null;
    }
  }

  // Save tasks JSON to Drive (creates the file if needed)
  async save(tasksArray) {
    if (!this.isReady) return false;
    const content = JSON.stringify(tasksArray, null, 2);

    try {
      this.fileId = this.fileId || (await this._findFile());

      if (this.fileId) {
        // update existing file content
        await this._uploadContent(this.fileId, content, 'PATCH');
      } else {
        // create new file in appDataFolder
        const createResp = await gapi.client.drive.files.create({
          resource: { name: FILE_NAME, parents: ['appDataFolder'] },
          fields: 'id',
        });
        this.fileId = createResp.result.id;
        await this._uploadContent(this.fileId, content, 'PATCH');
      }
      return true;
    } catch (err) {
      console.error('Drive save error:', err);
      return false;
    }
  }

  // Upload raw content to a file using the media upload endpoint
  async _uploadContent(fileId, content, method) {
    const token = gapi.client.getToken().access_token;
    const url =
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: content,
    });
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    return resp.json();
  }
}