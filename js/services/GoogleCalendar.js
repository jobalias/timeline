import { CLIENT_ID, API_KEY, SCOPES, DISCOVERY_DOCS } from '../config.js';
import { parseLocalDateTime } from '../core/dates.js';

const TOKEN_KEY = 'gcal_token';
const TOKEN_SAFETY_MARGIN_SEC = 60;
const LOADER_POLL_MS = 100;

export class GoogleCalendar {
  constructor() {
    this.gapiReady = false;
    this.gisReady = false;
    this.isAuthed = false;
    this.tokenClient = null;
    this.onAuthChange = () => {};
    this.syncEnabled = true;
    this._userInitiatedSignIn = false;
    this._expiryTimer = null;
  }

  // ── Lifecycle ────────────────────────────────────────────

  // The Google scripts load asynchronously, so poll until both are available.
  init() {
    const poll = setInterval(() => {
      if (window.gapi && !this.gapiReady) this._initGapi();
      if (window.google && !this.gisReady) this._initGis();
      if (this.gapiReady && this.gisReady) {
        clearInterval(poll);
        this._restoreSession();
      }
    }, LOADER_POLL_MS);
  }

  _initGapi() {
    gapi.load('client', async () => {
      await gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS });
      this.gapiReady = true;
    });
  }

  _initGis() {
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => this._onTokenResponse(resp),
    });
    this.gisReady = true;
  }

  // ── Auth ─────────────────────────────────────────────────

  toggleAuth() {
    if (!this.gisReady || !this.gapiReady) {
      alert('Google not loaded yet, try again in a sec.');
      return;
    }
    if (this.isAuthed) {
      this._signOut();
      return;
    }
    this._userInitiatedSignIn = true;
    this.tokenClient.requestAccessToken({ prompt: '' }); // try silently first
  }

  _onTokenResponse(resp) {
    if (resp.error) {
      // A silent attempt failed (e.g. consent needed). Only escalate to a
      // consent popup if the user is actively trying to sign in.
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
  }

  _onTokenReceived(resp) {
    const expiresAt = Date.now() + (resp.expires_in - TOKEN_SAFETY_MARGIN_SEC) * 1000;
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: resp.access_token, expiresAt }));
    this._applyToken(resp.access_token, expiresAt);
  }

  // Expired tokens just send the user back to the login screen —
  // no silent-refresh popup interrupting them.
  _restoreSession() {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) {
      this.onAuthChange(false);
      return;
    }
    try {
      const { access_token, expiresAt } = JSON.parse(raw);
      if (Date.now() < expiresAt) {
        this._applyToken(access_token, expiresAt);
      } else {
        this._discardStoredToken();
      }
    } catch (e) {
      this._discardStoredToken();
    }
  }

  _applyToken(accessToken, expiresAt) {
    gapi.client.setToken({ access_token: accessToken });
    this.isAuthed = true;
    this.onAuthChange(true);
    this._scheduleExpiry(expiresAt);
  }

  _discardStoredToken() {
    localStorage.removeItem(TOKEN_KEY);
    this.onAuthChange(false);
  }

  _scheduleExpiry(expiresAt) {
    clearTimeout(this._expiryTimer);
    const delay = Math.max(0, expiresAt - Date.now());
    this._expiryTimer = setTimeout(() => this._quietSignOut(), delay);
  }

  // Sign out without a popup or revoking the token — just show the login screen.
  _quietSignOut() {
    try { gapi.client.setToken(null); } catch (e) {}
    this._endSession();
  }

  _signOut() {
    const token = gapi.client.getToken();
    if (token) {
      google.accounts.oauth2.revoke(token.access_token, () => {});
      gapi.client.setToken(null);
    }
    this._endSession();
  }

  _endSession() {
    clearTimeout(this._expiryTimer);
    localStorage.removeItem(TOKEN_KEY);
    this.isAuthed = false;
    this.onAuthChange(false);
  }

  // ── Calendars & events ───────────────────────────────────

  async listCalendars() {
    try {
      const resp = await gapi.client.calendar.calendarList.list();
      return (resp.result.items || []).map((c) => ({
        id: c.id, name: c.summary, primary: !!c.primary,
      }));
    } catch (err) {
      if (this._handleApiError(err)) return [];
      throw err;
    }
  }

  // Fetches timed events from each calendar, merged into a single array.
  // A failing calendar is skipped, but an auth failure aborts everything.
  async getEvents(timeMin, timeMax, calendarIds = ['primary']) {
    const all = [];
    for (const calendarId of calendarIds) {
      try {
        const resp = await gapi.client.calendar.events.list({
          calendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 250,
        });
        for (const e of resp.result.items || []) {
          if (!this._isTimed(e)) continue;
          all.push({
            id: e.id,
            title: e.summary || '(no title)',
            start: new Date(e.start.dateTime),
            end: new Date(e.end.dateTime),
            calendarId,
          });
        }
      } catch (err) {
        if (this._handleApiError(err)) return [];
        console.warn('Failed to fetch calendar', calendarId, err);
      }
    }
    return all;
  }

  // Returns { start, end, description } for a primary-calendar event,
  // or null if it was deleted or isn't a timed event.
  async getEventById(eventId) {
    try {
      const resp = await gapi.client.calendar.events.get({ calendarId: 'primary', eventId });
      const e = resp.result;
      if (e.status === 'cancelled' || !this._isTimed(e)) return null;
      return {
        start: new Date(e.start.dateTime),
        end: new Date(e.end.dateTime),
        description: e.description || '',
      };
    } catch (err) {
      if (this._isGone(err) || this._handleApiError(err)) return null;
      throw err;
    }
  }

  async createEvent({ summary, description, startDate, startTime, hours }) {
    if (!this.syncEnabled) return null;
    try {
      const resp = await gapi.client.calendar.events.insert({
        calendarId: 'primary',
        resource: {
          summary,
          description: description || '',
          ...this._eventTimes(startDate, startTime, hours),
          colorId: '4',
        },
      });
      return resp.result.id;
    } catch (err) {
      if (this._handleApiError(err)) return null;
      throw err;
    }
  }

  async updateEvent({ eventId, summary, startDate, startTime, hours }) {
    if (!this.syncEnabled) return eventId || null;
    try {
      const resp = await gapi.client.calendar.events.patch({
        calendarId: 'primary',
        eventId,
        resource: { summary, ...this._eventTimes(startDate, startTime, hours) },
      });
      return resp.result.id;
    } catch (err) {
      if (this._handleApiError(err)) return null;
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
      if (this._isGone(err) || this._handleApiError(err)) return;
      console.warn('Failed to update event description:', err);
    }
  }

  async deleteEvent(eventId) {
    if (!this.syncEnabled) return eventId || null;
    try {
      await gapi.client.calendar.events.delete({ calendarId: 'primary', eventId });
    } catch (err) {
      if (this._isGone(err) || this._handleApiError(err)) return;
      throw err;
    }
  }

  // ── Helpers ──────────────────────────────────────────────

  // Detects auth failures; on one, signs out quietly and returns true.
  _handleApiError(err) {
    const isAuthError = err && (err.status === 401 || err.result?.error?.code === 401);
    if (!isAuthError) return false;
    this._quietSignOut();
    return true;
  }

  _isGone(err) {
    return err.status === 404 || err.status === 410;
  }

  // All-day events have only a `date`, not a `dateTime`.
  _isTimed(event) {
    return Boolean(event.start && event.start.dateTime);
  }

  _eventTimes(startDate, startTime, hours) {
    const start = parseLocalDateTime(startDate, startTime);
    const end = new Date(start.getTime() + parseFloat(hours) * 3600 * 1000);
    return {
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };
  }
}
