const toHours = (value) => parseFloat(value || 0);

// Short, practically unique id: base-36 timestamp plus a random suffix.
const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// A scheduled chunk of work on a given day, optionally mirrored as a Google Calendar event.
export class TimeBlock {
  constructor({ date = '', start = '09:00', hours = 1, eventId = null } = {}) {
    this.date = date;
    this.start = start;
    this.hours = hours;
    this.eventId = eventId;
  }

  get hoursNum() {
    return toHours(this.hours);
  }

  toJSON() {
    return { date: this.date, start: this.start, hours: this.hours, eventId: this.eventId };
  }
}

export class Subtask {
  constructor({
    name = '', due = '', estHours = '', blocks = [],
    done = false, actualHours = null, id = null, note = '', waiting = false,
  } = {}) {
    this.id = id || generateId();
    this.name = name;
    this.note = note;
    this.waiting = waiting;
    this.due = due;
    this.estHours = estHours;
    this.blocks = blocks.map((b) => new TimeBlock(b));
    this.done = done;
    this.actualHours = actualHours;
  }

  get estHoursNum() {
    return toHours(this.estHours);
  }

  get allocatedHours() {
    return this.blocks.reduce((sum, b) => sum + b.hoursNum, 0);
  }

  get remainingHours() {
    return this.estHoursNum - this.allocatedHours;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      note: this.note,
      waiting: this.waiting,
      due: this.due,
      estHours: this.estHours,
      blocks: this.blocks.map((b) => b.toJSON()),
      done: this.done,
      actualHours: this.actualHours,
    };
  }
}
