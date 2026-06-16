/* app.js — application controller: steps, controls, preview, render */
(function () {
  "use strict";
  var E = window.Escher;
  var G = E.geom;

  // ---------- default design ----------
  function circlePoly(cx, cy, r, n, squash) {
    var pts = [];
    squash = squash || 1;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * squash });
    }
    pts.push(pts[0]);
    return pts;
  }
  function defaultDesign() {
    return {
      style: "euclidean",
      topEdge: [{ x: 0, y: 0 }, { x: 0.33, y: -0.16 }, { x: 0.66, y: 0.16 }, { x: 1, y: 0 }],
      leftEdge: [{ x: 0, y: 0 }, { x: -0.16, y: 0.33 }, { x: 0.16, y: 0.66 }, { x: 0, y: 1 }],
      strokes: [
        { color: "#1c140c", width: 5, fill: false,
          points: [{ x: 0.30, y: 0.62 }, { x: 0.42, y: 0.70 }, { x: 0.58, y: 0.70 }, { x: 0.70, y: 0.60 }] },
        { color: "#1c140c", width: 4, fill: true, points: circlePoly(0.40, 0.42, 0.055, 14) },
        { color: "#1c140c", width: 4, fill: true, points: circlePoly(0.62, 0.42, 0.055, 14) },
        { color: "#f3ead6", width: 4, fill: true, points: circlePoly(0.405, 0.43, 0.022, 10) },
        { color: "#f3ead6", width: 4, fill: true, points: circlePoly(0.625, 0.43, 0.022, 10) }
      ],
      colorA: "#d8743b",
      colorB: "#2f6f7a",
      colorBg: "#f3ead6",
      outline: true,
      euclid: { density: 6 },
      hyper: { p: 6, q: 4, maxCells: 340 },
      sphere: { count: 1, density: 7, shininess: 0.55 }
    };
  }

  var design = defaultDesign();
  var editor = null;

  // ---------- element refs ----------
  var $ = function (id) { return document.getElementById(id); };
  var screens = { style: $("step-style"), design: $("step-design"), render: $("step-render") };
  var previewCanvas = $("preview-canvas");
  var previewCtx = previewCanvas.getContext("2d");
  var renderCanvas = $("render-canvas");
  var renderCtx = renderCanvas.getContext("2d");

  var STYLE_META = {
    euclidean: { name: "Regular tiling", preview: "plane tessellation", cell: "fundamental cell" },
    sphere: { name: "Reflecting sphere", preview: "mirror sphere", cell: "world tile" },
    hyperbolic: { name: "Hyperbolic plane", preview: "Poincare disk", cell: "motif (maps into each tile)" }
  };

  // ---------- dispatch render ----------
  function renderDesign(ctx, W, H, d, quality) {
    ctx.clearRect(0, 0, W, H);
    if (d.style === "euclidean") {
      E.euclidean.render(ctx, W, H, d, {});
    } else if (d.style === "sphere") {
      E.sphere.render(ctx, W, H, d, { envRes: quality === "final" ? 768 : 360 });
    } else {
      E.hyperbolic.render(ctx, W, H, d, {
        maxCells: quality === "final" ? d.hyper.maxCells : Math.min(200, d.hyper.maxCells)
      });
    }
  }

  // ---------- live preview (debounced) ----------
  var previewPending = false;
  function schedulePreview() {
    if (previewPending) return;
    previewPending = true;
    requestAnimationFrame(function () {
      previewPending = false;
      try {
        renderDesign(previewCtx, previewCanvas.width, previewCanvas.height, design, "preview");
      } catch (err) { console.error("preview error", err); }
    });
  }

  // ---------- step navigation ----------
  function show(step) {
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle("active", k === step); });
    var order = ["style", "design", "render"];
    var idx = order.indexOf(step);
    document.querySelectorAll("#step-indicator li").forEach(function (li) {
      var s = li.getAttribute("data-step");
      var i = order.indexOf(s);
      li.classList.toggle("active", s === step);
      li.classList.toggle("done", i < idx);
    });
  }

  // ---------- toast ----------
  var toastEl = $("toast"), toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }

  // ---------- style-specific controls ----------
  function buildStyleControls() {
    var host = $("style-controls");
    host.innerHTML = "";
    var label = document.createElement("span");
    label.className = "toolgroup-label";
    label.textContent = STYLE_META[design.style].name + " options";
    host.appendChild(label);

    if (design.style === "euclidean") {
      host.appendChild(sliderRow("Tile density", 3, 12, design.euclid.density, 1, function (v) {
        design.euclid.density = v; schedulePreview();
      }));
    } else if (design.style === "sphere") {
      host.appendChild(selectRow("Spheres", [["1", 1], ["2", 2], ["3", 3]], design.sphere.count, function (v) {
        design.sphere.count = +v; schedulePreview();
      }));
      host.appendChild(sliderRow("World density", 4, 12, design.sphere.density, 1, function (v) {
        design.sphere.density = v; schedulePreview();
      }));
      host.appendChild(sliderRow("Gloss", 0, 100, Math.round(design.sphere.shininess * 100), 1, function (v) {
        design.sphere.shininess = v / 100; schedulePreview();
      }));
    } else {
      var pRow = selectRow("Sides p", optsRange(3, 8), design.hyper.p, function (v) { setPQ(+v, design.hyper.q); });
      var qRow = selectRow("Meeting q", optsRange(3, 10), design.hyper.q, function (v) { setPQ(design.hyper.p, +v); });
      host.appendChild(pRow); host.appendChild(qRow);
      var info = document.createElement("div");
      info.className = "panel-hint"; info.id = "schlafli-info";
      host.appendChild(info);
      host.appendChild(sliderRow("Tiles", 80, 600, design.hyper.maxCells, 20, function (v) {
        design.hyper.maxCells = v; schedulePreview();
      }));
      updateSchlafli();
    }
  }
  function setPQ(p, q) {
    if (!E.hyperbolic.valid(p, q)) {
      toast("{" + p + "," + q + "} isn't hyperbolic — need (p-2)(q-2) > 4");
      buildStyleControls();   // revert selects
      return;
    }
    design.hyper.p = p; design.hyper.q = q;
    updateSchlafli();
    schedulePreview();
  }
  function updateSchlafli() {
    var info = $("schlafli-info");
    if (info) info.innerHTML = "Schl&auml;fli {" + design.hyper.p + "," + design.hyper.q + "} &mdash; " +
      design.hyper.q + " " + design.hyper.p + "-gons meet at every vertex.";
  }
  function optsRange(a, b) { var o = []; for (var i = a; i <= b; i++) o.push([String(i), i]); return o; }

  function sliderRow(label, min, max, val, step, onInput) {
    var wrap = document.createElement("label");
    wrap.className = "slider-row";
    wrap.appendChild(document.createTextNode(label + " "));
    var inp = document.createElement("input");
    inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
    inp.addEventListener("input", function () { onInput(+inp.value); });
    wrap.appendChild(inp);
    return wrap;
  }
  function selectRow(label, options, val, onChange) {
    var wrap = document.createElement("label");
    wrap.className = "select-row";
    wrap.appendChild(document.createTextNode(label + " "));
    var sel = document.createElement("select");
    options.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o[1]; op.textContent = o[0];
      if (o[1] === val) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener("change", function () { onChange(sel.value); });
    wrap.appendChild(sel);
    return wrap;
  }

  // ---------- ink palette ----------
  var INKS = ["#1c140c", "#f3ead6", "#d8743b", "#2f6f7a", "#9c2b2b", "#3a5a40", "#e6b84f", "#5b3a8c"];
  function buildSwatches() {
    var host = $("ink-swatches");
    host.innerHTML = "";
    INKS.forEach(function (c, i) {
      var b = document.createElement("button");
      b.className = "swatch" + (i === 0 ? " active" : "");
      b.style.background = c;
      b.addEventListener("click", function () {
        editor.pen.color = c;
        host.querySelectorAll(".swatch").forEach(function (s) { s.classList.remove("active"); });
        b.classList.add("active");
      });
      host.appendChild(b);
    });
  }

  // ---------- enter design step for a style ----------
  function enterDesign(style) {
    design.style = style;
    show("design");
    $("preview-label").textContent = STYLE_META[style].preview;
    $("cell-label").textContent = STYLE_META[style].cell;

    if (!editor) {
      editor = new E.Editor($("editor-canvas"), design, function () { schedulePreview(); });
      editor.onModeChange = function (mode) {
        $("node-plus").classList.toggle("active", mode === "add");
        $("node-minus").classList.toggle("active", mode === "remove");
        $("editor-hint").textContent = mode === "add"
          ? "Click on a tile edge to place a node at that spot."
          : mode === "remove"
            ? "Click a node to remove it."
            : baseEditorHint();
        updateNodeCount();
      };
      editor.onToast = toast;
    }
    var edgesOn = style !== "hyperbolic";
    editor.setEditEdges(edgesOn);
    // toggle edges tool button visibility
    var edgesBtn = document.querySelector('.tool-btn[data-tool="edges"]');
    edgesBtn.style.display = edgesOn ? "" : "none";
    if (!edgesOn) selectTool("draw"); else selectTool("edges");

    editor.cancelPending();
    $("editor-hint").textContent = baseEditorHint();
    $("edge-node-row").style.display = edgesOn ? "" : "none";
    updateNodeCount();
    buildStyleControls();
    editor.draw();
    schedulePreview();
  }

  function baseEditorHint() {
    return design.style !== "hyperbolic"
      ? "Drag the handles to shape the tile (opposite edges are linked). Hover or select a node to reveal its curve lever — angle sets the slope, length the curvature. 'Add node' then click an edge to add detail; Pen/Blob draw features."
      : "Draw your motif with the pen or blob — it maps into every {p,q} tile (the tile is a fixed quadrilateral here).";
  }

  function updateNodeCount() {
    var el = $("node-count");
    if (el && editor) el.textContent = editor.nodeCount();
  }

  function selectTool(tool) {
    if (!editor) return;
    editor.setTool(tool);
    document.querySelectorAll("#tool-buttons .tool-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tool") === tool);
    });
  }

  // ---------- final render ----------
  function doRender() {
    show("render");
    $("render-title").textContent = STYLE_META[design.style].name;
    toast("Rendering…");
    setTimeout(function () {
      try {
        renderDesign(renderCtx, renderCanvas.width, renderCanvas.height, design, "final");
      } catch (err) {
        console.error(err);
        toast("Render error — see console");
      }
    }, 30);
  }

  // ---------- wire up ----------
  function wire() {
    // style cards
    document.querySelectorAll(".style-card").forEach(function (card) {
      card.addEventListener("click", function () { enterDesign(card.getAttribute("data-style")); });
    });
    // tool buttons
    document.querySelectorAll("#tool-buttons .tool-btn").forEach(function (b) {
      b.addEventListener("click", function () { selectTool(b.getAttribute("data-tool")); });
    });
    // pen size
    $("pen-size").addEventListener("input", function () { if (editor) editor.pen.size = +this.value; });
    // colors
    $("colorA").addEventListener("input", function () { design.colorA = this.value; editor.draw(); schedulePreview(); });
    $("colorB").addEventListener("input", function () { design.colorB = this.value; schedulePreview(); });
    $("colorBg").addEventListener("input", function () { design.colorBg = this.value; editor.draw(); schedulePreview(); });
    $("outline-toggle").addEventListener("change", function () { design.outline = this.checked; editor.draw(); schedulePreview(); });
    // strokes
    $("undo-btn").addEventListener("click", function () {
      design.strokes.pop(); editor.draw(); schedulePreview();
    });
    $("clear-btn").addEventListener("click", function () {
      design.strokes = []; editor.draw(); schedulePreview(); toast("Ink cleared");
    });
    $("reset-tile-btn").addEventListener("click", function () {
      if (editor) editor.cancelPending();
      design.topEdge = [{ x: 0, y: 0 }, { x: 0.33, y: 0 }, { x: 0.66, y: 0 }, { x: 1, y: 0 }];
      design.leftEdge = [{ x: 0, y: 0 }, { x: 0, y: 0.33 }, { x: 0, y: 0.66 }, { x: 0, y: 1 }];
      editor.draw(); updateNodeCount(); schedulePreview(); toast("Tile reset to a square");
    });
    $("node-plus").addEventListener("click", function () { if (editor) editor.armAddNode(); });
    $("node-minus").addEventListener("click", function () { if (editor) editor.armRemoveNode(); });
    // nav
    $("back-to-style").addEventListener("click", function () { show("style"); });
    $("to-render").addEventListener("click", doRender);
    $("back-to-design").addEventListener("click", function () { show("design"); });
    $("rerender-btn").addEventListener("click", doRender);
    $("restart-btn").addEventListener("click", function () { show("style"); });
    $("download-btn").addEventListener("click", function () {
      try {
        var a = document.createElement("a");
        a.download = "tessellatorium-" + design.style + ".png";
        a.href = renderCanvas.toDataURL("image/png");
        a.click();
        toast("PNG downloaded");
      } catch (err) { toast("Download failed"); }
    });

    buildSwatches();
  }

  // ---------- style-card thumbnails ----------
  function drawThumbnails() {
    document.querySelectorAll("[data-thumb]").forEach(function (cv) {
      var d = defaultDesign();
      d.style = cv.getAttribute("data-thumb");
      d.outline = true;
      var ctx = cv.getContext("2d");
      try {
        if (d.style === "euclidean") { d.euclid.density = 4; E.euclidean.render(ctx, cv.width, cv.height, d, {}); }
        else if (d.style === "sphere") { d.sphere.density = 5; E.sphere.render(ctx, cv.width, cv.height, d, { envRes: 256 }); }
        else { d.hyper = { p: 6, q: 4, maxCells: 160 }; E.hyperbolic.render(ctx, cv.width, cv.height, d, { maxCells: 160 }); }
      } catch (err) { console.error("thumb", d.style, err); }
    });
  }

  // ---------- boot ----------
  window.addEventListener("DOMContentLoaded", function () {
    wire();
    drawThumbnails();
    // expose for tests / debugging
    window.__escher = { design: design, renderDesign: renderDesign, enterDesign: enterDesign, doRender: doRender };
  });
})();
