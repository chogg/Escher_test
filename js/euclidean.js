/* euclidean.js — interlocking translation tessellation (Escher "reptile" style) */
window.Escher = window.Escher || {};
Escher.euclidean = (function () {
  "use strict";
  var G = Escher.geom;

  // Build the closed tile outline in unit-cell coordinates from the design's
  // editable top & left edges. Opposite edges are exact translations, so the
  // tile interlocks with its neighbours under integer translation (group p1).
  function tileBoundary(design) {
    var top = G.edgeCurve(design.topEdge, 14);    // (0,0) -> (1,0)
    var left = G.edgeCurve(design.leftEdge, 14);   // (0,0) -> (0,1)
    var right = left.map(function (p) { return { x: p.x + 1, y: p.y }; });  // (1,0)->(1,1)
    var bottom = top.map(function (p) { return { x: p.x, y: p.y + 1 }; });  // (0,1)->(1,1)

    var b = [];
    function push(arr, skipFirst) {
      for (var i = skipFirst ? 1 : 0; i < arr.length; i++) b.push(arr[i]);
    }
    push(top, false);                       // along top:    (0,0) -> (1,0)
    push(right, true);                      // along right:  (1,0) -> (1,1)
    push(bottom.slice().reverse(), true);   // along bottom: (1,1) -> (0,1)
    push(left.slice().reverse(), true);     // along left:   (0,1) -> (0,0)
    return b;
  }

  function pathFromPoints(ctx, pts, ox, oy, s) {
    ctx.beginPath();
    ctx.moveTo(ox + pts[0].x * s, oy + pts[0].y * s);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(ox + pts[i].x * s, oy + pts[i].y * s);
    ctx.closePath();
  }

  // Draw the motif strokes for one cell, in unit-cell coords scaled by s and
  // offset by (ox,oy). Assumes the caller has already clipped to the tile.
  function drawStrokes(ctx, design, ox, oy, s) {
    for (var k = 0; k < design.strokes.length; k++) {
      var st = design.strokes[k];
      if (!st.points || st.points.length < 2) {
        // a single dot
        if (st.points && st.points.length === 1) {
          ctx.fillStyle = st.color;
          ctx.beginPath();
          ctx.arc(ox + st.points[0].x * s, oy + st.points[0].y * s, Math.max(1, st.width * s / 100), 0, 7);
          ctx.fill();
        }
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(ox + st.points[0].x * s, oy + st.points[0].y * s);
      for (var i = 1; i < st.points.length; i++) ctx.lineTo(ox + st.points[i].x * s, oy + st.points[i].y * s);
      if (st.fill) {
        ctx.closePath();
        ctx.fillStyle = st.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = st.color;
        ctx.lineWidth = Math.max(0.6, st.width * s / 100);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
  }

  // Main render. opts: {density, offsetX, offsetY, outline}
  function render(ctx, W, H, design, opts) {
    opts = opts || {};
    var density = opts.density || (design.euclid && design.euclid.density) || 6;
    var s = W / density;                       // tile size in px
    var boundary = tileBoundary(design);
    var outline = opts.outline !== undefined ? opts.outline : design.outline;

    ctx.save();
    ctx.fillStyle = design.colorBg;
    ctx.fillRect(0, 0, W, H);

    var offX = opts.offsetX || 0, offY = opts.offsetY || 0;
    var i0 = Math.floor(-offX / s) - 1, i1 = Math.ceil((W - offX) / s) + 1;
    var j0 = Math.floor(-offY / s) - 1, j1 = Math.ceil((H - offY) / s) + 1;

    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) {
        var ox = offX + i * s, oy = offY + j * s;
        pathFromPoints(ctx, boundary, ox, oy, s);
        ctx.fillStyle = ((i + j) & 1) ? design.colorB : design.colorA;
        ctx.fill();
        if (outline) {
          ctx.strokeStyle = "rgba(20,16,12,.7)";
          ctx.lineWidth = Math.max(0.5, s * 0.012);
          ctx.stroke();
        }
        if (design.strokes.length) {
          ctx.save();
          pathFromPoints(ctx, boundary, ox, oy, s);
          ctx.clip();
          drawStrokes(ctx, design, ox, oy, s);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  return { tileBoundary: tileBoundary, render: render, drawStrokes: drawStrokes };
})();
