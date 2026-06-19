/* isohedral-check.js — render the Tactile-backed engine across many types
 * through a canvas mock that throws on any non-finite coordinate. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, checks = 0;
function ok(c, m) { checks++; if (!c) { fail++; console.error("  FAIL: " + m); } }

function fin(name) {
  return function () {
    for (let i = 0; i < arguments.length; i++) {
      const v = arguments[i];
      if (typeof v === "number" && !Number.isFinite(v)) throw new Error("non-finite arg to " + name);
    }
    this._calls[name] = (this._calls[name] || 0) + 1;
  };
}
function makeCtx(canvas) {
  return {
    canvas: canvas, _calls: {}, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, lineJoin: "", lineCap: "",
    save: fin("save"), restore: fin("restore"), beginPath: fin("beginPath"), closePath: fin("closePath"),
    fill: fin("fill"), stroke: fin("stroke"), clip: fin("clip"), moveTo: fin("moveTo"), lineTo: fin("lineTo"),
    arc: fin("arc"), rect: fin("rect"), fillRect: fin("fillRect"), clearRect: fin("clearRect"),
    strokeRect: fin("strokeRect"), setLineDash: function () {},
    createRadialGradient: function () { return { addColorStop: function () {} }; },
    getImageData: function (x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4) }; },
    putImageData: function () {}
  };
}
function makeCanvas(w, h) {
  return { width: w, height: h, _ctx: null, style: {},
    getContext: function () { return this._ctx || (this._ctx = makeCtx(this)); } };
}
const sandbox = { console: console, document: { createElement: function () { return makeCanvas(300, 150); } } };
vm.createContext(sandbox);
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const root = path.resolve(__dirname, "..");
["js/vendor/tactile.js", "js/geometry.js", "js/isohedral.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), sandbox, { filename: f });
});
const ISO = sandbox.window.Escher.isohedral;

const cat = ISO.catalogue();
ok(cat.length === 81, "catalogue has 81 types (got " + cat.length + ")");
ok(cat.filter(c => c.flip).length === 35, "35 types flagged alternating-rows (got " + cat.filter(c => c.flip).length + ")");

function baseDesign(type) {
  return {
    style: "isohedral", colorA: "#d8743b", colorB: "#2f6f7a", colorBg: "#f3ead6", outline: true,
    iso: Object.assign(ISO.defaultIso(type), {
      strokes: [{ color: "#1c140c", width: 5, fill: false, points: [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.4 }, { x: 0.7, y: 0.2 }] }]
    })
  };
}

// Render every type with default + bent edges; assert finite geometry and real tiling.
let totalFills = 0;
cat.forEach(function (c) {
  const d = baseDesign(c.type);
  // bend the first editable edge to exercise the deform path
  if (d.iso.edges[0] && d.iso.edges[0].ctrl.length) d.iso.edges[0].ctrl[0] = { x: 0.3, y: 0.22 };
  const cv = makeCanvas(640, 480), ctx = cv.getContext();
  try {
    ISO.render(ctx, 640, 480, d, { density: 4 });
    ok(ctx._calls.fill > 4, "IH" + c.type + " produced tiles (fills=" + (ctx._calls.fill || 0) + ")");
    ok(ctx._calls.clip > 0, "IH" + c.type + " clipped motif");
    totalFills += ctx._calls.fill || 0;
  } catch (e) { ok(false, "IH" + c.type + " render threw: " + e.message); }
});

// Outline + corners are finite and closed-ish.
cat.slice(0, 12).forEach(function (c) {
  const iso = ISO.defaultIso(c.type);
  const o = ISO.outline(iso, 10), cor = ISO.corners(iso);
  ok(o.length >= 3 && o.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), "IH" + c.type + " outline finite");
  ok(cor.length === c.verts && cor.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), "IH" + c.type + " corners = " + c.verts);
});

// Edge symmetry: S partner is 180° rotation; U partner is mirror.
(function () {
  const sp = ISO.controlPair([{ x: 0.3, y: 0.2 }], "S");
  ok(Math.abs(sp[1].x - 0.7) < 1e-9 && Math.abs(sp[1].y + 0.2) < 1e-9, "S edge partner = 180° rotation");
  const up = ISO.controlPair([{ x: 0.3, y: 0.2 }], "U");
  ok(Math.abs(up[1].x - 0.7) < 1e-9 && Math.abs(up[1].y - 0.2) < 1e-9, "U edge partner = mirror");
  ok(ISO.controlPair([], "I") === null, "I edge is straight");
})();

console.log((fail ? "✗" : "✓") + " isohedral engine: " + (checks - fail) + "/" + checks +
  " checks, " + totalFills + " tiles drawn across 81 types");
process.exit(fail ? 1 : 0);
