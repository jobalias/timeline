import { Task, PALETTE } from '../models/Task.js';
import {_getSoonestDueDate } from '../utils.js';

const STORAGE_KEY = 'taskGrid';

export class TaskStore {
  constructor() {
    this.completionLog = [];        
    this.tasks = this._loadLocal();
    this.listeners = [];
    this.used_colors = [];
    this.drive = null;
    this.syncStatusFn = () => {};
    this._saveTimer = null;
  }

  // ---------- Drive wiring ----------
  attachDrive(drive) {
    this.drive = drive;
  }

  onSyncStatus(fn) {
    this.syncStatusFn = fn;
  }

  // Check all incomplete subtasks' blocks against Google Calendar.
  // Removes deleted events, updates moved/resized ones.
  async reconcileWithCalendar(googleCalendar) {
    if (!googleCalendar || !googleCalendar.isAuthed) return false;

    let changed = false;

    for (const task of this.tasks) {
      for (const st of task.subtasks) {
        const keptBlocks = [];

        for (const b of st.blocks) {
          // No eventId → block isn't linked to any real event → remove it
          if (!b.eventId) {
            changed = true;
            continue;
          }

          // Has eventId → check if the event still exists in Google
          let real;
          try {
            real = await googleCalendar.getEventById(b.eventId);
          } catch (e) {
            // network error → keep block (don't lose data on a transient error)
            keptBlocks.push(b);
            continue;
          }

          if (real === null) {
            // event was deleted in Google → remove the block
            changed = true;
            continue;
          }

          // event exists → sync block to match (for incomplete subtasks)
          // for done subtasks, just keep as-is (don't move completed history around)
          if (!st.done) {
            const newDate = this._ymdLocal(real.start);
            const newStart = this._hhmm(real.start);
            const newHours = (real.end - real.start) / 3600000;
            if (b.date !== newDate || b.start !== newStart ||
                Math.abs(b.hoursNum - newHours) > 0.001) {
              b.date = newDate;
              b.start = newStart;
              b.hours = Math.round(newHours * 100) / 100;
              changed = true;
            }
          }

          keptBlocks.push(b);
        }

        st.blocks = keptBlocks;
      }
    }

    if (changed) this._save();
    return changed;
  }

  // local-time YYYY-MM-DD (avoid UTC shift)
  _ymdLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  _hhmm(d) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // Called after Google connects: pull from Drive (last-write-wins = Drive wins on load)
  async loadFromDrive() {
    if (!this.drive) { this._setStatus('offline'); return; }
    this._setStatus('saving');
    const remote = await this.drive.load();
    console.log('📁 DRIVE FILE CONTENTS:', JSON.stringify(remote, null, 2)); // ← temp
    if (remote) {
      let taskArray, log;
      if (Array.isArray(remote)) {
        taskArray = remote; log = [];
      } else if (remote && typeof remote === 'object') {
        taskArray = remote.tasks || []; log = remote.completionLog || [];
      } else {
        this._setStatus('synced'); return;
      }
      this.tasks = taskArray.map((t) => new Task(t));
      this.completionLog = log;

      let colorIndex = 0;
      this.used_colors = [];
      for (const t of this.tasks) {
        t.color = PALETTE[colorIndex % PALETTE.length];
        this.used_colors.push(t.color);
        colorIndex++;
      }
      this._saveLocal();
      this._notify();
      this._setStatus('synced');
    } else {
      if (this.tasks.length > 0) await this._saveRemote();
      else this._setStatus('synced');
    }
  }

  // ---------- persistence ----------
  _loadLocal() {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw) { this.completionLog = []; return []; }
    if (Array.isArray(raw)) { this.completionLog = []; return raw.map((t) => new Task(t)); }
    this.completionLog = raw.completionLog || [];
    return (raw.tasks || []).map((t) => new Task(t));
  }

  _saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tasks: this.tasks.map((t) => t.toJSON()),
      completionLog: this.completionLog,
    }));
  }

  async _saveRemote() {
    if (!this.drive || !this.drive.isReady) { this._setStatus('offline'); return; }
    this._setStatus('saving');
    const ok = await this.drive.save({
      tasks: this.tasks.map((t) => t.toJSON()),
      completionLog: this.completionLog,
    });
    this._setStatus(ok ? 'synced' : 'failed');
  }

  addBlockToSubtask(taskId, subIndex, block) {
    const t = this.find(taskId);
    if (!t) return;
    const st = t.subtasks[subIndex];
    if (!st) return;
    st.blocks.push(block);
    this._save();
  }

  _setStatus(status) {
    this._status = status;
    this.syncStatusFn(status);
  }

  // Save locally immediately, debounce the Drive save
  _save() {
    this._saveLocal();
        this._notify();

        // immediately show we have unsaved changes
        if (this.drive && this.drive.isReady) {
        this._setStatus('saving');
        }

        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._saveRemote(), 800);
    }

  // ---------- subscriptions ----------
  subscribe(fn) { this.listeners.push(fn); }
  _notify() { this.listeners.forEach((fn) => fn()); }

  // ---------- queries ----------
  getAll() { return this.tasks; }
  find(id) { return this.tasks.find((t) => t.id === id); }

  getSorted() {
    const isTaskDone = (t) =>
      t.subtasks.length > 0 && t.subtasks.every((s) => s.done);
    const soonestDueDate = (t) => {
      return _getSoonestDueDate(t);
    };

    const sorted = [...this.tasks].sort(
      (a, b) => (isTaskDone(a) ? 1 : 0) - (isTaskDone(b) ? 1 : 0)
    );``
    return sorted.sort((a, b) => {
      const aDue = soonestDueDate(a);
      const bDue = soonestDueDate(b);
      if (aDue && bDue) return aDue - bDue;
      if (aDue) return -1;
      if (bDue) return 1;
      return 0;
    });
  }

  // Remove blocks that have no matching Google event, and dedupe
  async cleanupOrphanedBlocks(googleCalendar) {
    if (!googleCalendar || !googleCalendar.isAuthed) {
      return { removed: 0, deduped: 0 };
    }

    let removed = 0;
    let deduped = 0;

    for (const task of this.tasks) {
      for (const st of task.subtasks) {
        if (st.done) continue; // leave completed alone

        const validBlocks = [];
        const seenSignatures = new Set();

        for (const b of st.blocks) {
          // 1) dedupe: same date+start+hours = duplicate
          const sig = `${b.date}|${b.start}|${b.hours}`;
          if (seenSignatures.has(sig)) {
            deduped++;
            // if it has an eventId, delete that duplicate from Google too
            if (b.eventId) {
              try { await googleCalendar.deleteEvent(b.eventId); } catch {}
            }
            continue;
          }
          seenSignatures.add(sig);

          // 2) orphan check: does the Google event still exist?
          if (b.eventId) {
            let exists = true;
            try {
              const real = await googleCalendar.getEventById(b.eventId);
              exists = real !== null;
            } catch {
              exists = true; // network error → keep it, don't lose data
            }
            if (!exists) {
              removed++;
              continue; // event gone → drop this orphaned block
            }
          }
          // blocks with no eventId: keep (can't verify) — or optionally drop
          validBlocks.push(b);
        }

        st.blocks = validBlocks;
      }
    }

    if (removed > 0 || deduped > 0) {
      this._save();
    }
    return { removed, deduped };
  }

  // ---------- mutations ----------
  add(task) { this.tasks.push(task); this._save(); }

  async update(id, { name, subtasks }, googleCalendar) {
    const t = this.find(id);
    if (!t) return;

    const oldTaskName = t.name;
    const taskNameChanged = oldTaskName !== name;

    // Track which subtasks were renamed (by ID) so we can update their events
    const renamedSubtasks = []; // { subtask, oldName, newName }

    subtasks.forEach((ns) => {
      const old = t.subtasks.find((o) => o.id === ns.id);
      if (old) {
        if (old.blocks.length) ns.blocks = old.blocks;
        ns.done = old.done;
        ns.actualHours = old.actualHours;

        // detect subtask rename
        if (old.name !== ns.name) {
          renamedSubtasks.push({ subtask: ns, oldName: old.name, newName: ns.name });
        }
      }
    });

    t.name = name;
    t.subtasks = subtasks;
    this._save();

    // Update Google Calendar event titles for renamed items
    if (googleCalendar && googleCalendar.isAuthed) {
      await this._updateEventTitles(t, taskNameChanged, renamedSubtasks, googleCalendar);
    }
  }

  // Update event titles when task/subtask names change
  async _updateEventTitles(task, taskNameChanged, renamedSubtasks, googleCalendar) {
    // If the TASK name changed, ALL subtasks' events need new titles
    // If only some subtasks were renamed, just those need updating
    const subtasksToUpdate = new Set();

    if (taskNameChanged) {
      // every subtask with events needs its title refreshed
      task.subtasks.forEach((st) => subtasksToUpdate.add(st));
    }
    renamedSubtasks.forEach(({ subtask }) => subtasksToUpdate.add(subtask));

    for (const st of subtasksToUpdate) {
      for (const b of st.blocks) {
        if (!b.eventId) continue;
        try {
          await googleCalendar.updateEvent({
            eventId: b.eventId,
            summary: `${task.name}: ${st.name}`,
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

  setSubtaskBlocks(taskId, subIndex, blocks) {
    const t = this.find(taskId);
    if (!t) return;
    t.subtasks[subIndex].blocks = blocks;
    this._save();
  }

  uncompleteSubtask(taskId, subIndex) {
    const t = this.find(taskId);
    if (!t) return;
    const st = t.subtasks[subIndex];
    st.done = false;
    st.actualHours = null;
    st.blocks = st.blocks.filter((b) => b.eventId !== null);
    this._save();
  }

  async deleteSubtaskEvents(st, scope, googleCalendar) {
    if (scope === 'none') return;
    if (!googleCalendar || !googleCalendar.isAuthed) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const b of st.blocks) {
      if (!b.eventId) continue;
      if (scope === 'future') {
        const blockDate = new Date(b.date + 'T00:00:00');
        if (blockDate < today) continue;
      }
      await googleCalendar.deleteEvent(b.eventId);
      b.eventId = null;
    }
  }

  async completeSubtask(taskId, subIndex, actualHours, scope, googleCalendar) {
    const t = this.find(taskId);
    if (!t) return;
    const st = t.subtasks[subIndex];
    await this.deleteSubtaskEvents(st, scope, googleCalendar);
    st.done = true;
    st.actualHours = actualHours;
    this._save();
  }

  async removeTask(id, scope, googleCalendar) {
    const t = this.find(id);
    if (!t) return;
    if (scope && scope !== 'none') {
      for (const st of t.subtasks) {
        await this.deleteSubtaskEvents(st, scope, googleCalendar);
      }
    }
    this.tasks = this.tasks.filter((x) => x.id !== id);
    this._save();
  }

    // Log a completed subtask (one entry per subtask; updates if re-completed)
  logCompletion({ taskName, subtaskName, subtaskId, hoursSpent, taskId, taskJustCompleted }) {
    const entry = {
      subtaskId,
      taskId,
      taskName,
      subtaskName,
      hoursSpent,
      taskJustCompleted: !!taskJustCompleted, // was this the last subtask?
      completedAt: new Date().toISOString(),
    };

    const existingIdx = this.completionLog.findIndex(
      (e) => e.subtaskId === subtaskId
    );
    if (existingIdx >= 0) {
      this.completionLog[existingIdx] = entry;
    } else {
      this.completionLog.push(entry);
    }

    this._save();
  }

  getCompletionLog() {
    return this.completionLog;
  }
}