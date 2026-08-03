/**
 * Runtime dependency-closure resolver + copier (PRD §15.3, design §23.2).
 *
 * Derives — never hand-maintains — the production dependency closure for a
 * runtime's root packages from the installed, lockfile-backed node_modules:
 * recursively follows `dependencies` edges and includes only the matching-
 * target `optionalDependencies` (e.g. on win32-x64, sherpa-onnx-win-x64 is
 * pulled in but sherpa-onnx-darwin-* is not). Foreign-target packages never
 * enter the closure. This is the interim lockfile-derived copier from design
 * §25.1.1 — it is NOT a recursive copy of root node_modules.
 *
 * Pure helpers are exported for unit testing against a fake node_modules tree.
 */
import { readFileSync, cpSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";

const OS_TOKENS = {
  win32: ["win", "windows"],
  darwin: ["darwin", "macos", "osx"],
  linux: ["linux"],
};
const ARCH_TOKENS = {
  x64: ["x64", "x86_64"],
  arm64: ["arm64", "aarch64"],
};

/**
 * True iff a package name's platform/arch tokens match the target. Used to pull
 * in the correct optional native variant and reject foreign ones. Tokens are
 * matched against hyphen-delimited name segments (so "darwin" does NOT match a
 * "win" token even though it contains the substring "win").
 */
export function matchesTarget(name, platform, arch) {
  const segments = String(name).toLowerCase().split("-");
  const os = OS_TOKENS[platform] ?? [];
  const archT = ARCH_TOKENS[arch] ?? [];
  const segMatches = (tokens) =>
    tokens.some((t) => segments.some((s) => s === t || s.startsWith(t)));
  return segMatches(os) && segMatches(archT);
}

/** True iff a package name carries a platform segment (win/darwin/linux…). */
export function looksPlatformSpecific(name) {
  const segments = String(name).toLowerCase().split("-");
  return segments.some((s) =>
    ["win", "win32", "windows", "darwin", "macos", "osx", "linux"].some(
      (t) => s === t || s.startsWith(t),
    ),
  );
}

/** Read a package's manifest from `<rootDir>/node_modules/<name>/package.json`. */
export function readPackageManifest(rootDir, name) {
  const dir = resolvePackageDir(rootDir, name);
  if (!dir) return null;
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf-8"));
  } catch {
    return null;
  }
}

/** Resolve a (possibly scoped) package name to its installed directory, or null. */
export function resolvePackageDir(rootDir, name) {
  const candidate = path.join(rootDir, "node_modules", name);
  return existsSync(path.join(candidate, "package.json")) ? candidate : null;
}

/**
 * Resolve the production closure for the given root packages.
 * @returns {Map<string, {sourceDir: string, version: string}>}
 */
export function resolveClosure(rootDir, roots, { platform, arch }) {
  const closure = new Map();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (closure.has(name)) continue;
    const dir = resolvePackageDir(rootDir, name);
    if (!dir) {
      // Missing dependency — skip but record nothing; the verifier catches a
      // runtime that fails to load standalone.
      continue;
    }
    const manifest = readPackageManifest(rootDir, name);
    closure.set(name, {
      sourceDir: dir,
      version: manifest?.version ?? "0.0.0",
    });
    const deps = manifest?.dependencies ?? {};
    for (const dep of Object.keys(deps)) {
      if (!closure.has(dep)) queue.push(dep);
    }
    const optDeps = manifest?.optionalDependencies ?? {};
    for (const opt of Object.keys(optDeps)) {
      // Include only the matching-target optional native variant.
      if (matchesTarget(opt, platform, arch) && !closure.has(opt)) {
        queue.push(opt);
      }
    }
  }
  return closure;
}

/**
 * True iff a path segment is test/doc/cache noise to exclude. Importantly does
 * NOT exclude `dist`, `build`, or `out` — npm packages ship their compiled JS
 * and native binaries there (e.g. @xenova/transformers → dist/, sharp and
 * better-sqlite3 → build/Release/*.node). Nested `node_modules` is also kept so
 * a package's bundled dependencies are preserved when their version differs
 * from the hoisted one; the closure resolver hoists the common case.
 */
function isExcludedSegment(segment, fileName) {
  const lower = (fileName ?? "").toLowerCase();
  const s = segment.toLowerCase();
  if (s === "test" || s === "tests" || s === "__tests__" || s === "coverage") return true;
  if (s === "docs" || s === "doc" || s === ".github" || s === ".git") return true;
  if (lower.endsWith(".md") && !/^license/i.test(segment) && !/^notice/i.test(segment)) return true;
  if (lower.endsWith(".map") || lower.endsWith(".ts")) return true;
  if (s === ".bin" || s === ".package-lock.json" || s === "package-lock.json") return true;
  return false;
}

/**
 * Copy a resolved closure into `<stagingRoot>/node_modules/<name>/...`,
 * excluding tests, source maps, docs, build caches, and TypeScript sources
 * while keeping license/notice files and the native binaries.
 * @returns {{ copied: string[], totalBytes: number }}
 */
export function copyClosure(closure, stagingRoot) {
  const nmDir = path.join(stagingRoot, "node_modules");
  const copied = [];
  let totalBytes = 0;
  for (const [name, entry] of closure) {
    const dest = path.join(nmDir, name);
    cpSync(entry.sourceDir, dest, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(entry.sourceDir, src);
        if (!rel) return true; // the root itself
        const firstSegment = rel.split(path.sep)[0];
        if (isExcludedSegment(firstSegment, path.basename(src))) return false;
        return true;
      },
    });
    copied.push(name);
    try {
      totalBytes += dirSize(dest);
    } catch {
      // ignore
    }
  }
  return { copied, totalBytes };
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let stat;
    try {
      stat = statSync(cur);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const entries = readdirSync(cur);
      for (const e of entries) stack.push(path.join(cur, e));
    } else {
      total += stat.size;
    }
  }
  return total;
}
