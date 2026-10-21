#!/usr/bin/env node
/**
 * Fast ESLint runner for the quality gate (tech design §7.D).
 *
 * Invoked by lint-staged with the staged filenames appended as arguments —
 * consumed as an ARRAY, never shell-split (AC-07). Checks the COMPLETE staged
 * file contents lint-staged exposes (its backup/hidden-partial-staging
 * machinery guarantees the working-tree files at this moment ARE the staged
 * versions, AC-04/05). No fixes, ever (QG-08).
 *
 * Exit codes (tech design §10): 0 pass, 1 policy violations,
 * 2 operational/configuration failure. Warnings are reported but nonblocking.
 */

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const startNs = process.hrtime.bigint();

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = require('./policy.cjs');
const { applyExceptions } = await import('./check-exceptions.mjs');

const OPERATIONAL_FAILURE = 2;
const POLICY_VIOLATION = 1;

function failOperational(message, hint) {
  process.stderr.write(`quality: OPERATIONAL FAILURE — ${message}\n`);
  if (hint) process.stderr.write(`  ${hint}\n`);
  process.exit(OPERATIONAL_FAILURE);
}

const files = process.argv.slice(2).filter((a) => a !== '--json');
if (files.length === 0) {
  process.stdout.write('quality: no files to check\n');
  process.exit(0);
}

// Resolve every selected path inside the repository; reject symlink escape
// (tech design §11) before the engine starts. path.resolve collapses `..`,
// so an escaped traversal cannot masquerade as an in-repo path.
for (const file of files) {
  const abs = path.resolve(repoRoot, file);
  if (!abs.startsWith(repoRoot + path.sep)) {
    failOperational(
      `selected path escapes the repository boundary: ${file}`,
      'This is a policy/configuration failure, not accepted debt.'
    );
  }
}

const eslint = new ESLint({
  cwd: repoRoot,
  useEslintrc: false,
  overrideConfigFile: path.join(repoRoot, 'scripts', 'quality', 'eslint-fast.cjs'),
  resolvePluginsRelativeTo: repoRoot,
  fix: false,
  // No cache: staged-snapshot correctness cannot depend on cache invalidation.
});

let results;
try {
  results = await eslint.lintFiles(files);
} catch (error) {
  // Missing plugin, malformed config, parser bootstrap errors — NEVER a pass
  // (QG-12). Individual file parse errors arrive as fatal messages instead
  // and are handled as blockers below.
  failOperational(
    `ESLint engine failed: ${error && error.message ? error.message : String(error)}`,
    'Run `yarn quality:doctor` to diagnose installation/config problems.'
  );
}

// Detect eligible files that were excluded by ignore rules (AC-17): ESLint
// either omits the result or returns a severity-1 "File ignored" stub —
// neither may masquerade as a checked file. Fail with the reason.
const resultFiles = new Set(results.map((r) => path.resolve(repoRoot, r.filePath)));
const ignored = files.filter((f) => !resultFiles.has(path.resolve(repoRoot, f)));
const ignoredStubs = [];
for (const r of results) {
  if (r.messages.some((m) => m.ruleId === null && /File ignored/.test(m.message))) {
    ignoredStubs.push(path.relative(repoRoot, r.filePath));
  }
  r.messages = r.messages.filter(
    (m) => !(m.ruleId === null && /File ignored/.test(m.message))
  );
}
if (ignored.length > 0 || ignoredStubs.length > 0) {
  failOperational(
    `selected file(s) were excluded by ignore rules instead of checked:\n` +
      [...ignored, ...ignoredStubs].map((f) => `  - ${f}`).join('\n') +
      `\n(approved ignore patterns live in scripts/quality/policy.cjs)`,
    'Hidden dot-directories and ignore patterns exclude files silently. Move the file, or adjust the approved ignore list deliberately.'
  );
}

// Architecture direct-import checks (dedicated AST pass, §8): merged into
// the results before exception application so legacy allowances work the
// same for aifetchly/* findings.
const { checkArchitecture } = await import('./architecture-check.mjs');
const archFindings = checkArchitecture(
  files.map((f) => path.resolve(repoRoot, f)),
  repoRoot
);
for (const finding of archFindings) {
  const existing = results.find(
    (r) => path.resolve(repoRoot, r.filePath) === finding.filePath
  );
  if (existing) {
    existing.messages.push({
      ruleId: finding.ruleId,
      severity: 2,
      message: finding.message,
      line: finding.line,
      column: finding.column,
    });
  } else {
    results.push({
      filePath: finding.filePath,
      messages: [
        {
          ruleId: finding.ruleId,
          severity: 2,
          message: finding.message,
          line: finding.line,
          column: finding.column,
        },
      ],
    });
  }
}

// Apply reviewed legacy exceptions (§9) before deciding the exit status.
const exceptionOutcome = applyExceptions(results);
if (exceptionOutcome.errors.length > 0) {
  for (const e of exceptionOutcome.errors) {
    process.stderr.write(`quality: exception manifest error — ${e}\n`);
  }
  failOperational(
    'exception manifest validation failed',
    'Fix scripts/quality/exceptions.json. Parser and operational failures can never be excepted.'
  );
}

let blockers = 0;
let warnings = 0;
for (const result of exceptionOutcome.results) {
  for (const message of result.messages) {
    if (message.fatal || message.severity === 2) {
      blockers += 1;
      const rel = path.relative(repoRoot, result.filePath);
      process.stdout.write(
        `${rel}:${message.line}:${message.column} error ${message.ruleId || '(fatal)'}\n` +
          `  ${message.message}\n`
      );
    } else if (message.severity === 1) {
      warnings += 1;
    }
  }
}

const elapsedMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
process.stdout.write(
  `quality: checked ${results.length} file(s) in ${elapsedMs}ms; ` +
    `${blockers} blocker(s); ${warnings} warning(s)` +
    (exceptionOutcome.acceptedDebt > 0
      ? `; ${exceptionOutcome.acceptedDebt} accepted legacy finding(s)`
      : '') +
    '\n'
);

if (blockers > 0) {
  process.stdout.write(
    'Commit blocked. Fix the finding(s), stage the correction, and retry.\n' +
      'Deep checks were not run. Use `yarn quality:deep` for typed validation.\n'
  );
  process.exit(POLICY_VIOLATION);
}
process.exit(0);
