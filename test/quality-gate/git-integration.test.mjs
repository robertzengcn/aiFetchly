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
import { execSync, spawnSync } from 'node:child_process';
import {
  mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync, readFileSync, mkdtempSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const realRepo = process.cwd();
const sandboxes = [];

/** Create a disposable repo wired to run the real gate on ITS tree. */
function makeRepo(name) {
  const root = path.join(os.tmpdir(), `qg-git-${name}-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const git = (args, opts = {}) =>
    execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: 'pipe', ...opts });
  git('init -q');
  git('config user.email t@t'); git('config user.name t');
  git('config core.hooksPath .husky/_');
  // Copy the gate + base config; symlink node_modules.
  cpSync(path.join(realRepo, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  cpSync(path.join(realRepo, '.eslintrc.json'), path.join(root, '.eslintrc.json'));
  cpSync(path.join(realRepo, 'tsconfig.json'), path.join(root, 'tsconfig.json'));
  symlinkSync(path.join(realRepo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  // Minimal manifest so exceptions resolve deterministically.
  writeFileSync(
    path.join(root, 'scripts', 'quality', 'exceptions.json'),
    JSON.stringify({ schemaVersion: 1, exceptions: [] })
  );
  // husky-9 shim layout: the hook git actually executes.
  mkdirSync(path.join(root, '.husky', '_'), { recursive: true });
  writeFileSync(
    path.join(root, '.husky', '_', 'pre-commit'),
    '#!/usr/bin/env sh\nnode "$PWD/scripts/quality/pre-commit.mjs"\n'
  );
  execSync(`chmod +x ${path.join(root, '.husky', '_', 'pre-commit')}`);
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
    run(root, ['config', 'core.hooksPath', '/dev/null']);
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
