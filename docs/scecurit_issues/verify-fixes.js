// Verify security dep fixes against docs/scecurit_issues/dependabot_alerts.json.
// Run from repo root: node docs/scecurit_issues/verify-fixes.js
//
// Handles the canonical GitHub export's concatenated-array format
// ([{...}][{...}]...). For each package, checks every resolved yarn.lock version
// against each advisory's vulnerable_version_range; any instance that satisfies a
// range = still vulnerable (RESIDUAL). This correctly handles cross-major ranges
// like "<=6.4.2" that cover multiple majors.
const fs = require("fs");
const path = require("path");

const alertsPath = path.join(__dirname, "dependabot_alerts.json");
const lockPath = path.join(__dirname, "..", "..", "yarn.lock");

function splitArrays(s) {
  const chunks = [];
  let start = 0;
  let inStr = false;
  let esc = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0 && c === "]" && s[i + 1] === "[") {
        chunks.push(s.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  chunks.push(s.slice(start));
  return chunks;
}

const raw = fs.readFileSync(alertsPath, "utf8");
const alerts = [];
for (const chunk of splitArrays(raw)) {
  const t = chunk.trim();
  if (!t) continue;
  try {
    const arr = JSON.parse(t);
    if (Array.isArray(arr)) alerts.push(...arr);
  } catch (e) {
    console.error("chunk parse fail:", e.message);
  }
}

const lock = fs.readFileSync(lockPath, "utf8");

function versionsOf(pkg) {
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    '^(?:")?' + esc + '@[^:]*:\\n  version "([^"]+)"',
    "gm"
  );
  const out = new Set();
  let m;
  while ((m = re.exec(lock))) out.add(m[1]);
  return [...out];
}

// Parse a version into comparable numeric tuples (drop prerelease for simplicity).
function parseVer(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m
    ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
    : null;
}
function cmpVer(a, b) {
  const pa = parseVer(a);
  const pb = parseVer(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}
// Evaluate a vulnerable_version_range, e.g. "<= 1.3.3", ">= 5.0.0, < 5.1.8",
// ">= 7.0.0-alpha.0, < 8.18.0". Comparators are comma-separated; ALL must hold.
function inRange(version, range) {
  const comps = range
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (comps.length === 0) return false;
  for (const comp of comps) {
    const m = comp.match(/^(>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,2})/);
    if (!m) continue;
    const op = m[1] || "=";
    const bound = m[2];
    const c = cmpVer(version, bound);
    if (op === ">=" && !(c >= 0)) return false;
    if (op === "<=" && !(c <= 0)) return false;
    if (op === ">" && !(c > 0)) return false;
    if (op === "<" && !(c < 0)) return false;
    if (op === "=" && !(c === 0)) return false;
  }
  return true;
}

const pkgOf = (a) =>
  a.security_vulnerability?.package?.name || a.dependency?.package?.name;
const fixOf = (a) =>
  a.security_vulnerability?.first_patched_version?.identifier;
const rangeOf = (a) => a.security_vulnerability?.vulnerable_version_range;

const open = alerts.filter((a) => a.state === "open");
const byPkg = {};
for (const a of open) {
  const pkg = pkgOf(a);
  if (!pkg) continue;
  const manifest = a.dependency?.manifest_path || "";
  if (/skills\//.test(manifest)) continue; // skill libs, not the app
  if (pkg === "mermaid" || pkg === "@excalidraw/excalidraw") continue;
  (byPkg[pkg] = byPkg[pkg] || []).push(a);
}

const fixed = [];
const residual = [];
for (const [pkg, list] of Object.entries(byPkg)) {
  const ranges = [...new Set(list.map(rangeOf).filter(Boolean))];
  const fixTargets = [...new Set(list.map(fixOf).filter(Boolean))];
  const vers = versionsOf(pkg);
  if (vers.length === 0) {
    residual.push({
      pkg,
      reason: "not in lockfile",
      alerts: list.length,
      fixTargets,
    });
    continue;
  }
  // Vulnerable instances = versions satisfying any advisory range.
  const vulnInstances = vers.filter((v) => ranges.some((r) => inRange(v, r)));
  if (vulnInstances.length > 0) {
    residual.push({ pkg, vulnInstances, fixTargets, alerts: list.length });
  } else {
    fixed.push(pkg);
  }
}

console.log(
  `Source: ${alerts.length} alerts parsed (${open.length} open, app-only).`
);
console.log(`\n=== FIXED (${fixed.length} packages) ===`);
console.log(fixed.sort().join(", "));
console.log(`\n=== RESIDUAL (${residual.length} packages) ===`);
for (const r of residual.sort((a, b) => b.alerts - a.alerts)) {
  console.log(
    `  ${r.pkg}  vuln=[${(r.vulnInstances || []).join(",")}]  fix=[${(
      r.fixTargets || []
    ).join(",")}]  alerts=${r.alerts}` + (r.reason ? `  (${r.reason})` : "")
  );
}
