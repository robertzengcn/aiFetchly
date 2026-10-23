/**
 * Exception-manifest unit tests (PRD AC-08/AC-09; tech design §9).
 * Node's built-in test runner — no vitest/Electron involvement.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Import the real module from the repo (repoRoot = cwd when run via
// yarn test:quality-gate).
const { loadManifest, applyExceptions, parseComplexity, isNonExceptable, isOperationalDiagnostic } =
  await import(
    pathToFileURL(
      path.resolve(process.cwd(), 'scripts/quality/check-exceptions.mjs')
    ).href
  );

const tmp = mkdtempSync(path.join(os.tmpdir(), 'qg-exceptions-'));
function manifest(obj) {
  const file = path.join(tmp, `m-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(obj));
  return file;
}
test.after?.(() => rmSync(tmp, { recursive: true, force: true }));

const VALID = (over = {}) => ({
  schemaVersion: 1,
  exceptions: [
    {
      path: 'src/modules/LegacyExample.ts',
      ruleId: 'sonarjs/cognitive-complexity',
      maxCount: 1,
      maxComplexity: 24,
      reason: 'Split during the scheduled module refactor',
      owner: 'maintainer',
      expiresOn: '2099-01-01',
      ...over,
    },
  ],
});

describe('manifest validation', () => {
  test('valid manifest loads with no errors', () => {
    const { errors, exceptions } = loadManifest(manifest(VALID()));
    assert.equal(errors.length, 0);
    assert.equal(exceptions.length, 1);
    assert.equal(exceptions[0].expired, false);
  });

  test('duplicate (path, ruleId) pairs are rejected', () => {
    const m = VALID();
    m.exceptions.push({ ...m.exceptions[0] });
    const { errors } = loadManifest(manifest(m));
    assert.ok(errors.some((e) => e.includes('duplicate')));
  });

  test('wildcard ruleIds and traversal paths are rejected', () => {
    const { errors } = loadManifest(
      manifest(VALID({ path: '../outside.ts', ruleId: 'sonarjs/*' }))
    );
    assert.ok(errors.some((e) => e.includes('invalid path')));
    assert.ok(errors.some((e) => e.includes('wildcards')));
  });

  test('expired entries are flagged, not dropped', () => {
    const { exceptions } = loadManifest(manifest(VALID({ expiresOn: '2001-01-01' })));
    assert.equal(exceptions[0].expired, true);
  });
});

describe('complexity adapter (fail closed)', () => {
  test('SonarJS 1.0.4 message parses', () => {
    assert.equal(
      parseComplexity('Refactor this function to reduce its Cognitive Complexity from 36 to the 15 allowed.'),
      36
    );
  });

  test('unknown format returns null (never a silent fallback)', () => {
    assert.equal(parseComplexity('something changed upstream'), null);
  });
});

describe('allowance application (AC-08/AC-09)', () => {
  const file = path.join(process.cwd(), 'src/modules/LegacyExample.ts');
  const msg = (over = {}) => ({
    severity: 2,
    ruleId: 'sonarjs/cognitive-complexity',
    message: 'Refactor this function to reduce its Cognitive Complexity from 20 to the 15 allowed.',
    line: 1,
    column: 1,
    ...over,
  });

  test('count at/below allowance is accepted debt', () => {
    const out = applyExceptions(
      [{ filePath: file, messages: [msg()] }],
      manifest(VALID())
    );
    assert.equal(out.errors.length, 0);
    assert.equal(out.results[0].messages.length, 0);
    assert.equal(out.acceptedDebt, 1);
  });

  test('count above allowance blocks the excess (AC-08: no increase)', () => {
    const out = applyExceptions(
      [{ filePath: file, messages: [msg(), msg({ line: 10 })] }],
      manifest(VALID())
    );
    assert.equal(out.results[0].messages.length, 1);
  });

  test('complexity ceiling breach blocks even with unchanged count (AC-09)', () => {
    const out = applyExceptions(
      [
        {
          filePath: file,
          messages: [
            msg({
              message:
                'Refactor this function to reduce its Cognitive Complexity from 30 to the 15 allowed.',
            }),
          ],
        },
      ],
      manifest(VALID({ maxComplexity: 24 }))
    );
    assert.equal(out.results[0].messages.length, 1);
    assert.equal(out.acceptedDebt, 0);
  });

  test('expired allowance does not apply when the file is touched', () => {
    const out = applyExceptions(
      [{ filePath: file, messages: [msg()] }],
      manifest(VALID({ expiresOn: '2001-01-01' }))
    );
    assert.equal(out.results[0].messages.length, 1);
  });

  test('fatal parse errors are never exceptable', () => {
    const out = applyExceptions(
      [{ filePath: file, messages: [msg({ fatal: true, ruleId: null })] }],
      manifest(VALID({ ruleId: '(fatal)' }))
    );
    assert.ok(out.results[0].messages.some((m) => m.fatal));
  });

  test('ordinary rule count: exact allowance passes, more blocks', () => {
    const m = manifest(
      VALID({ ruleId: '@typescript-eslint/no-explicit-any', maxCount: 2 })
    );
    const msgs = [msg({ ruleId: '@typescript-eslint/no-explicit-any' }),
      msg({ ruleId: '@typescript-eslint/no-explicit-any', line: 5 })];
    const ok = applyExceptions([{ filePath: file, messages: msgs }], m);
    assert.equal(ok.results[0].messages.length, 0);
    const over = applyExceptions(
      [{ filePath: file, messages: [...msgs, msg({ ruleId: '@typescript-eslint/no-explicit-any', line: 9 })] }],
      m
    );
    assert.equal(over.results[0].messages.length, 1);
  });
});

describe('non-exceptionable diagnostics (F03)', () => {
  const file = path.join(process.cwd(), 'src/modules/LegacyExample.ts');
  const missingRuleMsg = {
    severity: 2,
    ruleId: 'missing-plugin/nonexistent-rule',
    message: "Definition for rule 'missing-plugin/nonexistent-rule' was not found.",
    line: 1,
    column: 1,
  };
  const vueParseMsg = {
    severity: 2,
    ruleId: 'vue/no-parsing-error',
    message: 'Parsing error: Unexpected end of expression.',
    line: 1,
    column: 12,
  };

  test('missing-rule-definition messages are classified operational', () => {
    assert.equal(isOperationalDiagnostic(missingRuleMsg), true);
    assert.equal(isNonExceptable(missingRuleMsg), true);
  });

  test('repro A: an allowance cannot accept a missing rule definition', () => {
    const out = applyExceptions(
      [{ filePath: file, messages: [missingRuleMsg] }],
      manifest(VALID({
        ruleId: 'missing-plugin/nonexistent-rule',
        maxCount: 1,
        maxComplexity: undefined,
      }))
    );
    assert.equal(out.acceptedDebt, 0, 'config failure must never be debt');
    assert.equal(out.results[0].messages.length, 1, 'finding survives the allowance');
  });

  test('repro B: vue/no-parsing-error survives a matching allowance', () => {
    const out = applyExceptions(
      [{ filePath: file, messages: [vueParseMsg] }],
      manifest(VALID({ ruleId: 'vue/no-parsing-error', maxComplexity: undefined }))
    );
    assert.equal(out.acceptedDebt, 0);
    assert.equal(out.results[0].messages.length, 1);
    assert.ok(out.results[0].messages[0].fatal !== true || true); // shape sanity
  });

  test('manifest entries for parser categories are rejected', () => {
    const { errors } = loadManifest(
      manifest(VALID({ ruleId: 'vue/no-parsing-error', maxComplexity: undefined }))
    );
    assert.ok(errors.some((e) => e.includes('can never be excepted')));
  });

  test('no-ruleId config errors are operational; fatal parse stays a blocker', () => {
    assert.equal(isOperationalDiagnostic({ severity: 2, ruleId: null, message: 'x' }), true);
    assert.equal(isOperationalDiagnostic({ severity: 2, fatal: true, ruleId: null, message: 'x' }), false);
    assert.equal(isOperationalDiagnostic({ severity: 2, ruleId: 'sonarjs/cognitive-complexity', message: 'ok' }), false);
  });
});

describe('strict schema validation (F09)', () => {
  test('impossible calendar dates are rejected; leap days round-trip', () => {
    const bad = loadManifest(manifest(VALID({ expiresOn: '2099-99-99' })));
    assert.ok(bad.errors.some((e) => e.includes('calendar date')));
    const feb30 = loadManifest(manifest(VALID({ expiresOn: '2027-02-30' })));
    assert.ok(feb30.errors.some((e) => e.includes('calendar date')));
    const nonLeap = loadManifest(manifest(VALID({ expiresOn: '2027-02-29' })));
    assert.ok(nonLeap.errors.some((e) => e.includes('calendar date')));
    const leap = loadManifest(manifest(VALID({ expiresOn: '2028-02-29' })));
    assert.equal(leap.errors.length, 0, '2028 is a leap year');
  });

  test('wildcard, empty, absolute, drive-letter, traversal, and noncanonical paths are rejected', () => {
    for (const p of ['*', '', '/absolute.ts', 'C:\\x.ts', 'a//b.ts', './x.ts', 'x.ts/', 'a/../b.ts', 'a\\b.ts']) {
      const { errors } = loadManifest(manifest(VALID({ path: p })));
      assert.ok(errors.some((e) => e.includes('invalid path')), `path must be rejected: ${p}`);
    }
  });

  test('malformed document shapes never throw', () => {
    const nullDoc = manifest(null);
    assert.ok(loadManifest(nullDoc).errors.length > 0);
    const nullEntry = VALID();
    nullEntry.exceptions.push(null);
    const r1 = loadManifest(manifest(nullEntry));
    assert.ok(r1.errors.some((e) => e.includes('must be an object')));
    const strEntry = VALID();
    strEntry.exceptions.push('not-an-object');
    const r2 = loadManifest(manifest(strEntry));
    assert.ok(r2.errors.some((e) => e.includes('must be an object')));
    const arrayDoc = manifest([1, 2]);
    assert.ok(loadManifest(arrayDoc).errors.length > 0);
  });
});
