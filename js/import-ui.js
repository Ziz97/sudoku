/* Import dialog: pick a picture → adjust corners → review → load into setup mode. */
(function () {
  'use strict';

  const R = window.GridReader;
  const $ = (id) => document.getElementById(id);
  const dialog = $('import-dialog');

  const ui = {
    work: null,       // working canvas of the picture
    corners: null,    // [tl, tr, br, bl] in work-canvas pixels
    found: false,     // corners came from automatic detection
    result: null,     // last reading
    view: { scale: 1, dpr: 1 },
    drag: -1,
  };

  // ---------- Steps ----------
  function show(step) {
    dialog.querySelectorAll('.import-step').forEach((s) => { s.hidden = s.dataset.step !== step; });
    dialog.dataset.step = step;
  }

  function open() {
    show('pick');
    if (!dialog.open) dialog.showModal();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  // ---------- Loading a picture ----------
  async function handleFile(file) {
    if (!file || !/^image\//.test(file.type)) {
      window.SudokuApp.toast('Please choose an image file.');
      return;
    }
    if (!dialog.open) dialog.showModal();
    show('busy');
    const url = URL.createObjectURL(file);
    try {
      const img = await R.loadImage(url);
      ui.work = R.toWorkCanvas(img);
      const found = R.detectCorners(ui.work);
      ui.found = !!found;
      ui.corners = found || defaultCorners(ui.work);
      showAdjust();
    } catch (err) {
      show('pick');
      window.SudokuApp.toast(err.message || 'This picture could not be opened.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function defaultCorners(c) {
    const mx = c.width * 0.08, my = c.height * 0.08;
    return [
      { x: mx, y: my }, { x: c.width - mx, y: my },
      { x: c.width - mx, y: c.height - my }, { x: mx, y: c.height - my },
    ];
  }

  // ---------- Corner adjustment ----------
  const canvas = $('adjust-canvas');

  function showAdjust() {
    show('adjust');
    $('adjust-text').textContent = ui.found
      ? 'Grid found. If the lines don’t match, drag the four corners onto the outer corners of the grid.'
      : 'The grid wasn’t found automatically. Drag the four corners onto the outer corners of the grid.';
    layoutCanvas();
  }

  function layoutCanvas() {
    const wrap = $('adjust-wrap');
    const maxW = wrap.clientWidth || 480;
    const maxH = Math.max(240, Math.min(window.innerHeight * 0.55, 560));
    const scale = Math.min(maxW / ui.work.width, maxH / ui.work.height);
    const dpr = window.devicePixelRatio || 1;
    ui.view = { scale, dpr };
    canvas.style.width = `${Math.round(ui.work.width * scale)}px`;
    canvas.style.height = `${Math.round(ui.work.height * scale)}px`;
    canvas.width = Math.round(ui.work.width * scale * dpr);
    canvas.height = Math.round(ui.work.height * scale * dpr);
    drawAdjust();
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawAdjust() {
    const ctx = canvas.getContext('2d');
    const { scale, dpr } = ui.view;
    const k = scale * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(ui.work, 0, 0, canvas.width, canvas.height);

    const pts = ui.corners.map((p) => ({ x: p.x * k, y: p.y * k }));

    // Dim everything outside the selected quad.
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 3; i >= 1; i--) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 12, 20, 0.5)';
    ctx.fill('evenodd');

    // Projected 9x9 grid, so you can see whether it lines up.
    const H = R.homography(
      [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }], pts);
    const accent = cssVar('--setup') || '#b7791f';
    if (H) {
      for (let i = 0; i <= 9; i++) {
        ctx.lineWidth = (i % 3 === 0 ? 2 : 1) * dpr;
        ctx.strokeStyle = i % 3 === 0 ? accent : 'rgba(255, 255, 255, 0.75)';
        for (const [a, b] of [[[i, 0], [i, 9]], [[0, i], [9, i]]]) {
          const p = R.project(H, a[0], a[1]), q = R.project(H, b[0], b[1]);
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
    }

    // Handles.
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, (ui.drag === i ? 13 : 10) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = accent;
      ctx.stroke();
    });
  }

  function eventPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const { scale } = ui.view;
    return {
      x: Math.min(ui.work.width, Math.max(0, (e.clientX - rect.left) / scale)),
      y: Math.min(ui.work.height, Math.max(0, (e.clientY - rect.top) / scale)),
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = eventPoint(e);
    const reach = 34 / ui.view.scale; // css px → picture px
    let best = -1, bestD = Infinity;
    ui.corners.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (bestD > reach) return;
    ui.drag = best;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    drawAdjust();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (ui.drag < 0) return;
    ui.corners[ui.drag] = eventPoint(e);
    drawAdjust();
  });
  const endDrag = () => { if (ui.drag >= 0) { ui.drag = -1; drawAdjust(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.addEventListener('resize', () => {
    if (dialog.open && dialog.dataset.step === 'adjust') layoutCanvas();
  });

  // ---------- Reading & review ----------
  async function readGrid() {
    show('busy');
    await new Promise((r) => setTimeout(r, 30)); // let the spinner paint
    try {
      ui.result = await R.read(ui.work, ui.corners.map((p) => ({ ...p })));
      showReview();
    } catch (err) {
      showAdjust();
      window.SudokuApp.toast(err.message || 'The grid could not be read.');
    }
  }

  function showReview() {
    show('review');
    const { values, uncertain, warped, valid, solutions } = ui.result;
    const count = values.filter(Boolean).length;
    const unsure = uncertain.filter(Boolean).length;

    let text;
    if (count === 0) {
      text = 'No numbers were found. Check that the corners sit on the grid’s outer corners.';
    } else if (!valid || solutions === 0) {
      text = `${count} numbers found, but they don’t form a valid puzzle yet: some were probably misread. Compare both grids, then fix them in setup mode.`;
    } else if (solutions > 1) {
      text = `${count} numbers found. The puzzle has several solutions, so a number may be missing. Compare both grids.`;
    } else {
      text = `${count} numbers found, and the puzzle has a single solution. Compare both grids to be sure.`;
    }
    $('review-text').textContent = text;
    $('review-legend').textContent = unsure
      ? `Numbers with a yellow background may have been misread (${unsure}).`
      : '';
    $('import-use').disabled = count === 0;

    drawPhoto(warped);
    drawRead(values, uncertain);
  }

  function sizeSquare(c) {
    const css = c.parentElement.clientWidth || 240;
    const dpr = window.devicePixelRatio || 1;
    c.style.width = c.style.height = `${css}px`;
    c.width = c.height = Math.round(css * dpr);
    return { css, dpr };
  }

  function drawPhoto(warped) {
    const c = $('review-photo');
    sizeSquare(c);
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = R.SIZE;
    tmp.getContext('2d').putImageData(warped, 0, 0);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, c.width, c.height);
  }

  function drawRead(values, uncertain) {
    const c = $('review-read');
    const { dpr } = sizeSquare(c);
    const ctx = c.getContext('2d');
    const S = c.width, cell = S / 9;
    ctx.fillStyle = cssVar('--surface') || '#fff';
    ctx.fillRect(0, 0, S, S);

    for (let i = 0; i < 81; i++) {
      if (!uncertain[i]) continue;
      ctx.fillStyle = cssVar('--setup-soft') || '#fdf1dc';
      ctx.fillRect((i % 9) * cell, ((i / 9) | 0) * cell, cell, cell);
    }
    for (let i = 0; i <= 9; i++) {
      ctx.strokeStyle = i % 3 === 0 ? cssVar('--line-strong') : cssVar('--line');
      ctx.lineWidth = (i % 3 === 0 ? 2 : 1) * dpr;
      const p = Math.round(i * cell) + (i === 9 ? -dpr : i === 0 ? dpr : 0);
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
    }
    ctx.fillStyle = cssVar('--setup') || '#b7791f';
    ctx.font = `700 ${Math.round(cell * 0.62)}px Fraunces, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 81; i++) {
      if (!values[i]) continue;
      ctx.fillText(String(values[i]), (i % 9 + 0.5) * cell, (((i / 9) | 0) + 0.54) * cell);
    }
  }

  function useGrid() {
    if (!ui.result) return;
    window.SudokuApp.importGrid(ui.result.values);
    close();
  }

  // ---------- Events ----------
  $('setup-import-btn').addEventListener('click', open);
  $('import-close').addEventListener('click', close);
  $('import-back').addEventListener('click', () => show('pick'));
  $('import-read').addEventListener('click', readGrid);
  $('import-readjust').addEventListener('click', showAdjust);
  $('import-use').addEventListener('click', useGrid);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('close', () => { ui.drag = -1; });

  for (const id of ['import-file', 'import-camera']) {
    $(id).addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) handleFile(f);
    });
  }
  // The camera button only makes sense on phones and tablets.
  if (!window.matchMedia('(pointer: coarse)').matches) $('import-camera-label').hidden = true;

  // Drag & drop: onto the dialog's drop zone, or anywhere on the page.
  const dz = $('dropzone');
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dz.classList.add('over');
  });
  document.addEventListener('dragleave', (e) => {
    if (e.target === dz || !e.relatedTarget) dz.classList.remove('over');
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dz.classList.remove('over');
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (f) handleFile(f);
  });

  // Paste an image from the clipboard anywhere.
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    handleFile(item.getAsFile());
  });

  // Warm up the digit templates in the background.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => R.buildTemplates());
})();
