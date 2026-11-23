# How this app is put together

Plain ES modules, no build step: open `index.html` and `js/app.js` starts everything.

## Folders

- **js/app.js** — creates every service, view and controller and wires them together. Start reading here.
- **js/config.js** — Google API keys/scopes and the grid window size (`DAYS_SHOWN`, `WINDOW_LOOKBACK`).
- **js/utils.js**, **js/theme.js** — tiny helpers (HTML escaping, due-today test; reading a CSS variable).
- **js/core/** — reusable building blocks, no app knowledge:
  `dates.js` date/time helpers · `Modal.js` base popup · `View.js` base tab view (active/render/refresh) · `DragController.js` mouse + touch dragging.
- **js/models/** — `Task.js` (a task + the colour palette) and `Subtask.js` (subtasks and their time blocks).
- **js/services/** — data and Google:
  - `TaskStore.js` — the one object that owns all data; every change goes through its methods.
  - `store/UndoHistory.js` undo/redo snapshots · `store/LocalSaver.js` the saved JSON + localStorage · `store/DriveSync.js` debounced Google Drive saves and the sync status · `store/CalendarSync.js` keeps time blocks and Google Calendar events in step.
  - `GoogleCalendar.js` sign-in + Calendar API · `GoogleDrive.js` the Drive file · `Settings.js` per-browser settings (chosen calendars).
- **js/controllers/** — behaviour that isn't one screen:
  `ViewSwitcher` the tabs · `TaskActions` delete/complete/discard flows · `SchedulingQueue` "schedule each new subtask" sequence · `SettingsController` the ⚙️ popup (+ `AlwaysTasksList`) · `SyncStatus` sync badge and warning · `CalendarRefresh` the ⟳ buttons.
- **js/views/** — one file per screen or dialog:
  `WhiteboardView`, `GridView` (+ `DayView` side panel), `PlannerView` (FullCalendar), `ProgressView` are the four tabs; `TaskModal`, `NoteModal`, `DeleteDialog`, `CalendarView` (the scheduler overlay), `CalendarPicker`, `UndoControls`.
- **js/lib/fullcalendar.min.js** — third-party, don't edit.
- **css/** — loaded in this order (later files win on ties):
  `tokens` (all colours, fonts, sizes) → `base` → `components` → `toolbar` → `grid` → `dayview` → `hoursfilter` → `planner` → `progress` → `whiteboard` → `scheduler` → `modals` → `undo`.

## How data flows

1. A view or controller calls a `TaskStore` method (e.g. `store.toggleWaiting(id, i)`, `store.setPersistent(id, true)`).
2. The method changes the data, then calls `store.save()`, which runs the save pipeline:
   **undo step** (UndoHistory) → **localStorage** (LocalSaver) → **notify** (the visible tab re-renders via `ViewSwitcher.renderActive`) → **Drive save** a moment later (DriveSync, debounced).
3. Google Calendar: CalendarSync creates/updates/deletes events for time blocks, and on ⟳ or sign-in reads Google back (moved or deleted events) and saves without an undo step.
4. On sign-in, the Drive copy is loaded and replaces local data (last write wins), and the undo history is reset.

Never change task objects and then save from outside the store — add a small store method instead.

## Where do I change…?

| I want to… | Look in |
|---|---|
| add a tab | new view in `js/views/` extending `core/View.js`, a tab + container in `index.html`, an entry in `controllers/ViewSwitcher.js`, create it in `app.js` |
| change a dialog's behaviour | its file in `js/views/` (`TaskModal`, `NoteModal`, `DeleteDialog`…); markup is in `index.html` |
| change colours, fonts, spacing | `css/tokens.css` only (task colours are `--task-01…`) |
| change how a screen looks | the matching `css/<screen>.css` |
| change how many undo steps | `UNDO_LIMIT` in `js/services/store/UndoHistory.js` |
| change the 8h "full day" | `FULL_DAY` / `RED_AT` in `js/views/ProgressView.js` |
| change the Drive save delay | `SAVE_DEBOUNCE_MS` in `js/services/store/DriveSync.js` |
| change how many days the grid shows | `DAYS_SHOWN` in `js/config.js` (phones: `MOBILE_DAYS_SHOWN` in `GridView.js`) |
| change what gets saved | `js/services/store/LocalSaver.js` (same shape goes to Drive) |
| change sync badge text | `SYNC_STATES` in `js/controllers/SyncStatus.js` |
