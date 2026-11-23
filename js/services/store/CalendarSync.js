// CalendarSync owns keeping task time blocks and Google Calendar events in step.
import { startOfDay, ymdLocal, hhmm, parseLocalDate } from '../../core/dates.js';

const isReady = (googleCalendar) => googleCalendar && googleCalendar.isAuthed;
const eventTitle = (task, st) => `${task.name}: ${st.name}`;

export class CalendarSync {
  // store: the TaskStore whose tasks are synced (read via store.tasks, saved via store.save)
  constructor(store) {
    this.store = store;
  }

  // ---------- block counting ----------
  // blocks on incomplete subtasks that still need a calendar event
  countBlocksWithoutEvents() {
    return this._countBlocks((st, b) => !st.done && !b.eventId);
  }

  countBlocksWithEvents() {
    return this._countBlocks((st, b) => !!b.eventId);
  }

  _countBlocks(predicate) {
    let count = 0;
    for (const { st, block } of this._allBlocks()) {
      if (predicate(st, block)) count++;
    }
    return count;
  }

  *_allBlocks() {
    for (const task of this.store.tasks) {
      for (const st of task.subtasks) {
        for (const block of st.blocks) yield { task, st, block };
      }
    }
  }

  // ---------- per-task writes ----------
  // A task rename retitles every subtask's events; otherwise only renamed subtasks'.
  async updateEventTitles(task, taskNameChanged, renamedSubtasks, googleCalendar) {
    const subtasksToUpdate = new Set();
    if (taskNameChanged) task.subtasks.forEach((st) => subtasksToUpdate.add(st));
    renamedSubtasks.forEach(({ subtask }) => subtasksToUpdate.add(subtask));

    for (const st of subtasksToUpdate) {
      for (const b of st.blocks) {
        if (!b.eventId) continue;
        try {
          await googleCalendar.updateEvent({
            eventId: b.eventId,
            summary: eventTitle(task, st),
            startDate: b.date,
            startTime: b.start,
            hours: b.hours,
          });
        } catch (e) {
          console.warn('Failed to update event title:', e);
        }
      }
    }
  }

  // scope: 'none' | 'future' | 'all'
  async deleteSubtaskEvents(st, scope, googleCalendar) {
    if (scope === 'none') return;
    if (!isReady(googleCalendar)) return;

    const today = startOfDay(new Date());
    for (const b of st.blocks) {
      if (!b.eventId) continue;
      if (scope === 'future' && parseLocalDate(b.date) < today) continue;
      try {
        await googleCalendar.deleteEvent(b.eventId);
      } catch (e) {
        // usually 404/410 = already gone on Google's side → safe to clear locally
        console.warn('Failed to delete event, clearing locally:', b.eventId, e);
      }
      b.eventId = null;
    }
  }

  // ---------- bulk writes ----------
  // Create events for every block lacking one (used when turning sync on).
  async pushUnsyncedBlocks(googleCalendar, onProgress = null) {
    if (!isReady(googleCalendar)) return 0;

    return this._withCalendarWrites(googleCalendar, async () => {
      const total = this.countBlocksWithoutEvents();
      let pushed = 0;

      for (const { task, st, block } of this._allBlocks()) {
        if (st.done || block.eventId) continue;
        try {
          block.eventId = await googleCalendar.createEvent({
            summary: eventTitle(task, st),
            description: st.note || '',
            startDate: block.date,
            startTime: block.start,
            hours: block.hours,
          });
          pushed++;
          if (onProgress) onProgress(pushed, total);
        } catch (e) {
          console.warn('Failed to push block:', e);
        }
      }
      return pushed;
    });
  }

  async deleteAllCalendarEvents(googleCalendar, onProgress = null) {
    if (!isReady(googleCalendar)) return 0;

    return this._withCalendarWrites(googleCalendar, async () => {
      const total = this.countBlocksWithEvents();
      let deleted = 0;

      for (const { block } of this._allBlocks()) {
        if (!block.eventId) continue;
        try {
          await googleCalendar.deleteEvent(block.eventId);
          deleted++;
          if (onProgress) onProgress(deleted, total);
        } catch (e) {
          console.warn('Failed to delete event:', e);
        }
        block.eventId = null;
      }
      return deleted;
    });
  }

  // Temporarily force calendar writes on, then save without an undo step.
  async _withCalendarWrites(googleCalendar, work) {
    const prevSync = googleCalendar.syncEnabled;
    googleCalendar.syncEnabled = true;
    const result = await work();
    googleCalendar.syncEnabled = prevSync;
    this.store.save({ history: false });
    return result;
  }

  // ---------- reading back from Google ----------
  // Check every block's event against Google Calendar: events deleted on Google
  // detach from their block, moved/resized events update it, and event
  // descriptions sync back into subtask notes. Blocks themselves are always kept.
  async reconcile(googleCalendar) {
    if (!isReady(googleCalendar)) return false;

    const range = this._blockDateRange();
    if (!range) return false;

    // one batch request up front; bail out if the calendar can't be reached
    try {
      await googleCalendar.getEvents(range.min, range.max, ['primary']);
    } catch (e) {
      console.warn('Reconcile batch fetch failed', e);
      return false;
    }

    let changed = false;
    for (const task of this.store.tasks) {
      for (const st of task.subtasks) {
        const keptBlocks = [];
        for (const b of st.blocks) {
          if (b.eventId && await this._syncBlockWithEvent(st, b, googleCalendar)) changed = true;
          keptBlocks.push(b);
        }
        st.blocks = keptBlocks;
      }
    }

    if (changed) this.store.save({ history: false }); // calendar sync isn't an undoable action
    return changed;
  }

  // Earliest-to-latest block dates, widened by a day before and two after.
  _blockDateRange() {
    let min = null;
    let max = null;
    for (const { block } of this._allBlocks()) {
      if (!block.date) continue;
      const d = parseLocalDate(block.date);
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
    if (!min) return null;

    min.setDate(min.getDate() - 1);
    max.setDate(max.getDate() + 2);
    return { min, max };
  }

  // Returns true if the block or subtask changed.
  async _syncBlockWithEvent(st, block, googleCalendar) {
    let event;
    try {
      event = await googleCalendar.getEventById(block.eventId);
    } catch {
      return false; // network error → leave untouched
    }

    if (event === null) {
      block.eventId = null; // deleted on Google → block becomes app-only
      return true;
    }

    let changed = false;
    if (!st.done) {
      const newDate = ymdLocal(event.start);
      const newStart = hhmm(event.start);
      const newHours = (event.end - event.start) / 3600000;
      if (block.date !== newDate || block.start !== newStart ||
          Math.abs(block.hoursNum - newHours) > 0.001) {
        block.date = newDate;
        block.start = newStart;
        block.hours = Math.round(newHours * 100) / 100;
        changed = true;
      }
    }

    const description = event.description || '';
    if (description !== (st.note || '')) {
      st.note = description;
      changed = true;
    }
    return changed;
  }
}
