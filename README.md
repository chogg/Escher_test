# Tessellatorium — an M.C. Escher-style drawing studio

A dependency-free, single-page web app for designing Escher-style art. You design
**one motif** in a WYSIWYG editor and view it through **three geometric "lenses"**:

| Style | What it does | Inspiration |
|-------|--------------|-------------|
| **Regular Tilings** | Deform a square tile's edges (opposite edges mirror, so tiles interlock) and tessellate the plane by translation (wallpaper group *p1*). | *Reptiles*, *Day and Night* |
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
node test/run.js          # 28 checks: geometry, all 3 renderers, editor, app boot
node test/preview-svg.js  # writes faithful SVGs to test/previews/
```

It exercises: Euclidean at densities 3–12; spheres ×1/2/3 + full-res; hyperbolic
across 8 different {p,q} (plus rejection of non-hyperbolic {p,q} and the cell-count
cap); editor handle-drag + stroke drawing + mode switching; and a full
`DOMContentLoaded` boot that drives each style through to a final render.

## Publishing (GitHub Pages)

This repo includes a Pages workflow (`.github/workflows/pages.yml`). When Actions has
Pages permission it self-enables and deploys on every push, serving at:

```
https://chogg.github.io/Escher_test/
```

If the workflow's deploy step is blocked by branch/environment protection (common when
deploying from a non-default branch), enable Pages manually in one step:
**Settings → Pages → Build and deployment → Source: "Deploy from a branch" →**
pick this branch and `/ (root)`. The site is plain static files at the repo root, so
that's all it needs.

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
