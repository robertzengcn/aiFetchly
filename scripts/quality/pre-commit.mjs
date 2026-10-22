#!/usr/bin/env node
/**
 * Quality-gate coordinator — the single Husky pre-commit entry point
 * (tech design §2, §5, §6).
 *
 * Responsibilities:
 *  1. Preflight: dependency presence (no network, no npx fallback), unstaged
 *     policy/control edits, unmerged index stages (QG-09, QG-12, §6.1).
 *  2. Documentation-only commits skip lint engine startup entirely (QG-10),
 *     except when policy-control inputs are staged (they validate instead).
 *  3. Staged-source enumeration via NUL-delimited git output — never shell
 *     string parsing (§6.1, AC-07).
 *  4. One lint-staged invocation (concurrent: false) using the committed
 *     config; lint-staged owns backup + partial-staging isolation and the
 *     index-identity check (§6.2/6.3).
 *  5. 120s safety timeout: on timeout the commit fails with a diagnostic —
 *     never a silent pass (§11).
 *
 * Exit codes: 0 pass, 1 policy violations, 2 operational failures.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = require('./policy.cjs');

const OPERATIONAL_FAILURE = 2;
const POLICY_VIOLATION = 1;
const SAFETY_TIMEOUT_MS = 120_000;

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    // NUL-delimited output for path listings; callers split on '\0'.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || (result.status !== 0 && !allowFailure)) {
    failOperational(
      `git ${args[0]} failed: ${result.error ? result.error.message : result.stderr.trim()}`
    );
  }
  return result;
}

function failOperational(message, hint) {
  process.stderr.write(`quality: OPERATIONAL FAILURE — ${message}\n`);
  if (hint) process.stderr.write(`  ${hint}\n`);
  process.exit(OPERATIONAL_FAILURE);
}

// --- 1. Preflight -----------------------------------------------------------

// Dependency presence: the pinned plugin must be importable from the repo's
// installed node_modules. NEVER fall back to npx (which can download).
try {
  require.resolve('eslint-plugin-sonarjs/package.json', { paths: [repoRoot] });
} catch {
  failOperational(
    'eslint-plugin-sonarjs is not installed',
    'Run `yarn install` locally (setup-time network only). The hook never downloads anything.'
  );
}
for (const dep of ['eslint', 'lint-staged', 'vue-eslint-parser', '@typescript-eslint/parser']) {
  try {
    require.resolve(`${dep}/package.json`, { paths: [repoRoot] });
  } catch {
    failOperational(
      `${dep} is not installed`,
      'Run `yarn install`. See `yarn quality:doctor` for full diagnostics.'
    );
  }
}
try {
  require('./eslint-fast.cjs');
} catch (e) {
  failOperational(`fast ESLint profile failed to load: ${e.message}`);
}

// Unmerged index stages block everything (§6.1).
const unmerged = git(['diff', '--cached', '--name-only', '--diff-filter=U']).stdout;
if (unmerged.trim().length > 0) {
  failOperational(
    'the index has unmerged paths:\n' +
      unmerged
        .trim()
        .split('\n')
        .map((f) => `  - ${f}`)
        .join('\n'),
    'Resolve the conflict (git add the resolution) before committing.'
  );
}

// --- 2. Staged enumeration (NUL-delimited) ----------------------------------

const stagedRaw = git([
  'diff',
  '--cached',
  '--name-status',
  '--diff-filter=ACMR', // added/copied/modified/renamed; deletions skipped
  '-z',
]).stdout;
const staged = [];
{
  const parts = stagedRaw.split('\0');
  for (let i = 0; i < parts.length; i += 1) {
    const status = parts[i];
    if (!status) continue;
    // -z name-status emits status then path. Renames emit TWO paths
    // (old, new); the NEW destination is what this commit adds.
    const oldPath = parts[i + 1];
    if (!oldPath) break;
    staged.push(status.startsWith('R') ? parts[i + 2] : oldPath);
    i += status.startsWith('R') ? 2 : 1;
  }
}

const sourceExt = new Set(policy.sourceExtensions);
const stagedSource = staged.filter((f) => sourceExt.has(path.extname(f)));

// Policy-control inputs among STAGED files → always validate policy (QG-10).
const stagedPolicy = staged.filter((f) =>
  policy.policyControlInputs.some(
    (p) => f === p || (p.endsWith('/**') && f.startsWith(p.slice(0, -2)))
  )
);

// Unstaged edits to policy/control inputs reject the commit (AC-16): an
// unstaged weaker configuration must not determine a staged commit's result.
const unstagedPolicy = [];
for (const control of policy.policyControlInputs) {
  const diff = git(['diff', '--name-only', '--', control], { allowFailure: true });
  if (diff.status === 0) {
    for (const line of diff.stdout.split('\n')) {
      if (line.trim().length > 0) unstagedPolicy.push(line.trim());
    }
  }
}
if (unstagedPolicy.length > 0) {
  failOperational(
    `policy/control inputs have UNSTAGED edits:\n` +
      [...new Set(unstagedPolicy)].map((f) => `  - ${f}`).join('\n'),
    'Stage them (git add) or restore them (git checkout -- <file>) so the effective policy matches the commit.'
  );
}

// Documentation-only fast path (QG-10): no staged source and no staged
// policy-control change → skip lint-staged and the engine entirely.
if (stagedSource.length === 0 && stagedPolicy.length === 0) {
  process.stdout.write(
    `quality: no staged source files (staged: ${staged.length} non-source) — lint engine skipped\n`
  );
  process.exit(0);
}

// Symlink guard: a staged source path that is a symlink is rejected with an
// explanation rather than followed outside the repository (§6.1).
for (const rel of stagedSource) {
  const abs = path.join(repoRoot, rel);
  const stat = spawnSync('git', ['ls-files', '-s', '--', rel], { cwd: repoRoot, encoding: 'utf8' });
  if (stat.status === 0 && /^120000 /.test(stat.stdout)) {
    failOperational(
      `staged source path is a symlink: ${rel}`,
      'Symlinked source cannot be checked safely. Commit the real file instead.'
    );
  }
  if (!existsSync(abs)) {
    failOperational(
      `staged source is missing from the working tree: ${rel}`,
      'lint-staged needs the staged file present. This is an operational failure, not a pass.'
    );
  }
}

// --- 3/4. lint-staged (single invocation, sequential, backed up) -----------

process.stdout.write(
  `quality: checking ${stagedSource.length} staged source file(s)\n`
);

// lint-staged's package exports hide its bin from module RESOLVERS; drive
// the real JS entry via process.execPath (cross-platform: no .bin shim
// execution, which breaks spawnSync on Windows).
const run = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'node_modules', 'lint-staged', 'bin', 'lint-staged.js'),
    '--config',
    path.join(repoRoot, 'scripts', 'quality', 'lint-staged.config.mjs'),
    '--concurrent',
    'false',
    // Default backup + hidden-partially-staged isolation stays ON (§6.2).
    // No --no-stash, no --no-hide-partially-staged, no --fix anywhere.
  ],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: SAFETY_TIMEOUT_MS,
    env: { ...process.env, FORCE_COLOR: '0' },
  }
);

process.stdout.write(run.stdout || '');
process.stderr.write(run.stderr || '');

if (run.error && run.error.code === 'ETIMEDOUT') {
  failOperational(
    `quality gate exceeded the ${SAFETY_TIMEOUT_MS / 1000}s safety timeout`,
    'The commit was NOT created. Run `yarn quality:doctor`, reduce the staged batch, or raise the timeout consciously in scripts/quality/pre-commit.mjs.'
  );
}
if (run.error) {
  failOperational(`lint-staged could not run: ${run.error.message}`);
}

// Exit 1 from lint-staged = task failure (our runner's policy violation or
// operational failure propagated). The messages above already explain it.
if (run.status !== 0) {
  process.exit(run.status === 1 ? POLICY_VIOLATION : OPERATIONAL_FAILURE);
}

process.stdout.write('quality: staged files passed the local gate\n');
process.exit(0);
