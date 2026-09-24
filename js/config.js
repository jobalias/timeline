// ====== GOOGLE CREDENTIALS — paste yours here ======
export const CLIENT_ID = '400372170176-1ebitf2c7vl6tlts5l2iigjbrncrgddl.apps.googleusercontent.com';
export const API_KEY = 'AIzaSyDoUW_TbSyolodDo8hHmKUidjqDakvs1Co';
// ====================================================

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ');

export const DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
  'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
];

export const DISCOVERY_DOC = DISCOVERY_DOCS[0];

export const DAYS_SHOWN = 100;
export const WINDOW_LOOKBACK = 2; // days shown before today

// ====================================================
