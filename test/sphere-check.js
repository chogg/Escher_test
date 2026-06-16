/* Renders the reflecting sphere to real PNGs so the reflection can be eyeballed
 * (no browser/canvas available). Uses the ACTUAL cubeFace() from js/sphere.js.
 * Outputs a before/after pair: equirectangular (old, has pole pinch) vs cube
 * room (new, physically consistent). PNG is encoded in pure JS via zlib. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

// ---- load the real cubeFace from the app ----
const sandbox = { Math: Math, console: console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, "..", "js/sphere.js"), "utf8"), sandbox);
const cubeFace = sandbox.window.Escher.sphere.cubeFace;

// ---- minimal PNG (truecolor, 8-bit) encoder ----
const CRC = (function () { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = w * 3, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---- a simple papered "room": grid lines + 2-colour checker per wall ----
function room(u, v, bright) {
  const N = 6;
  const fu = u * N - Math.floor(u * N), fv = v * N - Math.floor(v * N);
  const line = fu < 0.05 || fu > 0.95 || fv < 0.05 || fv > 0.95;
  const cell = (Math.floor(u * N) + Math.floor(v * N)) & 1;
  const base = line ? [40, 30, 22] : (cell ? [216, 116, 59] : [238, 228, 206]);
  return [base[0] * bright, base[1] * bright, base[2] * bright];
}

// old equirectangular mapping (what produced the visible N/S pole pinch)
function equirectUV(Rx, Ry, Rz) {
  const lat = Math.asin(Ry < -1 ? -1 : Ry > 1 ? 1 : Ry);
  const lon = Math.atan2(Rx, -Rz);
  return { u: lon / (2 * Math.PI) + 0.5, v: 0.5 - lat / Math.PI, bright: 1 };
}

function renderSphere(mapping) {
  const W = 460, H = 460, rgb = Buffer.alloc(W * H * 3);
  // background: soft dark radial so the sphere reads
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
    const g = Math.max(0, 1 - (dx * dx + dy * dy) * 0.5);
    const i = (y * W + x) * 3; rgb[i] = 26 * g + 8; rgb[i + 1] = 24 * g + 7; rgb[i + 2] = 20 * g + 6;
  }
  const cx = W / 2, cy = H / 2, R = W * 0.42;
  const Lx = -0.42, Ly = 0.55, Lz = 0.72, hl = Math.hypot(Lx, Ly, Lz + 1);
  const Hx = Lx / hl, Hy = Ly / hl, Hz = (Lz + 1) / hl;
  for (let py = Math.floor(cy - R); py < cy + R; py++) {
    for (let px = Math.floor(cx - R); px < cx + R; px++) {
      const nx = (px - cx) / R, ny = (py - cy) / R, rr = nx * nx + ny * ny;
      if (rr > 1) continue;
      const nz = Math.sqrt(1 - rr), Ny = -ny;
      const Rx = 2 * nz * nx, Ry = 2 * nz * Ny, Rz = 2 * nz * nz - 1;
      const f = mapping(Rx, Ry, Rz);
      let u = f.u - Math.floor(f.u), v = f.v < 0 ? 0 : f.v > 0.999 ? 0.999 : f.v;
      const col = room(u, v, f.bright);
      let ndh = nx * Hx + Ny * Hy + nz * Hz; if (ndh < 0) ndh = 0;
      const spec = Math.pow(ndh, 60) * 0.6 * 255, rim = 0.84 + 0.16 * nz;
      const i = (py * W + px) * 3;
      rgb[i] = Math.min(255, col[0] * rim + spec);
      rgb[i + 1] = Math.min(255, col[1] * rim + spec);
      rgb[i + 2] = Math.min(255, col[2] * rim + spec);
    }
  }
  return encodePNG(W, H, rgb);
}

const dir = path.join(path.resolve(__dirname, ".."), "test", "previews");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "sphere_before_equirect.png"), renderSphere(equirectUV));
fs.writeFileSync(path.join(dir, "sphere_after_cube.png"), renderSphere(cubeFace));
console.log("wrote sphere_before_equirect.png and sphere_after_cube.png");

// sanity: cubeFace must always yield finite, in-range coords with no pinch
let bad = 0, n = 0;
for (let a = 0; a < 2000; a++) {
  const th = Math.random() * Math.PI, ph = Math.random() * 2 * Math.PI;
  const Rx = Math.sin(th) * Math.cos(ph), Ry = Math.cos(th), Rz = Math.sin(th) * Math.sin(ph);
  const f = cubeFace(Rx, Ry, Rz); n++;
  if (!(f.u >= 0 && f.u <= 1 && f.v >= 0 && f.v <= 1 && isFinite(f.bright))) bad++;
}
console.log("cubeFace range check: " + (n - bad) + "/" + n + " ok, bright in {floor..ceiling}");
