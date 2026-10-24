#!/usr/bin/env node
/**
 * Explicit working-tree fix command (QG-11; BUG-11).
 *
 * Runs the FAST gate profile with fix enabled on exactly the paths the user
 * passed — never the whole tree, never a different config (the old
 * `eslint --fix` script used .eslintrc.json where `any`/unused are warnings
 * and SonarJS is absent). Refuses an empty path list so it cannot rewrite
 * files the user did not name. NEVER stages anything.
 *
 * Exit codes: 0 = clean/fixed, 1 = unfixable blockers remain, 2 = operational.
 */

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { assertInsideRepo } = require('./repo-boundary.cjs');

const files = process.argv.slice(2).filter((a) => a !== '--json');
if (files.length === 0) {
  process.stderr.write(
    'quality:fix requires explicit paths (it rewrites the working tree).\n' +
      'Usage: yarn quality:fix <paths...>\n' +
      'Nothing was changed and nothing was staged.\n'
  );
  process.exit(2);
}

// F08: fix REWRITES files, so the boundary check needs the realpath too —
// the old lexical-only check let a symlinked target pull the fixer's
// rewrite outside the repository. Checked before the engine starts, so
// rejected fixes leave the external bytes untouched.
for (const file of files) {
  try {
    assertInsideRepo(repoRoot, path.resolve(repoRoot, file), `quality:fix target ${file}`);
  } catch (e) {
    process.stderr.write(`quality:fix — ${e.message}\n`);
    process.stderr.write('Nothing was changed and nothing was staged.\n');
    process.exit(2);
  }
}

const eslint = new ESLint({
  cwd: repoRoot,
  useEslintrc: false,
  overrideConfigFile: path.join(repoRoot, 'scripts', 'quality', 'eslint-fast.cjs'),
  resolvePluginsRelativeTo: repoRoot,
  fix: true, // THE ONLY fix-enabled surface in the quality tooling.
});

let results;
try {
  results = await eslint.lintFiles(files);
} catch (error) {
  process.stderr.write(`quality:fix engine failure: ${error?.message ?? error}\n`);
  process.exit(2);
}

const remaining = results.reduce(
  (n, r) => n + r.messages.filter((m) => m.fatal || m.severity === 2).length,
  0
);
const fixedCount = results.reduce((n, r) => n + (r.output ? 1 : 0), 0);
await ESLint.outputFixes(results);

process.stdout.write(
  `quality:fix: ${fixedCount} file(s) rewritten in the working tree; ${remaining} blocker(s) remain\\n` +
      'Nothing was staged. Review with git diff, then git add what you accept.\\n'
);
process.exit(remaining > 0 ? 1 : 0);
