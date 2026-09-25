import { CLIENT_ID, API_KEY, SCOPES, DISCOVERY_DOCS } from '../config.js';
const TOKEN_KEY = 'gcal_token';

export class GoogleCalendar {
  constructor() {
    this.gapiReady = false;
    this.gisReady = false;
    this.isAuthed = false;
    this.tokenClient = null;
    this.onAuthChange = () => {};
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
          console.warn('Auth error:', resp.error);
          return;
        }
        this._onTokenReceived(resp);
      },
    });
    this.gisReady = true;
  }

  _onTokenReceived(resp) {
    console.log('Granted scopes:', resp.scope); // ← add this line
    const expiresAt = Date.now() + (resp.expires_in - 60) * 1000; // 60s safety margin
    const tokenData = { access_token: resp.access_token, expiresAt };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData));

    gapi.client.setToken({ access_token: resp.access_token });
    this.isAuthed = true;
    this.onAuthChange(true);

    // schedule a silent refresh just before it expires
    this._scheduleRefresh(expiresAt);
  }

  _scheduleRefresh(expiresAt) {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    const delay = Math.max(0, expiresAt - Date.now());
    this._refreshTimer = setTimeout(() => this._silentRefresh(), delay);
  }

  _silentRefresh() {
    // request a new token without showing a popup
    if (this.tokenClient) {
      this.tokenClient.requestAccessToken({ prompt: '' });
    }
  }

  // On page load, try to restore a saved token
  _restoreSession() {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return;

    try {
      const { access_token, expiresAt } = JSON.parse(raw);
      if (Date.now() < expiresAt) {
        // token still valid → use it
        gapi.client.setToken({ access_token });
        this.isAuthed = true;
        this.onAuthChange(true);
        this._scheduleRefresh(expiresAt);
      } else {
        // expired → try a silent refresh (works if consent still granted)
        this._silentRefresh();
      }
    } catch (e) {
      localStorage.removeItem(TOKEN_KEY);
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
      // first time / re-consent → show the popup
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    }
  }

  // Fetch a single event by ID from primary. Returns {start, end} or null if deleted.
  async getEventById(eventId) {
    try {
      const resp = await gapi.client.calendar.events.get({
        calendarId: 'primary',
        eventId,
      });
      const e = resp.result;
      if (e.status === 'cancelled') return null;
      if (!e.start || !e.start.dateTime) return null;
      return {
        start: new Date(e.start.dateTime),
        end: new Date(e.end.dateTime),
      };
    } catch (err) {
      if (err.status === 404 || err.status === 410) return null; // deleted
      throw err;
    }
  }
  
  _signOut() {
    const token = gapi.client.getToken();
    if (token) {
      google.accounts.oauth2.revoke(token.access_token, () => {});
      gapi.client.setToken(null);
    }
    localStorage.removeItem(TOKEN_KEY);
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this.isAuthed = false;
    this.onAuthChange(false);
  }

  async listCalendars() {
    const resp = await gapi.client.calendar.calendarList.list();
    return (resp.result.items || []).map((c) => ({
      id: c.id,
      name: c.summary,
      primary: !!c.primary,
    }));
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
        console.warn('Failed to fetch calendar', calId, err);
      }
    }
    return all;
  }

  async createEvent({ summary, description, startDate, startTime, hours }) {
    const [h, m] = startTime.split(':').map(Number);
    const startDt = new Date(startDate + 'T00:00:00');
    startDt.setHours(h, m, 0, 0);
    const endDt = new Date(startDt.getTime() + parseFloat(hours) * 3600 * 1000);

    const resp = await gapi.client.calendar.events.insert({
      calendarId: 'primary',
      resource: {
        summary,
        description: description || 'Scheduled via Task Grid',
        start: { dateTime: startDt.toISOString() },
        end: { dateTime: endDt.toISOString() },
      },
    });
    return resp.result.id;
  }

  async deleteEvent(eventId) {
    try {
      await gapi.client.calendar.events.delete({
        calendarId: 'primary',
        eventId,
      });
    } catch (err) {
      if (err.status !== 404 && err.status !== 410) throw err;
    }
  }
}