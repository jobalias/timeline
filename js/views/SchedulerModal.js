import { TimeBlock } from '../models/Subtask.js';

export class SchedulerModal {
  constructor(store, googleCalendar) {
    this.store = store;
    this.gcal = googleCalendar;
    this.context = null; // { taskId, subIndex }

    this.backdrop = document.getElementById('schedBackdrop');
    this.title = document.getElementById('schedTitle');
    this.counter = document.getElementById('schedCounter');
    this.blockList = document.getElementById('blockList');
    this.pushBtn = document.getElementById('pushBtn');

    document.getElementById('addBlockBtn')
      .addEventListener('click', () => this._addBlockRow());
    document.getElementById('schedCancelBtn')
      .addEventListener('click', () => this.close());
    this.pushBtn.addEventListener('click', () => this._push());
  }

  open(taskId, subIndex) {
    this.context = { taskId, subIndex };
    const st = this.store.find(taskId).subtasks[subIndex];
    this.title.textContent = `Schedule: ${st.name}`;
    this.blockList.innerHTML = '';
    st.blocks.forEach((b) => this._addBlockRow(b));
    if (st.blocks.length === 0) this._addBlockRow();
    this._updateCounter();
    this.backdrop.classList.add('open');
  }

  close() {
    this.backdrop.classList.remove('open');
  }

  _addBlockRow(data = {}) {
    const row = document.createElement('div');
    row.className = 'block-row';
    row.innerHTML = `
      <div><label>Date</label><input type="date" value="${data.date || ''}"></div>
      <div><label>Start</label><input type="time" value="${data.start || '09:00'}"></div>
      <div><label>Hours</label>
        <input type="number" min="0.5" step="0.5" value="${data.hours || 1}"></div>
      <button class="del-btn">✕</button>`;

    row.querySelectorAll('input').forEach((inp) =>
      inp.addEventListener('input', () => this._updateCounter())
    );
    row.querySelector('.del-btn').addEventListener('click', () => {
      row.remove();
      this._updateCounter();
    });
    this.blockList.appendChild(row);
  }

  _readBlocks() {
    const rows = this.blockList.querySelectorAll('.block-row');
    const blocks = [];
    rows.forEach((r) => {
      const inputs = r.querySelectorAll('input');
      if (!inputs[0].value) return;
      blocks.push(
        new TimeBlock({
          date: inputs[0].value,
          start: inputs[1].value,
          hours: inputs[2].value,
        })
      );
    });
    return blocks;
  }

  _updateCounter() {
    const st = this.store.find(this.context.taskId).subtasks[this.context.subIndex];
    const est = st.estHoursNum;
    const allocated = this._readBlocks().reduce((s, b) => s + b.hoursNum, 0);
    const remaining = est - allocated;

    if (est === 0) {
      this.counter.textContent = `${allocated}h allocated (no estimate set)`;
      this.counter.classList.remove('done');
    } else if (remaining <= 0) {
      this.counter.textContent = `✓ ${allocated}h allocated — fully scheduled!`;
      this.counter.classList.add('done');
    } else {
      this.counter.textContent =
        `${est}h needed · ${allocated}h allocated · ${remaining}h remaining`;
      this.counter.classList.remove('done');
    }
  }

  async _push() {
    if (!this.gcal.isAuthed) {
      alert('Please connect Google first (button in toolbar).');
      return;
    }
    const blocks = this._readBlocks();
    if (blocks.length === 0) {
      alert('Add at least one time block.');
      return;
    }

    const task = this.store.find(this.context.taskId);
    const st = task.subtasks[this.context.subIndex];

    // save locally first
    this.store.setSubtaskBlocks(this.context.taskId, this.context.subIndex, blocks);

    this.pushBtn.disabled = true;
    this.pushBtn.textContent = 'Creating events...';

    try {
      for (const b of blocks) {
        await this.gcal.createEvent({
          summary: `${task.name}: ${st.name}`,
          startDate: b.date,
          startTime: b.start,
          hours: b.hours,
        });
      }
      this.pushBtn.textContent = '✓ Added to Calendar';
      setTimeout(() => {
        this.pushBtn.disabled = false;
        this.pushBtn.textContent = 'Push to Google Calendar';
        this.close();
      }, 1200);
    } catch (err) {
      console.error(err);
      alert('Error creating events: ' + (err.result?.error?.message || err.message));
      this.pushBtn.disabled = false;
      this.pushBtn.textContent = 'Push to Google Calendar';
    }
  }
}