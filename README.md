# Tessellatorium — an M.C. Escher-style drawing studio

A dependency-free, single-page web app for designing Escher-style art. You design
**one motif** in a WYSIWYG editor and view it through **three geometric "lenses"**:

| Style | What it does | Inspiration |
|-------|--------------|-------------|
| **Regular Tilings** | Deform a square tile's edges (opposite edges mirror, so tiles interlock) and tessellate the plane by translation (wallpaper group *p1*). | *Reptiles*, *Day and Night* |
| **Escher Tessellations** | Choose from all **81 isohedral tiling types** (via the vendored [TactileJS](https://github.com/isohedral/tactile-js)) — rotations and glide reflections included, so figures turn and flip like Escher's interlocking birds & fish. Drag each edge's control points and the motif repeats (and flips) across the tiling. | *Bird/Fish*, *Pegasus*, *Lizards* |
| **Reflecting Spheres** | Drops glossy mirror sphere(s) into your tiled world; each pixel reflects the surrounding pattern (orthographic mirror-ball reflection + Blinn specular). | *Hand with a Reflecting Sphere*, *Three Spheres II* |
| **Hyperbolic Planes** | Maps the motif onto a regular **{p, q}** tiling of the Poincaré disk; tiles shrink toward an infinite horizon. | the *Circle Limit* series |

The workflow has three steps, exactly as requested:

1. **Choose a style** — three illustrated cards (the thumbnails are live-rendered).
2. **Design** — a fundamental-cell editor on the left, a **live preview** in the chosen
   geometry on the right. Drag the blue handles to shape the tile; use the **Pen** /
   **Blob** tools to draw features; pick tile colours and style-specific options
   (tile density, sphere count/gloss, hyperbolic *p*/*q*).
3. **Render** — a full-resolution render with **Download PNG**.

## Run locally

It's pure static HTML/CSS/JS — no build step, no dependencies. Any static server works:

```bash
python3 -m http.server 8099
# then open http://localhost:8099/
```

(Opening `index.html` directly via `file://` also works, since scripts are classic
`<script>` tags, not ES modules.)

## Project layout

```
index.html            # 3-step UI shell
css/styles.css        # styling
js/geometry.js        # shared math (splines, circle-through-3-points, colour mixing)
js/euclidean.js       # interlocking p1 tessellation (also the sphere's environment)
js/vendor/tactile.js  # vendored TactileJS (BSD-3) — all 81 isohedral tiling types
js/isohedral.js       # "Escher Tessellations": Tactile-backed isohedral engine
js/sphere.js          # per-pixel reflecting mirror-ball(s)
js/hyperbolic.js      # {p,q} Poincaré-disk tiling via a reflection group
js/editor.js          # WYSIWYG fundamental-cell editor
js/app.js             # controller: steps, controls, live preview, final render
test/run.js           # headless verification harness (see below)
test/preview-svg.js   # exports faithful SVG previews of the vector styles
.github/workflows/pages.yml  # GitHub Pages deploy
```

## Testing / verification

The sandbox this was built in blocks browser-engine downloads, so a real Playwright
run wasn't possible. Instead, `test/run.js` loads the **actual** app scripts into a
Node VM backed by a **validating mock canvas that throws on any non-finite
coordinate** — catching the real risks (bad geometry, NaNs, exceptions, runaway
loops) across every renderer, the editor, and a full app boot.

```bash
node test/run.js          # 33 checks: geometry, all 3 renderers, editor, app boot
node test/preview-svg.js  # faithful SVGs (euclidean / hyperbolic / editor) -> test/previews/
node test/sphere-check.js # renders the mirror-ball reflection to PNG (equirect vs cube room)
node test/editor-check.js # renders the editor's linked-spline UI to PNG
node test/tactile-smoke.js    # every isohedral type tiles with finite geometry (23k assertions)
node test/isohedral-check.js  # the Tactile-backed engine across all 81 types
node test/isohedral-preview.js # rasterises sample tilings (incl. the bird/fish flip) to PNG
```

The sphere reflection uses a **cube-room** environment lookup (a mirror ball in a
tiled room) instead of an equirectangular wrap, which removes the unphysical
pole-pinch singularity — matching how a real chrome light-probe ball reflects a
room from a single viewpoint.

It exercises: Euclidean at densities 3–12; spheres ×1/2/3 + full-res; hyperbolic
across 8 different {p,q} (plus rejection of non-hyperbolic {p,q} and the cell-count
cap); editor handle-drag + stroke drawing + mode switching; and a full
`DOMContentLoaded` boot that drives each style through to a final render.

## Publishing (GitHub Pages)

The site is plain static files at the repo root, so it's publish-ready. Pages has to
be **enabled once** by a repo admin (the Actions token isn't allowed to enable it
automatically). Pick either option — both make the app live at:

```
https://chogg.github.io/Escher_test/
```

**Option A — Deploy from a branch (simplest, ~1 minute, no Actions):**
Settings → Pages → Build and deployment → Source: **Deploy from a branch** →
Branch: `claude/intelligent-cerf-wnjccl`, folder **`/ (root)`** → Save.

**Option B — GitHub Actions:**
Settings → Pages → Source: **GitHub Actions**, then either merge this branch to `main`
or run the included workflow manually (Actions tab → *Deploy to GitHub Pages* →
*Run workflow* → pick this branch). See `.github/workflows/pages.yml`.

### Cache-busting / "is the live site up to date?"

GitHub Pages caches assets (~10 min) and takes a short while to propagate, so a
fresh push may not show up immediately in the browser. To avoid stale JS/CSS,
asset URLs are **content-fingerprinted** (`js/app.js?v=<hash>`) — a file is
re-fetched exactly when it changes. A small footer shows the live **build
version**, so you can confirm at a glance what's deployed (and hard-refresh if it
lags). Run the stamper before deploying:

```bash
node tools/stamp.js   # updates the ?v= hashes + footer; commit the result
```

The Pages Actions workflow runs it automatically; for branch deploys, run it
before you push (or just hard-refresh — Cmd/Ctrl+Shift+R — if you see old code).

## The math, briefly

- **Interlocking tiles:** the tile's top and left edges are editable Catmull-Rom
  curves; the right and bottom edges are exact translates (`+1` in x / y). A tile and
  its neighbour therefore share an identical boundary curve, so bumps and dents lock
  together — the mechanism behind Escher's tessellated creatures.
- **Reflecting sphere:** for each pixel on the unit disk, the surface normal gives a
  reflected view ray; that ray is converted to longitude/latitude and samples an
  equirectangular environment built from your tiling. A Blinn-Phong term adds gloss.
- **Hyperbolic tiling:** the central regular *p*-gon has vertices at Euclidean radius
  `r0 = √(cos(π/p+π/q) / cos(π/p−π/q))`. Its edges are geodesics (circles orthogonal
  to the unit circle). Reflecting in those edge-circles generates the whole tiling
  group; tiles are found by breadth-first search over that group, and the motif is
  carried through each group element so it curves and shrinks correctly.
- **Isohedral tilings:** the *Escher Tessellations* style is built on **TactileJS**
  (Craig S. Kaplan), which represents the 81 usable isohedral tiling types and
  hands back a 3×3 transform per tile and per edge. Each edge is drawn as a cubic
  with the intrinsic **J/U/S/I** symmetry the type forces (J = free, S = 180°
  rotation, U = mirror, I = straight); the prototile is assembled from those edges
  and stamped across the plane. 35 of the 81 types use glide/mirror symmetry — the
  "alternating rows" that let birds and fish face opposite ways each row, which the
  translation-only *p1* engine cannot express.

### Vendored library / license

`js/vendor/tactile.js` is [TactileJS](https://github.com/isohedral/tactile-js) by
Craig S. Kaplan, redistributed under its **BSD-3-Clause** license (kept verbatim in
`js/vendor/tactile.LICENSE`). The only change from upstream is the final few lines:
its single ES-module `export` is adapted to a global `Tactile` object so the app can
load it with a classic `<script>` tag (no build step) and the Node test harness can
`require()` it.
