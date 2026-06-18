/* Generates faithful SVG previews from the SAME geometry the app uses, so the
 * output can be eyeballed without a browser (which is unavailable here).
 * Covers the vector-friendly styles (Euclidean tiling + Hyperbolic disk). */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { console: console };
vm.createContext(sandbox);
sandbox.window = sandbox;
const root = path.resolve(__dirname, "..");
["js/geometry.js", "js/euclidean.js", "js/hyperbolic.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), sandbox, { filename: f });
});
const E = sandbox.window.Escher;

function design() {
  function circlePoly(cx, cy, r, n) {
    var p = []; for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; p.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); } p.push(p[0]); return p;
  }
  return {
    style: "euclidean",
    topEdge: [{ x: 0, y: 0 }, { x: 0.33, y: -0.16 }, { x: 0.66, y: 0.16 }, { x: 1, y: 0 }],
    leftEdge: [{ x: 0, y: 0 }, { x: -0.16, y: 0.33 }, { x: 0.16, y: 0.66 }, { x: 0, y: 1 }],
    strokes: [
      { color: "#1c140c", width: 5, fill: false, points: [{ x: 0.30, y: 0.62 }, { x: 0.42, y: 0.70 }, { x: 0.58, y: 0.70 }, { x: 0.70, y: 0.60 }] },
      { color: "#1c140c", width: 4, fill: true, points: circlePoly(0.40, 0.42, 0.055, 14) },
      { color: "#1c140c", width: 4, fill: true, points: circlePoly(0.62, 0.42, 0.055, 14) },
      { color: "#f3ead6", width: 4, fill: true, points: circlePoly(0.405, 0.43, 0.022, 10) },
      { color: "#f3ead6", width: 4, fill: true, points: circlePoly(0.625, 0.43, 0.022, 10) }
    ],
    colorA: "#d8743b", colorB: "#2f6f7a", colorBg: "#f3ead6", outline: true,
    euclid: { density: 6 }, hyper: { p: 6, q: 4, maxCells: 260 }, sphere: {}
  };
}
function f(n) { return Math.round(n * 100) / 100; }
function poly(pts, ox, oy, s) {
  var d = "M" + f(ox + pts[0].x * s) + " " + f(oy + pts[0].y * s);
  for (var i = 1; i < pts.length; i++) d += "L" + f(ox + pts[i].x * s) + " " + f(oy + pts[i].y * s);
  return d + "Z";
}

// ---------------- Euclidean ----------------
function euclideanSVG() {
  var d = design(), W = 900, H = 660, dens = 6, s = W / dens;
  var boundary = E.euclidean.tileBoundary(d);
  var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'];
  out.push('<rect width="' + W + '" height="' + H + '" fill="' + d.colorBg + '"/>');
  for (var j = -1; j <= H / s + 1; j++) {
    for (var i = -1; i <= dens + 1; i++) {
      var ox = i * s, oy = j * s;
      var fill = ((i + j) & 1) ? d.colorB : d.colorA;
      out.push('<path d="' + poly(boundary, ox, oy, s) + '" fill="' + fill + '" stroke="rgba(20,16,12,.7)" stroke-width="1.5"/>');
      for (var k = 0; k < d.strokes.length; k++) {
        var st = d.strokes[k];
        if (st.fill) out.push('<path d="' + poly(st.points, ox, oy, s) + '" fill="' + st.color + '"/>');
        else {
          var dd = "M" + f(ox + st.points[0].x * s) + " " + f(oy + st.points[0].y * s);
          for (var p = 1; p < st.points.length; p++) dd += "L" + f(ox + st.points[p].x * s) + " " + f(oy + st.points[p].y * s);
          out.push('<path d="' + dd + '" fill="none" stroke="' + st.color + '" stroke-width="' + f(st.width * s / 100) + '" stroke-linecap="round" stroke-linejoin="round"/>');
        }
      }
    }
  }
  out.push('</svg>');
  return out.join("\n");
}

// ---------------- Hyperbolic ----------------
function hyperbolicSVG() {
  var d = design(); d.style = "hyperbolic";
  var W = 720, H = 720, cx = W / 2, cy = H / 2, Rpx = Math.min(W, H) * 0.47;
  var data = E.hyperbolic.tiles(d, 260);
  function S(z) { return { x: cx + z.x * Rpx, y: cy + z.y * Rpx }; }
  var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'];
  out.push('<defs><clipPath id="disk"><circle cx="' + cx + '" cy="' + cy + '" r="' + f(Rpx) + '"/></clipPath></defs>');
  out.push('<rect width="' + W + '" height="' + H + '" fill="' + d.colorBg + '"/>');
  out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + f(Rpx) + '" fill="#0d0c0b"/>');
  out.push('<g clip-path="url(#disk)">');
  for (var c = 0; c < data.tiles.length; c++) {
    var t = data.tiles[c];
    var shade = Math.max(0.45, Math.min(1, 1 - t.depth * 0.05));
    var base = t.parity ? d.colorB : d.colorA;
    var fill = E.geom.mixHex(base, "#0d0c0b", 1 - shade);
    var bp = t.boundary.map(S);
    var dd = "M" + f(bp[0].x) + " " + f(bp[0].y);
    for (var i = 1; i < bp.length; i++) dd += "L" + f(bp[i].x) + " " + f(bp[i].y);
    dd += "Z";
    out.push('<path d="' + dd + '" fill="' + fill + '" stroke="rgba(15,12,9,.55)" stroke-width="' + f(Rpx * 0.004 * shade) + '"/>');
    for (var sIdx = 0; sIdx < t.strokes.length; sIdx++) {
      var st = t.strokes[sIdx]; if (!st.points.length) continue;
      var sp = st.points.map(S);
      var ds = "M" + f(sp[0].x) + " " + f(sp[0].y);
      for (var q = 1; q < sp.length; q++) ds += "L" + f(sp[q].x) + " " + f(sp[q].y);
      if (st.fill) out.push('<path d="' + ds + 'Z" fill="' + st.color + '"/>');
      else out.push('<path d="' + ds + '" fill="none" stroke="' + st.color + '" stroke-width="' + f(Math.max(0.4, st.width * Rpx / 100 * shade * data.r0)) + '" stroke-linecap="round"/>');
    }
  }
  out.push('</g>');
  out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + f(Rpx) + '" fill="none" stroke="rgba(216,160,75,.85)" stroke-width="' + f(Rpx * 0.01) + '"/>');
  out.push('</svg>');
  return out.join("\n");
}

// ---------------- Editor view (issue 1: linked splines + emphasis) ----------------
function editorSVG() {
  var d = design(), W = 460, H = 460, pad = 56, sz = W - pad * 2;
  function M(u) { return { x: pad + u.x * sz, y: pad + u.y * sz }; }
  function pl(pts, close) { var s = "M" + f(pts[0].x) + " " + f(pts[0].y); for (var i = 1; i < pts.length; i++) s += "L" + f(pts[i].x) + " " + f(pts[i].y); return close ? s + "Z" : s; }
  var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'];
  out.push('<rect width="' + W + '" height="' + H + '" fill="#11100e"/>');
  out.push('<rect x="' + pad + '" y="' + pad + '" width="' + sz + '" height="' + sz + '" fill="none" stroke="rgba(169,158,137,.25)" stroke-dasharray="4 5"/>');
  // tile
  out.push('<path d="' + pl(E.euclidean.tileBoundary(d).map(M), true) + '" fill="' + d.colorA + '" stroke="rgba(20,16,12,.7)" stroke-width="1.5"/>');
  // edge splines: top(primary), bottom(=top+y), left(primary), right(=left+x). Emphasise the top pair.
  function spline(edge, off, emph) {
    var ctrl = d[edge].map(function (p) { return { x: p.x + off.x, y: p.y + off.y }; });
    var pts = E.geom.catmullRom(ctrl, 12).map(M);
    out.push('<path d="' + pl(pts, false) + '" fill="none" stroke="' + (emph ? "#f0c46a" : "rgba(127,176,182,.8)") + '" stroke-width="' + (emph ? 3.5 : 2) + '" stroke-linecap="round"/>');
  }
  spline("topEdge", { x: 0, y: 0 }, true);
  spline("topEdge", { x: 0, y: 1 }, true);    // linked mirror (bottom)
  spline("leftEdge", { x: 0, y: 0 }, false);
  spline("leftEdge", { x: 1, y: 0 }, false);   // linked mirror (right)
  // connector for the emphasised linked pair (topEdge[1] <-> its bottom mirror)
  var src = d.topEdge[1], a = M(src), b = M({ x: src.x, y: src.y + 1 });
  out.push('<path d="M' + f(a.x) + ' ' + f(a.y) + 'L' + f(b.x) + ' ' + f(b.y) + '" stroke="rgba(240,196,106,.55)" stroke-width="1.5" stroke-dasharray="3 4"/>');
  // handles on all four edges (primary + mirror); emphasise top[1] pair
  [["topEdge", { x: 0, y: 0 }], ["topEdge", { x: 0, y: 1 }], ["leftEdge", { x: 0, y: 0 }], ["leftEdge", { x: 1, y: 0 }]].forEach(function (pair) {
    var edge = pair[0], off = pair[1], primary = off.x === 0 && off.y === 0;
    for (var i = 1; i < d[edge].length - 1; i++) {
      var p = M({ x: d[edge][i].x + off.x, y: d[edge][i].y + off.y });
      var emph = edge === "topEdge" && i === 1;
      out.push('<circle cx="' + f(p.x) + '" cy="' + f(p.y) + '" r="' + (emph ? 8.5 : 6.5) + '" fill="' + (emph ? "#f0c46a" : (primary ? "#7fb0b6" : "#56858b")) + '" stroke="#11100e" stroke-width="2"/>');
    }
  });
  out.push('</svg>');
  return out.join("\n");
}

var dir = path.join(root, "test", "previews");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "euclidean.svg"), euclideanSVG());
fs.writeFileSync(path.join(dir, "hyperbolic.svg"), hyperbolicSVG());
fs.writeFileSync(path.join(dir, "editor.svg"), editorSVG());
console.log("wrote test/previews/euclidean.svg (" + E.euclidean.tileBoundary(design()).length + " boundary pts)");
var hd = E.hyperbolic.tiles((function () { var x = design(); x.style = "hyperbolic"; return x; })(), 260);
console.log("wrote test/previews/hyperbolic.svg (" + hd.tiles.length + " tiles)");
