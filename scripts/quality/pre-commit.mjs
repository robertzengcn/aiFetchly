#!/usr/bin/env node
/**
 * Quality-gate coordinator — the single Husky pre-commit entry point
 * (tech design §2, §5, §6).
 *
 * Responsibilities:
 *  1. Preflight: dependency presence (no network, no npx fallback), unstaged
 *     policy/control edits, unmerged index stages (QG-09, QG-12, §6.1).
 *  2. Documentation-only commits skip lint engine startup entirely (QG-10).
 *     Staged policy-control inputs are VALIDATED before any exit (BUG-5):
 *     a broken manifest/config must never be recorded as a passing commit.
 *  3. Staged-source enumeration via NUL-delimited git output — never shell
 *     string parsing (§6.1, AC-07). Renames AND copies consume both paths
 *     (BUG-6); the new destination is what this commit adds.
 *  4. One lint-staged invocation (concurrent: false) using the committed
 *     config; lint-staged owns backup + partial-staging isolation (§6.2/6.3).
 *     The index tree identity is compared before/after the run — a change
 *     means concurrent staging and refuses the commit (BUG-10).
 *  5. 120s safety timeout: on timeout the commit fails with a diagnostic
 *     that names lint-staged's backup recovery path (BUG-13) — never a
 *     silent pass (§11).
 *
 * Exit codes: 0 pass, 1 policy violations, 2 operational failures.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = require('./policy.cjs');

const OPERATIONAL_FAILURE = 2;
const POLICY_VIOLATION = 1;
// Tech design §11: the safety timeout is deliberately configurable so an
// operator can consciously raise it for oversized staged batches.
const SAFETY_TIMEOUT_MS =
  Number.parseInt(process.env.QUALITY_GATE_TIMEOUT_MS ?? '', 10) || 120_000;

/**
 * F02: coordinator-owned CORE policy-control list. Deliberately NOT read
 * from policy.cjs — an unstaged edit that weakens policyControlInputs must
 * not be able to silence these consistency checks. policy.policyControlInputs
 * (loaded afterwards) can only ADD entries.
 */
const CORE_POLICY_CONTROL_INPUTS = [
  '.eslintrc.json',
  'scripts/quality/**',
  'package.json',
  'yarn.lock',
  '.gitignore',
  '.eslintignore',
];

/** Does a repo-relative path match a control entry (exact or dir glob)? */
function matchesControl(relPath, control) {
  if (control.endsWith('/**')) {
    const dir = control.slice(0, -3);
    return relPath === dir || relPath.startsWith(dir + '/');
  }
  return relPath === control;
}

function controlPathspec(control) {
  // `git diff -- scripts/quality` already covers the whole tree; keep the
  // glob form out of the pathspec (glob magic differs across git versions).
  return control.endsWith('/**') ? control.slice(0, -3) : control;
}

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

const STASH_RECOVERY_HINT =
  'If a lint-staged backup stash remains, inspect `git stash list` and restore it ' +
  'manually (`git stash apply`). The hook never deletes stashes or resets anything.';

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
  require('./policy.cjs');
} catch (e) {
  failOperational(`fast ESLint profile failed to load: ${e.message}`);
}

// F08: the gate's own policy inputs must physically live inside the
// repository. A symlinked policy.cjs / exceptions.json pointing outside
// would let the effective policy be supplied from beyond the commit.
const { assertInsideRepo } = require('./repo-boundary.cjs');
for (const policyFile of [
  'scripts/quality/policy.cjs',
  'scripts/quality/eslint-fast.cjs',
  'scripts/quality/exceptions.json',
  'scripts/quality/lint-staged.config.mjs',
  'scripts/quality/check-exceptions.mjs',
  '.eslintrc.json',
]) {
  try {
    assertInsideRepo(repoRoot, path.join(repoRoot, policyFile), `policy input ${policyFile}`);
  } catch (e) {
    failOperational(e.message, 'Policy must be committed in the repository, not supplied from outside it.');
  }
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
    // -z name-status emits status then path. Renames AND COPIES emit TWO
    // paths (old, new); the NEW destination is what this commit adds. Copy
    // detection (`diff.renames=copies`) emits C<score> the same way — a
    // mis-parsed record shifts every later offset (BUG-6).
    const isTwoPath = status.startsWith('R') || status.startsWith('C');
    const firstPath = parts[i + 1];
    if (!firstPath) break;
    staged.push(isTwoPath ? parts[i + 2] : firstPath);
    i += isTwoPath ? 2 : 1;
  }
}

const sourceExt = new Set(policy.sourceExtensions);
const stagedSource = staged.filter((f) => sourceExt.has(path.extname(f)));

// --- 2b. Policy-input consistency (F02) -------------------------------------
//
// The effective policy is read from the WORKING TREE, so every control
// input it depends on must be committed and match the index — tracked
// files with unstaged edits AND untracked helpers are both rejected.
// Untracked files are invisible to `git diff`, which is exactly how a
// staged policy.cjs importing an untracked, weaker helper slipped through.
// The control list is coordinator-owned (see CORE_POLICY_CONTROL_INPUTS);
// policy.policyControlInputs may only extend it.
const controls = [...new Set([
  ...CORE_POLICY_CONTROL_INPUTS,
  ...(Array.isArray(policy.policyControlInputs) ? policy.policyControlInputs : []),
])];

const unstagedPolicy = [];
{
  const diff = git(['diff', '--name-only', '-z', '--', ...controls.map(controlPathspec)], {
    allowFailure: true,
  });
  if (diff.status === 0) {
    for (const p of diff.stdout.split('\0')) {
      if (p.length > 0) unstagedPolicy.push(p);
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

const untrackedPolicy = [];
{
  const others = git(['ls-files', '--others', '--exclude-standard', '-z']);
  for (const p of others.stdout.split('\0')) {
    if (p.length === 0) continue;
    if (controls.some((c) => matchesControl(p, c)) || /^\.eslintrc[^/]*$/.test(p)) {
      untrackedPolicy.push(p);
    }
  }
}
if (untrackedPolicy.length > 0) {
  failOperational(
    `UNTRACKED policy/control inputs exist (they will not be in this commit):\n` +
      untrackedPolicy.map((f) => `  - ${f}`).join('\n'),
    'Stage them (git add) or remove them. A commit may not depend on policy files that a fresh checkout would not have.'
  );
}

// Policy-control inputs among STAGED files → validate policy before ANY
// exit (QG-10, BUG-5). This list is policy/config only; documentation is
// deliberately absent (BUG-17: the operator guide is documentation, not a
// policy input per tech design §6.1).
const stagedPolicy = staged.filter((f) => controls.some((c) => matchesControl(f, c)));

// BUG-5/F01: staged policy inputs are validated NOW — including in
// policy-only commits with zero staged source. A broken exceptions.json or
// unparseable profile is exit 2 here, not a deferred failure on the next
// source commit. F01: validation also EXERCISES the effective ESLint
// configuration (lintText on clean TS/Vue/CJS samples) — loading modules
// proves nothing about rule names, rule options, parser/plugin resolution,
// or the effective per-dialect profiles, so a config naming a nonexistent
// rule used to validate green and then break every later source commit.
if (stagedPolicy.length > 0) {
  validateStagedPackageControls(stagedPolicy);
  const moduleUrls = [
    'scripts/quality/check-exceptions.mjs',
    'scripts/quality/policy.cjs',
    'scripts/quality/eslint-fast.cjs',
    'scripts/quality/lint-staged.config.mjs',
  ]
    .map((rel) => path.join(repoRoot, rel))
    .map((abs) => pathToFileURL(abs).href)
    .map((href) => JSON.stringify(href))
    .join(', ');
  const rootLiteral = JSON.stringify(repoRoot);
  const snippet = `
    const path = await import('node:path');
    const [exceptions, policyMod, fastProfile, stagedConfig] = await Promise.all(
      [${moduleUrls}].map((u) => import(u))
    );
    void policyMod; void fastProfile; void stagedConfig;
    const manifest = exceptions.loadManifest();
    if (manifest.errors.length > 0) {
      process.stderr.write(manifest.errors.join('\\n') + '\\n');
      process.exit(1);
    }
    const { createRequire } = await import('node:module');
    const root = ${rootLiteral};
    const requireFromRoot = createRequire(path.join(root, 'package.json'));
    const { ESLint } = requireFromRoot('eslint');
    const eslint = new ESLint({
      cwd: root,
      useEslintrc: false,
      overrideConfigFile: path.join(root, 'scripts', 'quality', 'eslint-fast.cjs'),
      resolvePluginsRelativeTo: root,
      fix: false,
    });
    // Clean, representative samples for each dialect profile. ANY severity-2
    // finding on clean code is a configuration failure (unknown rule,
    // invalid options, unresolvable plugin/parser) — including the
    // "Definition for rule ... was not found" shape.
    const samples = [
      ['probe.ts', 'export const value: number = 1;\\n'],
      ['probe.vue', '<template><div>{{ ok }}</div></template>\\n<script setup lang="ts">\\nconst ok = 1;\\n</script>\\n'],
      ['probe.cjs', 'module.exports = { ok: true };\\n'],
    ];
    for (const [name, code] of samples) {
      const [result] = await eslint.lintText(code, {
        filePath: path.join(root, 'tmp-quality-probe', name),
      });
      const blockers = result.messages.filter((m) => m.severity === 2);
      if (blockers.length > 0) {
        for (const m of blockers) {
          process.stderr.write(\`policy probe \${name}: \${m.ruleId ?? '(config)'} — \${m.message}\\n\`);
        }
        process.exit(1);
      }
    }
  `;
  const validation = spawnSync(process.execPath, ['--input-type=module', '-e', snippet], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (validation.status !== 0) {
    failOperational(
      'staged policy-control inputs failed validation:\n' +
        (validation.stderr || validation.stdout || '(no output)'),
      'Fix the staged policy files before committing. Configuration failures are never deferrable debt.'
    );
  }
  process.stdout.write('quality: staged policy inputs validated\n');
}

/**
 * F01: staged package/lockfile control changes must not uninstall or
 * unpin the gate — the staged devDependencies must still declare every
 * engine dependency, and a staged yarn.lock must still contain the pinned
 * SonarJS plugin entry.
 */
function validateStagedPackageControls(stagedPolicy) {
  const REQUIRED_DEV_DEPS = [
    'eslint',
    'eslint-plugin-sonarjs',
    'eslint-plugin-vue',
    'vue-eslint-parser',
    '@typescript-eslint/parser',
    'lint-staged',
  ];
  if (stagedPolicy.includes('package.json')) {
    const staged = git(['show', ':package.json']).stdout;
    let pkg;
    try {
      pkg = JSON.parse(staged);
    } catch (e) {
      failOperational(`staged package.json is not valid JSON: ${e.message}`);
    }
    const dev = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
    const missing = REQUIRED_DEV_DEPS.filter((d) => !(d in dev));
    if (missing.length > 0) {
      failOperational(
        `staged package.json no longer declares the quality-gate dependencies:\n` +
          missing.map((d) => `  - ${d}`).join('\n'),
        'Removing a gate dependency disables the hook. Revert the removal deliberately (and update the gate) rather than committing a broken policy.'
      );
    }
  }
  if (stagedPolicy.includes('yarn.lock')) {
    const staged = git(['show', ':yarn.lock']).stdout;
    if (!/^eslint-plugin-sonarjs@/m.test(staged)) {
      failOperational(
        'staged yarn.lock no longer contains the pinned eslint-plugin-sonarjs entry',
        'The hook resolves the pinned plugin from the lockfile. Restore the entry or update the gate deliberately.'
      );
    }
  }
}

// Documentation-only fast path (QG-10): no staged source and no staged
// policy-control change → skip lint-staged and the engine entirely.
if (stagedSource.length === 0) {
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

// BUG-10: record the index tree identity before lint-staged; the gate is
// read-only, so any change after the run means concurrent staging — refuse
// rather than reset anything (§6.2).
const indexTreeBefore = git(['write-tree']).stdout.trim();

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
    // BUG-13: name lint-staged's backup recovery path explicitly.
    `The commit was NOT created. ${STASH_RECOVERY_HINT} Then run \`yarn quality:doctor\`, reduce the staged batch, or raise the timeout consciously in scripts/quality/pre-commit.mjs.`
  );
}
if (run.error) {
  failOperational(`lint-staged could not run: ${run.error.message}`, STASH_RECOVERY_HINT);
}

// BUG-10: index identity must be unchanged by the run. A mismatch means
// something else staged during the hook — fail closed with a retry hint,
// never a reset (the user's concurrent staging is preserved).
const indexTreeAfter = git(['write-tree']).stdout.trim();
if (indexTreeAfter !== indexTreeBefore) {
  failOperational(
    'the git index changed while the quality gate was running (concurrent git add?)',
    'The commit was NOT created. Re-run `git commit`; no reset or stash deletion was performed.'
  );
}

// Exit 1 from lint-staged = task failure (our runner's policy violation or
// operational failure propagated). The messages above already explain it.
if (run.status !== 0) {
  process.exit(run.status === 1 ? POLICY_VIOLATION : OPERATIONAL_FAILURE);
}

process.stdout.write('quality: staged files passed the local gate\n');
process.exit(0);
