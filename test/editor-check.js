/* Rasterises the editor view to a PNG so the linked-spline / emphasis UI can be
 * eyeballed (issue 1). Uses the app's tileBoundary + catmullRom. Tiny pure-JS
 * software rasteriser (scanline fill + disc-stamped strokes) + zlib PNG. */
const fs = require("fs"), path = require("path"), vm = require("vm"), zlib = require("zlib");

const sandbox = { Math: Math, console: console };
sandbox.window = sandbox;
vm.createContext(sandbox);
["js/geometry.js", "js/euclidean.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "..", f), "utf8"), sandbox, { filename: f });
});
const E = sandbox.window.Escher;

// --- PNG encoder ---
const CRC = (function () { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
function encodePNG(w, h, rgb) { const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const stride = w * 3, raw = Buffer.alloc(h * (stride + 1)); for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); } return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); }

// --- raster ---
const W = 460, H = 460, buf = Buffer.alloc(W * H * 3);
function set(x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; }
function fillBG(c) { for (let i = 0; i < W * H; i++) { buf[i * 3] = c[0]; buf[i * 3 + 1] = c[1]; buf[i * 3 + 2] = c[2]; } }
function disc(cx, cy, r, c) { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) { const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= r * r) set(x, y, c); } }
function ring(cx, cy, r, w, c) { for (let y = Math.floor(cy - r - w); y <= cy + r + w; y++) for (let x = Math.floor(cx - r - w); x <= cx + r + w; x++) { const d = Math.hypot(x - cx, y - cy); if (d <= r + w && d >= r - w) set(x, y, c); } }
function stroke(pts, r, c, dashed) { for (let k = 0; k < pts.length - 1; k++) { if (dashed && (k % 3 === 2)) continue; const a = pts[k], b = pts[k + 1], L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L)); for (let s = 0; s <= n; s++) { const t = s / n; disc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r, c); } } }
function fillPoly(pts, c) {
  let min = 1e9, max = -1e9; for (const p of pts) { min = Math.min(min, p.y); max = Math.max(max, p.y); }
  for (let y = Math.floor(min); y <= Math.ceil(max); y++) {
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]); x <= xs[k + 1]; x++) set(x, y, c);
  }
}

function circlePoly(cx, cy, r, n) { var p = []; for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; p.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); } return p; }
const d = {
  // node [1] carries an explicit tangent (set via its lever) to show curvature control
  topEdge: [{ x: 0, y: 0 }, { x: 0.33, y: -0.16 }, { x: 0.66, y: 0.16, t: { x: 0.2, y: 0.17 } }, { x: 1, y: 0 }],
  leftEdge: [{ x: 0, y: 0 }, { x: -0.16, y: 0.33 }, { x: 0.16, y: 0.66 }, { x: 0, y: 1 }],
  strokes: [
    { color: "#1c140c", fill: false, points: [{ x: 0.30, y: 0.62 }, { x: 0.42, y: 0.70 }, { x: 0.58, y: 0.70 }, { x: 0.70, y: 0.60 }] },
    { color: "#1c140c", fill: true, points: circlePoly(0.40, 0.42, 0.055, 16) },
    { color: "#1c140c", fill: true, points: circlePoly(0.62, 0.42, 0.055, 16) }
  ],
  colorA: "#d8743b", colorB: "#2f6f7a", colorBg: "#f3ead6", outline: true, euclid: { density: 6 }
};
const pad = 56, sz = W - pad * 2;
function M(u) { return { x: pad + u.x * sz, y: pad + u.y * sz }; }
const hex = E.geom.hexToRgb, rgb = (h) => { const o = hex(h); return [o.r, o.g, o.b]; };

fillBG([17, 16, 14]);
// dashed unit square
stroke([M({x:0,y:0}),M({x:1,y:0}),M({x:1,y:1}),M({x:0,y:1}),M({x:0,y:0})], 0.6, [70, 64, 54], true);
// tile fill + outline
const boundary = E.euclidean.tileBoundary(d).map(M);
fillPoly(boundary, rgb(d.colorA));
stroke(boundary.concat([boundary[0]]), 1.2, [20, 16, 12]);
// decorations
for (const st of d.strokes) { const pts = st.points.map(M); if (st.fill) fillPoly(pts, rgb(st.color)); else stroke(pts, 2.4, rgb(st.color)); }
// edge splines (top pair emphasised gold, left pair cyan)
function spline(edge, off, c, r) { const ctrl = d[edge].map(p => ({ x: p.x + off.x, y: p.y + off.y, t: p.t })); stroke(E.geom.edgeCurve(ctrl, 16).map(M), r, c); }
const GOLD = [240, 196, 106], CYAN = [127, 176, 182];
spline("topEdge", { x: 0, y: 0 }, GOLD, 2.2); spline("topEdge", { x: 0, y: 1 }, GOLD, 2.2);
spline("leftEdge", { x: 0, y: 0 }, CYAN, 1.4); spline("leftEdge", { x: 1, y: 0 }, CYAN, 1.4);
// connector for emphasised pair
const src = d.topEdge[2]; stroke([M(src), M({ x: src.x, y: src.y + 1 })], 0.8, [240, 196, 106], true);
// handles
[["topEdge", { x: 0, y: 0 }], ["topEdge", { x: 0, y: 1 }], ["leftEdge", { x: 0, y: 0 }], ["leftEdge", { x: 1, y: 0 }]].forEach(pair => {
  const edge = pair[0], off = pair[1], primary = off.x === 0 && off.y === 0;
  for (let i = 1; i < d[edge].length - 1; i++) {
    const p = M({ x: d[edge][i].x + off.x, y: d[edge][i].y + off.y }), emph = edge === "topEdge" && i === 2;
    disc(p.x, p.y, emph ? 8.5 : 6.5, emph ? GOLD : (primary ? CYAN : [86, 133, 139]));
    ring(p.x, p.y, emph ? 8.5 : 6.5, 1, [17, 16, 14]);
  }
});
// tangent lever on the selected node top[2] (light + unobtrusive), shown on both linked copies
(function () {
  const node = d.topEdge[2], t = E.geom.edgeTangent(d.topEdge, 2);
  [[0, 0], [0, 1]].forEach(([ox, oy]) => {
    const inP = M({ x: node.x + ox - t.x, y: node.y + oy - t.y });
    const outP = M({ x: node.x + ox + t.x, y: node.y + oy + t.y });
    stroke([inP, outP], 0.8, [150, 140, 122]);   // faint tangent bar
    disc(outP.x, outP.y, 3.4, [232, 188, 104]);   // draggable end
    disc(inP.x, inP.y, 2.2, [150, 140, 122]);     // mirrored end
  });
})();

const dir = path.join(path.resolve(__dirname, ".."), "test", "previews");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "editor.png"), encodePNG(W, H, buf));
console.log("wrote editor.png");
