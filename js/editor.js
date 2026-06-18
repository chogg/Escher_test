/* editor.js — the WYSIWYG fundamental-cell editor */
window.Escher = window.Escher || {};
Escher.Editor = (function () {
  "use strict";
  var G = Escher.geom;

  // Each editable edge has a linked "mirror" copy (the opposite edge) that moves
  // with it so tiles interlock: the top edge is mirrored downward (+y), the left
  // edge rightward (+x).
  var MIRROR = { topEdge: { x: 0, y: 1 }, leftEdge: { x: 1, y: 0 } };
  var MAX_NODES = 7;   // interior control points per edge

  function Editor(canvas, design, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.design = design;
    this.onChange = onChange || function () {};
    this.onModeChange = null;   // (mode|null) -> app updates buttons/hint/count
    this.onToast = null;        // (msg) -> app shows a toast
    this.pad = 56;
    this.size = canvas.width - this.pad * 2;
    this.tool = "edges";
    this.pen = { color: "#1c140c", size: 4, fill: false };
    this.editEdges = true;
    this.mode = "p1";           // 'p1' (square translate tile) | 'iso' (Tactile isohedral)
    this.active = null;
    this.selected = null;       // {edge,i} persistently selected node — its lever stays put
    this.hover = null;          // {edge,i} transiently hovered node
    this.isoSel = null;         // selected isohedral edge id (its handles stay put)
    this.isoHover = null;       // hovered isohedral edge id
    this._view = null;          // cached tile->canvas transform for iso mode
    this.pendingNode = null;    // 'add' | 'remove' | null : awaiting a placement click
    this._bind();
    this.draw();
  }

  // Switch between the simple p1 editor and the Tactile isohedral editor.
  Editor.prototype.setMode = function (mode) {
    this.mode = mode;
    this.editEdges = true;
    this.selected = this.hover = this.isoSel = this.isoHover = this.active = null;
    this.cancelPending();
    if (mode === "iso") { this.tool = "edges"; this._view = null; }
    this.draw();
  };

  Editor.prototype.setTool = function (t) {
    this.cancelPending();
    this.tool = t;
    this.hover = null;
    if (t !== "edges") this.selected = null;
    this.draw();
  };
  Editor.prototype.setEditEdges = function (on) {
    this.editEdges = on;
    if (!on && this.tool === "edges") this.tool = "draw";
    this.selected = null;
    this.hover = null;
    this.cancelPending();
    this.draw();
  };
  Editor.prototype._focus = function () { return this.selected || this.hover; };

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

  // The tile outline shown in the editor. In styles where the edge shape has no
  // effect on the render (hyperbolic — every cell is a {p,q} polygon), show a
  // plain unit square so the deformable shape isn't misleadingly displayed.
  Editor.prototype._tileBoundary = function () {
    return this.editEdges
      ? Escher.euclidean.tileBoundary(this.design)
      : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  };

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

  // ---- node placement (location chosen by the user's click) ----
  Editor.prototype.nodeCount = function () {
    return (this.design.topEdge.length - 2) + (this.design.leftEdge.length - 2);
  };
  function segProj(p, a, b) {
    var vx = b.x - a.x, vy = b.y - a.y, c2 = vx * vx + vy * vy;
    var t = c2 ? G.clamp((vx * (p.x - a.x) + vy * (p.y - a.y)) / c2, 0, 1) : 0;
    var qx = a.x + t * vx, qy = a.y + t * vy;
    return { d: Math.hypot(p.x - qx, p.y - qy), x: qx, y: qy };
  }
  // insert a node onto the nearest edge, AT the clicked position along that edge
  Editor.prototype._insertAt = function (px, requireNear) {
    var u = this.toUnit(px), self = this, best = null;
    ["topEdge", "leftEdge"].forEach(function (edge) {
      [{ x: 0, y: 0 }, MIRROR[edge]].forEach(function (off) {
        var arr = self.design[edge];
        for (var k = 0; k < arr.length - 1; k++) {
          var a = { x: arr[k].x + off.x, y: arr[k].y + off.y };
          var b = { x: arr[k + 1].x + off.x, y: arr[k + 1].y + off.y };
          var pr = segProj(u, a, b);
          if (!best || pr.d < best.d) best = { d: pr.d, edge: edge, off: off, seg: k, x: pr.x, y: pr.y };
        }
      });
    });
    if (!best) return false;
    if (requireNear && best.d > 0.06) return false;
    if (this.design[best.edge].length - 2 >= MAX_NODES) {
      if (this.onToast) this.onToast("That edge is at its maximum node count");
      return false;
    }
    this.design[best.edge].splice(best.seg + 1, 0, { x: best.x - best.off.x, y: best.y - best.off.y });
    this.selected = { edge: best.edge, i: best.seg + 1 };   // select the new node so its lever is ready
    this.onChange(); this.draw();
    return true;
  };
  // remove the interior node nearest the click
  Editor.prototype._removeNearest = function (px) {
    var u = this.toUnit(px), self = this, best = null;
    ["topEdge", "leftEdge"].forEach(function (edge) {
      [{ x: 0, y: 0 }, MIRROR[edge]].forEach(function (off) {
        var arr = self.design[edge];
        for (var i = 1; i < arr.length - 1; i++) {
          var d = Math.hypot(u.x - (arr[i].x + off.x), u.y - (arr[i].y + off.y));
          if (!best || d < best.d) best = { d: d, edge: edge, i: i };
        }
      });
    });
    if (!best) { if (this.onToast) this.onToast("No node to remove"); return false; }
    this.design[best.edge].splice(best.i, 1);
    this.selected = null;
    this.onChange(); this.draw();
    return true;
  };

  // arm / cancel the click-to-place modes
  Editor.prototype._setPending = function (m) {
    this.pendingNode = m;
    this.canvas.style.cursor = m === "add" ? "copy" : m === "remove" ? "crosshair" : "";
    if (this.onModeChange) this.onModeChange(m);
    this.draw();
  };
  Editor.prototype.armAddNode = function () { this._setPending(this.pendingNode === "add" ? null : "add"); };
  Editor.prototype.armRemoveNode = function () { this._setPending(this.pendingNode === "remove" ? null : "remove"); };
  Editor.prototype.cancelPending = function () { if (this.pendingNode) this._setPending(null); };

  // ---- events ----
  Editor.prototype._bind = function () {
    var self = this;
    this.canvas.addEventListener("pointerdown", function (e) { self._down(e); });
    this.canvas.addEventListener("pointermove", function (e) { self._move(e); });
    window.addEventListener("pointerup", function (e) { self._up(e); });
    this.canvas.addEventListener("dblclick", function (e) {
      if (self.tool === "edges" && self.editEdges && !self.pendingNode) { e.preventDefault(); self._insertAt(self._evtPx(e), true); }
    });
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && (self.selected || self.pendingNode)) { self.selected = null; self.cancelPending(); self.draw(); }
    });
  };

  Editor.prototype._down = function (e) {
    e.preventDefault();
    var px = this._evtPx(e);
    if (this.mode === "iso") return this._isoDown(px, e);
    // click-to-place node takes priority
    if (this.pendingNode && this.editEdges) {
      if (this.pendingNode === "add") this._insertAt(px, false);
      else this._removeNearest(px);
      this._setPending(null);
      return;
    }
    if (this.tool === "edges" && this.editEdges) {
      var lev = this._hitLever(px);    // tangent lever (only on the selected/hovered node)
      if (lev) {
        this.active = { type: "lever", edge: lev.edge, i: lev.i, off: lev.off };
        this.canvas.setPointerCapture(e.pointerId);
        this.draw();
        return;
      }
      var h = this._hitHandle(px);
      if (h) {
        this.selected = { edge: h.edge, i: h.i };   // persistent selection — lever stays after the mouse moves off
        this.active = { type: "handle", h: h };
        this.canvas.setPointerCapture(e.pointerId);
        this.draw();
      } else {
        this.selected = null;                        // click empty space to deselect
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
    if (this.mode === "iso") return this._isoMove(px, e);
    if (!this.active) {
      if (this.tool === "edges" && this.editEdges && !this.pendingNode) {
        var before = this._focus();
        var h = this._hitHandle(px);
        this.hover = h ? { edge: h.edge, i: h.i } : null;
        // a selected node keeps focus regardless of hover, so its lever never vanishes
        if (emphChanged(before, this._focus())) this.draw();
      }
      return;
    }
    if (this.active.type === "handle") {
      var hh = this.active.h, u = this.toUnit(px), node = this.design[hh.edge][hh.i];
      node.x = G.clamp(u.x - hh.off.x, -0.45, 1.45);   // mutate in place to keep the node's tangent (.t)
      node.y = G.clamp(u.y - hh.off.y, -0.45, 1.45);
      this.onChange(); this.draw();
    } else if (this.active.type === "lever") {
      var a = this.active, src = this.design[a.edge][a.i], lu = this.toUnit(px);
      var tx = lu.x - a.off.x - src.x, ty = lu.y - a.off.y - src.y;
      var len = Math.hypot(tx, ty) || 1e-6, L = G.clamp(len, 0.02, 0.7);
      src.t = { x: tx * L / len, y: ty * L / len };   // angle = gradient, length = curvature
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
    var refit = this.mode === "iso" && this.active && this.active.type === "isoHandle";
    this.active = null;
    if (refit) this._view = null;   // edge has settled — refit so a big bend can't stay clipped
    this.draw();
  };

  // ===================== ISOHEDRAL (Tactile) EDIT MODE =====================
  // tile-coord <-> canvas transform. Fit EVERYTHING that gets drawn — the tile
  // corners, the bent outline, AND the edge control-point handles (which sit off
  // the edge) — so nothing clips for long-edged types. Cached and invalidated on
  // edit so the tile doesn't rescale mid-drag.
  Editor.prototype._isoComputeView = function () {
    if (this._view) return this._view;
    var ISO = Escher.isohedral, iso = this.design.iso;
    var pts = ISO.corners(iso).concat(ISO.outline(iso, 12));
    var nz = ISO.normalizeEdges(iso), t = nz.tiling, letters = nz.letters, seen = {}, it = t.shape();
    for (var s = it.next(); !s.done; s = it.next()) {
      var si = s.value; if (seen[si.id]) continue; seen[si.id] = 1;
      var cp = ISO.controlPair(iso.edges[si.id].ctrl, letters[si.id]);
      if (cp) { pts.push(ISO.apply(si.T, cp[0])); if (letters[si.id] === "J") pts.push(ISO.apply(si.T, cp[1])); }
    }
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
      if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
    }
    var bw = (maxx - minx) || 1, bh = (maxy - miny) || 1, avail = this.canvas.width - this.pad * 2;
    var scale = Math.min(avail / bw, avail / bh);   // pad already leaves a hard margin for handle discs
    this._view = { scale: scale, ox: this.canvas.width / 2 - scale * (minx + maxx) / 2,
                   oy: this.canvas.height / 2 - scale * (miny + maxy) / 2 };
    return this._view;
  };
  Editor.prototype._isoToCanvas = function (p) { var v = this._view || this._isoComputeView(); return { x: v.ox + v.scale * p.x, y: v.oy + v.scale * p.y }; };
  Editor.prototype._isoToTile = function (px) { var v = this._view || this._isoComputeView(); return { x: (px.x - v.ox) / v.scale, y: (px.y - v.oy) / v.scale }; };

  // One representative placed instance per distinct edge shape (id) -> where its
  // control point handles live, in tile coords.
  Editor.prototype._isoEdges = function () {
    var ISO = Escher.isohedral, iso = this.design.iso, nz = ISO.normalizeEdges(iso);
    var t = nz.tiling, letters = nz.letters, seen = {}, list = [], it = t.shape();
    for (var s = it.next(); !s.done; s = it.next()) {
      var si = s.value;
      if (seen[si.id]) continue;
      seen[si.id] = 1;
      var L = letters[si.id], ctrl = iso.edges[si.id].ctrl, cp = ISO.controlPair(ctrl, L);
      var handles = [];
      if (cp) {
        handles.push({ k: 0, tile: ISO.apply(si.T, cp[0]) });               // first (free) control point
        if (L === "J") handles.push({ k: 1, tile: ISO.apply(si.T, cp[1]) }); // J has a second free point
      }
      list.push({ id: si.id, letter: L, T: si.T, v0: ISO.apply(si.T, { x: 0, y: 0 }), v1: ISO.apply(si.T, { x: 1, y: 0 }), handles: handles });
    }
    return list;
  };
  Editor.prototype._isoHitHandle = function (px) {
    var edges = this._isoEdges(), best = null, bd = 14 * 14;
    for (var i = 0; i < edges.length; i++) {
      for (var j = 0; j < edges[i].handles.length; j++) {
        var c = this._isoToCanvas(edges[i].handles[j].tile);
        var dd = (c.x - px.x) * (c.x - px.x) + (c.y - px.y) * (c.y - px.y);
        if (dd < bd) { bd = dd; best = { id: edges[i].id, k: edges[i].handles[j].k, letter: edges[i].letter, T: edges[i].T }; }
      }
    }
    return best;
  };

  Editor.prototype._isoDown = function (px, e) {
    this._isoComputeView();
    if (this.tool === "edges") {
      var h = this._isoHitHandle(px);
      if (h) {
        this.isoSel = h.id;
        this.active = { type: "isoHandle", id: h.id, k: h.k, letter: h.letter, T: h.T };
        if (e && this.canvas.setPointerCapture) this.canvas.setPointerCapture(e.pointerId);
      } else { this.isoSel = null; }
      this.draw();
      return;
    }
    // pen / blob: draw motif in tile coords
    var u = this._isoToTile(px);
    this.design.iso.strokes = this.design.iso.strokes || [];
    this.active = { type: "stroke", stroke: { color: this.pen.color, width: this.pen.size, fill: this.tool === "blob", points: [u] } };
    this.design.iso.strokes.push(this.active.stroke);
    if (e && this.canvas.setPointerCapture) this.canvas.setPointerCapture(e.pointerId);
    this.draw();
  };

  Editor.prototype._isoMove = function (px, e) {
    if (!this.active) {
      if (this.tool === "edges") {
        var h = this._isoHitHandle(px), id = h ? h.id : null;
        if (id !== this.isoHover) { this.isoHover = id; this.draw(); }
      }
      return;
    }
    if (this.active.type === "isoHandle") {
      var ISO = Escher.isohedral, a = this.active;
      var tile = this._isoToTile(px), canon = ISO.apply(ISO.invert(a.T), tile);     // back to (0,0)-(1,0) edge space
      canon.x = G.clamp(canon.x, 0.04, 0.96); canon.y = G.clamp(canon.y, -0.6, 0.6);
      var ed = this.design.iso.edges[a.id];
      ed.ctrl = ed.ctrl && ed.ctrl.length ? ed.ctrl.slice() : [{ x: 0.34, y: 0 }, { x: 0.66, y: 0 }];
      ed.ctrl[a.k] = canon;                                                          // partner derived at sample time for U/S
      this.onChange(); this.draw();
    } else if (this.active.type === "stroke") {
      var uu = this._isoToTile(px), pts = this.active.stroke.points, last = pts[pts.length - 1];
      if (Math.hypot(uu.x - last.x, uu.y - last.y) > 0.004) { pts.push(uu); this.onChange(); this.draw(); }
    }
  };

  Editor.prototype._isoDraw = function () {
    var ctx = this.ctx, d = this.design, W = this.canvas.width, H = this.canvas.height;
    var ISO = Escher.isohedral, iso = d.iso;
    this._isoComputeView();
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#11100e"; ctx.fillRect(0, 0, W, H);

    var self = this;
    function C(p) { return self._isoToCanvas(p); }

    // tile fill + outline
    var outline = ISO.outline(iso, 14), p0 = C(outline[0]);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
    for (var i = 1; i < outline.length; i++) { var p = C(outline[i]); ctx.lineTo(p.x, p.y); }
    ctx.closePath();
    ctx.fillStyle = d.colorA; ctx.fill();
    ctx.strokeStyle = "rgba(20,16,12,.75)"; ctx.lineWidth = 1.5; ctx.stroke();

    // motif clipped to tile
    if (iso.strokes && iso.strokes.length) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
      for (var j = 1; j < outline.length; j++) { var pj = C(outline[j]); ctx.lineTo(pj.x, pj.y); }
      ctx.closePath(); ctx.clip();
      ISO.drawStrokes(ctx, iso.strokes, function (q) { return C(q); }, this._view.scale);
      ctx.restore();
    }

    // edge control-point handles (Bezier-style)
    if (this.tool === "edges") {
      var edges = this._isoEdges();
      for (var k = 0; k < edges.length; k++) {
        var ed = edges[k], emph = (ed.id === this.isoSel) || (ed.id === this.isoHover);
        for (var m = 0; m < ed.handles.length; m++) {
          var anchor = (ed.handles[m].k === 0) ? ed.v0 : ed.v1;     // tie line to nearest vertex
          var a = C(anchor), hc = C(ed.handles[m].tile);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(hc.x, hc.y);
          ctx.strokeStyle = emph ? "rgba(240,196,106,.6)" : "rgba(240,224,186,.32)"; ctx.lineWidth = 1; ctx.stroke();
          if (ed.id === this.isoSel) { ctx.beginPath(); ctx.arc(hc.x, hc.y, 11, 0, 7); ctx.strokeStyle = "rgba(240,196,106,.7)"; ctx.lineWidth = 1.5; ctx.stroke(); }
          ctx.beginPath(); ctx.arc(hc.x, hc.y, emph ? 6.5 : 5, 0, 7);
          ctx.fillStyle = emph ? "#f0c46a" : "#7fb0b6"; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = "#11100e"; ctx.stroke();
        }
      }
    }
  };
  // ===================== end isohedral mode =====================

  // ---- rendering the editor view ----
  Editor.prototype.draw = function () {
    if (this.mode === "iso") return this._isoDraw();
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
    var boundary = this._tileBoundary();
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
      var focus = this._focus(), armed = !!this.pendingNode;
      var topEmph = armed || !!(focus && focus.edge === "topEdge");
      var leftEmph = armed || !!(focus && focus.edge === "leftEdge");
      this._drawSpline("topEdge", { x: 0, y: 0 }, topEmph);
      this._drawSpline("topEdge", MIRROR.topEdge, topEmph);
      this._drawSpline("leftEdge", { x: 0, y: 0 }, leftEmph);
      this._drawSpline("leftEdge", MIRROR.leftEdge, leftEmph);
      if (focus && !armed) this._drawLinkConnector(focus);
      this._drawHandles();
      if (focus && !armed) this._drawLever(focus);   // tangent lever, only on the focused node
    }

    // corner dots
    ctx.fillStyle = "rgba(216,160,75,.9)";
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }].forEach(function (c) {
      ctx.beginPath(); ctx.arc(pad + c.x * s, pad + c.y * s, 3, 0, 7); ctx.fill();
    });

    // armed banner
    if (this.pendingNode && this.editEdges) {
      ctx.fillStyle = "rgba(216,160,75,.95)";
      ctx.fillRect(0, 0, W, 26);
      ctx.fillStyle = "#1c140c";
      ctx.font = "13px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(this.pendingNode === "add" ? "Click on a tile edge to place a node there" : "Click a node to remove it", 12, 13);
    }
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
    var ctrl = this.design[edge].map(function (p) { return { x: p.x + off.x, y: p.y + off.y, t: p.t }; });
    var pts = G.edgeCurve(ctrl, 14), p0 = this.toPx(pts[0]);
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

  // ---- per-node tangent "levers" (Bezier handles) ----
  Editor.prototype._nodeTangent = function (edge, i) { return G.edgeTangent(this.design[edge], i); };
  Editor.prototype._leverOut = function (edge, i, off) {
    var src = this.design[edge][i], t = this._nodeTangent(edge, i);
    return this.toPx({ x: src.x + off.x + t.x, y: src.y + off.y + t.y });
  };
  Editor.prototype._hitLever = function (px) {
    var e = this._focus();
    if (!e || !this.editEdges) return null;
    var offs = [{ x: 0, y: 0 }, MIRROR[e.edge]];
    for (var k = 0; k < offs.length; k++) {
      var p = this._leverOut(e.edge, e.i, offs[k]);
      var dd = (p.x - px.x) * (p.x - px.x) + (p.y - px.y) * (p.y - px.y);
      if (dd < 11 * 11) return { edge: e.edge, i: e.i, off: offs[k] };
    }
    return null;
  };
  Editor.prototype._drawLever = function (emph) {
    var ctx = this.ctx, src = this.design[emph.edge][emph.i], t = this._nodeTangent(emph.edge, emph.i);
    var offs = [{ x: 0, y: 0 }, MIRROR[emph.edge]];
    for (var k = 0; k < offs.length; k++) {
      var off = offs[k];
      var inP = this.toPx({ x: src.x + off.x - t.x, y: src.y + off.y - t.y });
      var outP = this.toPx({ x: src.x + off.x + t.x, y: src.y + off.y + t.y });
      ctx.beginPath();                       // thin, faint tangent bar through the node
      ctx.moveTo(inP.x, inP.y); ctx.lineTo(outP.x, outP.y);
      ctx.strokeStyle = "rgba(240,224,186,.5)"; ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath(); ctx.arc(outP.x, outP.y, 3.4, 0, 7);   // draggable end
      ctx.fillStyle = "rgba(240,196,106,.9)"; ctx.fill();
      ctx.beginPath(); ctx.arc(inP.x, inP.y, 2.2, 0, 7);     // mirrored end (display only)
      ctx.fillStyle = "rgba(240,224,186,.45)"; ctx.fill();
    }
  };

  Editor.prototype._drawHandles = function () {
    var ctx = this.ctx, focus = this._focus(), sel = this.selected, self = this;
    this._handles().forEach(function (h) {
      var p = self.toPx(self._handlePos(h));
      var isFocus = focus && focus.edge === h.edge && focus.i === h.i;
      var isSel = sel && sel.edge === h.edge && sel.i === h.i;
      var primary = h.off.x === 0 && h.off.y === 0;
      if (isSel) {                                   // selection ring so it's clear the node stays active
        ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, 7);
        ctx.strokeStyle = "rgba(240,196,106,.7)"; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, isFocus ? 8.5 : 6.5, 0, 7);
      ctx.fillStyle = isFocus ? "#f0c46a" : (primary ? "#7fb0b6" : "#56858b");
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#11100e";
      ctx.stroke();
    });
  };

  return Editor;
})();
