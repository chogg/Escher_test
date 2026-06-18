/* geometry.js — shared math helpers (no dependencies) */
window.Escher = window.Escher || {};
Escher.geom = (function () {
  "use strict";

  // Catmull-Rom spline through `points` (endpoints included). Returns a denser,
  // smooth polyline. `samples` = subdivisions per segment.
  function catmullRom(points, samples) {
    samples = samples || 12;
    var n = points.length;
    if (n < 3) return points.slice();
    var P = [points[0]].concat(points, [points[n - 1]]);
    var out = [];
    for (var i = 1; i < P.length - 2; i++) {
      var p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      for (var s = 0; s < samples; s++) {
        var t = s / samples, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
              (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
              (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
        });
      }
    }
    out.push(points[n - 1]);
    return out;
  }

  // Circle through 3 points. Returns {x,y,r} or null if (nearly) colinear.
  function circle3(A, B, C) {
    var ax = A.x, ay = A.y, bx = B.x, by = B.y, cx = C.x, cy = C.y;
    var d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    var a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    var ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    var uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    return { x: ux, y: uy, r: Math.hypot(ax - ux, ay - uy) };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Linear-interpolated sample of an array of {x,y} at u in [0,1].
  function samplePolyline(pts, u) {
    if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };
    var f = clamp(u, 0, 1) * (pts.length - 1);
    var i = Math.floor(f), t = f - i;
    if (i >= pts.length - 1) return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
    return { x: lerp(pts[i].x, pts[i + 1].x, t), y: lerp(pts[i].y, pts[i + 1].y, t) };
  }

  // Mix two #rrggbb colours, t in [0,1].
  function mixHex(h1, h2, t) {
    var a = hexToRgb(h1), b = hexToRgb(h2);
    return rgbToHex(
      Math.round(lerp(a.r, b.r, t)),
      Math.round(lerp(a.g, b.g, t)),
      Math.round(lerp(a.b, b.b, t))
    );
  }
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // Tangent ("lever") offset at node i of an edge. If the node carries an
  // explicit `t` (set by dragging its lever) use it; otherwise fall back to the
  // uniform Catmull-Rom tangent (P[i+1]-P[i-1])/6, so untouched nodes keep the
  // smooth default shape. The cubic-Bezier control points around node i are
  // P[i] ± tangent.
  function edgeTangent(points, i) {
    var node = points[i];
    if (node.t) return node.t;
    var prev = points[i - 1] || node, next = points[i + 1] || node;
    return { x: (next.x - prev.x) / 6, y: (next.y - prev.y) / 6 };
  }

  // Sample an edge (array of nodes, possibly with per-node `t` tangents) as a
  // smooth cubic-Bezier polyline. With default tangents this equals Catmull-Rom.
  function edgeCurve(points, samples) {
    samples = samples || 16;
    var n = points.length;
    if (n < 2) return points.slice();
    var out = [{ x: points[0].x, y: points[0].y }];
    for (var i = 0; i < n - 1; i++) {
      var P0 = points[i], P3 = points[i + 1];
      var t0 = edgeTangent(points, i), t1 = edgeTangent(points, i + 1);
      var c1x = P0.x + t0.x, c1y = P0.y + t0.y;
      var c2x = P3.x - t1.x, c2y = P3.y - t1.y;
      for (var s = 1; s <= samples; s++) {
        var u = s / samples, v = 1 - u;
        var b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
        out.push({
          x: b0 * P0.x + b1 * c1x + b2 * c2x + b3 * P3.x,
          y: b0 * P0.y + b1 * c1y + b2 * c2y + b3 * P3.y
        });
      }
    }
    return out;
  }

  return {
    catmullRom: catmullRom,
    edgeTangent: edgeTangent,
    edgeCurve: edgeCurve,
    circle3: circle3,
    clamp: clamp,
    lerp: lerp,
    samplePolyline: samplePolyline,
    mixHex: mixHex,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex
  };
})();
