// Verify security dep fixes against docs/scecurit_issues/dependabot_alerts.json.
// Run from repo root: node docs/scecurit_issues/verify-fixes.js
// Reports packages whose every resolved yarn.lock version is >= the advisory fix
// (FIXED) vs packages with at least one instance still below the fix (RESIDUAL).
const fs = require("fs");
const path = require("path");

const alertsPath = path.join(__dirname, "dependabot_alerts.json");
const lockPath = path.join(__dirname, "..", "..", "yarn.lock");
const alerts = JSON.parse(fs.readFileSync(alertsPath, "utf8"));
const lock = fs.readFileSync(lockPath, "utf8");

function versionsOf(pkg) {
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp('^(?:")?' + esc + "@[^:]*:\\n  version \"([^\"]+)\"", "gm");
  const out = new Set();
  let m;
  while ((m = re.exec(lock))) out.add(m[1]);
  return [...out];
}
function cmp(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

const byPkg = {};
for (const a of alerts) {
  // Skip skill-library manifests (.claude/skills, .agents/skills) — not the app.
  if (a.manifest && /skills\//.test(a.manifest)) continue;
  if (a.package === "mermaid" || a.package === "@excalidraw/excalidraw") continue;
  (byPkg[a.package] = byPkg[a.package] || []).push(a);
}

const fixed = [];
const residual = [];
for (const [pkg, list] of Object.entries(byPkg)) {
  const fixTargets = [...new Set(list.map((a) => a.fixed_in).filter(Boolean))];
  const vers = versionsOf(pkg);
  if (vers.length === 0) {
    residual.push({ pkg, reason: "not in lockfile", alerts: list.length });
    continue;
  }
  const stillVuln = vers.some((v) => {
    const maj = parseInt(v.split(".")[0], 10);
    const majFix = fixTargets
      .filter((f) => parseInt(f.split(".")[0], 10) === maj)
      .sort(cmp);
    if (majFix.length === 0) return false;
    return cmp(v, majFix[majFix.length - 1]) < 0;
  });
  if (stillVuln) residual.push({ pkg, vers, fixTargets, alerts: list.length });
  else fixed.push(pkg);
}

console.log(`=== FIXED (${fixed.length} packages) ===`);
console.log(fixed.sort().join(", "));
console.log(`\n=== RESIDUAL (${residual.length} packages) ===`);
for (const r of residual.sort((a, b) => b.alerts - a.alerts)) {
  console.log(
    `  ${r.pkg}  vers=[${(r.vers || []).join(",")}]  fix=[${(r.fixTargets || []).join(",")}]  alerts=${r.alerts}  reason=${r.reason || "instance below fix"}`
  );
}
