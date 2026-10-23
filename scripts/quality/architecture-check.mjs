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
    loc: true,
    range: true,
  });
}

/**
 * Collect direct module specifiers with their AST nodes.
 * Returns [{ specifier, node, typeOnly }] for import/require/import().
 */
/**
 * BUG-8: a declaration is type-only when the declaration itself is
 * `import type` / `export type`, OR when EVERY named specifier carries the
 * inline `type` modifier (`import { type Foo } from ...`). A mixed
 * value-and-type import still counts as a runtime import and blocks.
 */
function declarationIsTypeOnly(node) {
  if (node.importKind === 'type' || node.exportKind === 'type') return true;
  if (Array.isArray(node.specifiers) && node.specifiers.length > 0) {
    return node.specifiers.every((spec) => spec.importKind === 'type');
  }
  return false;
}

/** Literal require('x') matcher used by the manual walker. */
function isRequireOfStringLiteral(n) {
  return (
    n.type === 'CallExpression' &&
    n.callee.type === 'Identifier' &&
    n.callee.name === 'require' &&
    n.arguments.length === 1 &&
    n.arguments[0].type === 'Literal' &&
    typeof n.arguments[0].value === 'string'
  );
}

/** Literal dynamic import('x'): bare ImportExpression node or callee form. */
function isLiteralDynamicImport(n) {
  return (
    (n.type === 'ImportExpression' ||
      (n.type === 'CallExpression' &&
        (n.callee.type === 'ImportExpression' || n.callee.type === 'Import'))) &&
    !!n.source &&
    n.source.type === 'Literal' &&
    typeof n.source.value === 'string'
  );
}

/** Depth-first walk collecting require/import literals into `found`. */
function visitForRequireAndImport(n, found) {
  if (!n || typeof n.type !== 'string') return;
  if (isRequireOfStringLiteral(n)) {
    found.push({ specifier: n.arguments[0].value, node: n, typeOnly: false });
  }
  if (isLiteralDynamicImport(n)) {
    found.push({ specifier: n.source.value, node: n, typeOnly: false });
  }
  visitAstChildren(n, found);
}

/** Recurse into child nodes only (skips loc/range/parent metadata). */
function visitAstChildren(n, found) {
  for (const key of Object.keys(n)) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue;
    const value = n[key];
    if (Array.isArray(value)) {
      visitArrayChildren(value, found);
    } else if (value && typeof value.type === 'string') {
      visitForRequireAndImport(value, found);
    }
  }
}

function visitArrayChildren(children, found) {
  for (const child of children) {
    if (child && typeof child.type === 'string') visitForRequireAndImport(child, found);
  }
}

export function collectDirectImports(ast, code) {
  void code;
  const found = [];
  collectBodyLevelImports(ast, found);
  // require(...) and literal import(...) can appear anywhere: walk manually
  // (no eslint traverse dependency). Depth-bounded, allocation-light.
  visitForRequireAndImport(ast, found);
  return found;
}

/** Import/export declarations at the Program body level. */
function collectBodyLevelImports(ast, found) {
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration' && node.source) {
      found.push({ specifier: node.source.value, node, typeOnly: declarationIsTypeOnly(node) });
    } else if (node.type === 'ExportNamedDeclaration' && node.source) {
      found.push({ specifier: node.source.value, node, typeOnly: declarationIsTypeOnly(node) });
    } else if (node.type === 'ExportAllDeclaration' && node.source) {
      found.push({ specifier: node.source.value, node, typeOnly: node.exportKind === 'type' });
    }
  }
}

/**
 * Run the two architecture rules over selected files.
 * Returns ESLint-shaped findings: [{ filePath, line, column, ruleId, message }].
 */
export function checkArchitecture(files, repoRoot) {
  const findings = [];
  const workerScope = /(^|\/)src\/childprocess\//;
  const ipcScope = /(^|\/)src\/main-process\/communication\//;

  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const isWorker = workerScope.test(rel);
    const isIpc = ipcScope.test(rel);
    if (!isWorker && !isIpc) continue;
    findings.push(...architectureFindingsForFile(file, rel, isWorker, repoRoot));
  }
  return findings;
}

function architectureRuleId(isWorker) {
  return isWorker ? 'aifetchly/no-worker-db-imports' : 'aifetchly/no-ipc-db-imports';
}

function architectureLayer(isWorker) {
  return isWorker ? 'worker (src/childprocess)' : 'IPC handler (src/main-process/communication)';
}

function architectureFindingsForFile(file, rel, isWorker, repoRoot) {
  void repoRoot;
  const ruleId = architectureRuleId(isWorker);
  const layer = architectureLayer(isWorker);
  const parsed = readAndParseForArchitecture(file, ruleId);
  if (parsed.error !== undefined) {
    return [parsed.error];
  }
  return prohibitedImportFindings(file, rel, ruleId, layer, parsed.ast, parsed.code);
}

/** Read + parse; on failure returns { error: fatalFinding } (BUG-9). */
function readAndParseForArchitecture(file, ruleId) {
  let code;
  try {
    code = readFileSync(file, 'utf8');
  } catch (e) {
    return {
      error: fatalArchitectureFinding(
        file, ruleId, `architecture check could not read the file: ${e.message}`
      ),
    };
  }
  try {
    return { ast: parseFor(file, code), code };
  } catch (e) {
    return {
      error: fatalArchitectureFinding(
        file, ruleId, `architecture check parse failure (never exceptable): ${e.message}`
      ),
    };
  }
}

function fatalArchitectureFinding(file, ruleId, message) {
  return { filePath: file, line: 0, column: 0, ruleId, message, fatal: true };
}

/** True when a direct import entry hits the prohibited list for its layer. */
function isProhibitedEntry(entry, rel, prohibitedList) {
  return localRules._internals.isProhibited(
    entry.specifier,
    rel,
    prohibitedList.repoPrefixes,
    prohibitedList.packages
  );
}

/** Report prohibited direct imports for one parsed file. */
function prohibitedImportFindings(file, rel, ruleId, layer, ast, code) {
  const findings = [];
  const prohibitedList = ruleId === 'aifetchly/no-worker-db-imports'
    ? localRules.worker
    : localRules.ipc;
  for (const entry of collectDirectImports(ast, code)) {
    if (entry.typeOnly) continue;
    if (isProhibitedEntry(entry, rel, prohibitedList)) {
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
  return findings;
}

export const _internals = { parseFor };
