/* isohedral-preview.js — rasterise a few Tactile tilings to PNG so the layout
 * (esp. alternating-direction "bird/fish" rows) can be eyeballed. */
const fs = require("fs"), path = require("path"), vm = require("vm"), zlib = require("zlib");
const sandbox = { Math: Math, console: console, document: { createElement: function () { return { getContext: function () { return {}; } }; } } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
["js/vendor/tactile.js", "js/geometry.js", "js/isohedral.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "..", f), "utf8"), sandbox, { filename: f });
});
const E = sandbox.window.Escher, ISO = E.isohedral;

const CRC = (function () { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
function encodePNG(w, h, rgb) { const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const stride = w * 3, raw = Buffer.alloc(h * (stride + 1)); for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); } return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); }

function render(type, file, opts) {
  opts = opts || {};
  const W = 520, H = 400, buf = Buffer.alloc(W * H * 3);
  const bg = E.geom.hexToRgb("#f3ead6");
  for (let i = 0; i < W * H; i++) { buf[i * 3] = bg.r; buf[i * 3 + 1] = bg.g; buf[i * 3 + 2] = bg.b; }
  function set(x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; }
  function fillPoly(pts, c) {
    let min = 1e9, max = -1e9; for (const p of pts) { min = Math.min(min, p.y); max = Math.max(max, p.y); }
    for (let y = Math.floor(min); y <= Math.ceil(max); y++) { const xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x)); }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]); x <= xs[k + 1]; x++) set(x, y, c); }
  }
  function strokePoly(pts, c) { for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k + 1) % pts.length]; const L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L)); for (let s = 0; s <= n; s++) { const t = s / n; set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, c); } } }

  const iso = ISO.defaultIso(type);
  if (opts.edges) opts.edges(iso);
  iso.strokes = opts.strokes || [];
  const t = ISO.makeTiling(iso), proto = ISO.outline(iso, 14);
  const pal = [E.geom.hexToRgb(opts.colorA || "#d8743b"), E.geom.hexToRgb(opts.colorB || "#2f6f7a"), E.geom.hexToRgb("#b95f3a")].map(o => [o.r, o.g, o.b]);
  const density = opts.density || 5, cx = W / 2, cy = H / 2, scale = W / density;
  const bx0 = (0 - cx) / scale, bx1 = (W - cx) / scale, by0 = (0 - cy) / scale, by1 = (H - cy) / scale, pad = 2.5;
  const it = t.fillRegionBounds(bx0 - pad, by0 - pad, bx1 + pad, by1 + pad);
  let tiles = 0;
  for (let inst = it.next(); !inst.done; inst = it.next()) {
    const M = inst.value.T;
    const scr = proto.map(p => { const w = ISO.apply(M, p); return { x: cx + scale * w.x, y: cy + scale * w.y }; });
    fillPoly(scr, pal[t.getColour(inst.value.t1, inst.value.t2, inst.value.aspect)]);
    strokePoly(scr, [40, 32, 24]);
    tiles++;
  }
  fs.writeFileSync(file, encodePNG(W, H, buf));
  console.log("wrote " + path.basename(file) + " — IH" + type + ", " + tiles + " tiles, " + ISO.meta(type).label);
}

const dir = path.join(path.resolve(__dirname, ".."), "test", "previews");
fs.mkdirSync(dir, { recursive: true });
// A glide quadrilateral bent into a bird-ish profile -> alternating rows
render(43, path.join(dir, "iso-birdfish.png"), { density: 5, edges: function (iso) { iso.edges[0].ctrl = [{ x: 0.3, y: 0.34 }, { x: 0.72, y: 0.18 }]; if (iso.edges[1]) iso.edges[1].ctrl = [{ x: 0.28, y: -0.26 }, { x: 0.64, y: -0.12 }]; } });
// The classic Escher hexagon
render(4, path.join(dir, "iso-hex.png"), { density: 4.5, edges: function (iso) { if (iso.edges[1]) iso.edges[1].ctrl = [{ x: 0.3, y: 0.22 }, { x: 0.7, y: 0.18 }]; } });
// A simple offset-brick quad with straight edges (sanity layout)
render(36, path.join(dir, "iso-glide36.png"), { density: 5, edges: function (iso) { iso.edges[0].ctrl = [{ x: 0.25, y: 0.28 }]; } });
