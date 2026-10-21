#!/usr/bin/env node
/**
 * Full-source audit command (PRD QG-11, §8): read-only inventory of every
 * blocker the fast profile finds across src/test/scripts, exception-manifest
 * validation, stale/expired entry detection, and candidates for tightening.
 *
 * Never rewrites or increases allowances, never regenerates a baseline
 * automatically (§8.6), and never blocks — it reports.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = require('./policy.cjs');
const { loadManifest } = await import('./check-exceptions.mjs');

process.stdout.write('quality audit: full-source read-only inventory (fast profile)\n');

// 1. Engine pass over the source tree.
const eslintBin = require.resolve('eslint/bin/eslint.js', { paths: [repoRoot] });
const run = spawnSync(
  process.execPath,
  [
    eslintBin,
    '--no-eslintrc',
    '--config',
    path.join(repoRoot, 'scripts', 'quality', 'eslint-fast.cjs'),
    '--format',
    'json',
    '--no-fix',
    '--ext',
    '.js,.jsx,.cjs,.mjs,.ts,.tsx,.vue',
    'src',
    'test',
    'scripts',
  ],
  { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
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

// 2. Tally blockers per (file, rule).
const findings = new Map(); // "path::rule" -> count
const complexityMax = new Map(); // "path" -> max observed complexity
let totalBlockers = 0;
for (const result of results) {
  const rel = path.relative(repoRoot, result.filePath).split(path.sep).join('/');
  for (const message of result.messages) {
    if (message.fatal || message.severity === 2) {
      totalBlockers += 1;
      const key = `${rel}::${message.ruleId || '(fatal)'}`;
      findings.set(key, (findings.get(key) || 0) + 1);
      if (message.ruleId === 'sonarjs/cognitive-complexity') {
        const m = /Cognitive Complexity from (\d+)/i.exec(message.message);
        const value = m ? Number(m[1]) : 0;
        complexityMax.set(rel, Math.max(complexityMax.get(rel) || 0, value));
      }
    }
  }
}

// 3. Manifest state: stale paths, expired entries, drift below allowances.
const { exceptions, errors } = loadManifest();
for (const e of errors) process.stderr.write(`manifest error: ${e}\n`);
const manifestPaths = new Set(exceptions.map((e) => e.path));
const stale = exceptions.filter((e) => !findings.has(`${e.path}::${e.ruleId}`));
const expired = exceptions.filter((e) => e.expired);

// 4. Report.
process.stdout.write(`\nBlockers (fast profile, full source): ${totalBlockers}\n`);
process.stdout.write(`Distinct (file, rule) pairs: ${findings.size}\n\n`);

const grouped = new Map();
for (const [key, count] of findings) {
  const [file, rule] = key.split('::');
  if (!grouped.has(rule)) grouped.set(rule, []);
  grouped.get(rule).push({ file, count });
}
for (const [rule, files] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
  process.stdout.write(`${rule}: ${files.length} file(s), ${files.reduce((n, f) => n + f.count, 0)} finding(s)\n`);
}

if (stale.length > 0) {
  process.stdout.write(`\nStale exception entries (finding gone — candidates for removal):\n`);
  for (const e of stale) process.stdout.write(`  - ${e.path} :: ${e.ruleId}\n`);
}
if (expired.length > 0) {
  process.stdout.write(`\nEXPIRED exception entries (block when their file is touched; remove or renew deliberately):\n`);
  for (const e of expired) process.stdout.write(`  - ${e.path} :: ${e.ruleId} (expired ${e.expiresOn})\n`);
}
for (const e of exceptions) {
  if (e.ruleId === 'sonarjs/cognitive-complexity' && complexityMax.has(e.path)) {
    const observed = complexityMax.get(e.path);
    if (observed > e.maxComplexity) {
      process.stdout.write(
        `\nCEILING EXCEEDED (would block when touched): ${e.path} observed ${observed} > allowed ${e.maxComplexity}\n`
      );
    }
  }
}

// 5. Machine-readable draft (NOT auto-applied — §8.6: new allowances are
// deliberate policy changes). Operators review and merge manually.
process.stdout.write(
  '\nDraft manifest entries for reviewed adoption (copy into scripts/quality/exceptions.json ONLY after review):\n'
);
process.stdout.write('[\n');
const draftEntries = [...findings.entries()]
  .filter(([key]) => {
    const [file, rule] = key.split('::');
    return !exceptions.some((e) => e.path === file && e.ruleId === rule);
  })
  .map(([key, count]) => {
    const [file, rule] = key.split('::');
    const entry = {
      path: file,
      ruleId: rule,
      maxCount: count,
      reason: 'REVIEW BEFORE ADOPTING: legacy baseline from quality audit',
      owner: 'maintainer',
      expiresOn: '2027-01-31',
    };
    if (rule === 'sonarjs/cognitive-complexity') {
      entry.maxComplexity = complexityMax.get(file) ?? 0;
    }
    return JSON.stringify(entry);
  });
process.stdout.write(draftEntries.map((e) => `  ${e}`).join(',\n'));
process.stdout.write('\n]\n');

process.stdout.write(
  `\nquality audit: done (read-only; nothing was rewritten, no baseline regenerated)\n`
);
process.exit(errors.length > 0 ? 2 : 0);
