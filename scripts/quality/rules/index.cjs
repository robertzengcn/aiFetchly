/**
 * Local AST architecture rules for the quality gate (tech design §8).
 *
 * Both rules inspect DIRECT imports only: ES import/export declarations,
 * require() calls, and literal dynamic imports. `@/` aliases and relative
 * paths are normalized lexically against the importing file — no module
 * execution, no resolution through node_modules. Type-only imports of
 * entityTypes and `import type` entity imports are allowed where they cannot
 * initialize persistence.
 *
 * Release-one limitation (documented in docs/development/local-quality-gate.md):
 * these rules do not prove transitive reachability — a worker importing a
 * shared module that itself imports a model still passes. A dependency-graph
 * audit covers that later.
 */

const path = require('path');

/** Prohibited direct dependencies for workers (src/childprocess/**). */
const WORKER_PROHIBITED = [
  'src/model',
  'src/entity',
  'src/config/SqliteDb',
  'typeorm',
  'better-sqlite3',
  'sqlite3',
];

/** Prohibited direct dependencies for IPC handlers. */
const IPC_PROHIBITED = [
  'src/model',
  'src/entity',
  'src/config/SqliteDb',
  'typeorm',
  'better-sqlite3',
  'sqlite3',
];

/** Always-permitted prefixes: type surfaces cannot initialize persistence. */
const ALLOWED_PREFIXES = ['src/entityTypes'];

/**
 * Normalize a specifier (`@/modules/X`, `./Y`, `Z`) to a repository-relative
 * path WITHOUT extension when it targets repo source, or null for bare
 * module specifiers (returned as-is for package comparison).
 */
function classifySpecifier(rawSpecifier, importerRepoPath) {
  const spec = rawSpecifier;
  if (spec.startsWith('@/')) {
    return { kind: 'repo', repoPath: spec.slice(2) };
  }
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const importerDir = path.posix.dirname(importerRepoPath);
    const joined = path.posix.normalize(path.posix.join(importerDir, spec));
    return { kind: 'repo', repoPath: joined };
  }
  return { kind: 'package', name: spec };
}

/**
 * Does a normalized repo path (extension-less) fall under a prohibited repo
 * prefix while not being in an allowed prefix?
 */
function repoPathMatches(repoPath, prohibitedRepoPrefix) {
  if (ALLOWED_PREFIXES.some((p) => repoPath === p || repoPath.startsWith(p + '/'))) {
    return false;
  }
  return (
    repoPath === prohibitedRepoPrefix ||
    repoPath.startsWith(prohibitedRepoPrefix + '/')
  );
}

function isProhibited(specifier, importerRepoPath, prohibitedRepoPrefixes, prohibitedPackages) {
  const classified = classifySpecifier(specifier, importerRepoPath);
  if (classified.kind === 'package') {
    // Compare the package root, not a deep import path: `typeorm/foo` still
    // matches `typeorm`.
    const pkgRoot = classified.name.split('/')[0];
    return prohibitedPackages.includes(pkgRoot) || prohibitedPackages.includes(classified.name);
  }
  return prohibitedRepoPrefixes.some((prefix) =>
    repoPathMatches(classified.repoPath, prefix)
  );
}

/**
 * Shared rule body. `options.prohibited` = { repoPrefixes, packages }.
 * Walks the Program once, reporting ImportDeclaration, ExportNamedDeclaration
 * /ExportAllDeclaration with source, CallExpression require('...'), and
 * literal dynamic import('...').
 */
function makeDirectImportRule(metaMessages, prohibited) {
  return {
    meta: {
      type: 'problem',
      docs: {
        description: metaMessages.description,
      },
      schema: [],
      messages: {
        forbidden:
          '{{specifier}} is a prohibited direct dependency for {{layer}} files ({{reason}}). Use the allowed boundary instead.',
      },
    },
    create(context) {
      const filename = context.getFilename();
      const repoRoot = process.env.AIFETCHLY_QUALITY_REPO_ROOT || process.cwd();
      const abs = path.resolve(filename);
      const importerRepoPath = path.relative(repoRoot, abs).split(path.sep).join('/');
      const layer = metaMessages.layer;

      function check(specifier, node) {
        if (
          isProhibited(
            specifier,
            importerRepoPath,
            prohibited.repoPrefixes,
            prohibited.packages
          )
        ) {
          context.report({
            node,
            messageId: 'forbidden',
            data: {
              specifier,
              layer,
              reason: metaMessages.reason,
            },
          });
        }
      }

      function isTypeOnlyImport(node) {
        // `import type X from ...` cannot initialize persistence at runtime.
        return node.importKind === 'type';
      }

      return {
        ImportDeclaration(node) {
          if (isTypeOnlyImport(node)) return;
          check(node.source.value, node);
        },
        ExportNamedDeclaration(node) {
          if (node.source && node.exportKind !== 'type') {
            check(node.source.value, node);
          }
        },
        ExportAllDeclaration(node) {
          if (node.exportKind !== 'type' && node.source) {
            check(node.source.value, node);
          }
        },
        CallExpression(node) {
          if (
            node.callee.type === 'Identifier' &&
            node.callee.name === 'require' &&
            node.arguments.length === 1 &&
            node.arguments[0].type === 'Literal' &&
            typeof node.arguments[0].value === 'string'
          ) {
            check(node.arguments[0].value, node);
          }
          if (
            node.callee.type === 'ImportExpression' &&
            node.arguments.length === 1 &&
            node.arguments[0].type === 'Literal' &&
            typeof node.arguments[0].value === 'string'
          ) {
            check(node.arguments[0].value, node);
          }
        },
      };
    },
  };
}

const WORKER_REPO_PREFIXES = WORKER_PROHIBITED.filter((p) => p.startsWith('src/'));
const WORKER_PACKAGES = WORKER_PROHIBITED.filter((p) => !p.startsWith('src/'));
const IPC_REPO_PREFIXES = IPC_PROHIBITED.filter((p) => p.startsWith('src/'));
const IPC_PACKAGES = IPC_PROHIBITED.filter((p) => !p.startsWith('src/'));

module.exports = {
  rules: {
    'no-worker-db-imports': makeDirectImportRule(
      {
        layer: 'worker (src/childprocess)',
        description:
          'Workers must not import the database directly; send data over IPC to the main process.',
        reason:
          'worker processes have no Electron app context; CRUD belongs to the main process',
      },
      { repoPrefixes: WORKER_REPO_PREFIXES, packages: WORKER_PACKAGES }
    ),
    'no-ipc-db-imports': makeDirectImportRule(
      {
        layer: 'IPC handler (src/main-process/communication)',
        description:
          'IPC handlers must not import models/TypeORM directly; call Module/Controller methods.',
        reason: 'IPC handlers delegate to the Module layer per the four-layer architecture',
      },
      { repoPrefixes: IPC_REPO_PREFIXES, packages: IPC_PACKAGES }
    ),
  },
  // Exported for unit tests.
  _internals: {
    classifySpecifier,
    isProhibited,
    repoPathMatches,
  },
};
