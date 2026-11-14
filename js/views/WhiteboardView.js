import { escapeHtml } from '../utils.js';

// Whiteboard: a quick-capture list of Categories / Tasks / Subtasks.
// Nothing here touches the real task list until you click "Add →" on a line.
//
// Line shape (stored in TaskStore.whiteboard):
//   { id, kind: 'category' | 'task' | 'subtask', text, added: bool,
//     parentId?        – subtasks only: id of the task line it belongs to, or null = independent
//     hours?, due?     – subtasks only
//     linkedTaskId?, linkedSubtaskId? – set once added; ties the line to the real task/subtask
//                        so renaming it in the modal or the grid doesn't lose the link }
//
// Parented subtasks always sit directly under their task (contiguous); _normalize() enforces it.

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

  // the task line a subtask belongs to (null = independent)
  _parentTask(subId) {
    const l = this._find(subId);
    return l && l.kind === 'subtask' && l.parentId ? this._find(l.parentId) || null : null;
  }

  // subtask lines that belong to a task
  _children(taskId) {
    return this.lines.filter((l) => l.kind === 'subtask' && l.parentId === taskId);
  }

  // the task whose group ends right above line index `idx` (for "indent under the task above")
  _groupAbove(idx) {
    const prev = this.lines[idx - 1];
    if (!prev) return null;
    if (prev.kind === 'task') return prev;
    if (prev.kind === 'subtask' && prev.parentId) return this._find(prev.parentId) || null;
    return null;
  }

  // Keep the structure valid: a parented subtask must follow its task (or a sibling).
  // Anything that breaks that becomes independent. Returns true if something changed.
  _normalize() {
    let changed = false;
    let group = null;  // task whose children may appear next
    for (const l of this.lines) {
      if (l.kind !== 'subtask') {
        if ('parentId' in l) { delete l.parentId; changed = true; }
        group = l.kind === 'task' ? l : null;
        continue;
      }
      // older whiteboards had no parentId → derive it from position once
      if (!('parentId' in l)) { l.parentId = group ? group.id : null; changed = true; }
      if (l.parentId && (!group || l.parentId !== group.id)) { l.parentId = null; changed = true; }
      if (!l.parentId) group = null;  // an independent subtask closes the group above
    }
    return changed;
  }

  // turn a line into a subtask: belongs to the task group above if there is one
  _makeSubtask(l) {
    const idx = this._index(l.id);
    const wasTask = l.kind === 'task';
    l.kind = 'subtask';
    const g = this._groupAbove(idx);
    l.parentId = g && g.id !== l.id ? g.id : null;
    // a task's own children can't follow it into subtask-land → they become independent
    if (wasTask) this._children(l.id).forEach((c) => { c.parentId = null; });
  }

  // ---------- rendering ----------
  render() {
    if (!this.isActive) return;
    if (this.lines.length === 0) {
      this.lines.push({ id: newId(), kind: 'task', text: '', added: false });
    }

    if (this._normalize()) this._save();

    const isHidden = (l) => this.hideAdded && l.added && l.kind !== 'category';
    // keep an added task visible while it still has visible subtasks,
    // otherwise they'd look like they belong to the task above
    const keepTask = new Set(
      this.lines.filter((l) => l.kind === 'subtask' && l.parentId && !isHidden(l)).map((l) => l.parentId)
    );
    const visible = this.lines.filter((l) => !isHidden(l) || keepTask.has(l.id));

    // per visible line: tree classes
    const treeCls = new Map();
    visible.forEach((l, i) => {
      const next = visible[i + 1];
      if (l.kind === 'task') {
        if (next && next.kind === 'subtask' && next.parentId === l.id) treeCls.set(l.id, ' has-children');
      } else if (l.kind === 'subtask') {
        if (!l.parentId) { treeCls.set(l.id, ' is-independent'); return; }
        const last = !next || next.kind !== 'subtask' || next.parentId !== l.parentId;
        treeCls.set(l.id, ' has-parent' + (last ? ' is-last-child' : ''));
      }
    });

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
        ? `<span class="wb-handle" title="${l.kind === 'task'
            ? 'Drag to move (brings its subtasks along)'
            : 'Drag to move. Drop slightly right under a task to put it in that task, or to the left to keep it on its own'}" aria-hidden="true">⋮⋮</span>`
        : '';
      const hours = l.kind === 'subtask'
        ? `<input class="wb-hours" type="number" min="0" step="0.5" inputmode="decimal"
             value="${escapeHtml(l.hours ?? '')}" placeholder="h" title="Est. hours (optional)" aria-label="Estimated hours">
           ${this._dueBox(l)}`
        : '';
      return `
        <div class="wb-line wb-${l.kind}${l.added ? ' is-added' : ''}${treeCls.get(l.id) || ''}" data-id="${l.id}">
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

  // small due-date chip: calendar glyph when empty, "Nov 14" when set.
  // A transparent native date input sits on top so tapping opens the OS picker.
  _dueBox(l) {
    const due = l.due || '';
    let label = '📅';
    let cls = '';
    if (due) {
      const d = new Date(due + 'T00:00:00');
      label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      cls = d < today ? ' is-overdue' : d.getTime() === today.getTime() ? ' is-today' : '';
    }
    return `
      <span class="wb-due${due ? ' has-date' : ''}${cls}" title="${due ? 'Due ' + label : 'Due date (optional)'}">
        <span class="wb-due-label">${escapeHtml(label)}</span>
        <input class="wb-due-input" type="date" value="${escapeHtml(due)}" aria-label="Due date" tabindex="-1">
        ${due ? '<button class="wb-due-clear" data-act="clear-due" title="Clear due date" tabindex="-1">×</button>' : ''}
      </span>`;
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
          const line = { id: newId(), kind: 'task', text: '', added: false };
          this.lines.push(line);
          if (btn.dataset.kind === 'subtask') this._makeSubtask(line);
          else line.kind = btn.dataset.kind;
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
    if (kind === 'subtask') this._makeSubtask(l);
    else l.kind = kind;
    if (kind === 'category') l.added = false;
    this._normalize();
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
      if (e.target.classList.contains('wb-due-input')) return; // handled on 'change'
      if (!e.target.classList.contains('wb-input')) return;
      const row = lineOf(e.target);
      const l = this._find(row.dataset.id);
      if (!l) return;

      // markdown-style shortcuts at the start of a line
      const v = e.target.value;
      const shortcut = /^#\s/.test(v) ? 'category' : /^[-*]\s/.test(v) ? 'subtask' : null;
      if (shortcut) {
        l.text = v.slice(2);
        if (shortcut === 'subtask') { if (l.kind !== 'subtask') this._makeSubtask(l); }
        else { l.kind = shortcut; l.added = false; }
        this._normalize();
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
          this._indent(id, e.shiftKey ? -1 : 1);
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

    // due date picked
    this.listEl.addEventListener('change', (e) => {
      if (!e.target.classList.contains('wb-due-input')) return;
      const l = this._find(lineOf(e.target).dataset.id);
      if (!l) return;
      l.due = e.target.value || '';
      this._save();
      this.render();
    });

    // desktop browsers only open the picker from their tiny icon → open it on any click
    this.listEl.addEventListener('click', (e) => {
      const input = e.target.classList.contains('wb-due-input') ? e.target : null;
      if (!input) return;
      try { input.showPicker?.(); } catch { /* not allowed / unsupported → native behaviour */ }
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
      else if (act === 'unadd') { this._unlink(this._find(id)); this._save(); this.render(); }
      else if (act === 'del') this._deleteLine(id);
      else if (act === 'clear-due') { const l = this._find(id); l.due = ''; this._save(); this.render(); }
    });
  }

  // Tab (+1) / Shift+Tab (-1)
  // levels: category → task → independent subtask → subtask inside the task above
  _indent(id, dir) {
    const l = this._find(id);
    if (!l) return;
    const input = this.listEl.querySelector(`.wb-line[data-id="${id}"] .wb-input`);
    const caret = input ? input.selectionStart : 'end';
    const idx = this._index(id);

    if (dir > 0) {
      if (l.kind === 'category') { l.kind = 'task'; }
      else if (l.kind === 'task') { this._makeSubtask(l); }
      else if (l.kind === 'subtask' && !l.parentId) {
        const g = this._groupAbove(idx);
        if (!g) return;           // nothing above to belong to
        l.parentId = g.id;
      } else return;
    } else {
      if (l.kind === 'subtask' && l.parentId) {
        // step out of the task; if siblings follow, move below them so the group stays together
        const parentId = l.parentId;
        l.parentId = null;
        const sibs = this.lines.filter((x) => x.kind === 'subtask' && x.parentId === parentId);
        const lastSib = sibs[sibs.length - 1];
        if (lastSib && this._index(lastSib.id) > idx) {
          this.lines.splice(idx, 1);
          this.lines.splice(this._index(lastSib.id) + 1, 0, l);
        }
      } else if (l.kind === 'subtask') { l.kind = 'task'; }
      else if (l.kind === 'task') { l.kind = 'category'; l.added = false; }
      else return;
    }
    this._normalize();
    this._save();
    this.render();
    this._focus(id, caret);
  }

  _splitLine(id, selStart, selEnd) {
    const l = this._find(id);
    const idx = this._index(id);
    const before = l.text.slice(0, selStart);
    const after = l.text.slice(selEnd);
    const nextKind = l.kind === 'category' ? 'task' : l.kind;
    // new subtask lines stay in the same task (or stay independent)
    const inherit = (line) => { if (line.kind === 'subtask') line.parentId = l.parentId || null; return line; };

    // caret at very start of a non-empty line → insert blank line above
    if (selStart === 0 && l.text) {
      const above = inherit({ id: newId(), kind: l.kind, text: '', added: false });
      this.lines.splice(idx, 0, above);
      this._save();
      this.render();
      this._focus(id, 'start');
      return;
    }

    l.text = before;
    const line = inherit({ id: newId(), kind: nextKind, text: after, added: false });
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
  // Subtask: dropped right below a task (or its subtasks) it joins that task if the
  //   pointer is to the right, or stays independent if it's to the left.
  //   Dropped between two subtasks of a task, it always joins that task.
  // Task: moves together with its subtasks, and never lands inside another task's group.
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
      indicator.className = 'wb-drop-indicator';

      this._drag = {
        line, ids: new Set(ids), dragRows, indicator,
        beforeId: undefined, parentId: null, pointerId: e.pointerId,
      };
      handle.setPointerCapture?.(e.pointerId);
      document.body.classList.add('wb-is-dragging');
      this._dragMove(e.clientX, e.clientY);
    });

    this.listEl.addEventListener('pointermove', (e) => {
      if (!this._drag || e.pointerId !== this._drag.pointerId) return;
      e.preventDefault();
      this._dragMove(e.clientX, e.clientY);
      // auto-scroll near the top/bottom of the window
      const edge = 60;
      if (e.clientY < edge) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
    });

    const end = (e, cancelled) => {
      if (!this._drag || e.pointerId !== this._drag.pointerId) return;
      const { ids, indicator, beforeId, line, parentId } = this._drag;
      indicator.remove();
      this.listEl.querySelectorAll('.wb-drop-parent').forEach((r) => r.classList.remove('wb-drop-parent'));
      document.body.classList.remove('wb-is-dragging');
      this._drag = null;
      if (!cancelled && beforeId !== undefined) {
        if (line.kind === 'subtask') line.parentId = parentId;
        this._moveBlock([...ids], beforeId);
      } else this.render();
    };
    this.listEl.addEventListener('pointerup', (e) => end(e, false));
    this.listEl.addEventListener('pointercancel', (e) => end(e, true));
  }

  _dragMove(x, y) {
    const d = this._drag;
    const rows = [...this.listEl.querySelectorAll('.wb-line')].filter((r) => !d.ids.has(r.dataset.id));
    const isChildRow = (r) => r && r.classList.contains('has-parent');
    // a task block may not land between a task and its subtasks
    const candidates = d.line.kind === 'task' ? rows.filter((r) => !isChildRow(r)) : rows;

    const target = candidates.find((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    d.beforeId = target ? target.dataset.id : null;

    // what's directly above the drop point (ignoring the rows being dragged)
    const ti = target ? rows.indexOf(target) : rows.length;
    const prevRow = rows[ti - 1] || null;

    d.parentId = null;
    if (d.line.kind === 'subtask') {
      const lineOf = (r) => r && this._find(r.dataset.id);
      const next = lineOf(target);
      const prev = lineOf(prevRow);
      const groupOfPrev = prev?.kind === 'task' ? prev.id
        : prev?.kind === 'subtask' && prev.parentId ? prev.parentId : null;

      if (next?.kind === 'subtask' && next.parentId) {
        d.parentId = next.parentId;                      // between siblings → must join
      } else if (groupOfPrev) {
        // just below a task group → pointer to the right (indented, where a subtask's
        // handle sits) = join; at the left edge (where a task's handle sits) = independent
        const rowLeft = this.listEl.getBoundingClientRect().left;
        d.parentId = x - rowLeft > 16 ? groupOfPrev : null;
      }
    }

    if (target) this.listEl.insertBefore(d.indicator, target);
    else this.listEl.appendChild(d.indicator);
    d.indicator.classList.toggle('is-subtask', !!d.parentId);

    // highlight the task the subtask would join
    this.listEl.querySelectorAll('.wb-drop-parent').forEach((r) => r.classList.remove('wb-drop-parent'));
    if (d.parentId) {
      this.listEl.querySelector(`.wb-line[data-id="${d.parentId}"]`)?.classList.add('wb-drop-parent');
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

  // the real task a whiteboard task line refers to: its saved link first, name as fallback
  _storeTaskFor(line) {
    if (!line) return null;
    return (line.linkedTaskId && this.store.find(line.linkedTaskId)) || this._findStoreTask(line.text);
  }

  _subData(c) {
    return { name: c.text.trim(), estHours: c.hours || '', due: c.due || '', wbId: c.id };
  }

  // Task → open Add Task modal prefilled with its (not-yet-added) subtasks
  _addTask(line) {
    const name = line.text.trim();
    const children = this._children(line.id).filter((c) => !c.added && c.text.trim());
    const subs = children.map((c) => this._subData(c));
    const existing = this._storeTaskFor(line);

    if (existing && (this._isOngoing(existing) || existing.persistent)) {
      // already a live task → open it with the new subtasks appended
      this.taskModal.openEdit(existing.id, { extraSubtasks: subs });
    } else {
      this.taskModal.openNew({ name, subtasks: subs });
    }

    this.taskModal.setAfterSaveOnce((savedId, links) => {
      this._linkTask(line, savedId);
      this._linkSubtasks(savedId, links);
      this._afterPromote();
    });
  }

  _linkTask(line, taskId) {
    line.added = true;
    line.linkedTaskId = taskId;
  }

  // mark the whiteboard lines that were actually saved (by line id, so renaming
  // them in the modal doesn't matter; rows deleted in the modal stay un-added)
  _linkSubtasks(taskId, links = []) {
    links.forEach(({ wbId, subtaskId }) => {
      const l = this._find(wbId);
      if (!l) return;
      l.added = true;
      l.linkedTaskId = taskId;
      l.linkedSubtaskId = subtaskId;
    });
  }

  _unlink(l) {
    l.added = false;
    delete l.linkedTaskId;
    delete l.linkedSubtaskId;
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
    const parentStore = parent ? this._storeTaskFor(parent) : null;

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
        html += item('parent', parentName, `Create “${escapeHtml(parentName)}”`, 'new task');
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
    const subData = this._subData(sub);
    const parent = this._parentTask(sub.id);

    if (mode === 'existing') {
      this.taskModal.openEdit(value, { extraSubtasks: [subData] });
    } else {
      // a "new" name may still match a finished/empty task — TaskModal merges in that case
      this.taskModal.openNew({ name: value, subtasks: [subData] });
    }

    this.taskModal.setAfterSaveOnce((savedId, links) => {
      this._linkSubtasks(savedId, links);
      // created (or picked) the whiteboard parent task → that line is now added too
      if (parent && (mode === 'parent' || this._storeTaskFor(parent)?.id === savedId)) {
        this._linkTask(parent, savedId);
      }
      this._afterPromote();
    });
  }
}
