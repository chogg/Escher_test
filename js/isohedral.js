/* isohedral.js — full isohedral tessellation engine, powered by TactileJS.
 *
 * Where euclidean.js can only translate one square tile (wallpaper group p1),
 * this module exposes all 81 isohedral tiling types from the vendored Tactile
 * library: rotations and glide reflections included, so figures can turn and
 * flip like Escher's interlocking birds and fish.
 *
 * Tactile is deliberately agnostic about how edges are drawn — it just hands us
 * a 3x3 transform per tile and per edge. We represent each distinct edge shape
 * as a small cubic with the intrinsic J/U/S/I symmetry the type requires, then
 * sample + transform it to assemble each tile. The motif strokes are stored in
 * the prototile's own coordinate frame and carried through every tile.
 */
window.Escher = window.Escher || {};
Escher.isohedral = (function () {
  "use strict";
  var G = Escher.geom;

  function T() { return window.Tactile || (typeof Tactile !== "undefined" ? Tactile : null); }

  // ---- affine 3x3 helpers (Tactile matrices are [a,b,c, d,e,f]) ----
  function apply(M, p) { return { x: M[0] * p.x + M[1] * p.y + M[2], y: M[3] * p.x + M[4] * p.y + M[5] }; }
  function invert(M) {
    var det = M[0] * M[4] - M[1] * M[3] || 1e-9;
    return [M[4] / det, -M[1] / det, (M[1] * M[5] - M[2] * M[4]) / det,
            -M[3] / det, M[0] / det, (M[2] * M[3] - M[0] * M[5]) / det];
  }

  // ---- type catalogue (computed once from Tactile, so labels never drift) ----
  var _catalogue = null;
  function shapeLetter(s) {
    var tac = T();
    return s === tac.EdgeShape.J ? "J" : s === tac.EdgeShape.U ? "U" : s === tac.EdgeShape.S ? "S" : "I";
  }
  var POLY = { 3: "triangle", 4: "quadrilateral", 5: "pentagon", 6: "hexagon" };
  // A few human-friendly names for well-known types (everything else is labelled
  // generically from its geometry, which is always accurate).
  var NICKNAMES = {
    4: "Escher hexagon", 7: "spinning hexagons", 21: "kites & darts",
    33: "offset bricks", 36: "birds & fish", 43: "fish rows", 44: "alternating rows",
    6: "pinwheel hexagon", 28: "rosette pentagons", 88: "twisted triangles"
  };

  function catalogue() {
    if (_catalogue) return _catalogue;
    var tac = T();
    if (!tac) return [];
    _catalogue = tac.tilingTypes.map(function (tp) {
      var t = new tac.IsohedralTiling(tp);
      var es = [];
      for (var i = 0; i < t.numEdgeShapes(); i++) es.push(shapeLetter(t.getEdgeShape(i)));
      // orientation-reversing tiles => the pattern flips direction (glide/mirror)
      var flip = false, n = 0;
      var it = t.fillRegionBounds(-1, -1, 3, 3);
      for (var inst = it.next(); !inst.done && n < 40; inst = it.next(), n++) {
        var M = inst.value.T;
        if (M[0] * M[4] - M[1] * M[3] < 0) { flip = true; break; }
      }
      var v = t.numVertices();
      return {
        type: tp, verts: v, params: t.numParameters(), edgeShapes: es, flip: flip,
        poly: POLY[v] || (v + "-gon"), nick: NICKNAMES[tp] || null,
        label: "IH" + tp + " · " + (POLY[v] || v + "-gon") + (flip ? " · alternating rows" : "")
      };
    });
    return _catalogue;
  }
  function meta(type) {
    var c = catalogue();
    for (var i = 0; i < c.length; i++) if (c[i].type === type) return c[i];
    return c[0];
  }

  // ---- edge shapes: canonical path from (0,0) to (1,0) ----
  // ctrl holds the FREE interior control point(s): 2 for J, 1 for U/S, 0 for I.
  function defaultCtrl(letter) {
    if (letter === "J") return [{ x: 0.34, y: 0 }, { x: 0.66, y: 0 }];
    if (letter === "S") return [{ x: 0.28, y: 0 }];   // partner derived (180° about midpoint)
    if (letter === "U") return [{ x: 0.28, y: 0 }];   // partner derived (mirror about x=0.5)
    return [];                                          // I: straight
  }
  // Resolve the two cubic control points, honouring the J/U/S/I symmetry.
  function controlPair(ctrl, letter) {
    if (letter === "I" || !ctrl || !ctrl.length) return null;
    var c1 = ctrl[0];
    if (letter === "J") return [c1, ctrl[1] || { x: 0.66, y: 0 }];
    if (letter === "S") return [c1, { x: 1 - c1.x, y: -c1.y }];   // 180° rotation about (0.5,0)
    if (letter === "U") return [c1, { x: 1 - c1.x, y: c1.y }];    // reflection across x=0.5
    return [c1, ctrl[1] || { x: 0.66, y: 0 }];
  }
  function sampleEdge(ctrl, letter, samples) {
    samples = samples || 12;
    var cp = controlPair(ctrl, letter);
    if (!cp) return [{ x: 0, y: 0 }, { x: 1, y: 0 }];   // straight
    var P0 = { x: 0, y: 0 }, P3 = { x: 1, y: 0 }, c1 = cp[0], c2 = cp[1], out = [P0];
    for (var s = 1; s <= samples; s++) {
      var u = s / samples, v = 1 - u;
      var b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
      out.push({ x: b0 * P0.x + b1 * c1.x + b2 * c2.x + b3 * P3.x,
                 y: b0 * P0.y + b1 * c1.y + b2 * c2.y + b3 * P3.y });
    }
    return out;
  }

  // ---- design <-> tiling ----
  function defaultIso(type) {
    var m = meta(type || 43);
    var tac = T();
    var edges = m.edgeShapes.map(function (L) { return { ctrl: defaultCtrl(L) }; });
    var t = new tac.IsohedralTiling(m.type);
    return { type: m.type, params: t.getParameters(), edges: edges, density: 5, colorC: null };
  }
  function makeTiling(iso) {
    var tac = T();
    var t = new tac.IsohedralTiling(iso.type);
    if (iso.params && iso.params.length === t.numParameters()) t.setParameters(iso.params.slice());
    return t;
  }
  function edgeLetters(t) {
    var out = [];
    for (var i = 0; i < t.numEdgeShapes(); i++) out.push(shapeLetter(t.getEdgeShape(i)));
    return out;
  }
  // Make sure iso.edges has the right count/shape for its type (after a type switch).
  function normalizeEdges(iso) {
    var t = makeTiling(iso), letters = edgeLetters(t);
    if (!iso.edges || iso.edges.length !== letters.length) {
      iso.edges = letters.map(function (L) { return { ctrl: defaultCtrl(L) }; });
    }
    iso.params = (iso.params && iso.params.length === t.numParameters()) ? iso.params : t.getParameters();
    return { tiling: t, letters: letters };
  }

  // The prototile corner points (tiling vertices) — independent of edge bending,
  // so the editor can fit a stable view that doesn't jiggle while you deform.
  function corners(iso) {
    var t = makeTiling(iso), pts = [], it = t.shape();
    for (var s = it.next(); !s.done; s = it.next()) pts.push(apply(s.value.T, { x: 0, y: 0 }));
    return pts;
  }
  // Closed prototile outline in tile coords, with edges bent per iso.edges.
  function outline(iso, samples) {
    var nz = normalizeEdges(iso), t = nz.tiling, letters = nz.letters, tac = T();
    var pts = [], first = true, it = t.shape();
    for (var s = it.next(); !s.done; s = it.next()) {
      var si = s.value, L = letters[si.id];
      var ep = sampleEdge(iso.edges[si.id].ctrl, L, samples || 12);
      if (si.rev) ep = ep.slice().reverse();
      for (var i = first ? 0 : 1; i < ep.length; i++) pts.push(apply(si.T, ep[i]));
      first = false;
    }
    return pts;
  }

  // ---- stroke (motif) drawing through an arbitrary point transform ----
  function drawStrokes(ctx, strokes, tf, scale) {
    if (!strokes) return;
    for (var k = 0; k < strokes.length; k++) {
      var st = strokes[k], pts = st.points;
      if (!pts || !pts.length) continue;
      if (pts.length === 1) {
        var q = tf(pts[0]);
        ctx.fillStyle = st.color; ctx.beginPath();
        ctx.arc(q.x, q.y, Math.max(1, st.width * scale / 100), 0, 7); ctx.fill();
        continue;
      }
      ctx.beginPath();
      var p0 = tf(pts[0]); ctx.moveTo(p0.x, p0.y);
      for (var i = 1; i < pts.length; i++) { var p = tf(pts[i]); ctx.lineTo(p.x, p.y); }
      if (st.fill) { ctx.closePath(); ctx.fillStyle = st.color; ctx.fill(); }
      else {
        ctx.strokeStyle = st.color; ctx.lineWidth = Math.max(0.6, st.width * scale / 100);
        ctx.lineJoin = ctx.lineCap = "round"; ctx.stroke();
      }
    }
  }

  // ---- main render ----
  // opts: {density, outline, motif:true} ; maps tile coords -> screen via a
  // centre + uniform scale so ~density tiles span the canvas width.
  function render(ctx, W, H, design, opts) {
    opts = opts || {};
    var iso = design.iso || (design.iso = defaultIso());
    var nz = normalizeEdges(iso), t = nz.tiling, letters = nz.letters;
    var density = opts.density || iso.density || 5;
    var showOutline = opts.outline !== undefined ? opts.outline : design.outline;
    var palette = [design.colorA, design.colorB, iso.colorC || G.mixHex(design.colorA, design.colorB, 0.5)];

    ctx.save();
    ctx.fillStyle = design.colorBg; ctx.fillRect(0, 0, W, H);

    var cx = W / 2, cy = H / 2, scale = W / density;
    // world (tile-coord) bounds of the screen rectangle, padded so no fringe shows
    var bx0 = (0 - cx) / scale, bx1 = (W - cx) / scale, by0 = (0 - cy) / scale, by1 = (H - cy) / scale;
    var pad = 2.5;
    var prototile = outline(iso, 12);   // canonical, bent
    var motif = iso.strokes && iso.strokes.length;

    var it = t.fillRegionBounds(bx0 - pad, by0 - pad, bx1 + pad, by1 + pad);
    for (var inst = it.next(); !inst.done; inst = it.next()) {
      var M = inst.value.T;
      // build this tile's screen path from the (already-bent) prototile
      ctx.beginPath();
      var w0 = apply(M, prototile[0]);
      ctx.moveTo(cx + scale * w0.x, cy + scale * w0.y);
      for (var i = 1; i < prototile.length; i++) {
        var w = apply(M, prototile[i]);
        ctx.lineTo(cx + scale * w.x, cy + scale * w.y);
      }
      ctx.closePath();
      ctx.fillStyle = palette[t.getColour(inst.value.t1, inst.value.t2, inst.value.aspect)];
      ctx.fill();
      if (showOutline) {
        ctx.strokeStyle = "rgba(20,16,12,.7)"; ctx.lineWidth = Math.max(0.5, scale * 0.012); ctx.stroke();
      }
      if (motif) {
        ctx.save();
        // re-trace clip path (current path is consumed by fill/stroke state)
        ctx.beginPath();
        ctx.moveTo(cx + scale * w0.x, cy + scale * w0.y);
        for (var j = 1; j < prototile.length; j++) { var wj = apply(M, prototile[j]); ctx.lineTo(cx + scale * wj.x, cy + scale * wj.y); }
        ctx.closePath(); ctx.clip();
        drawStrokes(ctx, iso.strokes, (function (MM) {
          return function (p) { var wp = apply(MM, p); return { x: cx + scale * wp.x, y: cy + scale * wp.y }; };
        })(M), scale);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  return {
    catalogue: catalogue, meta: meta, defaultIso: defaultIso, makeTiling: makeTiling,
    normalizeEdges: normalizeEdges, edgeLetters: edgeLetters,
    sampleEdge: sampleEdge, controlPair: controlPair, defaultCtrl: defaultCtrl,
    corners: corners, outline: outline, drawStrokes: drawStrokes,
    apply: apply, invert: invert, render: render
  };
})();
