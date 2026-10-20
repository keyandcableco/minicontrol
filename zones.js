// The xy pad's painted cells (xy zones, 447-471) drawn and dragged, in the envelope graphs' manner:
// a drawing of the plate goes above the zone rows and folds them under "exact values". Dragging a
// cell moves it, its filled corner resizes it, and a drag on empty plate draws the first unpainted
// cell; every edit goes through setParam, so it is sent and the bank marked edited like any slider.
// The plate is drawn as it is held, x left to right, y bottom row to top.
(function () {
  const FIRST = 447, CELL0 = 448, CELLS = 4;
  const ROLES = ["off", "fader", "chord", "drum", "toggle"];
  const COLORS = ["#999", "#2F7A4B", "#9C4A12", "#B4361F", "#4A5FB4"];
  const PAD = { x: 34, y: 12, w: 150, h: 264 };   // the plate's face in the canvas

  const el = a => document.getElementById("param-" + a);
  const num = a => { const e = el(a); return e ? +e.value || 0 : 0; };
  const cellAddr = c => [0, 1, 2, 3, 4, 5].map(k => CELL0 + c * 6 + k);
  const readCell = c => cellAddr(c).map(num);

  function box(z) {   // percent to canvas, y turned so the bottom row sits at the bottom
    const x0 = Math.min(z[0], z[2]), x1 = Math.max(z[0], z[2]);
    const y0 = Math.min(z[1], z[3]), y1 = Math.max(z[1], z[3]);
    return { x: PAD.x + PAD.w * x0 / 100, y: PAD.y + PAD.h * (1 - y1 / 100),
             w: PAD.w * (x1 - x0) / 100, h: PAD.h * (y1 - y0) / 100 };
  }

  let canvas, ctx;

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#8882";
    ctx.strokeStyle = "#888";
    ctx.fillRect(PAD.x, PAD.y, PAD.w, PAD.h);
    ctx.strokeRect(PAD.x, PAD.y, PAD.w, PAD.h);
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = "#8886";
    for (let r = 1; r < 6; r++) {   // the rows of dots, faint, to place cells by
      ctx.beginPath();
      ctx.moveTo(PAD.x, PAD.y + PAD.h * r / 6);
      ctx.lineTo(PAD.x + PAD.w, PAD.y + PAD.h * r / 6);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = "11px sans-serif";
    const count = num(FIRST);
    for (let c = 0; c < CELLS; c++) {
      const z = readCell(c), b = box(z);
      const live = c < count && z[4] >= 1 && z[4] <= 4;
      const color = COLORS[live ? z[4] : 0];
      ctx.globalAlpha = live ? 1 : 0.35;
      ctx.fillStyle = color + (live ? "33" : "22");
      ctx.strokeStyle = color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = color;
      ctx.fillRect(b.x + b.w - 7, b.y + b.h - 7, 7, 7);   // the resize corner
      if (b.w > 2 || b.h > 2) {
        const label = (c + 1) + " " + ROLES[live ? z[4] : 0] + (live && z[4] ? " " + z[5] : "");
        ctx.fillText(label, Math.min(b.x + 3, canvas.width - 64), Math.max(b.y - 3, 10));
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "#888";
    ctx.fillText("top", PAD.x + PAD.w + 8, PAD.y + 10);
    ctx.fillText("bottom row", PAD.x + PAD.w + 8, PAD.y + PAD.h);
  }

  function write(c, z) {   // the cell's edges back through its own controls
    const a = cellAddr(c);
    for (let k = 0; k < 4; k++) {
      const v = Math.round(Math.max(0, Math.min(100, z[k])));
      if (num(a[k]) !== v) setParam(a[k], v);
    }
  }

  let drag = null;
  function at(e) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;   // folded away: nothing to point at
    const x = (e.clientX - r.left) * canvas.width / r.width, y = (e.clientY - r.top) * canvas.height / r.height;
    return { x: (x - PAD.x) * 100 / PAD.w, y: (1 - (y - PAD.y) / PAD.h) * 100 };
  }

  function down(e) {
    const p = at(e);
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
    for (let c = CELLS - 1; c >= 0; c--) {   // the highest cell wins, as it does on the plate
      const z = readCell(c);
      const x0 = Math.min(z[0], z[2]), x1 = Math.max(z[0], z[2]);
      const y0 = Math.min(z[1], z[3]), y1 = Math.max(z[1], z[3]);
      if (x1 - x0 < 2 && y1 - y0 < 2) continue;
      if (p.x < x0 - 2 || p.x > x1 + 2 || p.y < y0 - 2 || p.y > y1 + 2) continue;
      const resize = p.x > x1 - 8 && p.y < y0 + 8;   // the filled corner, bottom right
      drag = { cell: c, resize, gx: p.x, gy: p.y, z0: [x0, y0, x1, y1] };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      return;
    }
    if (p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100) return;
    for (let c = 0; c < CELLS; c++) {   // empty plate: draw the first unpainted cell, towards bottom right
      const z = readCell(c);
      if (Math.abs(z[0] - z[2]) >= 2 && Math.abs(z[1] - z[3]) >= 2) continue;
      drag = { cell: c, resize: true, gx: p.x, gy: p.y, z0: [p.x, p.y - 4, p.x + 4, p.y] };
      write(c, drag.z0);
      draw();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      return;
    }
  }

  function move(e) {
    if (!drag) return;
    const p = at(e);
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
    const dx = p.x - drag.gx, dy = p.y - drag.gy;
    let [x0, y0, x1, y1] = drag.z0;
    if (drag.resize) {
      x1 = Math.max(x0 + 4, x1 + dx);
      y0 = Math.min(y1 - 4, y0 + dy);
    } else {
      const w = x1 - x0, h = y1 - y0;
      x0 = Math.max(0, Math.min(100 - w, x0 + dx));
      y0 = Math.max(0, Math.min(100 - h, y0 + dy));
      x1 = x0 + w;
      y1 = y0 + h;
    }
    write(drag.cell, [x0, y0, x1, y1]);
    draw();
  }

  function setupZones() {
    const addresses = [FIRST];
    for (let c = 0; c < CELLS; c++) addresses.push(...cellAddr(c));
    const rows = addresses.map(a => el(a)?.closest('div[style*="display: flex"]')).filter(Boolean);
    if (rows.length < addresses.length) return;
    const holder = document.createElement("div");
    holder.className = "picture zones-box";   // not env-box: envelope.js walks those
    holder.innerHTML = `<canvas width="300" height="288" style="touch-action:none; max-width:100%;"></canvas>` +
      `<p class="pic-values">drag a cell to move it, its corner to resize it, empty plate to draw the next; ` +
      `how many play, and each cell's role and value, are the rows below</p>` +
      `<details class="exact-values"><summary>exact values</summary></details>`;
    rows[0].before(holder);
    const exact = holder.querySelector(".exact-values");
    rows.forEach(row => exact.append(row));
    canvas = holder.querySelector("canvas");
    ctx = canvas.getContext("2d");
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", () => { drag = null; });
    canvas.addEventListener("pointercancel", () => { drag = null; });
    document.addEventListener("input", e => {
      const id = e.target.id || "";
      if (!id.startsWith("param-") && !id.startsWith("value-")) return;
      const a = +id.split("-")[1];
      if (a >= FIRST && a <= FIRST + CELLS * 6) draw();
    });
    draw();
  }

  if (typeof parameters !== "undefined" && typeof setParam === "function" && el(FIRST)) setupZones();
  else document.addEventListener("DOMContentLoaded", () => { if (el(FIRST)) setupZones(); });
})();
