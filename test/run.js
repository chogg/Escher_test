/* Headless verification harness.
 *
 * A real browser is unavailable (Playwright browser downloads are blocked by the
 * network policy), so we load the *actual* app scripts into a Node VM backed by a
 * mock Canvas 2D context that THROWS on any non-finite coordinate. This exercises
 * every renderer + the editor across many parameter combinations and fails loudly
 * on NaN/Infinity, exceptions, or runaway loops.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failures = 0, passes = 0;
function ok(name) { passes++; console.log("  ✓ " + name); }
function bad(name, err) { failures++; console.log("  ✗ " + name + "  ::  " + (err && err.message || err)); }
function check(name, fn) { try { fn(); ok(name); } catch (e) { bad(name, e); } }
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

// ---- validating mock 2D context ----
function fin(name) {
  return function () {
    for (let i = 0; i < arguments.length; i++) {
      const v = arguments[i];
      if (typeof v === "number" && !Number.isFinite(v)) {
        throw new Error("non-finite arg to ctx." + name + "(): arg#" + i + " = " + v);
      }
    }
    this._calls[name] = (this._calls[name] || 0) + 1;
  };
}
function makeCtx(canvas) {
  const ctx = {
    canvas: canvas,
    _calls: {},
    fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, lineJoin: "", lineCap: "",
    font: "", globalAlpha: 1, _dash: [],
    save: fin("save"), restore: fin("restore"), beginPath: fin("beginPath"),
    closePath: fin("closePath"), fill: fin("fill"), stroke: fin("stroke"),
    clip: fin("clip"),
    moveTo: fin("moveTo"), lineTo: fin("lineTo"), arc: fin("arc"), rect: fin("rect"),
    fillRect: fin("fillRect"), clearRect: fin("clearRect"), strokeRect: fin("strokeRect"),
    fillText: fin("fillText"), scale: fin("scale"), translate: fin("translate"),
    rotate: fin("rotate"), setTransform: fin("setTransform"),
    setLineDash: function (d) { this._dash = d; },
    drawImage: fin("drawImage"),
    setPointerCapture: function () {},
    createImageData: function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    getImageData: function (x, y, w, h) {
      if (![x, y, w, h].every(Number.isFinite)) throw new Error("getImageData non-finite");
      this._calls.getImageData = (this._calls.getImageData || 0) + 1;
      const data = new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4);
      for (let i = 0; i < data.length; i += 4) { data[i] = (i) & 255; data[i + 1] = (i >> 2) & 255; data[i + 2] = 80; data[i + 3] = 255; }
      return { width: w, height: h, data: data };
    },
    putImageData: function (img, x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("putImageData non-finite");
      this._calls.putImageData = (this._calls.putImageData || 0) + 1;
    },
    createRadialGradient: function () {
      for (let i = 0; i < arguments.length; i++) if (!Number.isFinite(arguments[i])) throw new Error("radialGradient non-finite");
      return { addColorStop: function () {} };
    },
    createLinearGradient: function () { return { addColorStop: function () {} }; }
  };
  return ctx;
}

let allCtxs = [];
function makeCanvas(w, h) {
  const cv = {
    width: w || 300, height: h || 150,
    _ctx: null, _attrs: {}, style: {}, classList: mkClassList(),
    getContext: function () { if (!this._ctx) { this._ctx = makeCtx(this); allCtxs.push(this._ctx); } return this._ctx; },
    addEventListener: function () {}, removeEventListener: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, width: this.width, height: this.height }; },
    setPointerCapture: function () {}, releasePointerCapture: function () {},
    toDataURL: function () { return "data:image/png;base64,AAAA"; },
    setAttribute: function (k, v) { this._attrs[k] = v; },
    getAttribute: function (k) { return this._attrs[k] || null; },
    appendChild: function (c) { (this.children = this.children || []).push(c); return c; },
    querySelectorAll: function () { return []; }, querySelector: function () { return null; }
  };
  return cv;
}
function mkClassList() {
  const set = new Set();
  return {
    add: function () { for (const a of arguments) set.add(a); },
    remove: function () { for (const a of arguments) set.delete(a); },
    toggle: function (c, on) { if (on === undefined) on = !set.has(c); on ? set.add(c) : set.delete(c); return on; },
    contains: function (c) { return set.has(c); }
  };
}

// ---- minimal document/window ----
const elements = {};
function getEl(id) { if (!elements[id]) elements[id] = makeCanvas(id === "render-canvas" ? 1100 : 460); return elements[id]; }
const documentMock = {
  getElementById: getEl,
  createElement: function (tag) { return makeCanvas(300, 150); },
  createTextNode: function (t) { return { nodeType: 3, textContent: t }; },
  querySelectorAll: function () { return []; },
  querySelector: function () { return null; },
  addEventListener: function (ev, cb) { if (ev === "DOMContentLoaded") this._dom = cb; }
};
const sandbox = {
  document: documentMock, navigator: { userAgent: "node" },
  console: console,
  setTimeout: function (cb) { cb(); }, clearTimeout: function () {},
  requestAnimationFrame: function (cb) { cb(); },
  // window.addEventListener — capture the boot handler, ignore pointer/resize
  addEventListener: function (ev, cb) { if (ev === "DOMContentLoaded") sandbox._dom = cb; }
};
vm.createContext(sandbox);
sandbox.window = sandbox;            // in browsers window === global
sandbox.globalThis = sandbox;

// ---- load the real scripts ----
const root = path.resolve(__dirname, "..");
["js/geometry.js", "js/euclidean.js", "js/sphere.js", "js/hyperbolic.js", "js/editor.js"].forEach(function (f) {
  const code = fs.readFileSync(path.join(root, f), "utf8");
  vm.runInContext(code, sandbox, { filename: f });
});
const E = sandbox.window.Escher;

function design(over) {
  const d = {
    style: "euclidean",
    topEdge: [{ x: 0, y: 0 }, { x: 0.33, y: -0.16 }, { x: 0.66, y: 0.16 }, { x: 1, y: 0 }],
    leftEdge: [{ x: 0, y: 0 }, { x: -0.16, y: 0.33 }, { x: 0.16, y: 0.66 }, { x: 0, y: 1 }],
    strokes: [
      { color: "#1c140c", width: 5, fill: false, points: [{ x: 0.3, y: 0.6 }, { x: 0.5, y: 0.7 }, { x: 0.7, y: 0.6 }] },
      { color: "#1c140c", width: 4, fill: true, points: [{ x: 0.4, y: 0.4 }, { x: 0.45, y: 0.45 }, { x: 0.4, y: 0.5 }, { x: 0.35, y: 0.45 }] }
    ],
    colorA: "#d8743b", colorB: "#2f6f7a", colorBg: "#f3ead6", outline: true,
    euclid: { density: 6 }, hyper: { p: 6, q: 4, maxCells: 340 }, sphere: { count: 1, density: 7, shininess: 0.55 }
  };
  return Object.assign(d, over || {});
}

console.log("\n== module load ==");
check("Escher namespace populated", function () {
  ["geom", "euclidean", "sphere", "hyperbolic", "Editor"].forEach(function (k) { assert(E[k], "missing " + k); });
});

console.log("\n== geometry ==");
check("catmullRom finite + denser", function () {
  const out = E.geom.catmullRom([{ x: 0, y: 0 }, { x: 0.5, y: 0.4 }, { x: 1, y: 0 }], 10);
  assert(out.length > 3, "not denser");
  out.forEach(function (p) { assert(Number.isFinite(p.x) && Number.isFinite(p.y), "NaN pt"); });
});
check("circle3 colinear -> null", function () {
  assert(E.geom.circle3({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }) === null);
});
check("circle3 valid -> finite circle", function () {
  const c = E.geom.circle3({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 });
  assert(c && Math.abs(c.r - 1) < 1e-9 && Math.abs(c.x) < 1e-9, "unit circle expected");
});
check("mixHex midpoint", function () {
  // round(127.5) -> 128 -> 0x80
  assert(E.geom.mixHex("#000000", "#ffffff", 0.5).toLowerCase() === "#808080");
});
check("edgeCurve: flat by default, curves with an explicit tangent", function () {
  const flat = E.geom.edgeCurve([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }], 8);
  flat.forEach(p => assert(Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert(Math.max(...flat.map(p => Math.abs(p.y))) < 1e-6, "default straight edge should stay flat");
  const bent = E.geom.edgeCurve([{ x: 0, y: 0 }, { x: 0.5, y: 0, t: { x: 0.1, y: 0.3 } }, { x: 1, y: 0 }], 12);
  assert(Math.max(...bent.map(p => Math.abs(p.y))) > 0.05, "explicit tangent should curve the edge");
});

console.log("\n== euclidean ==");
check("tileBoundary closed & finite", function () {
  const b = E.euclidean.tileBoundary(design());
  assert(b.length > 12, "too few pts");
  b.forEach(function (p) { assert(Number.isFinite(p.x) && Number.isFinite(p.y)); });
});
[3, 6, 10, 12].forEach(function (dens) {
  check("euclidean render density=" + dens, function () {
    const cv = makeCanvas(1100, 780); const ctx = cv.getContext();
    E.euclidean.render(ctx, 1100, 780, design({ euclid: { density: dens } }));
    assert(ctx._calls.fill > 5, "expected many fills");
    assert(ctx._calls.clip > 0, "expected decoration clipping");
  });
});
check("euclidean render with no strokes", function () {
  const ctx = makeCanvas(600, 600).getContext();
  E.euclidean.render(ctx, 600, 600, design({ strokes: [] }));
  assert(ctx._calls.fill > 5);
});

console.log("\n== sphere ==");
[1, 2, 3].forEach(function (n) {
  check("sphere render count=" + n, function () {
    const ctx = makeCanvas(700, 520).getContext();
    E.sphere.render(ctx, 700, 520, design({ style: "sphere", sphere: { count: n, density: 7, shininess: 0.5 } }), { envRes: 200 });
    assert(ctx._calls.getImageData > 0, "no getImageData (sphere pixels)");
    assert(ctx._calls.putImageData > 0, "no putImageData");
  });
});
check("sphere full-res render", function () {
  const ctx = makeCanvas(1100, 780).getContext();
  E.sphere.render(ctx, 1100, 780, design({ style: "sphere" }), { envRes: 512 });
  assert(ctx._calls.putImageData > 0);
});
check("cubeFace mapping: finite, in-range, no pole singularity", function () {
  for (let a = 0; a < 800; a++) {
    const th = Math.random() * Math.PI, ph = Math.random() * 2 * Math.PI;
    const Rx = Math.sin(th) * Math.cos(ph), Ry = Math.cos(th), Rz = Math.sin(th) * Math.sin(ph);
    const f = E.sphere.cubeFace(Rx, Ry, Rz);
    assert(Number.isFinite(f.u) && f.u >= 0 && f.u <= 1, "u out of range: " + f.u);
    assert(Number.isFinite(f.v) && f.v >= 0 && f.v <= 1, "v out of range: " + f.v);
    assert(Number.isFinite(f.bright) && f.bright > 0, "bad bright: " + f.bright);
  }
});
check("cubeFace: ceiling brighter than floor (physical room shading)", function () {
  assert(E.sphere.cubeFace(0, 1, 0).bright > E.sphere.cubeFace(0, -1, 0).bright, "ceiling should be brighter than floor");
});

console.log("\n== hyperbolic ==");
[[6, 4], [4, 5], [3, 7], [7, 3], [5, 4], [8, 3], [4, 6], [5, 5]].forEach(function (pq) {
  check("hyperbolic {" + pq[0] + "," + pq[1] + "}", function () {
    assert(E.hyperbolic.valid(pq[0], pq[1]), "should be hyperbolic");
    const ctx = makeCanvas(900, 780).getContext();
    const res = E.hyperbolic.render(ctx, 900, 780, design({ style: "hyperbolic", hyper: { p: pq[0], q: pq[1], maxCells: 300 } }));
    assert(res.cells >= 1 && res.cells <= 300, "cell count out of range: " + res.cells);
    assert(res.cells > pq[0], "expected more than one ring of tiles, got " + res.cells);
    assert(ctx._calls.fill > res.cells, "expected fills for tiles + motif");
  });
});
check("hyperbolic rejects euclidean/spherical {p,q}", function () {
  assert(!E.hyperbolic.valid(4, 4), "{4,4} is euclidean");
  assert(!E.hyperbolic.valid(3, 6), "{3,6} is euclidean");
  assert(!E.hyperbolic.valid(3, 5), "{3,5} is spherical");
  // even an invalid request must not throw (falls back internally)
  const ctx = makeCanvas(600, 600).getContext();
  E.hyperbolic.render(ctx, 600, 600, design({ style: "hyperbolic", hyper: { p: 4, q: 4, maxCells: 120 } }));
});
check("hyperbolic respects maxCells cap", function () {
  const ctx = makeCanvas(900, 780).getContext();
  const res = E.hyperbolic.render(ctx, 900, 780, design({ style: "hyperbolic", hyper: { p: 7, q: 3, maxCells: 120 } }));
  assert(res.cells <= 120, "exceeded cap: " + res.cells);
});

console.log("\n== editor ==");
check("editor instantiates & mutates design via interactions", function () {
  const d = design();
  let changes = 0;
  const cv = makeCanvas(460, 460);
  const ed = new E.Editor(cv, d, function () { changes++; });
  // drag a top-edge handle
  const before = JSON.stringify(d.topEdge[1]);
  ed.setTool("edges");
  ed._down({ clientX: ed.toPx(d.topEdge[1]).x, clientY: ed.toPx(d.topEdge[1]).y, pointerId: 1, preventDefault: function () {} });
  assert(ed.active && ed.active.type === "handle", "did not grab handle");
  ed._move({ clientX: 200, clientY: 60, pointerId: 1 });
  ed._up({});
  assert(JSON.stringify(d.topEdge[1]) !== before, "handle drag did not move control point");
  // draw a stroke
  const nStrokes = d.strokes.length;
  ed.setTool("draw");
  ed._down({ clientX: 120, clientY: 120, pointerId: 2, preventDefault: function () {} });
  ed._move({ clientX: 160, clientY: 140, pointerId: 2 });
  ed._move({ clientX: 200, clientY: 170, pointerId: 2 });
  ed._up({});
  assert(d.strokes.length === nStrokes + 1, "stroke not added");
  assert(d.strokes[d.strokes.length - 1].points.length >= 2, "stroke has too few points");
  assert(changes > 0, "onChange never fired");
});
check("editor edge-handles hidden in hyperbolic mode", function () {
  const d = design({ style: "hyperbolic" });
  const ed = new E.Editor(makeCanvas(460, 460), d, function () {});
  ed.setEditEdges(false);
  assert(ed.editEdges === false && ed.tool !== "edges", "should switch away from edges tool");
});
check("editor shows linked handles on all four edges", function () {
  const ed = new E.Editor(makeCanvas(460, 460), design(), function () {});
  // each interior node is shown as primary + mirror -> 2 handles per node
  assert(ed._handles().length === ed.nodeCount() * 2, "expected primary+mirror handles for both edges");
  // grabbing the linked mirror of a top node edits the same source point
  const d = ed.design, mir = { edge: "topEdge", i: 1, off: { x: 0, y: 1 } };
  const before = JSON.stringify(d.topEdge[1]);
  ed.active = { type: "handle", h: mir };
  ed._move({ clientX: 230, clientY: 300 });
  ed.active = null;
  assert(JSON.stringify(d.topEdge[1]) !== before, "dragging the mirror handle should edit the source node");
});
check("Add node is placed at the clicked location (armed flow)", function () {
  const ed = new E.Editor(makeCanvas(460, 460), design(), function () {});
  const top0 = ed.design.topEdge.length;
  ed.armAddNode();
  assert(ed.pendingNode === "add", "armAddNode should arm placement");
  // click near the LEFT end of the top edge
  ed._down({ clientX: ed.pad + 0.12 * ed.size, clientY: ed.pad + 2, pointerId: 1, preventDefault() {} });
  assert(ed.pendingNode === null, "placement should disarm");
  assert(ed.design.topEdge.length === top0 + 1, "a node should be added to the top edge");
  assert(ed.design.topEdge.slice(1, -1).some(p => p.x < 0.25), "node placed near the click, not crammed mid-edge");
  // second placement near the RIGHT end -> distinct location
  ed.armAddNode();
  ed._down({ clientX: ed.pad + 0.9 * ed.size, clientY: ed.pad + 2, pointerId: 1, preventDefault() {} });
  assert(ed.design.topEdge.slice(1, -1).some(p => p.x > 0.8), "second node placed near the second click");
});
check("Remove node deletes the node nearest the click (armed flow)", function () {
  const ed = new E.Editor(makeCanvas(460, 460), design(), function () {});
  const top0 = ed.design.topEdge.length;
  ed.armRemoveNode();
  assert(ed.pendingNode === "remove");
  const p = ed.toPx(ed.design.topEdge[1]);
  ed._down({ clientX: p.x, clientY: p.y, pointerId: 1, preventDefault() {} });
  assert(ed.pendingNode === null && ed.design.topEdge.length === top0 - 1, "nearest node should be removed");
});
check("double-click near an edge still inserts a node", function () {
  const ed = new E.Editor(makeCanvas(460, 460), design(), function () {});
  const n0 = ed.nodeCount();
  assert(ed._insertAt({ x: ed.pad + 0.5 * ed.size, y: ed.pad }, true) === true, "did not insert on edge");
  assert(ed.nodeCount() === n0 + 1, "node not added");
});
check("node lever sets the tangent (gradient + curvature), length clamped", function () {
  const ed = new E.Editor(makeCanvas(460, 460), design(), function () {});
  ed.emphasis = { edge: "topEdge", i: 1 };               // node is selected -> its lever exists
  const out = ed._leverOut("topEdge", 1, { x: 0, y: 0 });
  ed._down({ clientX: out.x, clientY: out.y, pointerId: 1, preventDefault() {} });
  assert(ed.active && ed.active.type === "lever", "should grab the lever, got " + (ed.active && ed.active.type));
  ed._move({ clientX: out.x + 12, clientY: out.y - 40, pointerId: 1 });
  ed._up({});
  const t = ed.design.topEdge[1].t;
  assert(t && Number.isFinite(t.x) && Number.isFinite(t.y), "node tangent should be set");
  assert(Math.hypot(t.x, t.y) <= 0.7 + 1e-9, "tangent length should be clamped");
});
check("levers only exist for the selected / hovered node", function () {
  const ed = new E.Editor(makeCanvas(460, 460), design(), function () {});
  ed.emphasis = null;
  assert(ed._hitLever({ x: 100, y: 100 }) === null, "no lever should be hittable without a selected node");
});
check("dragging a node keeps its tangent lever", function () {
  const ed = new E.Editor(makeCanvas(460, 460), design(), function () {});
  ed.design.topEdge[1].t = { x: 0.05, y: 0.2 };
  const p = ed.toPx(ed.design.topEdge[1]);
  ed._down({ clientX: p.x, clientY: p.y, pointerId: 1, preventDefault() {} });
  ed._move({ clientX: p.x + 20, clientY: p.y + 10, pointerId: 1 });
  ed._up({});
  assert(ed.design.topEdge[1].t && ed.design.topEdge[1].t.y === 0.2, "tangent should survive a node drag");
});
check("hyperbolic editor shows a fixed square tile (edge shape ignored)", function () {
  const d = design({ style: "hyperbolic" });
  d.topEdge = [{ x: 0, y: 0 }, { x: 0.33, y: -0.3 }, { x: 0.66, y: 0.3 }, { x: 1, y: 0 }]; // heavily deformed
  const ed = new E.Editor(makeCanvas(460, 460), d, function () {});
  ed.setEditEdges(false);
  const b = ed._tileBoundary();
  assert(b.length === 4, "expected a 4-corner square, got " + b.length);
  assert(b[0].x === 0 && b[0].y === 0 && b[2].x === 1 && b[2].y === 1, "expected unit-square corners");
});

// ---- app.js: ensure it loads & boots without throwing ----
console.log("\n== app boot ==");
check("app.js loads and DOMContentLoaded boots without throwing", function () {
  // give querySelectorAll enough structure for wire()/thumbnails
  const toolBtns = [mkBtn("edges"), mkBtn("draw"), mkBtn("blob")];
  const styleCards = [mkCard("euclidean"), mkCard("sphere"), mkCard("hyperbolic")];
  const thumbs = [mkThumb("euclidean"), mkThumb("sphere"), mkThumb("hyperbolic")];
  const stepLis = [mkStep("style"), mkStep("design"), mkStep("render")];
  documentMock.querySelectorAll = function (sel) {
    if (sel.indexOf("style-card") >= 0) return styleCards;
    if (sel.indexOf("tool-btn") >= 0) return toolBtns;
    if (sel.indexOf("data-thumb") >= 0) return thumbs;
    if (sel.indexOf("li") >= 0) return stepLis;
    return [];
  };
  documentMock.querySelector = function (sel) {
    if (sel.indexOf('data-tool="edges"') >= 0) return toolBtns[0];
    return null;
  };
  const code = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  vm.runInContext(code, sandbox, { filename: "js/app.js" });
  assert(typeof sandbox._dom === "function", "DOMContentLoaded handler not registered");
  sandbox._dom();   // boot
  assert(sandbox.window.__escher && sandbox.window.__escher.design, "app did not expose __escher");
  // simulate choosing each style end-to-end (enterDesign + a preview frame + render)
  ["euclidean", "sphere", "hyperbolic"].forEach(function (s) {
    sandbox.window.__escher.enterDesign(s);
    sandbox.window.__escher.doRender();
  });
});
function mkBtn(tool) { const b = makeCanvas(10, 10); b.setAttribute("data-tool", tool); b._handlers = {}; b.addEventListener = function (ev, cb) { b._handlers[ev] = cb; }; return b; }
function mkCard(style) { const b = makeCanvas(10, 10); b.setAttribute("data-style", style); b.addEventListener = function () {}; return b; }
function mkThumb(style) { const b = makeCanvas(220, 160); b.setAttribute("data-thumb", style); return b; }
function mkStep(step) { const b = makeCanvas(10, 10); b.setAttribute("data-step", step); return b; }

// ---- summary ----
console.log("\n========================================");
console.log("PASS: " + passes + "   FAIL: " + failures);
console.log("========================================");
process.exit(failures ? 1 : 0);
