import { CLIENT_ID, API_KEY, SCOPES, DISCOVERY_DOCS } from '../config.js';
const TOKEN_KEY = 'gcal_token';

export class GoogleCalendar {
  constructor() {
    this.gapiReady = false;
    this.gisReady = false;
    this.isAuthed = false;
    this.tokenClient = null;
    this.onAuthChange = () => {};
    this.syncEnabled = true;
  }

  init() {
    const check = setInterval(() => {
      if (window.gapi && !this.gapiReady) this._initGapi();
      if (window.google && !this.gisReady) this._initGis();
      if (this.gapiReady && this.gisReady) {
        clearInterval(check);
        this._restoreSession();
      }
    }, 100);
  }

    _initGapi() {
        gapi.load('client', async () => {
        await gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: DISCOVERY_DOCS,
        });
        this.gapiReady = true;
        });
    }

  _initGis() {
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) {
          // silent attempt failed (e.g. consent needed) — only retry with a
          // popup if the user is actively trying to sign in
          if (this._userInitiatedSignIn) {
            this._userInitiatedSignIn = false;
            this.tokenClient.requestAccessToken({ prompt: 'consent' });
          } else {
            console.warn('Auth error:', resp.error);
          }
          return;
        }
        this._userInitiatedSignIn = false;
        this._onTokenReceived(resp);
      },
    });
    this.gisReady = true;
  }

_onTokenReceived(resp) {
    const expiresAt = Date.now() + (resp.expires_in - 60) * 1000; // 60s safety margin
    const tokenData = { access_token: resp.access_token, expiresAt };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));

    gapi.client.setToken({ access_token: resp.access_token });
    this.isAuthed = true;
    this.onAuthChange(true);

    // schedule a QUIET expiry — no popup, just flip to login when it expires
    this._scheduleExpiry(expiresAt);
  }

  _scheduleExpiry(expiresAt) {
    if (this._expiryTimer) clearTimeout(this._expiryTimer);
    const delay = Math.max(0, expiresAt - Date.now());
    this._expiryTimer = setTimeout(() => this._quietSignOut(), delay);
  }

  // Quietly sign out (no popup, no revoke) — just show the login screen
  _quietSignOut() {
    if (this._expiryTimer) clearTimeout(this._expiryTimer);
    try { gapi.client.setToken(null); } catch (e) {}
    localStorage.removeItem(TOKEN_KEY);
    this.isAuthed = false;
    this.onAuthChange(false); // → app shows login screen, no interruption
  }

  // On page load, try to restore a saved token
  _restoreSession() {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) {
      this.onAuthChange(false); // no token → login screen
      return;
    }

    try {
      const { access_token, expiresAt } = JSON.parse(raw);
      if (Date.now() < expiresAt) {
        // token still valid → use it
        gapi.client.setToken({ access_token });
        this.isAuthed = true;
        this.onAuthChange(true);
        this._scheduleExpiry(expiresAt);
      } else {
        // expired → quietly show login (NO silent refresh popup)
        localStorage.removeItem(TOKEN_KEY);
        this.onAuthChange(false);
      }
    } catch (e) {
      localStorage.removeItem(TOKEN_KEY);
      this.onAuthChange(false);
    }
  }

toggleAuth() {
    if (!this.gisReady || !this.gapiReady) {
      alert('Google not loaded yet, try again in a sec.');
      return;
    }
    if (this.isAuthed) {
      this._signOut();
    } else {
      this._userInitiatedSignIn = true; // ← mark that YOU clicked
      this.tokenClient.requestAccessToken({ prompt: '' }); // try silent first
    }
  }

  // Fetch a single event by ID from primary. Returns {start, end} or null if deleted.
  async getEventById(eventId) {
    try {
      const resp = await gapi.client.calendar.events.get({
        calendarId: 'primary', eventId,
      });
      const e = resp.result;
      if (e.status === 'cancelled') return null;
      if (!e.start || !e.start.dateTime) return null;
      return {
        start: new Date(e.start.dateTime),
        end: new Date(e.end.dateTime),
        description: e.description || '',   // ← add this
      };
    } catch (err) {
      if (err.status === 404 || err.status === 410) return null;
      if (this._handleApiError && this._handleApiError(err)) return null;
      throw err;
    }
  }
  
  async updateEvent({ eventId, summary, startDate, startTime, hours }) {
    if (!this.syncEnabled) return eventId || null;
    const [h, m] = startTime.split(':').map(Number);
    const startDt = new Date(startDate + 'T00:00:00');
    startDt.setHours(h, m, 0, 0);
    const endDt = new Date(startDt.getTime() + parseFloat(hours) * 3600 * 1000);
    try {
      const resp = await gapi.client.calendar.events.patch({
        calendarId: 'primary', eventId,
        resource: {
          summary,
          start: { dateTime: startDt.toISOString() },
          end: { dateTime: endDt.toISOString() },
        },
      });
      return resp.result.id;
    } catch (err) {
      if (this._handleApiError(err)) return null; // ← add
      throw err;
    }
  }

  async updateEventDescription(eventId, description) {
    if (!this.syncEnabled) return eventId || null;
    try {
      await gapi.client.calendar.events.patch({
        calendarId: 'primary',
        eventId,
        resource: { description: description || '' },
      });
    } catch (err) {
      if (err.status === 404 || err.status === 410) return; // event gone
      if (this._handleApiError && this._handleApiError(err)) return;
      console.warn('Failed to update event description:', err);
    }
  }

  _signOut() {
    const token = gapi.client.getToken();
    if (token) {
      google.accounts.oauth2.revoke(token.access_token, () => {});
      gapi.client.setToken(null);
    }
    localStorage.removeItem(TOKEN_KEY);
    if (this._expiryTimer) clearTimeout(this._expiryTimer);
    this.isAuthed = false;
    this.onAuthChange(false);
  }

  async listCalendars() {
    try {
      const resp = await gapi.client.calendar.calendarList.list();
      return (resp.result.items || []).map((c) => ({
        id: c.id, name: c.summary, primary: !!c.primary,
      }));
    } catch (err) {
      if (this._handleApiError(err)) return []; // ← add
      throw err;
    }
  }

  // Fetch events from one or more calendars, merged into a single array
  async getEvents(timeMin, timeMax, calendarIds = ['primary']) {
    const all = [];
    for (const calId of calendarIds) {
      try {
        const resp = await gapi.client.calendar.events.list({
          calendarId: calId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 250,
        });
        (resp.result.items || [])
          .filter((e) => e.start && e.start.dateTime)
          .forEach((e) => {
            all.push({
              id: e.id,
              title: e.summary || '(no title)',
              start: new Date(e.start.dateTime),
              end: new Date(e.end.dateTime),
              calendarId: calId,
            });
          });
      } catch (err) {
        if (this._handleApiError(err)) return []; // auth expired → quiet login
        console.warn('Failed to fetch calendar', calId, err);
      }
    }
    return all;
  }

  async createEvent({ summary, description, startDate, startTime, hours }) {
    if (!this.syncEnabled) return eventId || null;
    const [h, m] = startTime.split(':').map(Number);
    const startDt = new Date(startDate + 'T00:00:00');
    startDt.setHours(h, m, 0, 0);
    const endDt = new Date(startDt.getTime() + parseFloat(hours) * 3600 * 1000);
    try {
      const resp = await gapi.client.calendar.events.insert({
        calendarId: 'primary',
        resource: {
          summary,
          description: description || '',
          start: { dateTime: startDt.toISOString() },
          end: { dateTime: endDt.toISOString() },
          colorId: '4',
        },
      });
      return resp.result.id;
    } catch (err) {
      if (this._handleApiError(err)) return null; // ← add
      throw err;
    }
  }

  async deleteEvent(eventId) {
    if (!this.syncEnabled) return eventId || null;
    try {
      await gapi.client.calendar.events.delete({
        calendarId: 'primary', eventId,
      });
    } catch (err) {
      if (err.status === 404 || err.status === 410) return;
      if (this._handleApiError(err)) return; // ← add
      throw err;
    }
  }

  // Call this in catch blocks to detect auth failures
  _handleApiError(err) {
    if (err && (err.status === 401 ||
        (err.result && err.result.error && err.result.error.code === 401))) {
      this._quietSignOut();
      return true; // was an auth error
    }
    return false;
  }
}