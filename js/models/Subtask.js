export class TimeBlock {
  constructor({ date = '', start = '09:00', hours = 1, eventId = null } = {}) {
    this.date = date;
    this.start = start;
    this.hours = hours;
    this.eventId = eventId; // Google Calendar event ID
  }

  get hoursNum() {
    return parseFloat(this.hours || 0);
  }

  toJSON() {
    return { date: this.date, start: this.start, hours: this.hours, eventId: this.eventId };
  }
}

export class Subtask {
  constructor({
    name = '', due = '', estHours = '', blocks = [],
    done = false, actualHours = null,
  } = {}) {
    this.name = name;
    this.due = due;
    this.estHours = estHours;
    this.blocks = blocks.map((b) => new TimeBlock(b));
    this.done = done;
    this.actualHours = actualHours;
  }

  get estHoursNum() {
    return parseFloat(this.estHours || 0);
  }

  get allocatedHours() {
    return this.blocks.reduce((sum, b) => sum + b.hoursNum, 0);
  }

  get remainingHours() {
    return this.estHoursNum - this.allocatedHours;
  }

  toJSON() {
    return {
      name: this.name,
      due: this.due,
      estHours: this.estHours,
      blocks: this.blocks.map((b) => b.toJSON()),
      done: this.done,
      actualHours: this.actualHours,
    };
  }
}