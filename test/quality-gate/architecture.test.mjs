/**
 * Architecture direct-import checks (PRD AC-11/AC-12; tech design §8).
 * Exercises the dedicated AST pass over fixture files in worker/IPC scopes.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
