/* sphere.js — reflecting sphere(s) set in the tiled world (orthographic mirror ball) */
window.Escher = window.Escher || {};
Escher.sphere = (function () {
  "use strict";
  var G = Escher.geom;

  // Build an equirectangular environment from the Euclidean tiling so it can be
  // sampled by reflected rays. Returns {data, w, h}.
  function buildEnv(design, w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var ctx = c.getContext("2d");
    // The environment wraps 360deg horizontally; use a higher density so the
    // reflection reads as a busy, Escher-like room of tiles.
    var dens = (design.sphere && design.sphere.density) || 7;
    Escher.euclidean.render(ctx, w, h, design, { density: dens, outline: design.outline });
    return { data: ctx.getImageData(0, 0, w, h).data, w: w, h: h };
  }

  function sampleEnv(env, u, v) {
    // wrap u, clamp v
    u = u - Math.floor(u);
    v = v < 0 ? 0 : v > 0.999999 ? 0.999999 : v;
    var x = (u * env.w) | 0, y = (v * env.h) | 0;
    var i = (y * env.w + x) * 4;
    return [env.data[i], env.data[i + 1], env.data[i + 2]];
  }

  // Render one reflecting sphere into the existing scene at {cx,cy,r}.
  function renderSphere(ctx, env, sph, shininess) {
    var R = sph.r, cx = sph.cx, cy = sph.cy;
    var x0 = Math.max(0, Math.floor(cx - R));
    var y0 = Math.max(0, Math.floor(cy - R));
    var x1 = Math.min(ctx.canvas.width, Math.ceil(cx + R));
    var y1 = Math.min(ctx.canvas.height, Math.ceil(cy + R));
    var w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;

    var img = ctx.getImageData(x0, y0, w, h);   // keep existing background
    var d = img.data;
    var TWO_PI = Math.PI * 2;
    // Light direction (screen space, y up) for the glossy highlight.
    var Lx = -0.42, Ly = 0.55, Lz = 0.72;
    var shin = 8 + shininess * 90;
    var specK = 0.35 + shininess * 0.5;

    for (var py = 0; py < h; py++) {
      for (var px = 0; px < w; px++) {
        var nx = (px + x0 - cx) / R;
        var ny = (py + y0 - cy) / R;
        var rr = nx * nx + ny * ny;
        if (rr > 1) continue;                  // outside the disk → leave bg
        var nz = Math.sqrt(1 - rr);
        var Ny = -ny;                          // screen y is down → flip to world up

        // Reflect the view ray D=(0,0,-1) about normal N=(nx,Ny,nz).
        var rx = 2 * nz * nx, ryv = 2 * nz * Ny, rz = -1 + 2 * nz * nz;
        var lat = Math.asin(ryv < -1 ? -1 : ryv > 1 ? 1 : ryv);
        var lon = Math.atan2(rx, -rz);
        var u = lon / TWO_PI + 0.5;
        var v = 0.5 - lat / Math.PI;
        var col = sampleEnv(env, u, v);

        // Glossy specular highlight (Blinn-Phong, V=(0,0,1)).
        var hlen = Math.sqrt(Lx * Lx + Ly * Ly + (Lz + 1) * (Lz + 1));
        var Hx = Lx / hlen, Hy = Ly / hlen, Hz = (Lz + 1) / hlen;
        var ndh = nx * Hx + Ny * Hy + nz * Hz;
        if (ndh < 0) ndh = 0;
        var spec = Math.pow(ndh, shin) * specK * 255;
        // Subtle rim darkening for roundness.
        var rim = 0.82 + 0.18 * nz;

        var i = (py * w + px) * 4;
        d[i] = Math.min(255, col[0] * rim + spec);
        d[i + 1] = Math.min(255, col[1] * rim + spec);
        d[i + 2] = Math.min(255, col[2] * rim + spec);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, x0, y0);

    // A crisp contact shadow / outline to seat the sphere in the scene.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TWO_PI);
    ctx.lineWidth = Math.max(1, R * 0.012);
    ctx.strokeStyle = "rgba(15,12,9,.55)";
    ctx.stroke();
    ctx.restore();
  }

  function spherePositions(W, H, count) {
    if (count <= 1) return [{ cx: W / 2, cy: H / 2, r: Math.min(W, H) * 0.34 }];
    if (count === 2) {
      var r2 = Math.min(W, H) * 0.26;
      return [
        { cx: W * 0.33, cy: H * 0.52, r: r2 },
        { cx: W * 0.68, cy: H * 0.48, r: r2 * 0.86 }
      ];
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

    // Paint the surrounding world (flat tiling) as the room the spheres sit in.
    Escher.euclidean.render(ctx, W, H, design, {
      density: (design.sphere && design.sphere.density) || 7,
      outline: design.outline
    });
    // Gentle vignette so the spheres pop.
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.32)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    var envRes = opts.envRes || 768;
    var env = buildEnv(design, envRes, envRes / 2);
    var positions = spherePositions(W, H, count);
    // Draw far spheres first.
    positions.sort(function (a, b) { return a.r - b.r; });
    for (var i = 0; i < positions.length; i++) {
      renderSphere(ctx, env, positions[i], shininess);
    }
  }

  return { render: render };
})();
