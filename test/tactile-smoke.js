/* tactile-smoke.js — prove the vendored TactileJS library works headless.
 *
 * Constructs every one of the 81 isohedral tiling types, perturbs its
 * parameters, builds J/U/S/I-symmetric edge shapes, fills a region, and
 * assembles a full tile outline from the per-edge transforms — asserting that
 * every number produced is finite. This is the de-risking gate for adopting
 * tactile.js as Tessellatorium's tiling engine.
 *
 *     node test/tactile-smoke.js
 */
"use strict";
const T = require("../js/vendor/tactile.js");
const { EdgeShape, tilingTypes, IsohedralTiling, mul } = T;

let fail = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fail++; console.error("  FAIL: " + msg); } }
const fin = (n) => Number.isFinite(n);
const finPt = (p) => p && fin(p.x) && fin(p.y);

// Build the two interior Bezier control points for one edge shape, honouring
// the intrinsic J/U/S/I symmetry (exactly as the upstream minimal demo does).
function edgeFor(shp) {
  if (shp === EdgeShape.I) return [];
  if (shp === EdgeShape.J) return [{ x: 0.2, y: 0.1 }, { x: 0.7, y: -0.15 }];
  if (shp === EdgeShape.S) { const a = { x: 0.25, y: 0.12 }; return [a, { x: 1 - a.x, y: -a.y }]; }
  if (shp === EdgeShape.U) { const a = { x: 0.25, y: 0.12 }; return [a, { x: 1 - a.x, y: a.y }]; }
  return [];
}

ok(Array.isArray(tilingTypes) && tilingTypes.length === 81, "tilingTypes has 81 entries");
ok(typeof T.numTypes === "number" && T.numTypes === 81, "numTypes === 81");

let totalTiles = 0;
for (const tp of tilingTypes) {
  let til;
  try { til = new IsohedralTiling(tp); }
  catch (e) { ok(false, "construct type " + tp + ": " + e.message); continue; }

  // Parameters round-trip and perturb cleanly.
  const np = til.numParameters();
  const ps = til.getParameters();
  ok(ps.length === np, "type " + tp + " param count matches");
  for (let i = 0; i < ps.length; i++) ok(fin(ps[i]), "type " + tp + " param " + i + " finite");
  for (let i = 0; i < ps.length; i++) ps[i] += 0.03;
  til.setParameters(ps);

  // Build an edge shape per distinct edge.
  const nes = til.numEdgeShapes();
  ok(nes >= 1, "type " + tp + " has >=1 edge shape");
  const edges = [];
  for (let i = 0; i < nes; i++) edges.push(edgeFor(til.getEdgeShape(i)));

  // The prototile outline (shape iterator) must assemble to finite points.
  let parts = 0;
  for (const si of til.shape()) {
    parts++;
    ok(si.T.length === 6 && si.T.every(fin), "type " + tp + " shape T finite");
    const S = si.T;
    ok(finPt(mul(S, { x: 0, y: 0 })) && finPt(mul(S, { x: 1, y: 0 })), "type " + tp + " edge endpoints finite");
    if (si.shape !== EdgeShape.I) {
      const ej = edges[si.id];
      ok(finPt(mul(S, ej[0])) && finPt(mul(S, ej[1])), "type " + tp + " edge ctrl pts finite");
    }
  }
  ok(parts >= 3, "type " + tp + " outline has >=3 edges (got " + parts + ")");

  // Fill a region and assemble a few real tiles end to end.
  let tiles = 0, assembled = 0;
  for (const inst of til.fillRegionBounds(-2, -2, 6, 6)) {
    tiles++;
    ok(inst.T.length === 6 && inst.T.every(fin), "type " + tp + " tile T finite");
    const col = til.getColour(inst.t1, inst.t2, inst.aspect);
    ok(col === 0 || col === 1 || col === 2, "type " + tp + " colour in {0,1,2}");
    if (assembled < 3) {
      assembled++;
      for (const si of til.shape()) {
        const M = mul(inst.T, si.T);
        ok(finPt(mul(M, { x: 0, y: 0 })), "type " + tp + " assembled vertex finite");
      }
    }
  }
  ok(tiles > 0, "type " + tp + " fills >0 tiles (got " + tiles + ")");
  totalTiles += tiles;
}

console.log((fail ? "✗" : "✓") + " tactile smoke: " + (checks - fail) + "/" + checks +
  " checks across " + tilingTypes.length + " types, " + totalTiles + " tiles assembled");
process.exit(fail ? 1 : 0);
