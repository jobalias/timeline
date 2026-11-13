import { escapeHtml } from '../utils.js';

// Whiteboard: a quick-capture list of Categories / Tasks / Subtasks.
// Nothing here touches the real task list until you click "Add →" on a line.
//
// Line shape (stored in TaskStore.whiteboard):
//   { id, kind: 'category' | 'task' | 'subtask', text, added: bool }

const KINDS = ['category', 'task', 'subtask'];
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = (s) => (s || '').trim().toLowerCase();

export class WhiteboardView {
  constructor(store, taskModal) {
    this.store = store;
    this.taskModal = taskModal;
    this.isActive = false;
    this.hideAdded = false;
    this.focusedId = null;

    this.listEl = document.getElementById('wbList');
    this.styleBtns = [...document.querySelectorAll('.wb-style-btn')];
    this.hideAddedEl = document.getElementById('wbHideAdded');
    this.clearAddedBtn = document.getElementById('wbClearAdded');

    // picker modal
    this.pickBackdrop = document.getElementById('wbPickBackdrop');
    this.pickTitle = document.getElementById('wbPickTitle');
    this.pickFilter = document.getElementById('wbPickFilter');
    this.pickList = document.getElementById('wbPickList');
    this._pickSubId = null;

    this._bindToolbar();
    this._bindList();
    this._bindDrag();
    this._bindPicker();
  }

  // ---------- lifecycle ----------
  activate() { this.isActive = true; this.render(); }
  deactivate() { this.isActive = false; }

  // store changed (typing, Drive load, etc.) — don't yank focus while typing
  onStoreChange() {
    if (!this.isActive || this._drag) return;
    if (this.listEl.contains(document.activeElement)) return;
    this.render();
  }

  get lines() {
    let l = this.store.getWhiteboard();
    if (!Array.isArray(l)) { l = []; this.store.whiteboard = l; }
    return l;
  }
  _find(id) { return this.lines.find((l) => l.id === id); }
  _index(id) { return this.lines.findIndex((l) => l.id === id); }
  _save() { this.store.saveWhiteboard(); }

  // nearest task line above a subtask
  _parentTask(subId) {
    const lines = this.lines;
    for (let i = this._index(subId) - 1; i >= 0; i--) {
      if (lines[i].kind === 'task') return lines[i];
      if (lines[i].kind === 'category') return null;
    }
    return null;
  }

  // subtask lines directly under a task (until next task/category)
  _children(taskId) {
    const lines = this.lines;
    const out = [];
    for (let i = this._index(taskId) + 1; i < lines.length; i++) {
      if (lines[i].kind !== 'subtask') break;
      out.push(lines[i]);
    }
    return out;
  }

  // ---------- rendering ----------
  render() {
    if (!this.isActive) return;
    if (this.lines.length === 0) {
      this.lines.push({ id: newId(), kind: 'task', text: '', added: false });
    }

    const visible = this.lines.filter((l) => !(this.hideAdded && l.added && l.kind !== 'category'));
    const placeholders = {
      category: 'Category',
      task: 'Task…   (type # for a category, - for a subtask)',
      subtask: 'Subtask',
    };

    this.listEl.innerHTML = visible.map((l) => {
      const canAdd = l.kind !== 'category';
      const action = !canAdd ? '' : l.added
        ? `<button class="wb-added" data-act="unadd" title="Added to your tasks — click to mark as not added">✓ Added</button>`
        : `<button class="wb-add" data-act="add" title="Add this to your tasks"${l.text.trim() ? '' : ' disabled'}>Add →</button>`;
      const handle = canAdd
        ? `<span class="wb-handle" title="Drag to move${l.kind === 'task' ? ' (brings its subtasks along)' : ' under a task'}" aria-hidden="true">⋮⋮</span>`
        : '';
      const hours = l.kind === 'subtask'
        ? `<input class="wb-hours" type="number" min="0" step="0.5" inputmode="decimal"
             value="${escapeHtml(l.hours ?? '')}" placeholder="h" title="Est. hours (optional)" aria-label="Estimated hours">`
        : '';
      return `
        <div class="wb-line wb-${l.kind}${l.added ? ' is-added' : ''}" data-id="${l.id}">
          ${handle}
          <span class="wb-bullet" aria-hidden="true"></span>
          <input class="wb-input" type="text" value="${escapeHtml(l.text)}"
            placeholder="${placeholders[l.kind]}" aria-label="${l.kind}">
          ${hours}
          ${action}
          <button class="wb-del" data-act="del" title="Delete line" tabindex="-1">✕</button>
        </div>`;
    }).join('');

    const total = this.lines.filter((l) => l.added).length;
    this.clearAddedBtn.disabled = total === 0;
    this.clearAddedBtn.textContent = total ? `Clear added (${total})` : 'Clear added';
    this._syncStyleBtns();
  }

  _focus(id, caret = 'end') {
    const input = this.listEl.querySelector(`.wb-line[data-id="${id}"] .wb-input`);
    if (!input) return;
    input.focus();
    const pos = caret === 'start' ? 0 : caret === 'end' ? input.value.length : caret;
    input.setSelectionRange(pos, pos);
  }

  _syncStyleBtns() {
    const l = this.focusedId && this._find(this.focusedId);
    this.styleBtns.forEach((b) => b.classList.toggle('active', !!l && b.dataset.kind === l.kind));
  }

  // ---------- toolbar ----------
  _bindToolbar() {
    this.styleBtns.forEach((btn) => {
      // mousedown + preventDefault keeps the caret in the current line
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const id = this.focusedId;
        if (id && this._find(id)) {
          this._setKind(id, btn.dataset.kind);
        } else {
          // nothing focused → start a new line of that style at the bottom
          const line = { id: newId(), kind: btn.dataset.kind, text: '', added: false };
          this.lines.push(line);
          this._save();
          this.render();
          this._focus(line.id);
        }
      });
    });

    this.hideAddedEl.addEventListener('change', () => {
      this.hideAdded = this.hideAddedEl.checked;
      this.render();
    });

    this.clearAddedBtn.addEventListener('click', () => {
      const n = this.lines.filter((l) => l.added).length;
      if (!n || !confirm(`Remove ${n} added line${n === 1 ? '' : 's'} from the whiteboard?\n(Your real tasks are not affected.)`)) return;
      this.store.setWhiteboard(this.lines.filter((l) => !l.added));
      this.render();
    });
  }

  _setKind(id, kind) {
    const l = this._find(id);
    if (!l || l.kind === kind) return;
    const input = this.listEl.querySelector(`.wb-line[data-id="${id}"] .wb-input`);
    const caret = input ? input.selectionStart : 'end';
    l.kind = kind;
    if (kind === 'category') l.added = false;
    this._save();
    this.render();
    this._focus(id, caret);
  }

  // ---------- list editing ----------
  _bindList() {
    const lineOf = (el) => el.closest('.wb-line');

    this.listEl.addEventListener('focusin', (e) => {
      const row = lineOf(e.target);
      if (row && e.target.classList.contains('wb-input')) {
        this.focusedId = row.dataset.id;
        this._syncStyleBtns();
      }
    });
    this.listEl.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!this.listEl.contains(document.activeElement)) {
          this.focusedId = null;
          this._syncStyleBtns();
        }
      }, 0);
    });

    this.listEl.addEventListener('input', (e) => {
      if (e.target.classList.contains('wb-hours')) {
        const l = this._find(lineOf(e.target).dataset.id);
        if (l) { l.hours = e.target.value; this._save(); }
        return;
      }
      if (!e.target.classList.contains('wb-input')) return;
      const row = lineOf(e.target);
      const l = this._find(row.dataset.id);
      if (!l) return;

      // markdown-style shortcuts at the start of a line
      const v = e.target.value;
      const shortcut = /^#\s/.test(v) ? 'category' : /^[-*]\s/.test(v) ? 'subtask' : null;
      if (shortcut) {
        l.text = v.slice(2);
        l.kind = shortcut;
        if (shortcut === 'category') l.added = false;
        this._save();
        this.render();
        this._focus(l.id, 'start');
        return;
      }

      l.text = v;
      const addBtn = row.querySelector('.wb-add');
      if (addBtn) addBtn.disabled = !v.trim();
      this._save();
    });

    this.listEl.addEventListener('keydown', (e) => {
      if (!e.target.classList.contains('wb-input')) return;
      if (e.isComposing) return;
      const input = e.target;
      const id = lineOf(input).dataset.id;
      const l = this._find(id);
      if (!l) return;

      // Cmd/Ctrl + 1/2/3 → Category / Task / Subtask
      if ((e.metaKey || e.ctrlKey) && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        this._setKind(id, KINDS[+e.key - 1]);
        return;
      }

      switch (e.key) {
        case 'Enter': {
          e.preventDefault();
          if ((e.metaKey || e.ctrlKey) && l.kind !== 'category' && l.text.trim()) {
            this._startAdd(id);   // Cmd+Enter → Add →
            return;
          }
          // empty subtask + Enter → step back out to a task (like outdenting a bullet)
          if (!l.text && l.kind === 'subtask') { this._setKind(id, 'task'); return; }
          this._splitLine(id, input.selectionStart, input.selectionEnd);
          return;
        }
        case 'Tab': {
          e.preventDefault();
          const k = KINDS.indexOf(l.kind) + (e.shiftKey ? -1 : 1);
          if (k >= 0 && k < KINDS.length) this._setKind(id, KINDS[k]);
          return;
        }
        case 'Backspace': {
          if (input.selectionStart !== 0 || input.selectionEnd !== 0) return;
          e.preventDefault();
          // at start of a styled line → first drop to plain task
          if (l.text && l.kind !== 'task') { this._setKind(id, 'task'); this._focus(id, 'start'); return; }
          this._mergeWithPrevious(id);
          return;
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          const inputs = [...this.listEl.querySelectorAll('.wb-input')];
          const i = inputs.indexOf(input) + (e.key === 'ArrowUp' ? -1 : 1);
          if (inputs[i]) {
            e.preventDefault();
            inputs[i].focus();
            const pos = Math.min(input.selectionStart, inputs[i].value.length);
            inputs[i].setSelectionRange(pos, pos);
          }
          return;
        }
      }
    });

    this.listEl.addEventListener('paste', (e) => {
      if (!e.target.classList.contains('wb-input')) return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!text.includes('\n')) return;
      // multi-line paste → one line each; "# " = category, "- " / indented = subtask
      e.preventDefault();
      const id = lineOf(e.target).dataset.id;
      this._pasteLines(id, text);
    });

    this.listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = lineOf(btn).dataset.id;
      const act = btn.dataset.act;
      if (act === 'add') this._startAdd(id);
      else if (act === 'unadd') { const l = this._find(id); l.added = false; this._save(); this.render(); }
      else if (act === 'del') this._deleteLine(id);
    });
  }

  _splitLine(id, selStart, selEnd) {
    const l = this._find(id);
    const idx = this._index(id);
    const before = l.text.slice(0, selStart);
    const after = l.text.slice(selEnd);
    const nextKind = l.kind === 'category' ? 'task' : l.kind;

    // caret at very start of a non-empty line → insert blank line above
    if (selStart === 0 && l.text) {
      const above = { id: newId(), kind: l.kind, text: '', added: false };
      this.lines.splice(idx, 0, above);
      this._save();
      this.render();
      this._focus(id, 'start');
      return;
    }

    l.text = before;
    const line = { id: newId(), kind: nextKind, text: after, added: false };
    this.lines.splice(idx + 1, 0, line);
    this._save();
    this.render();
    this._focus(line.id, 'start');
  }

  _mergeWithPrevious(id) {
    const inputs = [...this.listEl.querySelectorAll('.wb-line')];
    const pos = inputs.findIndex((r) => r.dataset.id === id);
    if (pos <= 0) return;
    const prevId = inputs[pos - 1].dataset.id;
    const prev = this._find(prevId);
    const cur = this._find(id);
    const caret = prev.text.length;
    prev.text += cur.text;
    this.lines.splice(this._index(id), 1);
    this._save();
    this.render();
    this._focus(prevId, caret);
  }

  _deleteLine(id) {
    const l = this._find(id);
    if (!l) return;
    this.lines.splice(this._index(id), 1);
    this._save();
    this.render();
  }

  _pasteLines(id, text) {
    const idx = this._index(id);
    const cur = this._find(id);
    const parsed = text.split(/\r?\n/).filter((s) => s.trim()).map((raw) => {
      let kind = 'task';
      let t = raw;
      if (/^\s*#+\s*/.test(t)) { kind = 'category'; t = t.replace(/^\s*#+\s*/, ''); }
      else if (/^(\s{2,}|\t)/.test(t) || /^\s*[-*•]\s+/.test(t)) {
        kind = /^(\s{2,}|\t)/.test(t) ? 'subtask' : (cur.kind === 'category' ? 'task' : 'subtask');
        t = t.replace(/^\s*[-*•]?\s*/, '');
      } else t = t.replace(/^\s*\[\s?[xX]?\]\s*/, '');
      return { id: newId(), kind, text: t.trim(), added: false };
    });
    if (!parsed.length) return;

    let insertAt = idx + 1;
    if (!cur.text) { this.lines.splice(idx, 1); insertAt = idx; }
    this.lines.splice(insertAt, 0, ...parsed);
    this._save();
    this.render();
    this._focus(parsed[parsed.length - 1].id);
  }

  // ---------- drag & drop (pointer events → works with mouse and touch) ----------
  // Dragging a subtask re-parents it under whichever task ends up above it.
  // Dragging a task moves it together with its subtasks, and only drops
  // between task blocks (so it can't split another task's subtasks).
  _bindDrag() {
    this.listEl.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.wb-handle');
      if (!handle || e.button > 0) return;
      e.preventDefault();
      const row = handle.closest('.wb-line');
      const line = this._find(row.dataset.id);
      if (!line) return;

      const ids = [line.id];
      if (line.kind === 'task') this._children(line.id).forEach((c) => ids.push(c.id));
      const dragRows = ids.map((id) => this.listEl.querySelector(`.wb-line[data-id="${id}"]`)).filter(Boolean);
      dragRows.forEach((r) => r.classList.add('wb-dragging'));
      document.activeElement?.blur?.();

      const indicator = document.createElement('div');
      indicator.className = 'wb-drop-indicator' + (line.kind === 'subtask' ? ' is-subtask' : '');

      this._drag = { line, ids: new Set(ids), dragRows, indicator, beforeId: undefined, pointerId: e.pointerId };
      handle.setPointerCapture?.(e.pointerId);
      document.body.classList.add('wb-is-dragging');
      this._dragMove(e.clientY);
    });

    this.listEl.addEventListener('pointermove', (e) => {
      if (!this._drag || e.pointerId !== this._drag.pointerId) return;
      e.preventDefault();
      this._dragMove(e.clientY);
      // auto-scroll near the top/bottom of the window
      const edge = 60;
      if (e.clientY < edge) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
    });

    const end = (e, cancelled) => {
      if (!this._drag || e.pointerId !== this._drag.pointerId) return;
      const { ids, indicator, beforeId } = this._drag;
      indicator.remove();
      this.listEl.querySelectorAll('.wb-drop-parent').forEach((r) => r.classList.remove('wb-drop-parent'));
      document.body.classList.remove('wb-is-dragging');
      this._drag = null;
      if (!cancelled && beforeId !== undefined) this._moveBlock([...ids], beforeId);
      else this.render();
    };
    this.listEl.addEventListener('pointerup', (e) => end(e, false));
    this.listEl.addEventListener('pointercancel', (e) => end(e, true));
  }

  _dragMove(y) {
    const d = this._drag;
    const rows = [...this.listEl.querySelectorAll('.wb-line')].filter((r) => !d.ids.has(r.dataset.id));
    // a task block may only land before a task/category (or at the very end)
    const candidates = d.line.kind === 'task'
      ? rows.filter((r) => !r.classList.contains('wb-subtask'))
      : rows;

    const target = candidates.find((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });

    if (target) this.listEl.insertBefore(d.indicator, target);
    else this.listEl.appendChild(d.indicator);
    d.beforeId = target ? target.dataset.id : null;

    // highlight the task the subtask would belong to
    this.listEl.querySelectorAll('.wb-drop-parent').forEach((r) => r.classList.remove('wb-drop-parent'));
    if (d.line.kind === 'subtask') {
      let prev = d.indicator.previousElementSibling;
      while (prev && (d.ids.has(prev.dataset.id) || prev.classList.contains('wb-subtask'))) {
        prev = prev.previousElementSibling;
      }
      if (prev && prev.classList.contains('wb-task')) prev.classList.add('wb-drop-parent');
    }
  }

  // move the given line ids (kept in order) to just before `beforeId` (null = end)
  _moveBlock(ids, beforeId) {
    const set = new Set(ids);
    const moving = this.lines.filter((l) => set.has(l.id));
    const rest = this.lines.filter((l) => !set.has(l.id));
    let at = beforeId ? rest.findIndex((l) => l.id === beforeId) : rest.length;
    if (at < 0) at = rest.length;
    rest.splice(at, 0, ...moving);
    this.store.setWhiteboard(rest);
    this.render();
  }

  // ---------- promoting to the real task list ----------
  _findStoreTask(name) {
    return this.store.getAll().find((t) => norm(t.name) === norm(name));
  }
  _isOngoing(t) {
    return t.subtasks.length > 0 && !t.subtasks.every((s) => s.done);
  }

  _startAdd(id) {
    const l = this._find(id);
    if (!l || !l.text.trim()) return;
    if (l.kind === 'task') this._addTask(l);
    else if (l.kind === 'subtask') this._openPicker(l);
  }

  // Task → open Add Task modal prefilled with its (not-yet-added) subtasks
  _addTask(line) {
    const name = line.text.trim();
    const children = this._children(line.id).filter((c) => !c.added && c.text.trim());
    const subs = children.map((c) => ({ name: c.text.trim(), estHours: c.hours || '' }));
    const existing = this._findStoreTask(name);

    if (existing && this._isOngoing(existing)) {
      // already a live task → open it with the new subtasks appended
      this.taskModal.openEdit(existing.id, { extraSubtasks: subs });
    } else {
      this.taskModal.openNew({ name, subtasks: subs });
    }

    this.taskModal.setAfterSaveOnce((savedId) => {
      line.added = true;
      this._markSubtasksAdded(savedId, children);
      this._afterPromote();
    });
  }

  _markSubtasksAdded(savedId, lines) {
    const t = this.store.find(savedId);
    if (!t) return;
    const names = new Set(t.subtasks.map((s) => norm(s.name)));
    lines.forEach((c) => { if (names.has(norm(c.text))) c.added = true; });
  }

  _afterPromote() {
    this._save();
    if (this.isActive) this.render();
  }

  // ---------- subtask → choose a task ----------
  _bindPicker() {
    document.getElementById('wbPickCancel').addEventListener('click', () => this._closePicker());
    this.pickBackdrop.addEventListener('click', (e) => { if (e.target === this.pickBackdrop) this._closePicker(); });
    this.pickFilter.addEventListener('input', () => this._renderPicker());
    this.pickFilter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._closePicker();
      if (e.key === 'Enter') {
        const first = this.pickList.querySelector('.wb-pick-item');
        if (first) first.click();
      }
    });
    this.pickList.addEventListener('click', (e) => {
      const item = e.target.closest('.wb-pick-item');
      if (!item) return;
      this._choose(item.dataset.mode, item.dataset.value);
    });
  }

  _openPicker(line) {
    this._pickSubId = line.id;
    this.pickTitle.textContent = `Add "${line.text.trim()}" to which task?`;
    this.pickFilter.value = '';
    this._renderPicker();
    this.pickBackdrop.classList.add('open');
    setTimeout(() => this.pickFilter.focus(), 30);
  }

  _closePicker() {
    this.pickBackdrop.classList.remove('open');
    this._pickSubId = null;
  }

  _renderPicker() {
    const sub = this._find(this._pickSubId);
    if (!sub) return;
    const q = norm(this.pickFilter.value);
    const parent = this._parentTask(sub.id);
    const parentName = parent?.text.trim();
    const parentStore = parentName ? this._findStoreTask(parentName) : null;

    const tasks = this.store.getSorted().filter((t) => this._isOngoing(t) || t.persistent || t.subtasks.length === 0);
    const match = (s) => !q || norm(s).includes(q);
    const item = (mode, value, label, sub = '', color = '') => `
      <button class="wb-pick-item" data-mode="${mode}" data-value="${escapeHtml(value)}">
        <span class="wb-pick-dot" style="${color ? `background:${color}` : ''}"></span>
        <span class="wb-pick-label">${label}</span>
        ${sub ? `<span class="wb-pick-sub">${sub}</span>` : ''}
      </button>`;

    let html = '';

    // the whiteboard task this subtask sits under
    if (parentName && match(parentName)) {
      html += `<div class="wb-pick-heading">From your whiteboard</div>`;
      if (parentStore && (this._isOngoing(parentStore) || parentStore.persistent || parentStore.subtasks.length === 0)) {
        html += item('existing', parentStore.id, escapeHtml(parentStore.name), 'already a task', parentStore.color);
      } else {
        html += item('new', parentName, `Create “${escapeHtml(parentName)}”`, 'new task');
      }
    }

    const rest = tasks.filter((t) => match(t.name) && t.id !== parentStore?.id);
    if (rest.length) {
      html += `<div class="wb-pick-heading">Your tasks</div>`;
      html += rest.map((t) => item('existing', t.id, escapeHtml(t.name), t.persistent ? 'always' : '', t.color)).join('');
    }

    // create a brand-new task from the filter text
    const typed = this.pickFilter.value.trim();
    if (typed && !this._findStoreTask(typed) && norm(typed) !== norm(parentName)) {
      html += `<div class="wb-pick-heading">New</div>`;
      html += item('new', typed, `Create “${escapeHtml(typed)}”`, 'new task');
    }

    if (!html) html = `<div class="wb-pick-empty">No matching tasks. Type a name to create one.</div>`;
    this.pickList.innerHTML = html;
  }

  _choose(mode, value) {
    const sub = this._find(this._pickSubId);
    this._closePicker();
    if (!sub) return;
    const subData = { name: sub.text.trim(), estHours: sub.hours || '' };
    const parent = this._parentTask(sub.id);

    if (mode === 'existing') {
      this.taskModal.openEdit(value, { extraSubtasks: [subData] });
    } else {
      // a "new" name may still match a finished/empty task — TaskModal merges in that case
      this.taskModal.openNew({ name: value, subtasks: [subData] });
    }

    this.taskModal.setAfterSaveOnce((savedId) => {
      this._markSubtasksAdded(savedId, [sub]);
      const saved = this.store.find(savedId);
      // if we just created the whiteboard parent task, mark it added too
      if (parent && saved && norm(parent.text) === norm(saved.name)) parent.added = true;
      this._afterPromote();
    });
  }
}
