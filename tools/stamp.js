/* stamp.js — content-fingerprint the CSS/JS asset URLs in index.html and write a
 * visible build version. Run before deploying (no build tooling required):
 *
 *     node tools/stamp.js
 *
 * Each asset gets `?v=<hash>` where <hash> is derived from the file's contents,
 * so browsers re-fetch a file exactly when it changes (standard cache-busting).
 * The footer #build-version shows a combined hash + UTC build time for an
 * at-a-glance check that the live site is up to date. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const indexPath = path.join(root, "index.html");
let html = fs.readFileSync(indexPath, "utf8");

const assets = [
  "css/styles.css",
  "js/vendor/tactile.js",
  "js/geometry.js", "js/euclidean.js", "js/isohedral.js", "js/sphere.js",
  "js/hyperbolic.js", "js/editor.js", "js/app.js"
];

function hashOf(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex").slice(0, 8);
}

const combined = crypto.createHash("sha256");
assets.forEach(function (a) {
  var ver = hashOf(a);
  combined.update(ver);
  var esc = a.replace(/[.\/]/g, "\\$&");
  var re = new RegExp('((?:href|src)=")' + esc + '(?:\\?v=[a-f0-9]+)?(")', "g");
  if (!re.test(html)) { console.warn("warning: asset not referenced in index.html: " + a); return; }
  html = html.replace(new RegExp('((?:href|src)=")' + esc + '(?:\\?v=[a-f0-9]+)?(")', "g"), "$1" + a + "?v=" + ver + "$2");
});

var build = combined.digest("hex").slice(0, 8);
var when = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
var label = "build " + build + " &middot; " + when;
if (!/id="build-version"/.test(html)) {
  console.error("error: no element with id=\"build-version\" found in index.html");
  process.exit(1);
}
html = html.replace(/(<[^>]*id="build-version"[^>]*>)[\s\S]*?(<\/)/, "$1" + label + "$2");

fs.writeFileSync(indexPath, html);
console.log("stamped " + build + " (" + when + ")");
