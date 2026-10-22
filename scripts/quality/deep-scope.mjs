/**
 * Deep-pass scope resolution (BUG-1): typed rules may only run on files the
 * root tsconfig includes — parsing anything else under parserOptions.project
 * is a fatal error. Exported separately so the fixture test can exercise
 * membership without running the engine.
 */

import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * @param {string} repoRoot absolute repository root
 * @returns {{ included: Set<string>, typedTargets: string[], jsInProject: string[] }}
 *   included — every tsconfig-included file, repo-relative POSIX;
 *   typedTargets — the .ts/.tsx/.vue subset for the typed lint pass;
 *   jsInProject — in-project JS files (also in typed scope, reported).
 * @throws when tsconfig.json cannot be found or parsed (operational failure).
 */
export function resolveTypedScope(repoRoot) {
  const ts = require('typescript');
  const configPath = ts.findConfigFile(repoRoot, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    throw new Error('tsconfig.json not found under ' + repoRoot);
  }
  const parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    path.dirname(configPath)
  );
  const included = new Set(
    parsed.fileNames.map((f) => path.relative(repoRoot, f).split(path.sep).join('/'))
  );
  const all = [...included];
  return {
    included,
    typedTargets: all.filter((rel) => /\.(ts|tsx|vue)$/.test(rel)),
    jsInProject: all.filter((rel) => /\.(js|cjs|mjs)$/.test(rel)),
  };
}
