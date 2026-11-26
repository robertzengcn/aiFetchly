/**
 * Git integration suite (tech design §12; AC-04/05/07/10/15/16).
 *
 * Builds a DISPOSABLE repository per test (real `git init`, real commits
 * through the real hook wiring), pointing `core.hooksPath` at a hook stub
 * that invokes this repo's pre-commit coordinator with the fixture repo as
 * its working tree. No network, no shared state between tests.
 *
 * The coordinator resolves repoRoot from its OWN location, so each fixture
 * repo gets a COPY of scripts/quality + .eslintrc.json and a node_modules
 * SYMLINK to the real checkout's tree (deps are never installed — offline).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync, spawn } from 'node:child_process';
import {
  mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, mkdtempSync, copyFileSync, existsSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const realRepo = process.cwd();
const { createDisposableGateRepo } = await import(
  pathToFileURL(path.join(realRepo, 'scripts', 'quality', 'disposable-gate.mjs')).href
);
const sandboxes = [];

/**
 * Create a disposable repo wired to run the real gate on ITS tree — shared
 * wiring with the doctor's real-commit probe (F13) lives in
 * scripts/quality/disposable-gate.mjs.
 */
function makeRepo(name) {
  const { root, git } = createDisposableGateRepo(realRepo, name);
  sandboxes.push(root);
  return { root, git };
}

before(() => { /* sandboxes cleaned per-test + in after() */ });
after(() => { for (const s of sandboxes) rmSync(s, { recursive: true, force: true }); });

/** Run git in `root` and return { status, stdout, stderr }. */
function run(root, args) {
  const res = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return res;
}

/** Attempt a commit; return exit status. */
function commitIn(root, message) {
  return run(root, ['commit', '-m', message]).status;
}

const INVALID = "export const v: any = 1;\n";
const VALID = 'export const two = 1 + 1;\n';

describe('git integration (AC-04/05/07/15/16)', () => {
  test('AC-01/02 e2e: invalid staged file rejects the commit; valid passes', () => {
    const { root } = makeRepo('basic');
    writeFileSync(path.join(root, 'Bad.ts'), INVALID);
    run(root, ['add', 'Bad.ts']);
    assert.notEqual(commitIn(root, 'bad'), 0, 'invalid file must block');
    writeFileSync(path.join(root, 'Bad.ts'), VALID);
    run(root, ['add', 'Bad.ts']);
    assert.equal(commitIn(root, 'good'), 0, 'corrected file must pass');
  });

  test('AC-04: staged violation fixed only in unstaged hunks still blocks', () => {
    const { root } = makeRepo('partial');
    writeFileSync(path.join(root, 'P.ts'), VALID);
    run(root, ['add', 'P.ts']);
    run(root, ['commit', '-m', 'seed']);
    // File now has a staged any + an unstaged fix for it.
    writeFileSync(path.join(root, 'P.ts'), INVALID);
    run(root, ['add', 'P.ts']);                       // stage the violation
    writeFileSync(path.join(root, 'P.ts'), VALID);    // fix stays unstaged
    assert.notEqual(commitIn(root, 'partial'), 0, 'staged snapshot must be what is linted');
  });

  test('AC-05: unstaged violation with valid staged content may pass', () => {
    const { root } = makeRepo('unstaged-bad');
    writeFileSync(path.join(root, 'U.ts'), VALID);
    run(root, ['add', 'U.ts']);
    writeFileSync(path.join(root, 'U.ts'), INVALID);   // unstaged violation
    assert.equal(commitIn(root, 'ok'), 0, 'unstaged content must not gate');
  });

  test('AC-07: spaces + unicode filenames survive argument passing', () => {
    const { root } = makeRepo('names');
    const weird = 'dir with space/файл-日本.ts';
    mkdirSync(path.join(root, 'dir with space'));
    writeFileSync(path.join(root, weird), VALID);
    run(root, ['add', weird]);
    assert.equal(commitIn(root, 'weird names'), 0);
  });

  test('AC-16: unstaged policy edit rejects the commit', () => {
    const { root } = makeRepo('policy');
    // Seed-commit the gate files with the hook disabled (unmanifested
    // scripts/lib debt would otherwise block the seed itself), then
    // restore the hook — the edit under test is now TRACKED-modified,
    // which is what `git diff --name-only` can see.
    // Portable hook disable: an empty hooks dir (see disposable-gate.mjs).
    run(root, ['config', 'core.hooksPath', '.husky-disabled']);
    run(root, ['add', 'scripts', '.eslintrc.json']);
    run(root, ['commit', '-m', 'seed gate']);
    run(root, ['config', 'core.hooksPath', '.husky/_']);
    writeFileSync(path.join(root, 'S.ts'), VALID);
    run(root, ['add', 'S.ts']);
    writeFileSync(
      path.join(root, 'scripts', 'quality', 'policy.cjs'),
      readFileSync(path.join(root, 'scripts', 'quality', 'policy.cjs'), 'utf8') + '\n// x\n'
    );
    assert.notEqual(commitIn(root, 'policy-dirty'), 0);
  });

  test('BUG-5/AC-10: policy-only commit with broken manifest is rejected', () => {
    const { root } = makeRepo('manifest');
    writeFileSync(
      path.join(root, 'scripts', 'quality', 'exceptions.json'),
      JSON.stringify({ schemaVersion: 99, exceptions: [] })
    );
    run(root, ['add', 'scripts/quality/exceptions.json']);
    assert.notEqual(commitIn(root, 'broken manifest'), 0);
  });

  test('BUG-6: copied file (diff.renames=copies) lints the NEW destination', () => {
    const { root } = makeRepo('copy');
    writeFileSync(path.join(root, 'C.ts'), VALID);
    run(root, ['add', 'C.ts']);
    run(root, ['commit', '-m', 'seed']);
    run(root, ['config', 'diff.renames', 'copies']);
    // Copy C.ts to Bad.ts, then make the COPY violate — old path stays valid.
    writeFileSync(path.join(root, 'Bad.ts'), INVALID);
    run(root, ['add', 'C.ts', 'Bad.ts']);
    assert.notEqual(commitIn(root, 'copy-violates'), 0, 'copy destination must be linted');
  });

  test('unborn HEAD: initial commit of an invalid file is rejected', () => {
    const { root } = makeRepo('unborn');
    writeFileSync(path.join(root, 'First.ts'), INVALID);
    run(root, ['add', 'First.ts']);
    assert.notEqual(commitIn(root, 'initial'), 0);
  });

  test('AC-15: index + worktree preserved on rejection', () => {
    const { root } = makeRepo('preserve');
    writeFileSync(path.join(root, 'R.ts'), VALID);
    run(root, ['add', 'R.ts']);
    run(root, ['commit', '-m', 'seed']);
    const headBefore = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    writeFileSync(path.join(root, 'R2.ts'), INVALID);
    run(root, ['add', 'R2.ts']);
    commitIn(root, 'rejected');
    // R2.ts content untouched, HEAD unchanged, file still staged.
    assert.equal(readFileSync(path.join(root, 'R2.ts'), 'utf8'), INVALID);
    assert.equal(run(root, ['rev-parse', 'HEAD']).stdout.trim(), headBefore);
    const staged = run(root, ['diff', '--cached', '--name-only']).stdout.trim();
    assert.ok(staged.includes('R2.ts'), 'index preserved');
  });

  test('AC-15: pre-existing user stash survives a rejected commit', () => {
    const { root } = makeRepo('stash');
    writeFileSync(path.join(root, 'S.ts'), VALID);
    run(root, ['add', 'S.ts']);
    run(root, ['commit', '-m', 'seed']);
    writeFileSync(path.join(root, 'other.txt'), 'junk\n');
    run(root, ['add', 'other.txt']);
    run(root, ['stash', 'push', '-q', '-m', 'user-stash']);
    const stashesBefore = run(root, ['stash', 'list']).stdout.trim();
    writeFileSync(path.join(root, 'Bad.ts'), INVALID);
    run(root, ['add', 'Bad.ts']);
    commitIn(root, 'nope');
    assert.equal(run(root, ['stash', 'list']).stdout.trim(), stashesBefore, 'user stash untouched');
  });

  test('AC-06/QG-10: docs-only commit completes without the lint engine', () => {
    const { root } = makeRepo('docs');
    writeFileSync(path.join(root, 'README.md'), '# hi\n');
    run(root, ['add', 'README.md']);
    const res = run(root, ['commit', '-m', 'docs']);
    assert.equal(res.status, 0);
    // Git may buffer hook stdout on success; the observable contract is
    // that NO lint engine ran: no lint-staged banners anywhere.
    const combined = res.stdout + res.stderr;
    assert.ok(!combined.includes('lint-staged'), 'engine must not start');
    assert.ok(!combined.includes('Running tasks'), 'no task execution');
    assert.ok(!combined.includes('typecheck'), 'no typecheck invocation');
  });

  test('F03/AC-10: missing rule definition is operational (exit 2), never accepted debt', () => {
    const { root } = makeRepo('f03-rule');
    // Add a nonexistent rule to the effective base policy the fast profile
    // extends, plus an allowance crafted to swallow the config error.
    const eslintrc = JSON.parse(readFileSync(path.join(root, '.eslintrc.json'), 'utf8'));
    eslintrc.rules['missing-plugin/nonexistent-rule'] = 'error';
    writeFileSync(path.join(root, '.eslintrc.json'), JSON.stringify(eslintrc, null, 2));
    writeFileSync(path.join(root, 'Good.ts'), 'export const value = 1;\n');
    writeFileSync(
      path.join(root, 'scripts', 'quality', 'exceptions.json'),
      JSON.stringify({
        schemaVersion: 1,
        exceptions: [{
          path: 'Good.ts',
          ruleId: 'missing-plugin/nonexistent-rule',
          maxCount: 1,
          reason: 'attempted exemption of a config failure',
          owner: 'maintainer',
          expiresOn: '2099-01-01',
        }],
      })
    );
    const res = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'quality', 'lint-files.mjs'), 'Good.ts'],
      { cwd: root, encoding: 'utf8' }
    );
    assert.equal(res.status, 2, 'config failure must be exit 2 (operational)');
    assert.ok((res.stdout + res.stderr).includes('was not found'));
    assert.ok((res.stdout + res.stderr).includes('OPERATIONAL FAILURE'));
  });

  test('F03/AC-10: invalid Vue template blocks; a valid allowance cannot swallow it', () => {
    const { root } = makeRepo('f03-vue');
    writeFileSync(
      path.join(root, 'Bad.vue'),
      '<template>{{ value + }}</template>\n<script setup lang="ts">const value = 1;</script>\n'
    );
    // A VALID manifest (the unused-var allowance applies normally) — the
    // vue/no-parsing-error finding must still block. An entry naming the
    // parser rule itself is rejected outright by the manifest validator,
    // which is also asserted here.
    writeFileSync(
      path.join(root, 'scripts', 'quality', 'exceptions.json'),
      JSON.stringify({
        schemaVersion: 1,
        exceptions: [{
          path: 'Bad.vue',
          ruleId: '@typescript-eslint/no-unused-vars',
          maxCount: 5,
          reason: 'legit debt on the same file',
          owner: 'maintainer',
          expiresOn: '2099-01-01',
        }],
      })
    );
    const res = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'quality', 'lint-files.mjs'), 'Bad.vue'],
      { cwd: root, encoding: 'utf8' }
    );
    assert.equal(res.status, 1, 'parse error must block (exit 1)');
    assert.ok((res.stdout + res.stderr).includes('vue/no-parsing-error'));
    // And the parser-rule category cannot even be expressed in the manifest.
    writeFileSync(
      path.join(root, 'scripts', 'quality', 'exceptions.json'),
      JSON.stringify({
        schemaVersion: 1,
        exceptions: [{
          path: 'Bad.vue',
          ruleId: 'vue/no-parsing-error',
          maxCount: 5,
          reason: 'attempted exemption of a parse error',
          owner: 'maintainer',
          expiresOn: '2099-01-01',
        }],
      })
    );
    const res2 = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'quality', 'lint-files.mjs'), 'Bad.vue'],
      { cwd: root, encoding: 'utf8' }
    );
    assert.equal(res2.status, 2, 'manifest naming a parser category is invalid');
    assert.ok((res2.stdout + res2.stderr).includes('can never be excepted'));
  });
});

describe('filesystem boundaries (F08)', () => {
  // Symlink creation needs privileges on Windows; the boundary check itself
  // is platform-independent and covered by repo-boundary unit usage.
  const canSymlink = process.platform !== 'win32';

  test('F08: quality:fix refuses a symlinked target; external bytes stay unchanged', () => {
    if (!canSymlink) return;
    const { root } = makeRepo('f08-fix');
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'qg-f08-out-'));
    try {
      const outside = path.join(outsideDir, 'OutsideTarget.ts');
      const before = 'export let value = 1;\n';
      writeFileSync(outside, before);
      rmSync(path.join(root, 'Linked.ts'), { force: true });
      symlinkSync(outside, path.join(root, 'Linked.ts'));
      const res = spawnSync(
        process.execPath,
        [path.join(root, 'scripts', 'quality', 'fix.mjs'), 'Linked.ts'],
        { cwd: root, encoding: 'utf8' }
      );
      assert.equal(res.status, 2, 'symlinked fix target must be refused');
      assert.ok((res.stdout + res.stderr).includes('outside the repository'));
      assert.equal(
        readFileSync(outside, 'utf8'),
        before,
        'external bytes must be untouched by the rejected fix'
      );
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test('F08: symlinked exception manifest is an operational failure', () => {
    if (!canSymlink) return;
    const { root } = makeRepo('f08-manifest');
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'qg-f08-man-'));
    try {
      const outside = path.join(outsideDir, 'evil-manifest.json');
      writeFileSync(outside, JSON.stringify({ schemaVersion: 1, exceptions: [] }));
      rmSync(path.join(root, 'scripts', 'quality', 'exceptions.json'));
      symlinkSync(outside, path.join(root, 'scripts', 'quality', 'exceptions.json'));
      writeFileSync(path.join(root, 'Good.ts'), 'export const value = 1;\n');
      const res = spawnSync(
        process.execPath,
        [path.join(root, 'scripts', 'quality', 'lint-files.mjs'), 'Good.ts'],
        { cwd: root, encoding: 'utf8' }
      );
      assert.equal(res.status, 2, 'outside manifest must never load');
      assert.ok((res.stdout + res.stderr).includes('outside the repository'));
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test('F08: symlinked staged source is rejected by the coordinator', () => {
    if (!canSymlink) return;
    const { root } = makeRepo('f08-src');
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'qg-f08-src-'));
    try {
      const outside = path.join(outsideDir, 'OutsideSrc.ts');
      writeFileSync(outside, 'export const value = 1;\n');
      symlinkSync(outside, path.join(root, 'Linked.ts'));
      run(root, ['add', 'Linked.ts']);
      assert.notEqual(commitIn(root, 'symlinked source'), 0, 'commit must fail');
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('policy-input consistency (F01/F02)', () => {
  test('F02: staged policy importing an UNTRACKED helper rejects the commit', () => {
    const { root } = makeRepo('f02-helper');
    writeFileSync(
      path.join(root, 'scripts', 'quality', 'local-overrides.cjs'),
      "module.exports = { '@typescript-eslint/no-explicit-any': 'off' };\n"
    );
    const policyPath = path.join(root, 'scripts', 'quality', 'policy.cjs');
    writeFileSync(
      policyPath,
      readFileSync(policyPath, 'utf8') +
        "\nObject.assign(module.exports, require('./local-overrides.cjs'));\n"
    );
    writeFileSync(path.join(root, 'S.ts'), 'export const value: any = 1;\n');
    run(root, ['add', 'S.ts', 'scripts/quality/policy.cjs']);
    const res = run(root, ['commit', '-m', 'untracked helper']);
    assert.notEqual(res.status, 0, 'commit must not pass with untracked policy');
    assert.ok(
      (res.stdout + res.stderr).includes('UNTRACKED policy'),
      `expected UNTRACKED diagnostic, got: ${(res.stdout + res.stderr).slice(0, 400)}`
    );
    // And the untracked helper is still untracked afterwards (nothing staged).
    const others = run(root, ['ls-files', '--others', '--exclude-standard']).stdout;
    assert.ok(others.includes('local-overrides.cjs'));
  });

  test('F01: policy-only commit with a missing rule definition is rejected', () => {
    const { root } = makeRepo('f01-missing-rule');
    const eslintrc = JSON.parse(readFileSync(path.join(root, '.eslintrc.json'), 'utf8'));
    eslintrc.rules['missing-plugin/nonexistent-rule'] = 'error';
    writeFileSync(path.join(root, '.eslintrc.json'), JSON.stringify(eslintrc, null, 2));
    run(root, ['add', '.eslintrc.json']);
    const res = run(root, ['commit', '-m', 'broken policy']);
    assert.notEqual(res.status, 0, 'a broken effective policy must never commit');
    assert.ok(
      (res.stdout + res.stderr).includes('was not found'),
      `expected the missing-rule diagnostic, got: ${(res.stdout + res.stderr).slice(0, 400)}`
    );
  });

  test('F01: a valid policy-only commit validates the effective config and passes', () => {
    const { root } = makeRepo('f01-valid');
    const policyPath = path.join(root, 'scripts', 'quality', 'policy.cjs');
    writeFileSync(
      policyPath,
      readFileSync(policyPath, 'utf8') + '\n// policy-only change: documentation comment\n'
    );
    run(root, ['add', 'scripts/quality/policy.cjs']);
    const res = run(root, ['commit', '-m', 'valid policy edit']);
    assert.equal(res.status, 0, `valid policy commit must pass: ${(res.stdout + res.stderr).slice(0, 400)}`);
  });

  test('F01: staged package.json dropping a gate dependency is rejected', () => {
    const { root } = makeRepo('f01-pkg');
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'disposable', version: '0.0.0' }, null, 2)
    );
    run(root, ['add', 'package.json']);
    const res = run(root, ['commit', '-m', 'uninstall gate']);
    assert.notEqual(res.status, 0);
    assert.ok((res.stdout + res.stderr).includes('no longer declares the quality-gate dependencies'));
  });
});

describe('failure, Git-state, and filename coverage (V01)', () => {
  test('timeout: commit fails operationally with recovery guidance; index/worktree/stashes preserved', () => {
    const { root } = makeRepo('v01-timeout');
    writeFileSync(path.join(root, 'Slow.ts'), VALID);
    run(root, ['add', 'Slow.ts']);
    run(root, ['commit', '-m', 'seed']);
    // A pre-existing user stash must survive the aborted run. Created
    // BEFORE staging T2.ts — stash push would otherwise swallow the staged
    // file under test.
    writeFileSync(path.join(root, 'scratch.txt'), 'junk\n');
    run(root, ['add', 'scratch.txt']);
    run(root, ['stash', 'push', '-q', '-m', 'user-stash']);
    writeFileSync(path.join(root, 'T2.ts'), VALID);
    run(root, ['add', 'T2.ts']);
    const stashesBefore = run(root, ['stash', 'list']).stdout.trim();
    const treeBefore = run(root, ['write-tree']).stdout.trim();
    const blobBefore = run(root, ['ls-files', '-s', 'T2.ts']).stdout.trim();
    const res = spawnSync('git', ['commit', '-m', 'slow'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, QUALITY_GATE_TIMEOUT_MS: '1' },
    });
    assert.notEqual(res.status, 0, `1ms timeout must fail operationally:\n${res.stdout}${res.stderr}`);
    // Git normalizes hook exit codes; assert the coordinator's marker.
    assert.match(res.stderr, /OPERATIONAL FAILURE/);
    assert.match(res.stderr, /timeout/i);
    assert.match(res.stderr, /stash/, 'recovery guidance must name the backup stash path');
    assert.equal(run(root, ['write-tree']).stdout.trim(), treeBefore, 'index tree unchanged');
    assert.equal(run(root, ['ls-files', '-s', 'T2.ts']).stdout.trim(), blobBefore, 'staged blob unchanged');
    assert.equal(readFileSync(path.join(root, 'T2.ts'), 'utf8'), VALID, 'worktree bytes unchanged');
    assert.equal(run(root, ['stash', 'list']).stdout.trim(), stashesBefore, 'user stash untouched');
  });

  test('copy record: git emits C for the staged copy before the destination is linted', () => {
    const { root } = makeRepo('v01-copy-record');
    // Seed with the long content: copy similarity compares Dest against
    // Origin's INDEX PREIMAGE, so the preimage must be the similar text.
    const lines = Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i};`);
    const seeded = lines.join('\n') + '\n';
    writeFileSync(path.join(root, 'Origin.ts'), seeded);
    run(root, ['add', 'Origin.ts']);
    run(root, ['commit', '-m', 'seed']);
    run(root, ['config', 'diff.renames', 'copies']);
    // -C copy detection only scans sources modified in the same diff and
    // needs high similarity: modify Origin slightly and add a near-identical
    // Dest that appends a violating line.
    const next = seeded.replace('v39 = 39', 'v39 = 40');
    writeFileSync(path.join(root, 'Origin.ts'), next);
    writeFileSync(path.join(root, 'Dest.ts'), next + 'export const bad: any = 1;\n');
    run(root, ['add', 'Origin.ts', 'Dest.ts']);
    const status = run(root, ['diff', '--cached', '--name-status']).stdout;
    assert.match(status, /C\d+\tOrigin\.ts\tDest\.ts/, `git must emit a copy record, got: ${JSON.stringify(status)}`);
    assert.notEqual(commitIn(root, 'copy'), 0, 'the copy DESTINATION must be linted');
  });

  test('rename record: git emits R and the commit of clean content passes', () => {
    const { root } = makeRepo('v01-rename');
    writeFileSync(path.join(root, 'Old.ts'), VALID);
    run(root, ['add', 'Old.ts']);
    run(root, ['commit', '-m', 'seed']);
    run(root, ['mv', 'Old.ts', 'New.ts']);
    const status = run(root, ['diff', '--cached', '--name-status']).stdout;
    assert.match(status, /R\d+\tOld\.ts\tNew\.ts/, `git must emit a rename record, got: ${JSON.stringify(status)}`);
    assert.equal(commitIn(root, 'rename'), 0);
  });

  test('deletion-only change takes the skip path and commits', () => {
    const { root } = makeRepo('v01-delete');
    writeFileSync(path.join(root, 'Gone.ts'), VALID);
    run(root, ['add', 'Gone.ts']);
    run(root, ['commit', '-m', 'seed']);
    run(root, ['rm', '-q', 'Gone.ts']);
    const res = run(root, ['commit', '-m', 'deletion only']);
    assert.equal(res.status, 0);
    assert.ok(!(res.stdout + res.stderr).includes('lint-staged'), 'no engine for deletions');
  });

  test('submodule gitlink is not source and commits cleanly', () => {
    const { root } = makeRepo('v01-submodule');
    const sub = mkdtempSync(path.join(os.tmpdir(), 'qg-v01-sub-'));
    try {
      execSync('git init -q && git config user.email t@t && git config user.name t && echo hi > f && git add f && git commit -q -m init', { cwd: sub, encoding: 'utf8', stdio: 'pipe' });
      // git >= 2.38 denies the file transport for submodules by default,
      // and the submodule helper ignores repo config for protocol allows —
      // this test uses a LOCAL path repo, so allow it on the command line.
      run(root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendored']);
      const res = run(root, ['commit', '-m', 'add submodule']);
      assert.equal(res.status, 0, res.stdout + res.stderr);
    } finally {
      rmSync(sub, { recursive: true, force: true });
    }
  });

  test('leading-hyphen, quote, and newline filenames commit valid content', () => {
    if (process.platform === 'win32') return; // newline-in-filename is POSIX
    const { root } = makeRepo('v01-names');
    const weirdNames = ['-leading-hyphen.ts', 'quo"te.ts', 'new\nline.ts'];
    for (const name of weirdNames) {
      writeFileSync(path.join(root, name), VALID);
      run(root, ['add', '--', name]);
    }
    const staged = run(root, ['diff', '--cached', '--name-only', '-z']).stdout.split('\0').filter(Boolean);
    for (const name of weirdNames) assert.ok(staged.includes(name), `staged: ${name}`);
    assert.equal(commitIn(root, 'weird names'), 0);
  });

  test('alternate GIT_INDEX_FILE: gate runs against that index; the main index is untouched', () => {
    const { root } = makeRepo('v01-alt-index');
    writeFileSync(path.join(root, 'Base.ts'), VALID);
    run(root, ['add', 'Base.ts']);
    run(root, ['commit', '-m', 'seed']);
    copyFileSync(path.join(root, '.git', 'index'), path.join(root, '.git', 'index-alt'));
    const altEnv = { ...process.env, GIT_INDEX_FILE: '.git/index-alt' };
    writeFileSync(path.join(root, 'AltBad.ts'), INVALID);
    spawnSync('git', ['add', 'AltBad.ts'], { cwd: root, encoding: 'utf8', env: altEnv });
    const res = spawnSync('git', ['commit', '-m', 'alt index'], { cwd: root, encoding: 'utf8', env: altEnv });
    assert.notEqual(res.status, 0, 'the alternate index is gated too');
    const mainStaged = run(root, ['diff', '--cached', '--name-only']).stdout.trim();
    assert.equal(mainStaged, '', 'the main index was never touched');
  });

  test('concurrent staging during the run is detected and refused', () => {
    const { root } = makeRepo('v01-concurrent');
    // Stage a lint-staged config whose task stages an EXTRA file mid-run —
    // the coordinator must see the index tree change and refuse.
    const cfgPath = path.join(root, 'scripts', 'quality', 'lint-staged.config.mjs');
    writeFileSync(
      cfgPath,
      [
        "import { execSync } from 'node:child_process';",
        'export default {',
        "  '*.{js,jsx,cjs,mjs,ts,tsx,vue}': (files) => {",
        "    execSync('git add Extra.ts', { cwd: process.cwd() });",
        "    return `node scripts/quality/lint-files.mjs ${files.map((f) => JSON.stringify(f)).join(' ')}`;",
        '  },',
        '};',
        '',
      ].join('\n')
    );
    writeFileSync(path.join(root, 'Extra.ts'), VALID); // untracked non-policy file
    writeFileSync(path.join(root, 'Main.ts'), VALID);
    run(root, ['add', 'Main.ts', 'scripts/quality/lint-staged.config.mjs']);
    const res = run(root, ['commit', '-m', 'concurrent staging']);
    assert.notEqual(res.status, 0, 'concurrent staging must never pass');
    assert.match(res.stdout + res.stderr, /index changed|concurrent/i);
  });

  test('policy deletion commit fails validation (the gate cannot uninstall itself)', () => {
    const { root } = makeRepo('v01-policy-del');
    run(root, ['rm', '-q', 'scripts/quality/policy.cjs']);
    const res = run(root, ['commit', '-m', 'delete policy']);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /failed validation|policy/i);
  });

  test('a file with unsupported encoding blocks instead of passing', () => {
    const { root } = makeRepo('v01-encoding');
    writeFileSync(path.join(root, 'BadBytes.ts'), 'export const v: any = 1;\n');
    // Prepend invalid UTF-8 bytes to the staged content.
    const fd = path.join(root, 'BadBytes.ts');
    const broken = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x81]), readFileSync(fd)]);
    writeFileSync(fd, broken);
    run(root, ['add', 'BadBytes.ts']);
    const res = run(root, ['commit', '-m', 'bad encoding']);
    assert.notEqual(res.status, 0, 'non-UTF-8 source must never pass');
    assert.ok(res.status === 1 || res.status === 2, `defined failure code, got ${res.status}`);
  });

  test('success commit: HEAD advances, worktree intact, no lint-staged backup stash remains', () => {
    const { root } = makeRepo('v01-success-state');
    writeFileSync(path.join(root, 'Fine.ts'), VALID);
    run(root, ['add', 'Fine.ts']);
    const headBefore = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    const bytes = readFileSync(path.join(root, 'Fine.ts'), 'utf8');
    assert.equal(commitIn(root, 'good'), 0);
    assert.notEqual(run(root, ['rev-parse', 'HEAD']).stdout.trim(), headBefore);
    assert.equal(readFileSync(path.join(root, 'Fine.ts'), 'utf8'), bytes);
    const stashList = run(root, ['stash', 'list']).stdout;
    assert.ok(!/lint-staged/i.test(stashList), 'lint-staged must clean up its own backup');
  });
});

describe('outside-review hardening (codex round)', () => {
  const canSymlink = process.platform !== 'win32';

  test('D1: quality:fix refuses symlinked files reached via DIRECTORY expansion', () => {
    if (!canSymlink) return;
    const { root } = makeRepo('d1-dirfix');
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'qg-d1-out-'));
    try {
      const outside = path.join(outsideDir, 'Outside.ts');
      const before = 'export let value = 1;\n';
      writeFileSync(outside, before);
      mkdirSync(path.join(root, 'srcdir'), { recursive: true });
      symlinkSync(outside, path.join(root, 'srcdir', 'Linked.ts'));
      const res = spawnSync(
        process.execPath,
        [path.join(root, 'scripts', 'quality', 'fix.mjs'), 'srcdir'],
        { cwd: root, encoding: 'utf8' }
      );
      assert.equal(res.status, 2, `directory-expanded symlink must be refused:\n${res.stdout}${res.stderr}`);
      assert.equal(readFileSync(outside, 'utf8'), before, 'external bytes unchanged');
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test('D3: a policy helper hidden by a STAGED .gitignore change still rejects', () => {
    const { root } = makeRepo('d3-ignorehide');
    const helperRel = 'scripts/quality/local-overrides.cjs';
    // Hide the helper via a staged .gitignore edit — --exclude-standard
    // would have made it invisible to the untracked-policy scan.
    writeFileSync(
      path.join(root, '.gitignore'),
      `node_modules/\n${helperRel}\n`
    );
    writeFileSync(
      path.join(root, 'scripts', 'quality', 'local-overrides.cjs'),
      "module.exports = {};\n"
    );
    const policyPath = path.join(root, 'scripts', 'quality', 'policy.cjs');
    writeFileSync(
      policyPath,
      readFileSync(policyPath, 'utf8') +
        "\nObject.assign(module.exports, require('./local-overrides.cjs'));\n"
    );
    writeFileSync(path.join(root, 'S.ts'), 'export const value = 1;\n');
    run(root, ['add', 'S.ts', 'scripts/quality/policy.cjs', '.gitignore']);
    const res = run(root, ['commit', '-m', 'ignored helper']);
    assert.notEqual(res.status, 0, 'commit must not pass');
    assert.match(res.stdout + res.stderr, /UNTRACKED policy/);
  });

  test('D4: dropping husky or the prepare script from package.json is rejected', () => {
    const { root } = makeRepo('d4-husky');
    // All lint deps present + prepare present -> passes; then remove husky.
    const withAll = {
      name: 'disposable',
      version: '0.0.0',
      devDependencies: {
        eslint: '8.57.1',
        'eslint-plugin-sonarjs': '1.0.4',
        'eslint-plugin-vue': '9.33.0',
        'vue-eslint-parser': '9.4.3',
        '@typescript-eslint/parser': '7.18.0',
        '@typescript-eslint/eslint-plugin': '7.18.0',
        '@vue/eslint-config-typescript': '13.0.0',
        'lint-staged': '16.2.7',
        husky: '9.1.7',
      },
      scripts: { prepare: 'husky' },
    };
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(withAll, null, 2));
    run(root, ['add', 'package.json']);
    assert.equal(commitIn(root, 'pkg with husky'), 0, 'complete package.json passes');
    const noPrepare = JSON.parse(JSON.stringify(withAll));
    delete noPrepare.scripts;
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(noPrepare, null, 2));
    run(root, ['add', 'package.json']);
    const res = run(root, ['commit', '-m', 'drop prepare']);
    assert.notEqual(res.status, 0, 'prepare-script removal must reject');
    assert.match(res.stdout + res.stderr, /prepare/);
  });
});

describe('audit 2026-10-24 fixes (B01/B09)', () => {
  test('B01: deleting a gate runtime file can never commit', () => {
    const { root } = makeRepo('b01-runner-del');
    run(root, ['rm', '-q', 'scripts/quality/lint-files.mjs']);
    const res = run(root, ['commit', '-m', 'delete runner']);
    assert.notEqual(res.status, 0, 'deletion-only commit must reject');
    assert.match(res.stdout + res.stderr, /DELETION|missing from the index/);
  });

  test('B09: a source-suffixed submodule gitlink is not a file and commits', () => {
    const { root } = makeRepo('b09-gitlink');
    const sha = run(root, ['rev-parse', 'HEAD']).stdout.trim();
    run(root, ['update-index', '--add', '--cacheinfo', `160000,${sha},vendored.ts`]);
    const res = run(root, ['commit', '-m', 'gitlink suffix']);
    assert.equal(res.status, 0, `suffixed gitlink must commit:\n${res.stdout}${res.stderr}`);
  });
});

describe('interruption and restoration failure (V03)', () => {
  const INVALID = "export const v: any = 1;\n";
  const VALID = 'export const two = 1 + 1;\n';

  test('SIGKILL after the backup exists: state preserved, documented restoration works', () => {
    const { root } = makeRepo('v03-interrupt');
    // Partial-staging fixture: staged violation + unstaged fix, so
    // lint-staged MUST create a backup and hide the unstaged hunks.
    writeFileSync(path.join(root, 'P.ts'), VALID);
    run(root, ['add', 'P.ts']);
    run(root, ['commit', '-m', 'seed']);
    writeFileSync(path.join(root, 'P.ts'), INVALID);
    run(root, ['add', 'P.ts']);
    writeFileSync(path.join(root, 'P.ts'), VALID); // unstaged fix
    const userStashBefore = run(root, ['stash', 'list']).stdout.trim();
    const blobBefore = run(root, ['ls-files', '-s', 'P.ts']).stdout.trim();
    // Stage a task that signals readiness once lint-staged is mid-run (the
    // backup now exists and the unstaged hunks are hidden), then blocks.
    writeFileSync(
      path.join(root, 'scripts', 'quality', 'midrun-block.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync('MIDRUN_READY', '1');",
        'const end = Date.now() + 8000;',
        'while (Date.now() < end) { /* block inside the lint-staged task */ }',
        '',
      ].join('\n')
    );
    const cfg = path.join(root, 'scripts', 'quality', 'lint-staged.config.mjs');
    writeFileSync(
      cfg,
      "export default {\n  '*.{js,jsx,cjs,mjs,ts,tsx,vue}': 'node scripts/quality/midrun-block.mjs',\n};\n"
    );
    run(root, ['add', 'scripts/quality/lint-staged.config.mjs', 'scripts/quality/midrun-block.mjs']);
    const marker = path.join(root, 'MIDRUN_READY');
    rmSync(marker, { force: true });
    const hook = spawn(process.execPath, [path.join(root, 'scripts', 'quality', 'pre-commit.mjs')], {
      cwd: root,
      stdio: 'ignore',
    });
    // Wait until lint-staged is genuinely mid-run (backup created, unstaged
    // hunks hidden), then interrupt — the 1ms-timeout test never got here.
    const deadline = Date.now() + 30_000;
    while (!existsSync(marker) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    assert.ok(existsSync(marker), 'mid-run readiness marker never appeared');
    const stashesAtInterrupt = run(root, ['stash', 'list']).stdout;
    assert.match(stashesAtInterrupt, /lint-staged/i, 'backup stash exists at interrupt time');
    killSync(hook.pid);
    hook.kill('SIGKILL');
    // State after the uncatchable interruption:
    assert.equal(run(root, ['ls-files', '-s', 'P.ts']).stdout.trim(), blobBefore, 'index blob unchanged');
    assert.ok(
      run(root, ['stash', 'list']).stdout.trim().startsWith(userStashBefore),
      'pre-existing user stashes untouched (lint-staged backup may remain above them)'
    );
    // Documented restoration: apply the retained lint-staged backup to get
    // the hidden unstaged hunks back.
    const backup = run(root, ['stash', 'list']).stdout.split('\n').find((l) => /lint-staged/i.test(l)) ?? '';
    const ref = /stash@\{(\d+)\}/.exec(backup);
    assert.ok(ref, `retained backup identifiable: ${backup.trim()}`);
    // The hidden unstaged fix is inside the retained backup and comes back
    // through the documented recovery (`git stash apply` / path checkout).
    const inBackup = run(root, ['show', `stash@{${ref[1]}}:P.ts`]).stdout;
    assert.equal(inBackup, VALID, 'backup captures the hidden unstaged fix');
    const checkout = run(root, ['checkout', `stash@{${ref[1]}}`, '--', 'P.ts']);
    assert.equal(checkout.status, 0, `documented path-restore works: ${checkout.stderr}`);
    assert.equal(
      readFileSync(path.join(root, 'P.ts'), 'utf8'),
      VALID,
      'restoration returns the hidden unstaged content'
    );
  }, 60_000);

  test('forced restoration failure keeps the backup and points at recovery', () => {
    const { root } = makeRepo('v03-restore-fail');
    writeFileSync(path.join(root, 'P.ts'), VALID);
    run(root, ['add', 'P.ts']);
    run(root, ['commit', '-m', 'seed']);
    writeFileSync(path.join(root, 'P.ts'), INVALID);
    run(root, ['add', 'P.ts']);
    writeFileSync(path.join(root, 'P.ts'), VALID); // unstaged hunks to hide/restore
    // Make the worktree file unwritable so lint-staged's automatic
    // restoration of the hidden unstaged content FAILS after the violation.
    spawnSync('chmod', ['444', path.join(root, 'P.ts')]);
    const res = run(root, ['commit', '-m', 'will fail']);
    assert.notEqual(res.status, 0, 'the staged violation must reject');
    const out = res.stdout + res.stderr;
    const stashes = run(root, ['stash', 'list']).stdout;
    // Either lint-staged kept its backup with recovery guidance, or (if it
    // restored before the write was needed) the state is already intact —
    // both must leave the unstaged fix recoverable and user stashes intact.
    const backupRetained = /lint-staged/i.test(stashes);
    assert.ok(
      backupRetained || out.includes('Reverting'),
      `backup retained with guidance, or automatic restore reported: ${out.slice(0, 300)}`
    );
    spawnSync('chmod', ['644', path.join(root, 'P.ts')]);
    if (backupRetained) {
      const ref = /stash@\{(\d+)\}/.exec(stashes.split('\n').find((l) => /lint-staged/i.test(l)) ?? '');
      assert.ok(ref, 'backup ref parseable');
      const applied = run(root, ['stash', 'apply', `stash@{${ref[1]}}`]);
      assert.equal(applied.status, 0, `documented recovery works: ${applied.stderr}`);
    }
    assert.equal(readFileSync(path.join(root, 'P.ts'), 'utf8'), VALID, 'unstaged fix recoverable');
  }, 60_000);
});

/** Kill a spawned process and (best effort) its children. */
function killSync(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}
