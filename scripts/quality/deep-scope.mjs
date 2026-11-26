/**
 * Deep-pass scope resolution (BUG-1 + F05): typed rules may only run on
 * files the root tsconfig covers — parsing anything else under
 * parserOptions.project is a fatal error. Exported separately so fixture
 * tests can exercise membership without running the engine.
 *
 * F05: the TypeScript compiler API enumerates only TS-supported extensions,
 * so the Vue include patterns in the tsconfig produced ZERO Vue targets
 * and the deep pass silently skipped every Vue script. The scope
 * is therefore built from TWO sources:
 *  1. TS's own enumeration (parsed.fileNames) — the authoritative project
 *     membership for .ts/.tsx/.d.ts/allowJs .js files.
 *  2. The RAW include/exclude patterns applied to tracked files, for the
 *     extensions TS cannot enumerate (.vue) and any JS form the patterns
 *     name.
 * TS config diagnostics (parsed.errors) are surfaced as failures — a
 * broken tsconfig is an operational failure, not an empty scope.
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);

/**
 * Simple glob → RegExp for tsconfig include/exclude patterns, following
 * TypeScript's documented semantics: `**` matches ZERO or more directory
 * levels (a `src` Vue glob also matches `src/Panel.vue` directly), `*`
 * matches within one segment, everything else is literal.
 */
function tsGlobToRegExp(pattern) {
  // Staged placeholders keep the replacement text (which itself contains
  // `*`) out of the later single-star pass.
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '<@DIRS@>')
    .replace(/\*\*/g, '<@ANY@>')
    .replace(/\*/g, '[^/]*')
    .replace(/<@DIRS@>/g, '(?:.*/)?')
    .replace(/<@ANY@>/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Match a repo-relative POSIX path against tsconfig include/exclude lists. */
function matchesAny(list, relPath, rootDir) {
  for (const rawPattern of list) {
    const normalized = path.posix.normalize(rawPattern).replace(/\\/g, '/');
    // Absolute-ish or .. patterns are normalized relative to the config dir.
    const posixPattern = normalized.startsWith('../')
      ? path.posix.relative(rootDir, path.posix.join(rootDir, normalized))
      : normalized;
    const candidate = posixPattern.endsWith('/') ? posixPattern.slice(0, -1) : posixPattern;
    if (candidate.includes('*')) {
      if (tsGlobToRegExp(candidate).test(relPath)) return true;
    } else if (relPath === candidate || relPath.startsWith(candidate + '/')) {
      // A literal exclude like `node_modules` or `test/e2e` covers the
      // whole tree beneath it.
      return true;
    }
  }
  return false;
}


/** NUL-delimited git listing filtered to the wanted extensions. */
function gitListMatching(repoRoot, args, extensionRegex) {
  const out = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (out.error || out.status !== 0) {
    throw new Error(
      `git ${args[0]} failed in ${repoRoot}: ${out.error ? out.error.message : out.stderr.trim()}`
    );
  }
  const files = [];
  for (const entry of out.stdout.split('\0')) {
    if (entry.length > 0 && extensionRegex.test(entry)) files.push(entry);
  }
  return files;
}

/**
 * Source files for the extensions TS cannot enumerate itself. In a real
 * checkout this is the tracked list PLUS untracked non-ignored files (deep
 * validation works on the WORKING TREE — an unstaged new .vue file is
 * checked, not skipped), NUL-delimited so build output stays out via
 * --exclude-standard. Fixture directories that are not themselves git
 * roots (test harness trees) fall back to a filesystem walk — without
 * this, git would climb to the PARENT repo and enumerate the wrong tree.
 */
function trackedSourceFiles(repoRoot, extensionRegex) {
  const toplevel = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const isOwnRepo =
    toplevel.status === 0 &&
    path.resolve(toplevel.stdout.trim()) === path.resolve(repoRoot);
  if (isOwnRepo) {
    const files = [
      ...gitListMatching(repoRoot, ['ls-files', '-z'], extensionRegex),
      ...gitListMatching(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z'], extensionRegex),
    ];
    return [...new Set(files)];
  }
  const files = [];
  const walk = (dir, relDir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(path.join(dir, entry.name), `${relDir}${entry.name}/`);
      } else if (extensionRegex.test(entry.name)) {
        files.push(relDir + entry.name);
      }
    }
  };
  walk(repoRoot, '');
  return files;
}

/**
 * @param {string} repoRoot absolute repository root
 * @returns {{
 *   included: Set<string>,
 *   typedTargets: string[],
 *   jsInProject: string[],
 *   vueTargets: string[],
 *   configDiagnostics: string[]
 * }}
 *   included — every tsconfig-covered file, repo-relative POSIX;
 *   typedTargets — the .ts/.tsx/.vue subset for the typed lint pass;
 *   vueTargets — the .vue subset (reported separately: F05 scope evidence);
 *   jsInProject — in-project JS files (also in the typed pass);
 *   configDiagnostics — TS config parse diagnostics (empty when healthy).
 * @throws when tsconfig.json cannot be found, read, or parsed, or reports
 *   config diagnostics (operational failure).
 */
export function resolveTypedScope(repoRoot) {
  const ts = require('typescript');
  const configPath = ts.findConfigFile(repoRoot, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    throw new Error('tsconfig.json not found under ' + repoRoot);
  }
  const rawRead = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    rawRead.config,
    ts.sys,
    path.dirname(configPath)
  );
  const configDiagnostics = [...(rawRead.error ? [rawRead.error] : []), ...parsed.errors].map(
    (d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')
  );
  if (configDiagnostics.length > 0) {
    // F05: a broken tsconfig is an operational failure — reporting an
    // empty (or partial) scope would silently skip the typed rules.
    throw new Error(
      `tsconfig.json reported configuration diagnostics:\n  - ${configDiagnostics.join('\n  - ')}`
    );
  }
  const rootDir = path.relative(repoRoot, path.dirname(configPath)) || '.';

  const tsEnumerated = parsed.fileNames.map((f) =>
    path.relative(repoRoot, f).split(path.sep).join('/')
  );

  // F05: extend with the extensions TS cannot enumerate itself.
  const include = rawRead.config.include ?? [];
  const exclude = rawRead.config.exclude ?? [];
  const patternMatches = (rel) =>
    include.length > 0 &&
    matchesAny(include, rel, rootDir) &&
    !matchesAny(exclude, rel, rootDir);

  const trackedVue = trackedSourceFiles(repoRoot, /\.(vue|jsx)$/).filter(patternMatches);
  const trackedJs = trackedSourceFiles(repoRoot, /\.(js|mjs|cjs)$/).filter(patternMatches);

  const included = new Set([...tsEnumerated, ...trackedVue, ...trackedJs]);
  const all = [...included];
  return {
    included,
    // B08: in-project .jsx joins the typed pass (TS enumeration includes it
    // with allowJs, but it was silently dropped from every target set).
    typedTargets: all.filter((rel) => /\.(ts|tsx|jsx|vue)$/.test(rel)),
    vueTargets: all.filter((rel) => rel.endsWith('.vue')),
    jsInProject: all.filter((rel) => /\.(js|mjs|cjs)$/.test(rel)),
    configDiagnostics,
  };
}
