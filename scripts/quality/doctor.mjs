#!/usr/bin/env node
/**
 * Installation and configuration diagnostics (PRD QG-11, AC-18; F13).
 *
 * Checks: Node version, pinned dependencies, config/profile loadability,
 * the REAL manifest validator, Husky hooksPath + the executable shim file
 * Git actually invokes, a fixture rejection probe that asserts the
 * EXPECTED rule in the output (unique temp path, never a fixed name), and
 * an end-to-end real-commit proof in an isolated disposable checkout:
 * Git must EXECUTE the installed hook wiring and reject an invalid staged
 * fixture while accepting a valid one. Read-only on the user's tree.
 */

import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync, existsSync, readFileSync, mkdirSync, accessSync, constants } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { loadManifest } = await import('./check-exceptions.mjs');
const { createDisposableGateRepo, removeDisposableGateRepo } = await import('./disposable-gate.mjs');

const checks = [];
function check(name, ok, detail, fixHint) {
  checks.push({ name, ok, detail, fixHint });
}

// Node engine
const nodeMajor = Number(process.versions.node.split('.')[0]);
check('node', nodeMajor >= 22, `Node ${process.versions.node}`, 'Install Node >= 22');

// Pinned dependencies
for (const dep of [
  'eslint',
  'eslint-plugin-sonarjs',
  'eslint-plugin-vue',
  'vue-eslint-parser',
  '@typescript-eslint/parser',
  'lint-staged',
]) {
  let ok = false;
  let detail = 'not resolvable';
  try {
    const pkg = require(`${dep}/package.json`, { paths: [repoRoot] });
    ok = true;
    detail = `${dep}@${pkg.version}`;
    if (dep === 'eslint-plugin-sonarjs' && pkg.version !== '1.0.4') {
      ok = false;
      detail += ' (expected EXACT 1.0.4)';
    }
  } catch {
    /* detail already set */
  }
  check(`dependency:${dep}`, ok, detail, 'Run `yarn install` from the repository root');
}

// Profiles load
for (const profile of ['eslint-fast.cjs', 'policy.cjs', 'rules/index.cjs']) {
  try {
    require(path.join(repoRoot, 'scripts', 'quality', profile));
    check(`profile:${profile}`, true, 'loads');
  } catch (e) {
    check(`profile:${profile}`, false, e.message, 'Fix the profile; the hook fails closed on load errors');
  }
}

// Exception manifest — through the REAL validator (F13): a JSON-shaped
// but semantically invalid manifest (bad dates, wildcard paths, missing
// per-function identities) must fail doctor exactly as it fails the gate.
{
  const { exceptions, errors } = loadManifest();
  check(
    'exceptions.json',
    errors.length === 0,
    errors.length > 0 ? errors[0] : `${exceptions.length} reviewed exception(s)`,
    errors.length > 0
      ? 'Fix the manifest (see scripts/quality/check-exceptions.mjs validation rules)'
      : undefined
  );
}

// Husky hook wiring
const hooksPath = spawnSync('git', ['config', 'core.hooksPath'], {
  cwd: repoRoot,
  encoding: 'utf8',
});
// With hooksPath=.husky/_ (husky 9's shim layout), the user hook lives in
// .husky/pre-commit and the SHIM FILE .husky/_/pre-commit is what Git
// actually executes — an empty shim directory used to satisfy this check
// (F13). Worktrees do not inherit the generated shims at all.
const shimDir = path.join(repoRoot, '.husky', '_');
const shimFile = path.join(shimDir, 'pre-commit');
const hooksValue = (hooksPath.stdout || '').trim();
check(
  'husky:core.hooksPath',
  hooksValue === '.husky' || hooksValue === '.husky/_',
  `core.hooksPath=${hooksValue || '(unset)'}${
    hooksValue === '.husky/_' ? ' (husky 9 shim dir — the standard layout)' : ''
  }`,
  hooksValue
    ? 'Ensure the shim directory exists (.husky/_ for husky 9; run `yarn prepare`)'
    : 'Run `yarn prepare` (husky) to install the hook directory'
);
if (hooksValue === '.husky/_') {
  if (!existsSync(shimFile)) {
    check(
      'husky:shims',
      false,
      '.husky/_ is configured but the generated pre-commit shim FILE is missing (common in git worktrees)',
      'Run `yarn prepare` in this checkout, or copy .husky/_ from the main checkout'
    );
  } else {
    // F13: prove the shim is EXECUTABLE — Git invokes it directly.
    let executable = true;
    let detail = '.husky/_/pre-commit shim present';
    if (process.platform !== 'win32') {
      try {
        accessSync(shimFile, constants.X_OK);
      } catch {
        executable = false;
        detail = '.husky/_/pre-commit exists but is NOT executable';
      }
    }
    check('husky:shims', executable, detail, executable ? undefined : `chmod +x .husky/_/pre-commit (or re-run \`yarn prepare\`)`);
    // Outside-review D7: a shim that is present and executable but
    // content-broken would otherwise get an all-clear. Husky 9 shims source
    // the runner script next to themselves — tolerate layout changes by
    // requiring the reference, not an exact byte match.
    if (executable) {
      // B02: a substring match accepted '# husky runner' comments and
      // no-op shims — inspect NON-COMMENT code lines only (the real husky 9
      // shim is `. "$(dirname "$0")/h"`).
      const shimCode = readFileSync(shimFile, 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'));
      const sourcesRunner = shimCode.some((l) => /\/h\b|h"\)|husky\.sh/.test(l));
      check(
        'husky:shim-content',
        sourcesRunner,
        sourcesRunner ? 'shim sources the husky runner' : 'shim never invokes the husky runner (comment-only or no-op)',
        'The shim must source the husky runner — re-run `yarn prepare`'
      );
    }
  }
}
const hookFile = path.join(repoRoot, '.husky', 'pre-commit');
if (existsSync(hookFile)) {
  const content = readFileSync(hookFile, 'utf8');
  // F13: a COMMENT mentioning the coordinator used to satisfy this check —
  // inspect non-comment code lines only.
  const codeLines = content.split('\n').filter((l) => !l.trim().startsWith('#'));
  const invokes = codeLines.some((l) => l.includes('scripts/quality/pre-commit.mjs'));
  check(
    'husky:pre-commit',
    invokes,
    invokes ? 'invokes scripts/quality/pre-commit.mjs' : content.trim().split('\n')[0],
    'The hook must execute: node scripts/quality/pre-commit.mjs'
  );
} else {
  check('husky:pre-commit', false, '.husky/pre-commit missing', 'Run `yarn prepare`');
}

// Fixture rejection probe: invalid code must be REJECTED with the EXPECTED
// rule (F13) — exit 1 alone could be any unrelated configuration error.
// BUG-12: the fixture lives under tmp-quality-probe/ (gitignored,
// non-hidden so ESLint does not silently skip it), uses a UNIQUE name so a
// user's own probe file is never clobbered, and deletion is in finally.
let probeOk = false;
let probeDetail = 'probe did not run';
const probeDir = path.join(repoRoot, 'tmp-quality-probe');
const probeRel = path.join('tmp-quality-probe', `doctor-fixture-${process.pid}.ts`);
const probeFixture = path.join(repoRoot, probeRel);
try {
  mkdirSync(probeDir, { recursive: true });
  writeFileSync(
    probeFixture,
    "export function dup(v: boolean): string {\n  if (v) { return 'same'; } else { return 'same'; }\n}\n"
  );
  const run = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'quality', 'lint-files.mjs'), probeRel],
    { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 }
  );
  const out = run.stdout + run.stderr;
  const rejectedWithRule = run.status === 1 && out.includes('sonarjs/no-all-duplicated-branches');
  probeOk = rejectedWithRule;
  probeDetail = rejectedWithRule
    ? 'invalid fixture rejected with the expected rule'
    : `exit ${run.status}; expected rule in output: ${out.includes('sonarjs') ? 'maybe' : 'absent'}`;
} catch (e) {
  probeDetail = e.message;
} finally {
  rmSync(probeFixture, { force: true });
}
check('probe:duplicated-branches', probeOk, probeDetail, 'The runner must reject a duplicated-branch fixture with the sonarjs rule reported (exit 1)');

// F13/AC-18: the decisive proof — Git EXECUTES the installed hook wiring
// in an isolated disposable checkout wired to this repo's gate: an invalid
// staged fixture must be rejected and a valid one must commit.
let commitProbeOk = false;
let commitProbeDetail = 'probe did not run';
{
  const repo = createDisposableGateRepo(repoRoot, 'doctor');
  try {
    writeFileSync(path.join(repo.root, 'DoctorBad.ts'), 'export const v: any = 1;\n');
    repo.run(['add', 'DoctorBad.ts']);
    const bad = repo.run(['commit', '-m', 'doctor probe: invalid']);
    // A rejected commit leaves the invalid file STAGED — remove it so the
    // valid probe commits exactly one clean file.
    repo.run(['reset', '-q']);
    rmSync(path.join(repo.root, 'DoctorBad.ts'), { force: true });
    writeFileSync(path.join(repo.root, 'DoctorGood.ts'), 'export const two = 1 + 1;\n');
    repo.run(['add', 'DoctorGood.ts']);
    const good = repo.run(['commit', '-m', 'doctor probe: valid']);
    commitProbeOk = bad.status !== 0 && good.status === 0;
    commitProbeDetail = commitProbeOk
      ? 'real git commit rejected the invalid fixture and accepted the valid one'
      : `invalid commit exit ${bad.status}, valid commit exit ${good.status}`;
  } catch (e) {
    commitProbeDetail = e.message;
  } finally {
    removeDisposableGateRepo(repo.root);
  }
}
check(
  'probe:real-commit-rejection',
  commitProbeOk,
  commitProbeDetail,
  'Git must execute the hook: check core.hooksPath and the .husky/_ shims'
);

// Report
let failures = 0;
for (const c of checks) {
  const mark = c.ok ? 'ok  ' : 'FAIL';
  if (!c.ok) failures += 1;
  console.log(`[${mark}] ${c.name} — ${c.detail}`);
  if (!c.ok && c.fixHint) console.log(`        fix: ${c.fixHint}`);
}
console.log(
  failures === 0
    ? '\nquality doctor: all checks passed'
    : `\nquality doctor: ${failures} check(s) failed`
);
process.exit(failures === 0 ? 0 : 2);
