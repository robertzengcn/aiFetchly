/**
 * Architecture direct-import checks (PRD AC-11/AC-12; tech design §8).
 * Exercises the dedicated AST pass over fixture files in worker/IPC scopes.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

const repoRoot = process.cwd();
const { checkArchitecture, collectDirectImports } = await import(
  pathToFileURL(path.resolve(repoRoot, 'scripts/quality/architecture-check.mjs')).href
);

// Fixtures under tmp-quality-arch/src/... so the scope regexes match real
// worker/IPC paths relative to repoRoot.
const base = path.join(repoRoot, 'tmp-quality-arch');
const workerDir = path.join(base, 'src', 'childprocess');
const ipcDir = path.join(base, 'src', 'main-process', 'communication');
const otherDir = path.join(base, 'src', 'modules');

function rel(p) {
  return path.relative(repoRoot, p).split(path.sep).join('/');
}

before(() => {
  rmSync(base, { recursive: true, force: true });
  for (const d of [workerDir, ipcDir, otherDir]) mkdirSync(d, { recursive: true });

  writeFileSync(
    path.join(workerDir, 'bad-import.ts'),
    "import { SqliteDb } from '@/config/SqliteDb';\nexport const x = 1;\n"
  );
  writeFileSync(
    path.join(workerDir, 'type-only.ts'),
    "import type { Shape } from '@/entityTypes/shape';\nimport type { E } from '@/entity/E.entity';\nexport const y = 1;\n"
  );
  writeFileSync(
    path.join(workerDir, 'require-and-dynamic.ts'),
    "const orm = require('typeorm');\nexport async function later(): Promise<unknown> {\n  return import('better-sqlite3');\n}\n"
  );
  writeFileSync(
    path.join(workerDir, 'allowed.ts'),
    "import { helper } from '@/modules/Helper';\nexport const z = helper;\n"
  );
  writeFileSync(
    path.join(ipcDir, 'bad-ipc.ts'),
    "import { Repository } from 'typeorm';\nimport { ContactInfoModel } from '@/model/ContactInfo.model';\nexport const w = 1;\n"
  );
  writeFileSync(
    path.join(otherDir, 'model-use-ok.ts'),
    "import { ContactInfoModel } from '@/model/ContactInfo.model';\nexport const v = ContactInfoModel;\n"
  );
  // F06: alias traversal must normalize before prefix comparison.
  writeFileSync(
    path.join(workerDir, 'alias-traversal.ts'),
    "import { Foo } from '@/entityTypes/../model/Foo.model';\nexport const t = Foo;\n"
  );
  writeFileSync(
    path.join(workerDir, 'alias-traversal-config.ts'),
    "import { SqliteDb } from '@/modules/../config/SqliteDb';\nexport const u = SqliteDb;\n"
  );
  writeFileSync(
    path.join(workerDir, 'unrelated-utils.ts'),
    "import { util } from '@/utils.ts';\nexport const s = util;\n"
  );
  // F07: TS import-equals and inline-type exports.
  writeFileSync(
    path.join(workerDir, 'import-equals.ts'),
    "import Db = require('typeorm');\nexport { Db };\n"
  );
  writeFileSync(
    path.join(workerDir, 'export-type-only.ts'),
    "export { type Shape } from '@/entityTypes/shape';\nexport { type E } from '@/entity/E.entity';\nexport const q = 1;\n"
  );
  writeFileSync(
    path.join(workerDir, 'export-mixed.ts'),
    "export { type E, Other } from '@/entity/E.entity';\nexport const r = Other;\n"
  );
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

function findingsFor(relPath) {
  return checkArchitecture([path.join(repoRoot, relPath)], repoRoot);
}

describe('worker boundary (AC-11)', () => {
  test('@/ alias database import is prohibited with a real position', () => {
    const findings = findingsFor(rel(path.join(workerDir, 'bad-import.ts')));
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].ruleId, 'aifetchly/no-worker-db-imports');
    assert.ok(findings[0].line >= 1 && findings[0].column >= 1, 'line/column reported');
    assert.ok(findings[0].message.includes('@/config/SqliteDb'));
  });

  test('relative model import from a real-tree worker path is prohibited (unit)', async () => {
    const internals = nodeRequire(
      path.join(repoRoot, 'scripts/quality/rules/index.cjs')
    )._internals;
    // Real-tree depth: src/childprocess/worker.ts + ../model → src/model
    // (one level up from childprocess IS src). Two levels would leave src/.
    assert.equal(
      internals.isProhibited('../model/Foo.model', 'src/childprocess/worker.ts', ['src/model', 'src/entity', 'src/config/SqliteDb'], ['typeorm']),
      true
    );
    assert.equal(
      internals.isProhibited('../entityTypes/shape', 'src/childprocess/worker.ts', ['src/model', 'src/entity', 'src/config/SqliteDb'], ['typeorm']),
      false,
      'entityTypes stays allowed'
    );
  });

  test('type-only imports are allowed (cannot initialize persistence)', () => {
    const findings = findingsFor(rel(path.join(workerDir, 'type-only.ts')));
    assert.equal(findings.length, 0, JSON.stringify(findings));
  });

  test('literal require() and literal dynamic import() are prohibited', () => {
    const findings = findingsFor(rel(path.join(workerDir, 'require-and-dynamic.ts')));
    assert.equal(findings.length, 2, JSON.stringify(findings));
    assert.ok(
      findings.some((f) => f.message.includes('typeorm')),
      'typeorm require detected'
    );
    assert.ok(
      findings.some((f) => f.message.includes('better-sqlite3')),
      'dynamic import detected'
    );
  });

  test('shared modules remain allowed', () => {
    const findings = findingsFor(rel(path.join(workerDir, 'allowed.ts')));
    assert.equal(findings.length, 0);
  });
});

describe('IPC boundary (AC-12)', () => {
  test('TypeORM and model imports are prohibited', () => {
    const findings = findingsFor(rel(path.join(ipcDir, 'bad-ipc.ts')));
    assert.equal(findings.length, 2, JSON.stringify(findings));
    assert.ok(findings.every((f) => f.ruleId === 'aifetchly/no-ipc-db-imports'));
  });

  test('modules outside the scoped directories are untouched', () => {
    const findings = findingsFor(rel(path.join(otherDir, 'model-use-ok.ts')));
    assert.equal(findings.length, 0);
  });
});

describe('collectDirectImports internals', () => {
  test('non-literal dynamic import is not flagged (no false promise)', async () => {
    const mod = await import(
      pathToFileURL(path.resolve(repoRoot, 'scripts/quality/architecture-check.mjs')).href
    );
    const code = 'const p = import(nameVariable);\n';
    const ast = mod._internals.parseFor('x.ts', code);
    const found = collectDirectImports(ast, code);
    assert.equal(found.length, 0);
  });
});

describe('audit bug fixes (BUG-7/8/9)', () => {
  test('BUG-7: SqliteDb with extension or index segment is prohibited', async () => {
    const internals = nodeRequire(
      path.join(repoRoot, 'scripts/quality/rules/index.cjs')
    )._internals;
    const P = ['src/model', 'src/entity', 'src/config/SqliteDb'];
    const pkgs = ['typeorm', 'better-sqlite3'];
    for (const spec of ['@/config/SqliteDb.ts', '@/config/SqliteDb.js', '@/config/SqliteDb/index.ts']) {
      assert.equal(internals.isProhibited(spec, 'src/childprocess/w.ts', P, pkgs), true, spec);
    }
    // Near-miss file name is NOT prohibited
    assert.equal(internals.isProhibited('@/config/SqliteDbFoo', 'src/childprocess/w.ts', P, pkgs), false);
  });

  test('BUG-8: all-inline-type import is allowed; mixed value+type blocks', async () => {
    const mod = await import(
      pathToFileURL(path.join(repoRoot, 'scripts/quality/architecture-check.mjs')).href
    );
    const allType = "import { type Foo } from '@/entity/Foo.entity';\nexport const x = 1;\n";
    const mixed = "import { type Foo, Bar } from '@/entity/Foo.entity';\nexport const x = Bar;\n";
    const astAll = mod._internals.parseFor('a.ts', allType);
    const astMixed = mod._internals.parseFor('b.ts', mixed);
    assert.equal(collectDirectImports(astAll, allType)[0].typeOnly, true, 'all-inline-type skipped');
    const mixedEntries = collectDirectImports(astMixed, mixed);
    assert.equal(mixedEntries[0].typeOnly, false, 'mixed import still blocks');
  });

  test('BUG-9: parse-failure findings are fatal and survive an allowance', async () => {
    const { applyExceptions } = await import(
      pathToFileURL(path.join(repoRoot, 'scripts/quality/check-exceptions.mjs')).href
    );
    const file = path.join(repoRoot, 'src/childprocess/Broken.ts');
    const manifest = path.join(os.tmpdir(), `qg-bug9-${Date.now()}.json`);
    writeFileSync(manifest, JSON.stringify({
      schemaVersion: 1,
      exceptions: [{
        path: 'src/childprocess/Broken.ts',
        ruleId: 'aifetchly/no-worker-db-imports',
        maxCount: 1,
        reason: 'legacy', owner: 'maintainer', expiresOn: '2099-01-01',
      }],
    }));
    const out = applyExceptions(
      [{ filePath: file, messages: [{ severity: 2, fatal: true, ruleId: 'aifetchly/no-worker-db-imports', message: 'parse failure', line: 0, column: 0 }] }],
      manifest
    );
    assert.equal(out.results[0].messages.length, 1, 'fatal architecture finding NOT excepted');
    rmSync(manifest, { force: true });
  });
});

describe('requirements-audit fixes (F06/F07)', () => {
  test('F06: alias traversal through an allowed prefix is prohibited', () => {
    const traversalModel = findingsFor(rel(path.join(workerDir, 'alias-traversal.ts')));
    assert.equal(traversalModel.length, 1, JSON.stringify(traversalModel));
    assert.ok(traversalModel[0].message.includes('entityTypes/../model'));

    const traversalConfig = findingsFor(rel(path.join(workerDir, 'alias-traversal-config.ts')));
    assert.equal(traversalConfig.length, 1, JSON.stringify(traversalConfig));
  });

  test('F06: unrelated same-stem-length path is not falsely rejected', () => {
    const internals = nodeRequire(
      path.join(repoRoot, 'scripts/quality/rules/index.cjs')
    )._internals;
    const P = ['src/model', 'src/entity', 'src/config/SqliteDb'];
    const pkgs = ['typeorm'];
    // src/utils.ts has the same stem length as src/model — the old
    // length-based slice treated the leftover '.ts' as an extension match.
    assert.equal(
      internals.isProhibited('@/utils.ts', 'src/childprocess/probe.ts', P, pkgs),
      false,
      'unrelated path must pass'
    );
    // Real extension variants keep working after the stem-prefix requirement.
    for (const spec of ['@/model/Foo.model.ts', '@/entity/index.ts', '@/config/SqliteDb.js']) {
      assert.equal(internals.isProhibited(spec, 'src/childprocess/w.ts', P, pkgs), true, spec);
    }
    // entityTypes allowance holds at BOTH boundaries: direct and traversed.
    assert.equal(
      internals.isProhibited('@/entityTypes/shape', 'src/childprocess/w.ts', P, pkgs),
      false
    );
    assert.equal(
      internals.isProhibited('@/entityTypes/../entityTypes/deep', 'src/childprocess/w.ts', P, pkgs),
      false
    );
  });

  test('F06: unrelated same-length fixture file is clean end to end', () => {
    const findings = findingsFor(rel(path.join(workerDir, 'unrelated-utils.ts')));
    assert.equal(findings.length, 0, JSON.stringify(findings));
  });

  test('F07: TS import-equals require() of a DB package is prohibited', () => {
    const findings = findingsFor(rel(path.join(workerDir, 'import-equals.ts')));
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].ruleId, 'aifetchly/no-worker-db-imports');
    assert.ok(findings[0].message.includes('typeorm'));
  });

  test('F07: inline-type-only re-export from entity is allowed', () => {
    const findings = findingsFor(rel(path.join(workerDir, 'export-type-only.ts')));
    assert.equal(findings.length, 0, JSON.stringify(findings));
  });

  test('F07: mixed runtime/type re-export still blocks', () => {
    const findings = findingsFor(rel(path.join(workerDir, 'export-mixed.ts')));
    assert.equal(findings.length, 1, JSON.stringify(findings));
  });
});

describe('outside-review fixes (codex round)', () => {
  test('import TYPE equals is type-only and allowed (never a false block)', () => {
    writeFileSync(
      path.join(workerDir, 'import-type-equals.ts'),
      "import type Db = require('typeorm');\nexport type Conn = Db.Connection;\nexport const y = 1;\n"
    );
    const findings = findingsFor(rel(path.join(workerDir, 'import-type-equals.ts')));
    assert.equal(findings.length, 0, JSON.stringify(findings));
  });
});
