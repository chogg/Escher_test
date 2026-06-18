/* sphere.js — reflecting sphere(s) set in a tiled room (orthographic mirror ball)
 *
 * The environment is modelled as a CUBE ROOM whose walls/ceiling/floor are
 * papered with the tiling. Each reflected ray is looked up against that cube
 * (a standard cube-map / light-probe lookup). Unlike an equirectangular wrap
 * this has no pole singularities, so the sphere shows a physically consistent
 * room from a single viewpoint (bright ceiling above, darker floor below).
 */
window.Escher = window.Escher || {};
Escher.sphere = (function () {
  "use strict";

  // Map a reflected unit direction to a cube face -> {u,v in [0,1], bright}.
  // Pure function (no canvas) so it can be unit-tested / rendered offline.
  function cubeFace(Rx, Ry, Rz) {
    var ax = Math.abs(Rx), ay = Math.abs(Ry), az = Math.abs(Rz), u, v, bright;
    if (ay >= ax && ay >= az) {            // up / down dominant
      if (Ry > 0) { u = Rx / ay; v = -Rz / ay; bright = 1.18; }   // ceiling (brighter)
      else { u = Rx / ay; v = Rz / ay; bright = 0.6; }            // floor (darker)
    } else if (ax >= az) {                 // side walls
      if (Rx > 0) { u = -Rz / ax; v = Ry / ax; } else { u = Rz / ax; v = Ry / ax; }
      bright = 0.95;
    } else {                               // front / back walls
      if (Rz > 0) { u = Rx / az; v = Ry / az; } else { u = -Rx / az; v = Ry / az; }
      bright = 0.82;
    }
    u = (u + 1) * 0.5; v = (v + 1) * 0.5;
    return { u: u < 0 ? 0 : u > 0.999999 ? 0.999999 : u, v: v < 0 ? 0 : v > 0.999999 ? 0.999999 : v, bright: bright };
  }

  // Build the wallpaper texture (the tiling) sampled by the cube faces.
  function buildEnv(design, res) {
    var c = document.createElement("canvas");
    c.width = res; c.height = res;
    var ctx = c.getContext("2d");
    var dens = (design.sphere && design.sphere.density) || 7;
    Escher.euclidean.render(ctx, res, res, design, { density: dens, outline: design.outline });
    return { data: ctx.getImageData(0, 0, res, res).data, w: res, h: res };
  }
  function sampleEnv(env, u, v) {
    var x = (u * env.w) | 0, y = (v * env.h) | 0;
    var i = (y * env.w + x) * 4;
    return [env.data[i], env.data[i + 1], env.data[i + 2]];
  }

  function renderSphere(ctx, env, sph, shininess) {
    var R = sph.r, cx = sph.cx, cy = sph.cy;
    var x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R));
    var x1 = Math.min(ctx.canvas.width, Math.ceil(cx + R)), y1 = Math.min(ctx.canvas.height, Math.ceil(cy + R));
    var w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;

    var img = ctx.getImageData(x0, y0, w, h), d = img.data;
    var Lx = -0.42, Ly = 0.55, Lz = 0.72;
    var hlen = Math.sqrt(Lx * Lx + Ly * Ly + (Lz + 1) * (Lz + 1));
    var Hx = Lx / hlen, Hy = Ly / hlen, Hz = (Lz + 1) / hlen;
    var shin = 8 + shininess * 90, specK = 0.3 + shininess * 0.5;

    for (var py = 0; py < h; py++) {
      for (var px = 0; px < w; px++) {
        var nx = (px + x0 - cx) / R, ny = (py + y0 - cy) / R;
        var rr = nx * nx + ny * ny;
        if (rr > 1) continue;
        var nz = Math.sqrt(1 - rr), Ny = -ny;            // screen y down -> world up

        // reflect the (orthographic) view ray D=(0,0,-1) about N=(nx,Ny,nz)
        var Rx = 2 * nz * nx, Ry = 2 * nz * Ny, Rz = 2 * nz * nz - 1;
        var f = cubeFace(Rx, Ry, Rz);
        var col = sampleEnv(env, f.u, f.v);

        var ndh = nx * Hx + Ny * Hy + nz * Hz; if (ndh < 0) ndh = 0;
        var spec = Math.pow(ndh, shin) * specK * 255;
        var rim = 0.84 + 0.16 * nz;
        var i = (py * w + px) * 4;
        d[i] = Math.min(255, col[0] * f.bright * rim + spec);
        d[i + 1] = Math.min(255, col[1] * f.bright * rim + spec);
        d[i + 2] = Math.min(255, col[2] * f.bright * rim + spec);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, x0, y0);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, R * 0.012);
    ctx.strokeStyle = "rgba(15,12,9,.55)";
    ctx.stroke();
    ctx.restore();
  }

  function spherePositions(W, H, count) {
    if (count <= 1) return [{ cx: W / 2, cy: H / 2, r: Math.min(W, H) * 0.34 }];
    if (count === 2) {
      var r2 = Math.min(W, H) * 0.26;
      return [{ cx: W * 0.33, cy: H * 0.52, r: r2 }, { cx: W * 0.68, cy: H * 0.48, r: r2 * 0.86 }];
    }
    var r = Math.min(W, H) * 0.2;
    return [
      { cx: W * 0.30, cy: H * 0.36, r: r * 1.05 },
      { cx: W * 0.66, cy: H * 0.34, r: r * 0.9 },
      { cx: W * 0.5, cy: H * 0.68, r: r * 1.25 }
    ];
  }

  function render(ctx, W, H, design, opts) {
    opts = opts || {};
    var count = (design.sphere && design.sphere.count) || 1;
    var shininess = (design.sphere && design.sphere.shininess);
    if (shininess === undefined) shininess = 0.5;

    // the surrounding room (flat tiling) the spheres sit in
    Escher.euclidean.render(ctx, W, H, design, {
      density: (design.sphere && design.sphere.density) || 7, outline: design.outline
    });
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.32)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    var env = buildEnv(design, opts.envRes || 600);
    var positions = spherePositions(W, H, count);
    positions.sort(function (a, b) { return a.r - b.r; });
    for (var i = 0; i < positions.length; i++) renderSphere(ctx, env, positions[i], shininess);
  }

  return { render: render, cubeFace: cubeFace };
})();
