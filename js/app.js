/* Sudoku UI: play mode + setup mode. */
(function () {
  'use strict';

  const { PEERS, row, col, box, DIFFICULTY } = window.Sudoku;
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'sudoku.state.v1';

  // ---------- Safe storage ----------
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  // ---------- State ----------
  const emptyGrid = () => new Array(81).fill(0);

  const state = {
    mode: 'play',          // 'play' | 'setup'
    selected: 40,
    notesMode: false,
    paused: false,
    showMistakes: true,
    theme: null,           // null = follow system
    game: null,            // { givens, values, notes, solution, level, mistakes, elapsed, solved, history }
    setup: { values: emptyGrid(), history: [] },
  };

  function makeGame(puzzle, solution, level) {
    return {
      givens: puzzle.map((v) => v !== 0),
      values: puzzle.slice(),
      notes: emptyGrid(),
      solution,
      level,
      mistakes: 0,
      elapsed: 0,
      solved: false,
      history: [],
    };
  }

  function save() {
    store.set(STORAGE_KEY, {
      mode: state.mode,
      selected: state.selected,
      notesMode: state.notesMode,
      showMistakes: state.showMistakes,
      theme: state.theme,
      game: state.game,
      setup: { values: state.setup.values, history: [] },
      difficulty: $('difficulty').value,
    });
  }

  function load() {
    const s = store.get(STORAGE_KEY);
    if (!s || !s.game || !Array.isArray(s.game.values) || s.game.values.length !== 81) return false;
    Object.assign(state, {
      mode: s.mode === 'setup' ? 'setup' : 'play',
      selected: Number.isInteger(s.selected) ? s.selected : 40,
      showMistakes: s.showMistakes !== false,
      notesMode: s.notesMode === true,
      theme: s.theme || null,
      game: { history: [], ...s.game },
    });
    if (s.setup && Array.isArray(s.setup.values)) state.setup.values = s.setup.values;
    if (s.difficulty) $('difficulty').value = s.difficulty;
    return true;
  }

  // ---------- Board construction ----------
  const boardEl = $('board');
  const cells = [];
  const noteSpans = [];

  function buildBoard() {
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement('div');
      cell.setAttribute('role', 'gridcell');
      cell.dataset.index = i;
      const value = document.createElement('span');
      value.className = 'value';
      const notes = document.createElement('div');
      notes.className = 'notes';
      const spans = [];
      for (let d = 1; d <= 9; d++) {
        const s = document.createElement('span');
        notes.appendChild(s);
        spans.push(s);
      }
      cell.append(value, notes);
      boardEl.appendChild(cell);
      cells.push(cell);
      noteSpans.push(spans);
    }
    boardEl.tabIndex = 0;
    boardEl.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('[data-index]');
      if (!cell) return;
      select(+cell.dataset.index);
      boardEl.focus({ preventScroll: true });
    });
  }

  function buildNumpad() {
    const pad = $('numpad');
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button');
      b.className = 'num';
      b.dataset.digit = d;
      b.innerHTML = `${d}<small></small>`;
      b.addEventListener('click', () => enterDigit(d, state.notesMode));
      pad.appendChild(b);
    }
  }

  // ---------- Helpers ----------
  const isSetup = () => state.mode === 'setup';
  const grid = () => (isSetup() ? state.setup.values : state.game.values);

  function conflictsOf(values) {
    return window.Sudoku.conflictCells(values);
  }

  function isWrong(i, conflicts) {
    const g = state.game;
    const v = g.values[i];
    if (!v || g.givens[i]) return false;
    return g.solution ? v !== g.solution[i] : conflicts.has(i);
  }

  function formatTime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // ---------- Rendering ----------
  function render() {
    const setup = isSetup();
    const values = grid();
    const g = state.game;
    const sel = state.selected;
    const selVal = values[sel];
    const showErrors = !setup && state.showMistakes;
    const conflicts = showErrors && !g.solution ? conflictsOf(g.values) : new Set();

    boardEl.classList.toggle('setup', setup);
    boardEl.classList.toggle('paused', state.paused && !setup);
    boardEl.classList.toggle('solved', !setup && g.solved);

    for (let i = 0; i < 81; i++) {
      const v = values[i];
      const cls = ['cell'];
      if (col(i) === 2 || col(i) === 5) cls.push('br');
      if (row(i) === 2 || row(i) === 5) cls.push('bb');

      if (i === sel) cls.push('selected');
      else if (selVal && v === selVal) cls.push('same');
      else if (row(i) === row(sel) || col(i) === col(sel) || box(i) === box(sel)) cls.push('peer');

      if (!setup) {
        if (g.givens[i]) cls.push('given');
        if (showErrors && isWrong(i, conflicts)) cls.push('error');
      }
      cells[i].className = cls.join(' ');
      cells[i].firstChild.textContent = v || '';
      cells[i].setAttribute('aria-label', `Row ${row(i) + 1}, column ${col(i) + 1}${v ? `, ${v}` : ', empty'}`);

      const notes = !setup && !v ? g.notes[i] : 0;
      const spans = noteSpans[i];
      for (let d = 1; d <= 9; d++) {
        const on = notes & (1 << d);
        spans[d - 1].textContent = on ? d : '';
        spans[d - 1].className = on && d === selVal ? 'hl' : '';
      }
    }

    // Numpad remaining counts
    const counts = new Array(10).fill(0);
    for (const v of values) counts[v]++;
    document.querySelectorAll('.num').forEach((b) => {
      const d = +b.dataset.digit;
      const left = 9 - counts[d];
      b.querySelector('small').textContent = setup ? '' : left > 0 ? left : '';
      b.classList.toggle('done', !setup && left <= 0);
    });

    const pad = $('numpad');
    pad.classList.toggle('notes-on', state.notesMode && !setup);
    pad.classList.toggle('setup', setup);

    // Mode UI
    $('tab-play').setAttribute('aria-selected', String(!setup));
    $('tab-setup').setAttribute('aria-selected', String(setup));
    $('setup-banner').hidden = !setup;
    $('setup-controls').hidden = !setup;
    $('play-controls').hidden = setup;
    $('status-bar').hidden = setup;
    $('mistakes-switch').hidden = setup;
    $('notes-btn').disabled = setup;
    $('hint-btn').disabled = setup || g.solved || !g.solution;
    $('notes-btn').setAttribute('aria-pressed', String(state.notesMode && !setup));
    $('notes-state').textContent = state.notesMode && !setup ? 'on' : 'off';
    $('undo-btn').disabled = (setup ? state.setup.history : g.history).length === 0;

    // Status
    $('stat-level').textContent = g.level;
    $('stat-mistakes').textContent = g.mistakes;
    $('stat-mistakes').classList.toggle('bad', g.mistakes > 0);
    $('stat-mistakes-wrap').hidden = !state.showMistakes || !g.solution;
    $('stat-time').textContent = formatTime(g.elapsed);
    $('pause-overlay').hidden = !state.paused || setup;
    $('show-mistakes').checked = state.showMistakes;

    const clues = state.setup.values.filter(Boolean).length;
    $('setup-count').textContent = `${clues} clue${clues === 1 ? '' : 's'} entered${clues < 17 ? ' · a valid grid needs at least 17' : ''}`;
  }

  function flash(i, cls) {
    const c = cells[i];
    c.classList.remove(cls);
    void c.offsetWidth; // restart animation
    c.classList.add(cls);
  }

  // ---------- Actions ----------
  function select(i) {
    state.selected = i;
    render();
  }

  function pushHistory() {
    if (isSetup()) {
      state.setup.history.push(state.setup.values.slice());
      if (state.setup.history.length > 300) state.setup.history.shift();
    } else {
      const g = state.game;
      g.history.push({ values: g.values.slice(), notes: g.notes.slice() });
      if (g.history.length > 300) g.history.shift();
    }
  }

  function canEdit() {
    if (isSetup()) return true;
    const g = state.game;
    return !g.solved && !state.paused && !g.givens[state.selected];
  }

  function enterDigit(d, asNote) {
    if (!canEdit()) return;
    const i = state.selected;

    if (isSetup()) {
      const vals = state.setup.values;
      pushHistory();
      vals[i] = vals[i] === d ? 0 : d;
      if (vals[i]) flash(i, 'placed');
      return commit();
    }

    const g = state.game;
    if (asNote) {
      if (g.values[i]) return;
      pushHistory();
      g.notes[i] ^= 1 << d;
      return commit();
    }

    if (g.values[i] === d) return; // nothing to do
    pushHistory();
    g.values[i] = d;
    g.notes[i] = 0;
    // Clear this digit from notes in peers.
    for (const p of PEERS[i]) g.notes[p] &= ~(1 << d);

    if (state.showMistakes && g.solution && d !== g.solution[i]) {
      g.mistakes++;
    }
    commit();
    flash(i, 'placed');
    checkSolved();
  }

  function erase() {
    if (!canEdit()) return;
    const i = state.selected;
    if (isSetup()) {
      if (!state.setup.values[i]) return;
      pushHistory();
      state.setup.values[i] = 0;
      return commit();
    }
    const g = state.game;
    if (!g.values[i] && !g.notes[i]) return;
    pushHistory();
    if (g.values[i]) g.values[i] = 0; else g.notes[i] = 0;
    commit();
  }

  function undo() {
    if (isSetup()) {
      const prev = state.setup.history.pop();
      if (prev) state.setup.values = prev;
    } else {
      const g = state.game;
      if (g.solved || state.paused) return;
      const prev = g.history.pop();
      if (prev) { g.values = prev.values; g.notes = prev.notes; }
    }
    commit();
  }

  function hint() {
    const g = state.game;
    if (isSetup() || g.solved || state.paused || !g.solution) return;
    let i = state.selected;
    if (g.givens[i] || g.values[i] === g.solution[i]) {
      const open = [];
      for (let k = 0; k < 81; k++) if (g.values[k] !== g.solution[k]) open.push(k);
      if (!open.length) return;
      i = open[(Math.random() * open.length) | 0];
    }
    pushHistory();
    const d = g.solution[i];
    g.values[i] = d;
    g.notes[i] = 0;
    for (const p of PEERS[i]) g.notes[p] &= ~(1 << d);
    state.selected = i;
    commit();
    flash(i, 'hinted');
    checkSolved();
  }

  function commit() {
    render();
    save();
  }

  function checkSolved() {
    const g = state.game;
    if (g.values.some((v) => !v)) return;
    const ok = g.solution
      ? g.values.every((v, i) => v === g.solution[i])
      : !window.Sudoku.hasConflicts(g.values);
    if (!ok) {
      if (!state.showMistakes) toast('The grid is full, but something is not right yet.');
      return;
    }
    g.solved = true;
    g.history = [];
    commit();
    setTimeout(() => {
      const mistakes = g.solution && state.showMistakes
        ? ` with ${g.mistakes} mistake${g.mistakes === 1 ? '' : 's'}` : '';
      modal({
        icon: '🎉',
        title: 'Solved!',
        text: `${g.level} puzzle completed in ${formatTime(g.elapsed)}${mistakes}.`,
        actions: [{ label: 'New game', value: 'new', primary: true }, { label: 'Close', value: 'close' }],
      }).then((v) => { if (v === 'new') newGame(); });
    }, 650);
  }

  function newGame(level = $('difficulty').value) {
    const { puzzle, solution } = window.Sudoku.generate(level);
    state.game = makeGame(puzzle, solution, DIFFICULTY[level].label);
    state.paused = false;
    state.selected = 40;
    commit();
  }

  // ---------- Setup mode ----------
  function enterSetup() {
    if (isSetup()) return;
    state.mode = 'setup';
    state.paused = false;
    state.notesMode = false;
    commit();
    boardEl.focus({ preventScroll: true });
  }

  function leaveSetup() {
    if (!isSetup()) return;
    state.mode = 'play';
    commit();
  }

  async function startSetupGrid() {
    const vals = state.setup.values;
    const clues = vals.filter(Boolean).length;
    if (clues === 0) return toast('Enter some clues first.');

    // We deliberately never point at the faulty cells: setup mode hides mistakes.
    if (window.Sudoku.hasConflicts(vals)) {
      return modal({
        icon: '🧩',
        title: 'This grid can’t be solved',
        text: 'A number appears twice in the same row, column or box. Check your clues and try again.',
        actions: [{ label: 'Keep editing', value: 'ok', primary: true }],
      });
    }

    const count = window.Sudoku.countSolutions(vals, 2);
    if (count === 0) {
      return modal({
        icon: '🧩',
        title: 'No solution',
        text: 'These clues don’t lead to any valid solution. Double-check them against your source.',
        actions: [{ label: 'Keep editing', value: 'ok', primary: true }],
      });
    }

    let solution = null;
    if (count === 1) {
      solution = window.Sudoku.solve(vals);
    } else {
      const choice = await modal({
        icon: '🔀',
        title: 'Several solutions',
        text: 'This grid has more than one solution. You can still play it: hints are off, and only numbers that repeat in a row, column or box are flagged.',
        actions: [{ label: 'Play anyway', value: 'play', primary: true }, { label: 'Keep editing', value: 'edit' }],
      });
      if (choice !== 'play') return;
    }

    state.game = makeGame(vals, solution, 'Custom');
    state.mode = 'play';
    state.notesMode = false;
    state.paused = false;
    state.setup.history = [];
    commit();
    toast('Your grid is ready. Have fun!');
  }

  async function clearSetup() {
    if (!state.setup.values.some(Boolean)) return;
    pushHistory();
    state.setup.values = emptyGrid();
    commit();
    toast('Grid cleared. Use Undo to bring it back.');
  }

  // ---------- Timer ----------
  setInterval(() => {
    const g = state.game;
    if (!g || isSetup() || state.paused || g.solved || document.hidden) return;
    g.elapsed++;
    $('stat-time').textContent = formatTime(g.elapsed);
    if (g.elapsed % 5 === 0) save();
  }, 1000);

  function togglePause(force) {
    if (isSetup() || state.game.solved) return;
    state.paused = typeof force === 'boolean' ? force : !state.paused;
    commit();
  }

  // ---------- Modal & toast ----------
  const modalEl = $('modal');
  function modal({ icon = '', title, text, actions }) {
    $('modal-icon').textContent = icon;
    $('modal-title').textContent = title;
    $('modal-text').textContent = text;
    const box = $('modal-actions');
    box.innerHTML = '';
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = 'btn' + (a.primary ? ' primary' : '');
      b.value = a.value;
      b.textContent = a.label;
      box.appendChild(b);
    });
    modalEl.returnValue = '';
    modalEl.showModal();
    box.querySelector('.primary')?.focus();
    return new Promise((resolve) => {
      modalEl.addEventListener('close', () => resolve(modalEl.returnValue), { once: true });
    });
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- Theme ----------
  function applyTheme() {
    if (state.theme) document.documentElement.dataset.theme = state.theme;
    else delete document.documentElement.dataset.theme;
  }
  function toggleTheme() {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const current = state.theme || (systemDark ? 'dark' : 'light');
    state.theme = current === 'dark' ? 'light' : 'dark';
    applyTheme();
    save();
  }

  // ---------- Events ----------
  function bindEvents() {
    $('tab-play').addEventListener('click', leaveSetup);
    $('tab-setup').addEventListener('click', enterSetup);
    $('theme-toggle').addEventListener('click', toggleTheme);

    $('new-game-btn').addEventListener('click', async () => {
      const g = state.game;
      const inProgress = !g.solved && g.values.some((v, i) => v && !g.givens[i]);
      if (inProgress) {
        const v = await modal({
          icon: '✨',
          title: 'Start a new game?',
          text: 'Your current progress will be lost.',
          actions: [{ label: 'New game', value: 'yes', primary: true }, { label: 'Cancel', value: 'no' }],
        });
        if (v !== 'yes') return;
      }
      newGame();
    });
    $('difficulty').addEventListener('change', save);

    $('undo-btn').addEventListener('click', undo);
    $('erase-btn').addEventListener('click', erase);
    $('hint-btn').addEventListener('click', hint);
    $('notes-btn').addEventListener('click', () => { state.notesMode = !state.notesMode; render(); });
    $('pause-btn').addEventListener('click', () => togglePause());
    $('resume-btn').addEventListener('click', () => togglePause(false));
    $('show-mistakes').addEventListener('change', (e) => { state.showMistakes = e.target.checked; commit(); });

    $('setup-start-btn').addEventListener('click', startSetupGrid);
    $('setup-clear-btn').addEventListener('click', clearSetup);
    $('setup-cancel-btn').addEventListener('click', leaveSetup);

    document.addEventListener('keydown', (e) => {
      if (modalEl.open) return;
      const tag = e.target.tagName;
      if (tag === 'SELECT' || tag === 'INPUT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // e.code keeps digits working with Shift (and on AZERTY keyboards).
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      const digit = m ? +m[1] : /^[1-9]$/.test(e.key) ? +e.key : 0;
      if (digit) { e.preventDefault(); return enterDigit(digit, e.shiftKey || state.notesMode); }

      const i = state.selected;
      switch (e.key) {
        case 'ArrowUp':    e.preventDefault(); return select(i < 9 ? i + 72 : i - 9);
        case 'ArrowDown':  e.preventDefault(); return select(i >= 72 ? i - 72 : i + 9);
        case 'ArrowLeft':  e.preventDefault(); return select(col(i) === 0 ? i + 8 : i - 1);
        case 'ArrowRight': e.preventDefault(); return select(col(i) === 8 ? i - 8 : i + 1);
        case 'Backspace': case 'Delete': case '0': e.preventDefault(); return erase();
      }
      switch (e.key.toLowerCase()) {
        case 'n': if (!isSetup()) { state.notesMode = !state.notesMode; render(); } return;
        case 'h': return hint();
        case 'p': return togglePause();
      }
    });

    // Save on every way a page can go away (tab switch, close, reload, mobile app switch).
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
  }

  // ---------- Init ----------
  buildBoard();
  buildNumpad();
  bindEvents();
  if (!load()) {
    state.game = null;
    newGame($('difficulty').value);
  }
  applyTheme();
  render();
})();
