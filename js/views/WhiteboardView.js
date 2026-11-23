import { escapeHtml } from '../utils.js';
import { startOfDay, parseLocalDate, fmtShortDate } from '../core/dates.js';
import { Modal } from '../core/Modal.js';
import { DragController } from '../core/DragController.js';
import { View } from '../core/View.js';

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

const PLACEHOLDERS = {
  category: 'Category',
  task: 'Task…   (type # for a category, - for a subtask)',
  subtask: 'Subtask',
};

const JOIN_THRESHOLD_PX = 16;   // drop a subtask further right than this → it joins the task above
const AUTOSCROLL_EDGE_PX = 60;
const AUTOSCROLL_STEP_PX = 12;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = (s) => (s || '').trim().toLowerCase();
const newLine = (kind = 'task', text = '') => ({ id: newId(), kind, text, added: false });

// One pasted line → a whiteboard line: "# " = category, "- " / indented = subtask
function parsePastedLine(raw, currentKind) {
  let kind = 'task';
  let text;
  const indented = /^(\s{2,}|\t)/.test(raw);
  if (/^\s*#+\s*/.test(raw)) {
    kind = 'category';
    text = raw.replace(/^\s*#+\s*/, '');
  } else if (indented || /^\s*[-*•]\s+/.test(raw)) {
    kind = indented || currentKind !== 'category' ? 'subtask' : 'task';
    text = raw.replace(/^\s*[-*•]?\s*/, '');
  } else {
    text = raw.replace(/^\s*\[\s?[xX]?\]\s*/, '');   // strip "[ ]" / "[x]" checkboxes
  }
  return newLine(kind, text.trim());
}

const pickHeadingHtml = (text) => `<div class="wb-pick-heading">${text}</div>`;

const pickItemHtml = (mode, value, label, sub = '', color = '') => `
      <button class="wb-pick-item" data-mode="${mode}" data-value="${escapeHtml(value)}">
        <span class="wb-pick-dot" style="${color ? `background:${color}` : ''}"></span>
        <span class="wb-pick-label">${label}</span>
        ${sub ? `<span class="wb-pick-sub">${sub}</span>` : ''}
      </button>`;

export class WhiteboardView extends View {
  constructor(store, taskModal) {
    super();
    this.store = store;
    this.taskModal = taskModal;
    this.hideAdded = false;
    this.focusedId = null;

    this.listEl = document.getElementById('wbList');
    this.styleBtns = [...document.querySelectorAll('.wb-style-btn')];
    this.hideAddedEl = document.getElementById('wbHideAdded');
    this.clearAddedBtn = document.getElementById('wbClearAdded');

    this.picker = new Modal('wbPickBackdrop', {
      closeOnBackdrop: true,
      onClose: () => { this._pickSubId = null; },
    });
    this.pickTitle = document.getElementById('wbPickTitle');
    this.pickFilter = document.getElementById('wbPickFilter');
    this.pickList = document.getElementById('wbPickList');
    this._pickSubId = null;

    this._bindToolbar();
    this._bindList();
    this.dragger = this._createDragger();
    this._bindPicker();
  }

  // ---------- lifecycle (activate/deactivate from View) ----------
  // Store changed (typing, Drive load, …) — don't redraw under the user's caret
  refresh() {
    if (this.dragger.isDragging) return;
    if (this.listEl.contains(document.activeElement)) return;
    super.refresh();
  }

  // ---------- line model ----------
  get lines() {
    let lines = this.store.getWhiteboard();
    if (!Array.isArray(lines)) { lines = []; this.store.whiteboard = lines; }
    return lines;
  }

  _find(id) { return this.lines.find((l) => l.id === id); }
  _index(id) { return this.lines.findIndex((l) => l.id === id); }
  _save(opts) { this.store.saveWhiteboard(opts); }

  _addedCount() { return this.lines.filter((l) => l.added).length; }

  // the task line a subtask belongs to (null = independent)
  _parentTask(subId) {
    const l = this._find(subId);
    return l && l.kind === 'subtask' && l.parentId ? this._find(l.parentId) || null : null;
  }

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
    let group = null;   // task whose children may appear next
    for (const l of this.lines) {
      if (l.kind !== 'subtask') {
        if ('parentId' in l) { delete l.parentId; changed = true; }
        group = l.kind === 'task' ? l : null;
        continue;
      }
      // older whiteboards had no parentId → derive it from position once
      if (!('parentId' in l)) { l.parentId = group ? group.id : null; changed = true; }
      if (l.parentId && (!group || l.parentId !== group.id)) { l.parentId = null; changed = true; }
      if (!l.parentId) group = null;   // an independent subtask closes the group above
    }
    return changed;
  }

  // turn a line into a subtask: belongs to the task group above if there is one
  _makeSubtask(l) {
    const wasTask = l.kind === 'task';
    const group = this._groupAbove(this._index(l.id));
    l.kind = 'subtask';
    l.parentId = group && group.id !== l.id ? group.id : null;
    // a task's own children can't follow it into subtask-land → they become independent
    if (wasTask) this._children(l.id).forEach((c) => { c.parentId = null; });
  }

  // change a line's kind in place (caller saves)
  _convert(l, kind) {
    if (kind === 'subtask') this._makeSubtask(l);
    else l.kind = kind;
    if (kind === 'category') l.added = false;
  }

  // ---------- toolbar ----------
  _bindToolbar() {
    this.styleBtns.forEach((btn) => {
      // mousedown + preventDefault keeps the caret in the current line
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => this._applyStyle(btn.dataset.kind));
    });

    this.hideAddedEl.addEventListener('change', () => {
      this.hideAdded = this.hideAddedEl.checked;
      this.render();
    });

    this.clearAddedBtn.addEventListener('click', () => this._clearAdded());
  }

  _applyStyle(kind) {
    const id = this.focusedId;
    if (id && this._find(id)) {
      this._setKind(id, kind);
      return;
    }
    // nothing focused → start a new line of that style at the bottom
    const line = newLine();
    this.lines.push(line);
    this._convert(line, kind);
    this._commit(line.id);
  }

  _clearAdded() {
    const n = this._addedCount();
    if (!n || !confirm(`Remove ${n} added line${n === 1 ? '' : 's'} from the whiteboard?\n(Your real tasks are not affected.)`)) return;
    this.store.setWhiteboard(this.lines.filter((l) => !l.added));
    this.render();
  }

  // ---------- list events ----------
  _bindList() {
    this.listEl.addEventListener('focusin', (e) => this._onFocusIn(e));
    this.listEl.addEventListener('focusout', () => this._onFocusOut());
    this.listEl.addEventListener('input', (e) => this._onInput(e));
    this.listEl.addEventListener('keydown', (e) => this._onKeyDown(e));
    this.listEl.addEventListener('change', (e) => this._onChange(e));
    this.listEl.addEventListener('paste', (e) => this._onPaste(e));
    this.listEl.addEventListener('click', (e) => this._onClick(e));
  }

  _idOf(el) { return el.closest('.wb-line').dataset.id; }

  _onFocusIn(e) {
    const row = e.target.closest('.wb-line');
    if (!row || !e.target.classList.contains('wb-input')) return;
    this.focusedId = row.dataset.id;
    this._syncStyleBtns();
  }

  _onFocusOut() {
    // wait for focus to land so moving between lines doesn't flicker the toolbar
    setTimeout(() => {
      if (this.listEl.contains(document.activeElement)) return;
      this.focusedId = null;
      this._syncStyleBtns();
    }, 0);
  }

  _onInput(e) {
    const { classList } = e.target;
    if (classList.contains('wb-hours')) this._onHoursInput(e.target);
    else if (classList.contains('wb-input')) this._onTextInput(e.target);
    // the due-date input is handled on 'change'
  }

  _onHoursInput(input) {
    const l = this._find(this._idOf(input));
    if (!l) return;
    l.hours = input.value;
    this._save({ coalesce: 'hours:' + l.id });
  }

  _onTextInput(input) {
    const row = input.closest('.wb-line');
    const l = this._find(row.dataset.id);
    if (!l) return;
    const value = input.value;
    if (this._applyShortcut(l, value)) return;

    l.text = value;
    const addBtn = row.querySelector('.wb-add');
    if (addBtn) addBtn.disabled = !value.trim();
    this._save({ coalesce: 'text:' + l.id });   // typing in one line = one undo step
  }

  // markdown-style shortcuts at the start of a line: "# " → category, "- " / "* " → subtask
  _applyShortcut(l, value) {
    const kind = /^#\s/.test(value) ? 'category' : /^[-*]\s/.test(value) ? 'subtask' : null;
    if (!kind) return false;
    l.text = value.slice(2);
    // re-converting an existing subtask would re-pick its parent, so leave it alone
    if (kind === 'category' || l.kind !== kind) this._convert(l, kind);
    this._normalize();
    this._commit(l.id, 'start');
    return true;
  }

  _onKeyDown(e) {
    const input = e.target;
    if (!input.classList.contains('wb-input') || e.isComposing) return;
    const l = this._find(this._idOf(input));
    if (!l) return;
    const withModifier = e.metaKey || e.ctrlKey;

    // ⌘/Ctrl + 1/2/3 → Category / Task / Subtask
    if (withModifier && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      this._setKind(l.id, KINDS[+e.key - 1]);
      return;
    }

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        this._onEnter(l, input, withModifier);
        break;
      case 'Tab':
        e.preventDefault();
        this._indent(l.id, e.shiftKey ? -1 : 1);
        break;
      case 'Backspace':
        this._onBackspace(e, l, input);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        this._moveFocusVertically(e, input);
        break;
    }
  }

  _onEnter(l, input, withModifier) {
    if (withModifier && l.kind !== 'category' && l.text.trim()) {
      this._startAdd(l.id);   // ⌘Enter → Add →
      return;
    }
    // empty subtask + Enter → step back out to a task (like outdenting a bullet)
    if (!l.text && l.kind === 'subtask') {
      this._setKind(l.id, 'task');
      return;
    }
    this._splitLine(l.id, input.selectionStart, input.selectionEnd);
  }

  _onBackspace(e, l, input) {
    if (input.selectionStart !== 0 || input.selectionEnd !== 0) return;
    e.preventDefault();
    // at the start of a styled line → first drop it to a plain task
    if (l.text && l.kind !== 'task') {
      this._setKind(l.id, 'task');
      this._focus(l.id, 'start');
      return;
    }
    this._mergeWithPrevious(l.id);
  }

  _moveFocusVertically(e, input) {
    const inputs = [...this.listEl.querySelectorAll('.wb-input')];
    const target = inputs[inputs.indexOf(input) + (e.key === 'ArrowUp' ? -1 : 1)];
    if (!target) return;
    e.preventDefault();
    target.focus();
    const pos = Math.min(input.selectionStart, target.value.length);
    target.setSelectionRange(pos, pos);
  }

  // due date picked
  _onChange(e) {
    if (!e.target.classList.contains('wb-due-input')) return;
    const l = this._find(this._idOf(e.target));
    if (!l) return;
    l.due = e.target.value || '';
    this._commit();
  }

  _onPaste(e) {
    if (!e.target.classList.contains('wb-input')) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text.includes('\n')) return;
    e.preventDefault();
    this._pasteLines(this._idOf(e.target), text);
  }

  _onClick(e) {
    if (e.target.classList.contains('wb-due-input')) {
      this._showDatePicker(e.target);
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (btn) this._runAction(btn.dataset.act, this._idOf(btn));
  }

  // desktop browsers only open the picker from their tiny icon → open it on any click
  _showDatePicker(input) {
    try { input.showPicker?.(); } catch { /* not allowed / unsupported → native behaviour */ }
  }

  _runAction(act, id) {
    switch (act) {
      case 'add':
        this._startAdd(id);
        break;
      case 'unadd':
        this._unlink(this._find(id));
        this._commit();
        break;
      case 'del':
        this._deleteLine(id);
        break;
      case 'clear-due':
        this._find(id).due = '';
        this._commit();
        break;
    }
  }

  // ---------- editing ----------
  // save, redraw and (optionally) put the caret back
  _commit(focusId, caret) {
    this._save();
    this.render();
    if (focusId) this._focus(focusId, caret);
  }

  _setKind(id, kind) {
    const l = this._find(id);
    if (!l || l.kind === kind) return;
    const caret = this._caret(id);
    this._convert(l, kind);
    this._normalize();
    this._commit(id, caret);
  }

  // Tab (+1) / Shift+Tab (-1) step through the levels:
  // category → task → independent subtask → subtask inside the task above
  _indent(id, dir) {
    const l = this._find(id);
    if (!l) return;
    const caret = this._caret(id);
    const changed = dir > 0 ? this._indentLine(l) : this._outdentLine(l);
    if (!changed) return;
    this._normalize();
    this._commit(id, caret);
  }

  _indentLine(l) {
    if (l.kind === 'category') l.kind = 'task';
    else if (l.kind === 'task') this._makeSubtask(l);
    else if (l.kind === 'subtask' && !l.parentId) {
      const group = this._groupAbove(this._index(l.id));
      if (!group) return false;   // nothing above to belong to
      l.parentId = group.id;
    } else return false;
    return true;
  }

  _outdentLine(l) {
    if (l.kind === 'subtask' && l.parentId) this._leaveGroup(l);
    else if (l.kind === 'subtask') l.kind = 'task';
    else if (l.kind === 'task') { l.kind = 'category'; l.added = false; }
    else return false;
    return true;
  }

  // step out of the task; if siblings follow, move below them so the group stays together
  _leaveGroup(l) {
    const idx = this._index(l.id);
    const parentId = l.parentId;
    l.parentId = null;
    const siblings = this._children(parentId);
    const lastSibling = siblings[siblings.length - 1];
    if (lastSibling && this._index(lastSibling.id) > idx) {
      this.lines.splice(idx, 1);
      this.lines.splice(this._index(lastSibling.id) + 1, 0, l);
    }
  }

  _splitLine(id, selStart, selEnd) {
    const l = this._find(id);
    const idx = this._index(id);
    // new subtask lines stay in the same task (or stay independent)
    const sibling = (kind, text) => {
      const line = newLine(kind, text);
      if (kind === 'subtask') line.parentId = l.parentId || null;
      return line;
    };

    // caret at the very start of a non-empty line → insert a blank line above
    if (selStart === 0 && l.text) {
      this.lines.splice(idx, 0, sibling(l.kind, ''));
      this._commit(id, 'start');
      return;
    }

    const line = sibling(l.kind === 'category' ? 'task' : l.kind, l.text.slice(selEnd));
    l.text = l.text.slice(0, selStart);
    this.lines.splice(idx + 1, 0, line);
    this._commit(line.id, 'start');
  }

  _mergeWithPrevious(id) {
    const rows = [...this.listEl.querySelectorAll('.wb-line')];
    const pos = rows.findIndex((r) => r.dataset.id === id);
    if (pos <= 0) return;
    const prevId = rows[pos - 1].dataset.id;
    const prev = this._find(prevId);
    const caret = prev.text.length;
    prev.text += this._find(id).text;
    this.lines.splice(this._index(id), 1);
    this._commit(prevId, caret);
  }

  _deleteLine(id) {
    if (!this._find(id)) return;
    this.lines.splice(this._index(id), 1);
    this._commit();
  }

  // multi-line paste → one line each, after the current line (or replacing it if empty)
  _pasteLines(id, text) {
    const idx = this._index(id);
    const cur = this._find(id);
    const parsed = text.split(/\r?\n/).filter((s) => s.trim()).map((raw) => parsePastedLine(raw, cur.kind));
    if (!parsed.length) return;

    if (cur.text) this.lines.splice(idx + 1, 0, ...parsed);
    else this.lines.splice(idx, 1, ...parsed);
    this._commit(parsed[parsed.length - 1].id);
  }

  // ---------- rendering ----------
  render() {
    if (!this.isActive) return;
    if (this.lines.length === 0) this.lines.push(newLine());

    // structural tidy-up is part of whatever action caused it, not its own undo step
    if (this._normalize()) this._save({ history: false });

    const visible = this._visibleLines();
    const treeClasses = this._treeClasses(visible);
    this.listEl.innerHTML = visible.map((l) => this._lineHtml(l, treeClasses.get(l.id) || '')).join('');

    const added = this._addedCount();
    this.clearAddedBtn.disabled = added === 0;
    this.clearAddedBtn.textContent = added ? `Clear added (${added})` : 'Clear added';
    this._syncStyleBtns();
  }

  _visibleLines() {
    const isHidden = (l) => this.hideAdded && l.added && l.kind !== 'category';
    // keep an added task visible while it still has visible subtasks,
    // otherwise they'd look like they belong to the task above
    const keepTask = new Set(
      this.lines.filter((l) => l.kind === 'subtask' && l.parentId && !isHidden(l)).map((l) => l.parentId)
    );
    return this.lines.filter((l) => !isHidden(l) || keepTask.has(l.id));
  }

  // per visible line: the classes that draw the task → subtask tree
  _treeClasses(visible) {
    const classes = new Map();
    visible.forEach((l, i) => {
      const next = visible[i + 1];
      if (l.kind === 'task') {
        if (next && next.kind === 'subtask' && next.parentId === l.id) classes.set(l.id, ' has-children');
      } else if (l.kind === 'subtask') {
        if (!l.parentId) { classes.set(l.id, ' is-independent'); return; }
        const isLast = !next || next.kind !== 'subtask' || next.parentId !== l.parentId;
        classes.set(l.id, ' has-parent' + (isLast ? ' is-last-child' : ''));
      }
    });
    return classes;
  }

  _lineHtml(l, treeCls) {
    const canAdd = l.kind !== 'category';
    const action = !canAdd ? '' : l.added
      ? `<button class="wb-added" data-act="unadd" title="Added to your tasks — click to mark as not added">✓ Added</button>`
      : `<button class="wb-add" data-act="add" title="Add this to your tasks"${l.text.trim() ? '' : ' disabled'}>Add →</button>`;
    const handle = canAdd
      ? `<span class="wb-handle" title="${l.kind === 'task'
          ? 'Drag to move (brings its subtasks along)'
          : 'Drag to move. Drop slightly right under a task to put it in that task, or to the left to keep it on its own'}" aria-hidden="true">⋮⋮</span>`
      : '';
    const subtaskFields = l.kind === 'subtask'
      ? `<input class="wb-hours" type="number" min="0" step="0.5" inputmode="decimal"
             value="${escapeHtml(l.hours ?? '')}" placeholder="h" title="Est. hours (optional)" aria-label="Estimated hours">
           ${this._dueBoxHtml(l)}`
      : '';
    return `
        <div class="wb-line wb-${l.kind}${l.added ? ' is-added' : ''}${treeCls}" data-id="${l.id}">
          ${handle}
          <span class="wb-bullet" aria-hidden="true"></span>
          <input class="wb-input" type="text" value="${escapeHtml(l.text)}"
            placeholder="${PLACEHOLDERS[l.kind]}" aria-label="${l.kind}">
          ${subtaskFields}
          ${action}
          <button class="wb-del" data-act="del" title="Delete line" tabindex="-1">✕</button>
        </div>`;
  }

  // small due-date chip: calendar glyph when empty, "Nov 14" when set.
  // A transparent native date input sits on top so tapping opens the OS picker.
  _dueBoxHtml(l) {
    const due = l.due || '';
    let label = '📅';
    let stateCls = '';
    if (due) {
      const date = parseLocalDate(due);
      const today = startOfDay(new Date());
      label = fmtShortDate(date);
      stateCls = date < today ? ' is-overdue' : date.getTime() === today.getTime() ? ' is-today' : '';
    }
    return `
      <span class="wb-due${due ? ' has-date' : ''}${stateCls}" title="${due ? 'Due ' + label : 'Due date (optional)'}">
        <span class="wb-due-label">${escapeHtml(label)}</span>
        <input class="wb-due-input" type="date" value="${escapeHtml(due)}" aria-label="Due date" tabindex="-1">
        ${due ? '<button class="wb-due-clear" data-act="clear-due" title="Clear due date" tabindex="-1">×</button>' : ''}
      </span>`;
  }

  _rowOf(id) { return this.listEl.querySelector(`.wb-line[data-id="${id}"]`); }
  _inputOf(id) { return this._rowOf(id)?.querySelector('.wb-input') || null; }

  _caret(id) {
    const input = this._inputOf(id);
    return input ? input.selectionStart : 'end';
  }

  _focus(id, caret = 'end') {
    const input = this._inputOf(id);
    if (!input) return;
    input.focus();
    const pos = caret === 'start' ? 0 : caret === 'end' ? input.value.length : caret;
    input.setSelectionRange(pos, pos);
  }

  _syncStyleBtns() {
    const l = this.focusedId && this._find(this.focusedId);
    this.styleBtns.forEach((b) => b.classList.toggle('active', !!l && b.dataset.kind === l.kind));
  }

  // ---------- drag & drop (pointer events → works with mouse and touch) ----------
  // Subtask: dropped right below a task (or its subtasks) it joins that task if the
  //   pointer is to the right, or stays independent if it's to the left.
  //   Dropped between two subtasks of a task, it always joins that task.
  // Task: moves together with its subtasks, and never lands inside another task's group.
  _createDragger() {
    return new DragController(this.listEl, {
      handle: '.wb-handle',
      listenOn: this.listEl,
      capturePointer: true,
      bodyClass: 'wb-is-dragging',
      autoScroll: { el: window, axis: 'y', edge: AUTOSCROLL_EDGE_PX, step: AUTOSCROLL_STEP_PX },
      onStart: (handle) => this._startDrag(handle),
      onMove: (d, x, y) => this._updateDropTarget(d, x, y),
      onEnd: (d, cancelled) => this._endDrag(d, cancelled),
    });
  }

  _startDrag(handle) {
    const line = this._find(this._idOf(handle));
    if (!line) return null;

    const ids = [line.id];
    if (line.kind === 'task') this._children(line.id).forEach((c) => ids.push(c.id));
    ids.map((id) => this._rowOf(id)).filter(Boolean).forEach((r) => r.classList.add('wb-dragging'));
    document.activeElement?.blur?.();

    const indicator = document.createElement('div');
    indicator.className = 'wb-drop-indicator';
    return { line, ids: new Set(ids), indicator, beforeId: undefined, parentId: null };
  }

  _endDrag(d, cancelled) {
    const { ids, indicator, beforeId, line, parentId } = d;
    indicator.remove();
    this._clearDropHighlight();

    if (cancelled || beforeId === undefined) {
      this.render();
      return;
    }
    if (line.kind === 'subtask') line.parentId = parentId;
    this._moveBlock([...ids], beforeId);
  }

  _updateDropTarget(d, x, y) {
    const rows = [...this.listEl.querySelectorAll('.wb-line')].filter((r) => !d.ids.has(r.dataset.id));
    // a task block may not land between a task and its subtasks
    const candidates = d.line.kind === 'task' ? rows.filter((r) => !r.classList.contains('has-parent')) : rows;

    const target = candidates.find((r) => {
      const box = r.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    d.beforeId = target ? target.dataset.id : null;

    // what's directly above the drop point (ignoring the rows being dragged)
    const prevRow = rows[(target ? rows.indexOf(target) : rows.length) - 1] || null;
    d.parentId = d.line.kind === 'subtask' ? this._dropParent(x, target, prevRow) : null;

    if (target) this.listEl.insertBefore(d.indicator, target);
    else this.listEl.appendChild(d.indicator);
    d.indicator.classList.toggle('is-subtask', !!d.parentId);

    // highlight the task the subtask would join
    this._clearDropHighlight();
    if (d.parentId) this._rowOf(d.parentId)?.classList.add('wb-drop-parent');
  }

  // the task a dragged subtask would join at this drop point (null = independent)
  _dropParent(x, nextRow, prevRow) {
    const lineAt = (row) => row && this._find(row.dataset.id);
    const next = lineAt(nextRow);
    const prev = lineAt(prevRow);

    if (next?.kind === 'subtask' && next.parentId) return next.parentId;   // between siblings → must join

    const groupOfPrev = prev?.kind === 'task' ? prev.id
      : prev?.kind === 'subtask' && prev.parentId ? prev.parentId : null;
    if (!groupOfPrev) return null;

    // just below a task group → pointer to the right (indented, where a subtask's
    // handle sits) = join; at the left edge (where a task's handle sits) = independent
    const listLeft = this.listEl.getBoundingClientRect().left;
    return x - listLeft > JOIN_THRESHOLD_PX ? groupOfPrev : null;
  }

  _clearDropHighlight() {
    this.listEl.querySelectorAll('.wb-drop-parent').forEach((r) => r.classList.remove('wb-drop-parent'));
  }

  // move the given line ids (kept in order) to just before `beforeId` (null = end)
  _moveBlock(ids, beforeId) {
    const moving = new Set(ids);
    const block = this.lines.filter((l) => moving.has(l.id));
    const rest = this.lines.filter((l) => !moving.has(l.id));
    let at = beforeId ? rest.findIndex((l) => l.id === beforeId) : rest.length;
    if (at < 0) at = rest.length;
    rest.splice(at, 0, ...block);
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

  // tasks a subtask can still be added to (finished tasks are excluded)
  _isPickable(t) {
    return this._isOngoing(t) || t.persistent || t.subtasks.length === 0;
  }

  // the real task a whiteboard task line refers to: its saved link first, name as fallback
  _storeTaskFor(line) {
    if (!line) return null;
    return (line.linkedTaskId && this.store.find(line.linkedTaskId)) || this._findStoreTask(line.text);
  }

  _subData(line) {
    return { name: line.text.trim(), estHours: line.hours || '', due: line.due || '', wbId: line.id };
  }

  _startAdd(id) {
    const l = this._find(id);
    if (!l || !l.text.trim()) return;
    if (l.kind === 'task') this._addTask(l);
    else if (l.kind === 'subtask') this._openPicker(l);
  }

  // Task → open the Add Task modal prefilled with its (not-yet-added) subtasks
  _addTask(line) {
    const subs = this._children(line.id)
      .filter((c) => !c.added && c.text.trim())
      .map((c) => this._subData(c));
    const existing = this._storeTaskFor(line);

    if (existing && (this._isOngoing(existing) || existing.persistent)) {
      // already a live task → open it with the new subtasks appended
      this.taskModal.openEdit(existing.id, { extraSubtasks: subs });
    } else {
      this.taskModal.openNew({ name: line.text.trim(), subtasks: subs });
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
      this._linkTask(l, taskId);
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
    document.getElementById('wbPickCancel').addEventListener('click', () => this.picker.close());
    this.pickFilter.addEventListener('input', () => this._renderPicker());
    this.pickFilter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.picker.close();
      if (e.key === 'Enter') this.pickList.querySelector('.wb-pick-item')?.click();
    });
    this.pickList.addEventListener('click', (e) => {
      const item = e.target.closest('.wb-pick-item');
      if (item) this._choose(item.dataset.mode, item.dataset.value);
    });
  }

  _openPicker(line) {
    this._pickSubId = line.id;
    this.pickTitle.textContent = `Add "${line.text.trim()}" to which task?`;
    this.pickFilter.value = '';
    this._renderPicker();
    this.picker.show();
    setTimeout(() => this.pickFilter.focus(), 30);
  }

  _renderPicker() {
    const sub = this._find(this._pickSubId);
    if (!sub) return;
    const query = norm(this.pickFilter.value);
    const matches = (s) => !query || norm(s).includes(query);
    const parent = this._parentTask(sub.id);
    const parentName = parent?.text.trim();
    const parentStore = parent ? this._storeTaskFor(parent) : null;
    let html = '';

    // the whiteboard task this subtask sits under
    if (parentName && matches(parentName)) {
      html += pickHeadingHtml('From your whiteboard');
      html += parentStore && this._isPickable(parentStore)
        ? pickItemHtml('existing', parentStore.id, escapeHtml(parentStore.name), 'already a task', parentStore.color)
        : pickItemHtml('parent', parentName, `Create “${escapeHtml(parentName)}”`, 'new task');
    }

    const others = this.store.getSorted()
      .filter((t) => this._isPickable(t) && matches(t.name) && t.id !== parentStore?.id);
    if (others.length) {
      html += pickHeadingHtml('Your tasks');
      html += others.map((t) => pickItemHtml('existing', t.id, escapeHtml(t.name), t.persistent ? 'always' : '', t.color)).join('');
    }

    // create a brand-new task from the filter text
    const typed = this.pickFilter.value.trim();
    if (typed && !this._findStoreTask(typed) && norm(typed) !== norm(parentName)) {
      html += pickHeadingHtml('New');
      html += pickItemHtml('new', typed, `Create “${escapeHtml(typed)}”`, 'new task');
    }

    this.pickList.innerHTML = html || `<div class="wb-pick-empty">No matching tasks. Type a name to create one.</div>`;
  }

  _choose(mode, value) {
    const sub = this._find(this._pickSubId);
    this.picker.close();
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
