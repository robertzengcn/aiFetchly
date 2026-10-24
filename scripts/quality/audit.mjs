#!/usr/bin/env node
/**
 * Full-source audit command (PRD QG-11, §8; F11): read-only inventory of
 * every blocker the fast profile finds across ALL eligible tracked source
 * — any directory, including root tooling like forge.config.js and the
 * vite configs, not just src/test/scripts — under the shared approved
 * ignores. Reports exception-manifest state (stale with reason, expired,
 * tightening candidates including NONZERO count reductions and per-
 * function complexity easing), ceiling breaches, code defects that can
 * never carry allowances, and reviewable draft entries (never applied,
 * never regenerated automatically; §8.6).
 *
 * --json emits the versioned quality-gate-audit/1 document on stdout.
 * Never rewrites, never blocks.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { loadManifest, isOperationalDiagnostic } = await import('./check-exceptions.mjs');
const { checkArchitecture } = await import('./architecture-check.mjs');
const { buildAuditReport } = await import('./audit-core.mjs');
const { assertInsideRepo } = await import('./repo-boundary.cjs');
const policy = require('./policy.cjs');

const jsonMode = process.argv[2] === '--json';

// --- 1. Inventory: every tracked source file under the shared exclusions ---
const sourceExt = new Set(policy.sourceExtensions);
const ls = spawnSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (ls.error || ls.status !== 0) {
  process.stderr.write(`quality audit: git ls-files failed: ${ls.stderr}\n`);
  process.exit(2);
}
const inventory = [];
const inventorySet = new Set();
const boundaryErrors = []; // B05: source must physically live in the repo
for (const entry of ls.stdout.split('\0')) {
  if (entry.length === 0) continue;
  if (!sourceExt.has(path.posix.extname(entry))) continue;
  if (policy.approvedIgnorePatternFor(entry) !== null) continue;
  try {
    assertInsideRepo(repoRoot, path.join(repoRoot, entry), `audited source ${entry}`);
  } catch (e) {
    boundaryErrors.push(e.message);
    continue;
  }
  inventory.push(entry);
  inventorySet.add(entry);
}
if (boundaryErrors.length > 0 && jsonMode) {
  process.stdout.write(
    JSON.stringify({
      schema: 'quality-gate-audit/1',
      inventoryFiles: 0,
      manifestErrors: [],
      operationalErrors: boundaryErrors,
    }) + '\n'
  );
} else {
  for (const e of boundaryErrors) process.stderr.write(`quality audit: ${e}\n`);
}
if (boundaryErrors.length > 0) process.exit(2);

// --- 2. Engine pass over the explicit inventory (chunked, execPath-driven) ---
const CHUNK = 200;
const allFindings = [];
const eslintBin = path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
const skippedApproved = [];
const skippedByDefault = []; // ESLint's built-in dot-dir/node_modules ignoring
const unexpectedlySkipped = [];

/** ESLint's documented DEFAULT ignores: hidden directories and node_modules. */
function isDefaultIgnoredPath(rel) {
  return rel.split('/').some((seg) => seg === 'node_modules' || (seg.startsWith('.') && seg.length > 1));
}
for (let i = 0; i < inventory.length; i += CHUNK) {
  const requested = inventory.slice(i, i + CHUNK);
  const run = spawnSync(
    process.execPath,
    [
      eslintBin,
      '--no-eslintrc',
      '--config',
      path.join(repoRoot, 'scripts', 'quality', 'eslint-fast.cjs'),
      '--format', 'json',
      '--no-fix',
      // B06: file operands after the terminator can never be parsed as
      // options — a tracked '-bad.ts' must stay an operand.
      '--',
      ...requested,
    ],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: false }
  );
  if (run.error || (run.status !== 0 && run.status !== 1)) {
    process.stderr.write(`quality audit: engine failed (exit ${run.status})\n${run.stderr}\n`);
    process.exit(2);
  }
  let results;
  try {
    results = JSON.parse(run.stdout);
  } catch (e) {
    process.stderr.write(`quality audit: could not parse engine output: ${e.message}\n`);
    process.exit(2);
  }
  // B03: compare what was REQUESTED with what the engine actually reports —
  // a file silently excluded by an unexpected ignore is coverage the audit
  // claimed but never performed (same fail-closed rule as the runner).
  const reported = new Set();
  for (const result of results) {
    const rel = path.relative(repoRoot, result.filePath).split(path.sep).join('/');
    reported.add(rel);
    const ignoreStubs = result.messages.filter(
      (m) => m.ruleId === null && /File ignored/.test(m.message)
    );
    if (ignoreStubs.length > 0) {
      if (isDefaultIgnoredPath(rel)) skippedByDefault.push(rel);
      else {
        const pattern = policy.approvedIgnorePatternFor(rel);
        if (pattern !== null) skippedApproved.push({ rel, pattern });
        else unexpectedlySkipped.push(rel);
      }
    }
    for (const message of result.messages) {
      if (message.ruleId === null && /File ignored/.test(message.message)) continue;
      allFindings.push({
        path: rel,
        ruleId: message.ruleId ?? null,
        severity: message.severity,
        fatal: message.fatal === true,
        line: message.line,
        column: message.column,
        message: message.message,
      });
    }
  }
  for (const rel of requested) {
    if (reported.has(rel)) continue;
    if (isDefaultIgnoredPath(rel)) {
      skippedByDefault.push(rel); // ESLint's built-in default, not config drift
      continue;
    }
    const pattern = policy.approvedIgnorePatternFor(rel);
    if (pattern !== null) skippedApproved.push({ rel, pattern });
    else unexpectedlySkipped.push(rel);
  }
}

// --- 2b. Architecture direct-import pass (same findings the gate reports) ---
const archScope = inventory
  .filter((rel) => /(^|\/)src\/(childprocess|main-process\/communication)\//.test(rel))
  .map((rel) => path.join(repoRoot, rel));
for (const finding of checkArchitecture(archScope, repoRoot)) {
  allFindings.push({
    path: path.relative(repoRoot, finding.filePath).split(path.sep).join('/'),
    ruleId: finding.ruleId,
    severity: 2,
    fatal: finding.fatal === true,
    line: finding.line,
    column: finding.column,
    message: finding.message,
  });
}

// --- 3. Manifest state + report core ---
const { exceptions, errors } = loadManifest();
for (const e of errors) process.stderr.write(`manifest error: ${e}\n`);
const report = buildAuditReport(allFindings, { exceptions }, inventorySet);

// B03/B04: coverage gaps and infrastructure failures are OPERATIONAL — the
// audit exits 2 instead of claiming success over checks it never performed.
const operationalErrors = [
  ...boundaryErrors,
  ...unexpectedlySkipped.map((rel) => `audited file was excluded by an UNAPPROVED ignore instead of checked: ${rel}`),
  ...report.codeDefects
    .filter((d) => isOperationalDiagnostic(d))
    .map((d) => `configuration diagnostic: ${d.path}:${d.line ?? 0} ${d.message}`),
];

// --- 4. Output ---
if (jsonMode) {
  const document = {
    schema: 'quality-gate-audit/1',
    inventoryFiles: inventory.length,
    totalBlockers: report.totalBlockers,
    distinctPairs: report.distinctPairs,
    byRule: report.byRule,
    stale: report.stale,
    expired: report.expired,
    tightening: report.tightening,
    ceilingExceeded: report.ceilingExceeded,
    codeDefects: report.codeDefects,
    skippedApproved,
    skippedByDefault,
    draftEntries: report.draft,
    manifestErrors: errors,
    operationalErrors,
  };
  process.stdout.write(JSON.stringify(document) + '\n');
} else {
  process.stdout.write(
    `quality audit: full-source read-only inventory (fast profile, ${inventory.length} tracked file(s))\n`
  );
  process.stdout.write(`\nBlockers (fast profile, full source): ${report.totalBlockers}\n`);
  process.stdout.write(`Distinct (file, rule) pairs: ${report.distinctPairs}\n\n`);
  for (const { rule, files, findings: n } of report.byRule) {
    process.stdout.write(`${rule}: ${files} file(s), ${n} finding(s)\n`);
  }
  if (report.stale.length > 0) {
    process.stdout.write(`\nStale exception entries (candidates for removal):\n`);
    for (const s of report.stale) process.stdout.write(`  - ${s.path} (${s.reason})\n`);
  }
  if (report.expired.length > 0) {
    process.stdout.write(`\nEXPIRED exception entries (block when their file is touched):\n`);
    for (const e of report.expired) process.stdout.write(`  - ${e.path} :: ${e.ruleId} (expired ${e.expiresOn})\n`);
  }
  if (report.tightening.length > 0) {
    process.stdout.write(`\nTightening candidates (debt shrank — reduce the allowances deliberately):\n`);
    for (const t of report.tightening) process.stdout.write(`  - ${t.path} :: ${t.ruleId} [${t.kind}] ${t.detail}\n`);
  }
  if (report.ceilingExceeded.length > 0) {
    process.stdout.write(`\nCEILING EXCEEDED (would block when touched):\n`);
    for (const c of report.ceilingExceeded) process.stdout.write(`  - ${c.path} :: ${c.ruleId} — ${c.detail}\n`);
  }
  if (report.codeDefects.length > 0) {
    process.stdout.write(`\nCode defects (fatal/parse/unexceptable — fixes, NEVER allowances):\n`);
    for (const d of report.codeDefects.slice(0, 50)) {
      process.stdout.write(`  - ${d.path}:${d.line ?? 0}:${d.column ?? 0} ${d.message}\n`);
    }
    if (report.codeDefects.length > 50) {
      process.stdout.write(`  … ${report.codeDefects.length - 50} more (see --json)\n`);
    }
  }
  process.stdout.write(
    '\nDraft manifest entries for reviewed adoption (copy into scripts/quality/exceptions.json ONLY after review):\n'
  );
  process.stdout.write(JSON.stringify(report.draft, null, 2) + '\n');
  process.stdout.write(
    `\nquality audit: done (read-only; nothing was rewritten, no baseline regenerated)\n`
  );
}
if (!jsonMode && skippedByDefault.length > 0) {
  process.stdout.write(
    `\nSkipped by ESLint's built-in default ignores (hidden dirs / node_modules): ${skippedByDefault.length} file(s)\n`
  );
}
for (const e of operationalErrors) process.stderr.write(`quality audit: OPERATIONAL — ${e}\n`);
process.exit(errors.length > 0 || operationalErrors.length > 0 ? 2 : 0);
