/**
 * Architecture direct-import checks (tech design §8) as a dedicated AST pass.
 *
 * ESLint 8 legacy config cannot package an in-repo plugin (string plugins
 * resolve from node_modules only; object plugins are rejected in config
 * files AND overrideConfig on this stack). Instead of fighting that, these
 * checks run their own pass with the repo's installed parsers:
 * @typescript-eslint/parser for JS/TS and vue-eslint-parser for .vue script
 * blocks — same findings shape as ESLint results, merged by the runner.
 *
 * Semantics identical to the design: direct ES import/export declarations,
 * literal require(), and literal dynamic import(); `@/` alias and relative
 * paths normalized lexically; `import type` allowed; entityTypes allowed.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Anchor require at THIS module so './rules/index.cjs' resolves relative to
// scripts/quality/, never the caller's cwd.
const require = createRequire(import.meta.url);

const tsParser = require('@typescript-eslint/parser');
const vueParser = require('vue-eslint-parser');
const localRules = require('./rules/index.cjs');

/** Parse a file into an ESTree Program for its extension. */
function parseFor(fileName, code) {
  if (fileName.endsWith('.vue')) {
    const parsed = vueParser.parseForESLint(code, {
      parser: '@typescript-eslint/parser',
      ecmaVersion: 'latest',
      sourceType: 'module',
      extraFileExtensions: ['.vue'],
      filePath: fileName,
    });
    return parsed.ast;
  }
  return tsParser.parse(code, {
    ecmaVersion: 'latest',
    sourceType: fileName.endsWith('.cjs') ? 'commonjs' : 'module',
    filePath: fileName,
  });
}

/**
 * Collect direct module specifiers with their AST nodes.
 * Returns [{ specifier, node, typeOnly }] for import/require/import().
 */
export function collectDirectImports(ast, code) {
  void code;
  const found = [];
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration' && node.source) {
      found.push({
        specifier: node.source.value,
        node,
        typeOnly: node.importKind === 'type',
      });
    } else if (node.type === 'ExportNamedDeclaration' && node.source) {
      found.push({
        specifier: node.source.value,
        node,
        typeOnly: node.exportKind === 'type',
      });
    } else if (node.type === 'ExportAllDeclaration' && node.source) {
      found.push({
        specifier: node.source.value,
        node,
        typeOnly: node.exportKind === 'type',
      });
    }
  }
  // require(...) and literal import(...) can appear anywhere: walk manually
  // (no eslint traverse dependency). Depth-bounded, allocation-light.
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (
      n.type === 'CallExpression' &&
      ((n.callee.type === 'Identifier' && n.callee.name === 'require') ||
        n.callee.type === 'ImportExpression') &&
      n.arguments.length === 1 &&
      n.arguments[0].type === 'Literal' &&
      typeof n.arguments[0].value === 'string'
    ) {
      found.push({ specifier: n.arguments[0].value, node: n, typeOnly: false });
    }
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'range' || key === 'parent') continue;
      const value = n[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') visit(child);
        }
      } else if (value && typeof value.type === 'string') {
        visit(value);
      }
    }
  };
  visit(ast);
  return found;
}

/**
 * Run the two architecture rules over selected files.
 * Returns ESLint-shaped findings: [{ filePath, line, column, ruleId, message }].
 */
export function checkArchitecture(files, repoRoot) {
  const findings = [];
  const workerScope = /^src\/childprocess\//;
  const ipcScope = /^src\/main-process\/communication\//;

  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const isWorker = workerScope.test(rel);
    const isIpc = ipcScope.test(rel);
    if (!isWorker && !isIpc) continue;

    let code;
    try {
      code = readFileSync(file, 'utf8');
    } catch (e) {
      findings.push({
        filePath: file,
        line: 0,
        column: 0,
        ruleId: isWorker ? 'aifetchly/no-worker-db-imports' : 'aifetchly/no-ipc-db-imports',
        message: `architecture check could not read the file: ${e.message}`,
      });
      continue;
    }

    let ast;
    try {
      ast = parseFor(file, code);
    } catch (e) {
      findings.push({
        filePath: file,
        line: 0,
        column: 0,
        ruleId: isWorker ? 'aifetchly/no-worker-db-imports' : 'aifetchly/no-ipc-db-imports',
        message: `architecture check parse failure (never exceptable): ${e.message}`,
      });
      continue;
    }

    const ruleId = isWorker
      ? 'aifetchly/no-worker-db-imports'
      : 'aifetchly/no-ipc-db-imports';
    const layer = isWorker
      ? 'worker (src/childprocess)'
      : 'IPC handler (src/main-process/communication)';

    for (const entry of collectDirectImports(ast, code)) {
      if (entry.typeOnly) continue;
      const repoPrefixes = ['src/model', 'src/entity', 'src/config/SqliteDb'];
      const packages = ['typeorm', 'better-sqlite3', 'sqlite3'];
      const prohibited = localRules._internals.isProhibited(
        entry.specifier,
        rel,
        repoPrefixes,
        packages
      );
      if (prohibited) {
        findings.push({
          filePath: file,
          line: entry.node.loc ? entry.node.loc.start.line : 0,
          column: entry.node.loc ? entry.node.loc.start.column + 1 : 0,
          ruleId,
          message:
            `${entry.specifier} is a prohibited direct dependency for ${layer} files ` +
            `(database access belongs to the main process via Modules).`,
        });
      }
    }
  }
  return findings;
}

export const _internals = { parseFor };
