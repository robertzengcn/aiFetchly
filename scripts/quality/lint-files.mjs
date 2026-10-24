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
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const startNs = process.hrtime.bigint();

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = require('./policy.cjs');
const { assertInsideRepo } = require('./repo-boundary.cjs');
const { applyExceptions, isOperationalDiagnostic } = await import('./check-exceptions.mjs');

const OPERATIONAL_FAILURE = 2;
const POLICY_VIOLATION = 1;

// BUG-16: --json is a FLAG only when it is the FIRST argument; a file
// literally named --json stays in the list (checked below, never silently
// dropped to a vacuous pass).
const jsonMode = process.argv[2] === '--json';
// F10: distinguish staged coordinator execution from direct working-tree
// invocation — the coordinator exports QUALITY_GATE_CONTEXT through
// lint-staged; direct runs (doctor, CI, humans) do not.
const runMode = process.env.QUALITY_GATE_CONTEXT === 'lint-staged' ? 'staged-fast' : 'working-tree-fast';

/**
 * F10: operational failures still produce the versioned JSON document on
 * stdout in --json mode (with operationalErrors populated) so machine
 * consumers always get parseable output; human diagnostics go to stderr.
 */
function failOperational(message, hint) {
  if (jsonMode) {
    const document = {
      schema: 'quality-gate/1',
      mode: runMode,
      filesChecked: 0,
      filesSkippedApproved: 0,
      elapsedMs: Number((process.hrtime.bigint() - startNs) / 1_000_000n),
      blockers: [],
      blockerCount: 0,
      warnings: [],
      warningCount: 0,
      acceptedDebt: 0,
      acceptedDebtFindings: [],
      operationalErrors: [message],
    };
    process.stdout.write(JSON.stringify(document) + '\n');
    process.stderr.write(`quality: OPERATIONAL FAILURE — ${message}\n`);
    if (hint) process.stderr.write(`  ${hint}\n`);
  } else {
    process.stderr.write(`quality: OPERATIONAL FAILURE — ${message}\n`);
    if (hint) process.stderr.write(`  ${hint}\n`);
  }
  process.exit(OPERATIONAL_FAILURE);
}

const files = jsonMode ? process.argv.slice(3) : process.argv.slice(2);
if (files.length === 0) {
  if (jsonMode) {
    // B12: JSON consumers must always receive the versioned document — a
    // human string with exit 0 is unparseable success.
    process.stdout.write(
      JSON.stringify({
        schema: 'quality-gate/1',
        mode: runMode,
        filesChecked: 0,
        filesSkippedApproved: 0,
        elapsedMs: Number((process.hrtime.bigint() - startNs) / 1_000_000n),
        blockers: [],
        blockerCount: 0,
        warnings: [],
        warningCount: 0,
        acceptedDebt: 0,
        acceptedDebtFindings: [],
        operationalErrors: [],
      }) + '\n'
    );
  } else {
    process.stdout.write('quality: no files to check\n');
  }
  process.exit(0);
}

// Resolve every selected path inside the repository; reject symlink escape
// (tech design §11) before the engine starts. Shared boundary helper (F08)
// — the same lexical + realpath validation the fix command and the
// manifest loader use, so the checks cannot drift apart again.
// B09: a gitlink (mode 160000 — submodule) can carry a source-like suffix
// and arrive here via lint-staged's own enumeration; it is not a file and
// is skipped with a report rather than treated as missing source.
const checkable = [];
for (const file of files) {
  const rel = path.relative(repoRoot, path.resolve(repoRoot, file)).split(path.sep).join('/');
  const stat = spawnSync('git', ['ls-files', '-s', '--', rel], { cwd: repoRoot, encoding: 'utf8' });
  if (stat.status === 0 && stat.stdout.startsWith('160000 ')) {
    (jsonMode ? process.stderr : process.stdout).write(
      `quality: skipped ${rel} (submodule gitlink, not a file)\n`
    );
    continue;
  }
  checkable.push(file);
}
for (const file of checkable) {
  try {
    assertInsideRepo(repoRoot, path.resolve(repoRoot, file), `selected path ${file}`);
  } catch (e) {
    failOperational(e.message, 'Symlinked source cannot be checked safely.');
  }
}
if (checkable.length === 0) {
  if (jsonMode) {
    process.stdout.write(
      JSON.stringify({
        schema: 'quality-gate/1',
        mode: runMode,
        filesChecked: 0,
        filesSkippedApproved: 0,
        elapsedMs: Number((process.hrtime.bigint() - startNs) / 1_000_000n),
        blockers: [],
        blockerCount: 0,
        warnings: [],
        warningCount: 0,
        acceptedDebt: 0,
        acceptedDebtFindings: [],
        operationalErrors: [],
      }) + '\n'
    );
  } else {
    process.stdout.write('quality: no files to check\n');
  }
  process.exit(0);
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
  results = await eslint.lintFiles(checkable);
} catch (error) {
  // Missing plugin, malformed config, parser bootstrap errors — NEVER a pass
  // (QG-12). Individual file parse errors arrive as fatal messages instead
  // and are handled as blockers below.
  failOperational(
    `ESLint engine failed: ${error && error.message ? error.message : String(error)}`,
    'Run `yarn quality:doctor` to diagnose installation/config problems.'
  );
}

// BUG-15/AC-17: distinguish APPROVED ignores (skipped with the pattern
// printed) from unexpected ones (exit 2 — never pretend a file was
// checked). ESLint either omits ignored files from results or returns a
// severity-1 "File ignored" stub. The matcher itself lives in policy.cjs
// (F11 single source, shared with the audit inventory).
const approvedIgnorePatternFor = policy.approvedIgnorePatternFor;

const resultFiles = new Set(results.map((r) => path.resolve(repoRoot, r.filePath)));
const ignoredStubs = [];
for (const r of results) {
  if (r.messages.some((m) => m.ruleId === null && /File ignored/.test(m.message))) {
    ignoredStubs.push(path.relative(repoRoot, r.filePath));
  }
  r.messages = r.messages.filter(
    (m) => !(m.ruleId === null && /File ignored/.test(m.message))
  );
}
const ignoredPaths = [...new Set([
  ...checkable.filter((f) => !resultFiles.has(path.resolve(repoRoot, f))).map((f) => path.relative(repoRoot, path.resolve(repoRoot, f)).split(path.sep).join('/')),
  ...ignoredStubs,
])];

const approvedSkipped = [];
const unexpected = [];
for (const rel of ignoredPaths) {
  const pattern = approvedIgnorePatternFor(rel);
  if (pattern !== null) approvedSkipped.push({ rel, pattern });
  else unexpected.push(rel);
}
if (unexpected.length > 0) {
  failOperational(
    `selected file(s) were excluded by UNAPPROVED ignore rules instead of checked:\n` +
      unexpected.map((f) => `  - ${f}`).join('\n') +
      `\n(approved ignore patterns live in scripts/quality/policy.cjs)`,
    'Hidden dot-directories and non-approved ignore patterns exclude files silently. Move the file, or adjust the approved ignore list deliberately.'
  );
}
for (const { rel, pattern } of approvedSkipped) {
  (jsonMode ? process.stderr : process.stdout).write(
    `quality: skipped ${rel} (approved ignore: ${pattern})\n`
  );
}
// Files that were entirely approved-skips are removed from the result set.
const approvedSkipSet = new Set(approvedSkipped.map((a) => a.rel));
results = results.filter(
  (r) => !approvedSkipSet.has(path.relative(repoRoot, r.filePath).split(path.sep).join('/'))
);

// Architecture direct-import checks (dedicated AST pass, §8): merged into
// the results before exception application so legacy allowances work the
// same for aifetchly/* findings.
const { checkArchitecture } = await import('./architecture-check.mjs');
const archFindings = checkArchitecture(
  checkable.map((f) => path.resolve(repoRoot, f)),
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
      fatal: finding.fatal === true,
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
          fatal: finding.fatal === true,
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

// F03: configuration/rule-resolution failures ("Definition for rule 'x' was
// not found", invalid rule options, no-ruleId config errors) are OPERATIONAL
// failures (exit 2): never accepted debt, never a source-code policy
// violation, and never exceptable. Source parse errors (fatal) and
// vue/no-parsing-error stay BLOCKERS (exit 1) — those are the file's own
// defects.
const operationalErrors = [];
for (const result of exceptionOutcome.results) {
  const rel = path.relative(repoRoot, result.filePath).split(path.sep).join('/');
  for (const message of result.messages) {
    if (isOperationalDiagnostic(message)) {
      operationalErrors.push(`${rel}:${message.line ?? 0}:${message.column ?? 0} ${message.message}`);
    }
  }
}
if (operationalErrors.length > 0) {
  for (const e of operationalErrors) process.stderr.write(`quality: ${e}\n`);
  if (jsonMode) {
    process.stdout.write(
      JSON.stringify({
        schema: 'quality-gate/1',
        mode: runMode,
        filesChecked: exceptionOutcome.results.length,
        filesSkippedApproved: approvedSkipped.length,
        elapsedMs: Number((process.hrtime.bigint() - startNs) / 1_000_000n),
        blockers: [],
        blockerCount: 0,
        warnings: [],
        warningCount: 0,
        acceptedDebt: 0,
        acceptedDebtFindings: [],
        operationalErrors,
      }) + '\n'
    );
  }
  process.stderr.write(
    'quality: OPERATIONAL FAILURE — the effective ESLint configuration is broken\n' +
    '  Configuration failures are never deferrable debt. Fix the rule/plugin configuration.\n'
  );
  process.exit(OPERATIONAL_FAILURE);
}

// BUG-16/F10: structured finding collection feeds BOTH outputs. Human
// output is capped (first 50 blockers) with the total and a pointer to
// --json; the versioned JSON document carries full detail for blockers,
// warnings, accepted debt, and operational errors.
const MAX_HUMAN_BLOCKERS = 50;
const findings = [];
const warningFindings = [];
for (const result of exceptionOutcome.results) {
  const rel = path.relative(repoRoot, result.filePath).split(path.sep).join('/');
  for (const message of result.messages) {
    if (message.fatal || message.severity === 2) {
      findings.push({
        path: rel,
        line: message.line,
        column: message.column,
        ruleId: message.ruleId ?? null,
        severity: message.severity ?? 2,
        fatal: message.fatal === true,
        message: message.message,
      });
    } else if (message.severity === 1) {
      warningFindings.push({
        path: rel,
        line: message.line,
        column: message.column,
        ruleId: message.ruleId ?? null,
        message: message.message,
      });
    }
  }
}
const blockers = findings.length;
const warnings = warningFindings.length;

const elapsedMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);

if (jsonMode) {
  // Versioned JSON schema (tech design §10) on stdout; human lines on stderr.
  const document = {
    schema: 'quality-gate/1',
    mode: runMode,
    filesChecked: results.length,
    filesSkippedApproved: approvedSkipped.length,
    elapsedMs,
    blockers: findings,
    blockerCount: blockers,
    warnings: warningFindings,
    warningCount: warnings,
    acceptedDebt: exceptionOutcome.acceptedDebt,
    acceptedDebtFindings: exceptionOutcome.acceptedDebtFindings ?? [],
    operationalErrors: [],
  };
  process.stdout.write(JSON.stringify(document) + '\n');
} else {
  // B11: warnings are nonblocking but must stay actionable — show bounded
  // details with location and rule, not just a count.
  const MAX_HUMAN_WARNINGS = 10;
  for (const w of warningFindings.slice(0, MAX_HUMAN_WARNINGS)) {
    process.stdout.write(
      `${w.path}:${w.line}:${w.column} warning ${w.ruleId ?? '(unknown)'}\n` +
        `  ${w.message}\n`
    );
  }
  if (warningFindings.length > MAX_HUMAN_WARNINGS) {
    process.stdout.write(
      `… ${warningFindings.length - MAX_HUMAN_WARNINGS} more warning(s) not shown. ` +
        `Re-run with --json for the full list.\n`
    );
  }
  for (const f of findings.slice(0, MAX_HUMAN_BLOCKERS)) {
    process.stdout.write(
      `${f.path}:${f.line}:${f.column} error ${f.ruleId || '(fatal)'}\n` +
        `  ${f.message}\n`
    );
  }
  if (findings.length > MAX_HUMAN_BLOCKERS) {
    process.stdout.write(
      `… ${findings.length - MAX_HUMAN_BLOCKERS} more blocker(s) not shown. ` +
        `Re-run with --json for the full list.\n`
    );
  }
  process.stdout.write(
    `quality: checked ${results.length} file(s) in ${elapsedMs}ms; ` +
      `${blockers} blocker(s); ${warnings} warning(s)` +
      (exceptionOutcome.acceptedDebt > 0
        ? `; ${exceptionOutcome.acceptedDebt} accepted legacy finding(s)`
        : '') +
      (approvedSkipped.length > 0
        ? `; ${approvedSkipped.length} approved skip(s)`
        : '') +
      '\n'
  );
}

if (blockers > 0) {
  // BUG-16: keep stdout PURE JSON in --json mode; human lines on stderr.
  const human = process.stderr;
  human.write(
    'Commit blocked. Fix the finding(s), stage the correction, and retry.\n' +
      'Deep checks were not run. Use `yarn quality:deep` for typed validation.\n'
  );
  process.exit(POLICY_VIOLATION);
}
process.exit(0);
