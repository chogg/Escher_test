/* editor.js — the WYSIWYG fundamental-cell editor */
window.Escher = window.Escher || {};
Escher.Editor = (function () {
  "use strict";
  var G = Escher.geom;

  // Each editable edge has a linked "mirror" copy (the opposite edge) that moves
  // with it so tiles interlock: the top edge is mirrored downward (+y), the left
  // edge rightward (+x).
  var MIRROR = { topEdge: { x: 0, y: 1 }, leftEdge: { x: 1, y: 0 } };
  var MAX_NODES = 7;

  function Editor(canvas, design, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.design = design;
    this.onChange = onChange || function () {};
    this.pad = 56;
    this.size = canvas.width - this.pad * 2;
    this.tool = "edges";
    this.pen = { color: "#1c140c", size: 4, fill: false };
    this.editEdges = true;
    this.active = null;
    this.emphasis = null;   // {edge,i} highlighted handle/spline pair (hover or drag)
    this._bind();
    this.draw();
  }

  Editor.prototype.setTool = function (t) { this.tool = t; this.draw(); };
  Editor.prototype.setEditEdges = function (on) {
    this.editEdges = on;
    if (!on && this.tool === "edges") this.tool = "draw";
    this.emphasis = null;
    this.draw();
  };

  // ---- coordinate helpers ----
  Editor.prototype._evtPx = function (e) {
    var r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (this.canvas.width / r.width),
      y: (e.clientY - r.top) * (this.canvas.height / r.height)
    };
  };
  Editor.prototype.toPx = function (u) { return { x: this.pad + u.x * this.size, y: this.pad + u.y * this.size }; };
  Editor.prototype.toUnit = function (px) { return { x: (px.x - this.pad) / this.size, y: (px.y - this.pad) / this.size }; };

  // ---- handles: every interior control point appears on BOTH linked edges ----
  Editor.prototype._handles = function () {
    var d = this.design, list = [];
    ["topEdge", "leftEdge"].forEach(function (edge) {
      for (var i = 1; i < d[edge].length - 1; i++) {
        list.push({ edge: edge, i: i, off: { x: 0, y: 0 } });   // primary
        list.push({ edge: edge, i: i, off: MIRROR[edge] });     // linked mirror
      }
    });
    return list;
  };
  Editor.prototype._handlePos = function (h) {
    var p = this.design[h.edge][h.i];
    return { x: p.x + h.off.x, y: p.y + h.off.y };
  };
  Editor.prototype._hitHandle = function (px) {
    var hs = this._handles(), best = null, bd = 15 * 15;
    for (var k = 0; k < hs.length; k++) {
      var p = this.toPx(this._handlePos(hs[k]));
      var dd = (p.x - px.x) * (p.x - px.x) + (p.y - px.y) * (p.y - px.y);
      if (dd < bd) { bd = dd; best = hs[k]; }
    }
    return best;
  };

  // ---- edge node add / remove ----
  Editor.prototype.nodeCount = function () { return this.design.topEdge.length - 2; };
  function midInsert(arr) {
    var k = Math.floor((arr.length - 1) / 2), a = arr[k], b = arr[k + 1];
    arr.splice(k + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  Editor.prototype.addEdgeNode = function () {
    if (this.nodeCount() >= MAX_NODES) return false;
    midInsert(this.design.topEdge);
    midInsert(this.design.leftEdge);
    this.onChange(); this.draw();
    return true;
  };
  Editor.prototype.removeEdgeNode = function () {
    if (this.nodeCount() <= 1) return false;
    var t = this.design.topEdge, l = this.design.leftEdge;
    t.splice(Math.floor(t.length / 2), 1);
    l.splice(Math.floor(l.length / 2), 1);
    this.onChange(); this.draw();
    return true;
  };
  function segDist(p, a, b) {
    var vx = b.x - a.x, vy = b.y - a.y, wx = p.x - a.x, wy = p.y - a.y;
    var c2 = vx * vx + vy * vy, t = c2 ? G.clamp((vx * wx + vy * wy) / c2, 0, 1) : 0;
    var dx = p.x - (a.x + t * vx), dy = p.y - (a.y + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
  }
  // double-click on an edge inserts a node there (on whichever linked copy is nearest)
  Editor.prototype._insertAt = function (px) {
    if (this.nodeCount() >= MAX_NODES) return false;
    var u = this.toUnit(px), self = this;
    var bestEdge = null, bestOff = null, bestSeg = -1, bestD = 1e9;
    ["topEdge", "leftEdge"].forEach(function (edge) {
      [{ x: 0, y: 0 }, MIRROR[edge]].forEach(function (off) {
        var arr = self.design[edge];
        for (var k = 0; k < arr.length - 1; k++) {
          var a = { x: arr[k].x + off.x, y: arr[k].y + off.y };
          var b = { x: arr[k + 1].x + off.x, y: arr[k + 1].y + off.y };
          var dd = segDist(u, a, b);
          if (dd < bestD) { bestD = dd; bestEdge = edge; bestOff = off; bestSeg = k; }
        }
      });
    });
    if (bestEdge && bestD < 0.06) {
      this.design[bestEdge].splice(bestSeg + 1, 0, { x: u.x - bestOff.x, y: u.y - bestOff.y });
      this.emphasis = { edge: bestEdge, i: bestSeg + 1 };
      this.onChange(); this.draw();
      return true;
    }
    return false;
  };

  // ---- events ----
  Editor.prototype._bind = function () {
    var self = this;
    this.canvas.addEventListener("pointerdown", function (e) { self._down(e); });
    this.canvas.addEventListener("pointermove", function (e) { self._move(e); });
    window.addEventListener("pointerup", function (e) { self._up(e); });
    this.canvas.addEventListener("dblclick", function (e) {
      if (self.tool === "edges" && self.editEdges) { e.preventDefault(); self._insertAt(self._evtPx(e)); }
    });
  };

  Editor.prototype._down = function (e) {
    e.preventDefault();
    var px = this._evtPx(e);
    if (this.tool === "edges" && this.editEdges) {
      var h = this._hitHandle(px);
      if (h) {
        this.active = { type: "handle", h: h };
        this.emphasis = { edge: h.edge, i: h.i };
        this.canvas.setPointerCapture(e.pointerId);
        this.draw();
      }
      return;
    }
    var u = this.toUnit(px);
    u.x = G.clamp(u.x, -0.05, 1.05); u.y = G.clamp(u.y, -0.05, 1.05);
    this.active = { type: "stroke", stroke: { color: this.pen.color, width: this.pen.size, fill: this.tool === "blob", points: [u] } };
    this.design.strokes.push(this.active.stroke);
    this.canvas.setPointerCapture(e.pointerId);
    this.draw();
  };

  Editor.prototype._move = function (e) {
    var px = this._evtPx(e);
    if (!this.active) {
      if (this.tool === "edges" && this.editEdges) {
        var h = this._hitHandle(px);
        var em = h ? { edge: h.edge, i: h.i } : null;
        if (emphChanged(this.emphasis, em)) { this.emphasis = em; this.draw(); }
      }
      return;
    }
    if (this.active.type === "handle") {
      var hh = this.active.h, u = this.toUnit(px);
      // dragging either the primary or its linked mirror edits the same source point
      this.design[hh.edge][hh.i] = {
        x: G.clamp(u.x - hh.off.x, -0.45, 1.45),
        y: G.clamp(u.y - hh.off.y, -0.45, 1.45)
      };
      this.onChange(); this.draw();
    } else {
      var uu = this.toUnit(px);
      uu.x = G.clamp(uu.x, -0.05, 1.05); uu.y = G.clamp(uu.y, -0.05, 1.05);
      var pts = this.active.stroke.points, last = pts[pts.length - 1];
      if (Math.hypot(uu.x - last.x, uu.y - last.y) > 0.006) { pts.push(uu); this.onChange(); this.draw(); }
    }
  };
  function emphChanged(a, b) {
    if (!a && !b) return false;
    if (!a || !b) return true;
    return a.edge !== b.edge || a.i !== b.i;
  }

  Editor.prototype._up = function () {
    if (this.active && this.active.type === "stroke") this.onChange();
    this.active = null;
    this.draw();
  };

  // ---- rendering the editor view ----
  Editor.prototype.draw = function () {
    var ctx = this.ctx, d = this.design, W = this.canvas.width, H = this.canvas.height, s = this.size, pad = this.pad;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#11100e";
    ctx.fillRect(0, 0, W, H);

    // reference unit square
    ctx.strokeStyle = "rgba(169,158,137,.25)";
    ctx.setLineDash([4, 5]);
    ctx.strokeRect(pad, pad, s, s);
    ctx.setLineDash([]);

    // tile fill + outline
    var boundary = Escher.euclidean.tileBoundary(d);
    this._pathPts(boundary);
    ctx.fillStyle = d.colorA; ctx.fill();
    ctx.strokeStyle = "rgba(20,16,12,.7)"; ctx.lineWidth = 1.5; ctx.stroke();

    // decorations clipped to tile
    ctx.save();
    this._pathPts(boundary);
    ctx.clip();
    Escher.euclidean.drawStrokes(ctx, d, pad, pad, s);
    ctx.restore();

    if (this.editEdges) {
      var emph = this.emphasis;
      var topEmph = !!(emph && emph.edge === "topEdge");
      var leftEmph = !!(emph && emph.edge === "leftEdge");
      // both linked copies of each edge spline are always shown
      this._drawSpline("topEdge", { x: 0, y: 0 }, topEmph);
      this._drawSpline("topEdge", MIRROR.topEdge, topEmph);
      this._drawSpline("leftEdge", { x: 0, y: 0 }, leftEmph);
      this._drawSpline("leftEdge", MIRROR.leftEdge, leftEmph);
      if (emph) this._drawLinkConnector(emph);
      this._drawHandles();
    }

    // corner dots
    ctx.fillStyle = "rgba(216,160,75,.9)";
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }].forEach(function (c) {
      ctx.beginPath(); ctx.arc(pad + c.x * s, pad + c.y * s, 3, 0, 7); ctx.fill();
    });
  };

  Editor.prototype._pathPts = function (pts) {
    var ctx = this.ctx, p0 = this.toPx(pts[0]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (var i = 1; i < pts.length; i++) { var p = this.toPx(pts[i]); ctx.lineTo(p.x, p.y); }
    ctx.closePath();
  };

  Editor.prototype._drawSpline = function (edge, off, emph) {
    var ctx = this.ctx;
    var ctrl = this.design[edge].map(function (p) { return { x: p.x + off.x, y: p.y + off.y }; });
    var pts = G.catmullRom(ctrl, 12), p0 = this.toPx(pts[0]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (var i = 1; i < pts.length; i++) { var p = this.toPx(pts[i]); ctx.lineTo(p.x, p.y); }
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = emph ? "#f0c46a" : "rgba(127,176,182,.8)";
    ctx.lineWidth = emph ? 3.5 : 2;
    ctx.stroke();
  };

  Editor.prototype._drawLinkConnector = function (emph) {
    var ctx = this.ctx, src = this.design[emph.edge][emph.i], off = MIRROR[emph.edge];
    var a = this.toPx(src), b = this.toPx({ x: src.x + off.x, y: src.y + off.y });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = "rgba(240,196,106,.55)"; ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  };

  Editor.prototype._drawHandles = function () {
    var ctx = this.ctx, emph = this.emphasis, self = this;
    this._handles().forEach(function (h) {
      var p = self.toPx(self._handlePos(h));
      var isEmph = emph && emph.edge === h.edge && emph.i === h.i;
      var primary = h.off.x === 0 && h.off.y === 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isEmph ? 8.5 : 6.5, 0, 7);
      ctx.fillStyle = isEmph ? "#f0c46a" : (primary ? "#7fb0b6" : "#56858b");
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#11100e";
      ctx.stroke();
    });
  };

  return Editor;
})();
