/* editor.js — the WYSIWYG fundamental-cell editor */
window.Escher = window.Escher || {};
Escher.Editor = (function () {
  "use strict";
  var G = Escher.geom;

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
    this.active = null;     // current handle drag or stroke
    this._bind();
    this.draw();
  }

  Editor.prototype.setTool = function (t) {
    this.tool = t;
    this.draw();
  };
  Editor.prototype.setEditEdges = function (on) {
    this.editEdges = on;
    if (!on && this.tool === "edges") this.tool = "draw";
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
  Editor.prototype.toPx = function (u) {
    return { x: this.pad + u.x * this.size, y: this.pad + u.y * this.size };
  };
  Editor.prototype.toUnit = function (px) {
    return { x: (px.x - this.pad) / this.size, y: (px.y - this.pad) / this.size };
  };

  // ---- handle hit testing (interior points of top & left edges) ----
  Editor.prototype._handles = function () {
    var d = this.design, list = [];
    for (var i = 1; i < d.topEdge.length - 1; i++) list.push({ edge: "topEdge", i: i });
    for (var j = 1; j < d.leftEdge.length - 1; j++) list.push({ edge: "leftEdge", i: j });
    return list;
  };
  Editor.prototype._hitHandle = function (px) {
    var hs = this._handles(), best = null, bd = 16 * 16;
    for (var k = 0; k < hs.length; k++) {
      var p = this.toPx(this.design[hs[k].edge][hs[k].i]);
      var dd = (p.x - px.x) * (p.x - px.x) + (p.y - px.y) * (p.y - px.y);
      if (dd < bd) { bd = dd; best = hs[k]; }
    }
    return best;
  };

  // ---- events ----
  Editor.prototype._bind = function () {
    var self = this;
    this.canvas.addEventListener("pointerdown", function (e) { self._down(e); });
    this.canvas.addEventListener("pointermove", function (e) { self._move(e); });
    window.addEventListener("pointerup", function (e) { self._up(e); });
  };

  Editor.prototype._down = function (e) {
    e.preventDefault();
    var px = this._evtPx(e);
    if (this.tool === "edges" && this.editEdges) {
      var h = this._hitHandle(px);
      if (h) { this.active = { type: "handle", h: h }; this.canvas.setPointerCapture(e.pointerId); }
      return;
    }
    // drawing
    var u = this.toUnit(px);
    u.x = G.clamp(u.x, -0.05, 1.05); u.y = G.clamp(u.y, -0.05, 1.05);
    this.active = {
      type: "stroke",
      stroke: { color: this.pen.color, width: this.pen.size, fill: this.tool === "blob", points: [u] }
    };
    this.design.strokes.push(this.active.stroke);
    this.canvas.setPointerCapture(e.pointerId);
    this.draw();
  };

  Editor.prototype._move = function (e) {
    if (!this.active) {
      // hover cursor feedback
      return;
    }
    var px = this._evtPx(e);
    if (this.active.type === "handle") {
      var u = this.toUnit(px);
      var h = this.active.h;
      // keep handles from crossing the cell corners too far
      u.x = G.clamp(u.x, -0.45, 1.45);
      u.y = G.clamp(u.y, -0.45, 1.45);
      // top-edge handles slide in x but bow in y; left-edge handles slide in y, bow in x
      this.design[h.edge][h.i] = u;
      this.onChange();
      this.draw();
    } else if (this.active.type === "stroke") {
      var uu = this.toUnit(px);
      uu.x = G.clamp(uu.x, -0.05, 1.05); uu.y = G.clamp(uu.y, -0.05, 1.05);
      var pts = this.active.stroke.points;
      var last = pts[pts.length - 1];
      if (Math.hypot(uu.x - last.x, uu.y - last.y) > 0.006) {
        pts.push(uu);
        this.onChange();
        this.draw();
      }
    }
  };

  Editor.prototype._up = function () {
    if (this.active && this.active.type === "stroke") {
      var s = this.active.stroke;
      if (s.points.length < 2 && !s.fill) {
        // keep single dots as tiny marks; nothing to do
      }
      this.onChange();
    }
    this.active = null;
  };

  // ---- rendering the editor view ----
  Editor.prototype.draw = function () {
    var ctx = this.ctx, d = this.design;
    var W = this.canvas.width, H = this.canvas.height, s = this.size, pad = this.pad;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#11100e";
    ctx.fillRect(0, 0, W, H);

    // reference unit square
    ctx.strokeStyle = "rgba(169,158,137,.25)";
    ctx.setLineDash([4, 5]);
    ctx.strokeRect(pad, pad, s, s);
    ctx.setLineDash([]);

    // the tile itself
    var boundary = Escher.euclidean.tileBoundary(d);
    ctx.beginPath();
    var b0 = this.toPx(boundary[0]);
    ctx.moveTo(b0.x, b0.y);
    for (var i = 1; i < boundary.length; i++) {
      var bp = this.toPx(boundary[i]);
      ctx.lineTo(bp.x, bp.y);
    }
    ctx.closePath();
    ctx.fillStyle = d.colorA;
    ctx.fill();
    ctx.strokeStyle = "rgba(20,16,12,.7)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // decorations (clipped to tile)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(b0.x, b0.y);
    for (var c = 1; c < boundary.length; c++) {
      var cp = this.toPx(boundary[c]);
      ctx.lineTo(cp.x, cp.y);
    }
    ctx.closePath();
    ctx.clip();
    Escher.euclidean.drawStrokes(ctx, d, pad, pad, s);
    ctx.restore();

    // edge handles
    if (this.editEdges) {
      this._drawHandles("topEdge");
      this._drawHandles("leftEdge");
      // hint arrows on mirrored edges
      ctx.fillStyle = "rgba(127,176,182,.9)";
      ctx.font = "11px sans-serif";
    }

    // corner dots
    ctx.fillStyle = "rgba(216,160,75,.9)";
    var corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
    for (var k = 0; k < corners.length; k++) {
      var cc = this.toPx(corners[k]);
      ctx.beginPath(); ctx.arc(cc.x, cc.y, 3, 0, 7); ctx.fill();
    }
  };

  Editor.prototype._drawHandles = function (edge) {
    var ctx = this.ctx, d = this.design;
    for (var i = 1; i < d[edge].length - 1; i++) {
      var p = this.toPx(d[edge][i]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, 7);
      ctx.fillStyle = "#7fb0b6";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#11100e";
      ctx.stroke();
    }
  };

  return Editor;
})();
