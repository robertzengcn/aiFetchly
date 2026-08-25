/**
 * RendererServiceImportGuard — prevent Vite client bundle breakage.
 *
 * Regression (2026-08): AIChatErrorMapper imported `@/modules/user` (Electron
 * BrowserWindow / Yellow Pages / platform adapters). AiChatV2.vue imports the
 * mapper for AUTH_EXPIRED / QUOTA_EXHAUSTED sentinels, so the renderer pulled
 * the main-process graph and failed to load (Vite dynamic-import warnings
 * for ExampleHybridAdapter, blank UI).
 *
 * Rule: any `@/service/*` module that the renderer (`src/views/**`) value-
 * imports must stay free of Electron / main-process-only dependencies,
 * transitively. Main-process side effects (e.g. User.Signout) belong in
 * dedicated handlers such as AIChatAuthExpiredHandler — never in modules
 * shared with the Vue renderer.
 *
 * If this test fails: move the Electron/main import out of the shared
 * module (do NOT add the shared module to an allowlist).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, extname, join, relative, resolve } from "path";

const PROJECT_ROOT = process.cwd();
const RENDERER_ROOT = join(PROJECT_ROOT, "src", "views");
const SRC_ROOT = join(PROJECT_ROOT, "src");

/** Packages / paths that must never appear in the renderer service graph. */
const FORBIDDEN_EXTERNAL = new Set<string>(["electron"]);

const FORBIDDEN_SRC_EXACT = new Set<string>([
  "src/modules/user.ts",
  "src/background.ts",
  "src/service/AIChatAuthExpiredHandler.ts",
]);

const FORBIDDEN_SRC_PREFIXES = ["src/main-process/"] as const;

/** Value `import … from '…'` / `export … from '…'` (skips `import type`). */
const VALUE_FROM_RE =
  /(?:^|\n)\s*(?:export\s+(?:type\s+)?)?import\s+(?!type\b)[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm;

function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) {
    return acc;
  }
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") {
      continue;
    }
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkSourceFiles(full, acc);
      continue;
    }
    if (name.endsWith(".d.ts")) {
      continue;
    }
    const ext = extname(name);
    if (ext === ".ts" || ext === ".vue") {
      acc.push(full);
    }
  }
  return acc;
}

/** Strip comments so documented examples do not false-positive. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;{}()])\/\/.*$/gm, "$1");
}

function toPosixRel(absPath: string): string {
  return relative(PROJECT_ROOT, absPath).replace(/\\/g, "/");
}

function resolveImportSpec(
  fromAbsFile: string,
  spec: string
): { kind: "external"; name: string } | { kind: "file"; abs: string } | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) {
    return { kind: "external", name: spec };
  }

  let baseAbs: string;
  if (spec.startsWith("@/")) {
    baseAbs = join(SRC_ROOT, spec.slice(2));
  } else {
    baseAbs = resolve(dirname(fromAbsFile), spec);
  }

  const candidates = [
    baseAbs,
    `${baseAbs}.ts`,
    `${baseAbs}.vue`,
    join(baseAbs, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { kind: "file", abs: candidate };
    }
  }
  return null;
}

function collectValueImportSpecs(source: string): string[] {
  const specs: string[] = [];
  const stripped = stripComments(source);
  VALUE_FROM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VALUE_FROM_RE.exec(stripped)) !== null) {
    specs.push(match[1]);
  }
  return specs;
}

function isForbiddenSrc(relPosix: string): boolean {
  if (FORBIDDEN_SRC_EXACT.has(relPosix)) {
    return true;
  }
  return FORBIDDEN_SRC_PREFIXES.some((prefix) => relPosix.startsWith(prefix));
}

function collectRendererServiceEntries(): string[] {
  const entries = new Set<string>();
  for (const file of walkSourceFiles(RENDERER_ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const spec of collectValueImportSpecs(source)) {
      if (!spec.startsWith("@/service/") && !spec.startsWith(".")) {
        continue;
      }
      const resolved = resolveImportSpec(file, spec);
      if (!resolved || resolved.kind !== "file") {
        continue;
      }
      const rel = toPosixRel(resolved.abs);
      if (rel.startsWith("src/service/")) {
        entries.add(resolved.abs);
      }
    }
  }
  return [...entries].sort();
}

interface Violation {
  readonly entry: string;
  readonly via: string;
  readonly forbidden: string;
}

function findTransitiveViolations(entries: string[]): Violation[] {
  const violations: Violation[] = [];
  const visited = new Set<string>();
  const queue: Array<{ abs: string; entry: string }> = entries.map((abs) => ({
    abs,
    entry: abs,
  }));

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      break;
    }
    const { abs, entry } = current;
    if (visited.has(abs)) {
      continue;
    }
    visited.add(abs);

    const rel = toPosixRel(abs);
    if (isForbiddenSrc(rel)) {
      violations.push({
        entry: toPosixRel(entry),
        via: rel,
        forbidden: rel,
      });
      continue;
    }

    if (!existsSync(abs)) {
      continue;
    }
    const source = readFileSync(abs, "utf8");
    for (const spec of collectValueImportSpecs(source)) {
      const resolved = resolveImportSpec(abs, spec);
      if (!resolved) {
        continue;
      }
      if (resolved.kind === "external") {
        if (FORBIDDEN_EXTERNAL.has(resolved.name)) {
          violations.push({
            entry: toPosixRel(entry),
            via: rel,
            forbidden: resolved.name,
          });
        }
        continue;
      }
      const childRel = toPosixRel(resolved.abs);
      if (isForbiddenSrc(childRel)) {
        violations.push({
          entry: toPosixRel(entry),
          via: rel,
          forbidden: childRel,
        });
        continue;
      }
      if (childRel.startsWith("src/") && !visited.has(resolved.abs)) {
        queue.push({ abs: resolved.abs, entry });
      }
    }
  }

  return violations;
}

describe("RendererServiceImportGuard", () => {
  const entries = collectRendererServiceEntries();

  it("finds renderer value-imports of @/service modules", () => {
    expect(
      entries.length,
      "expected at least one src/views value-import of @/service/*"
    ).toBeGreaterThan(0);
    // Sentinel contract: AiChatV2 keeps VALUE-importing a @/service module so
    // the scanner always has real coverage. The sentinel moved from
    // AIChatErrorMapper (node-carrying) to the node-free
    // AIChatErrorSentinels module in 2cc6d5b7 — assert the current module.
    expect(
      entries.some(
        (abs) => toPosixRel(abs) === "src/service/AIChatErrorSentinels.ts"
      ),
      "AiChatV2 must keep value-importing AIChatErrorSentinels (sentinel contract)"
    ).toBe(true);
  });

  it("renderer-imported @/service modules never pull Electron / User / main-process", () => {
    const violations = findTransitiveViolations(entries);
    expect(
      violations,
      "These renderer-reachable @/service modules transitively import forbidden main-process code:\n" +
        violations
          .map(
            (v) =>
              `  - entry ${v.entry} → via ${v.via} → forbidden ${v.forbidden}`
          )
          .join("\n") +
        "\nMove Electron/main side effects to a main-only module " +
        "(e.g. AIChatAuthExpiredHandler) and keep sentinels/types renderer-safe."
    ).toEqual([]);
  });

  it("AIChatErrorMapper itself has no direct Electron/User imports", () => {
    const mapperPath = join(SRC_ROOT, "service", "AIChatErrorMapper.ts");
    expect(existsSync(mapperPath)).toBe(true);
    const source = stripComments(readFileSync(mapperPath, "utf8"));
    const specs = collectValueImportSpecs(source);
    expect(specs).not.toContain("electron");
    expect(specs).not.toContain("@/modules/user");
    expect(specs.some((s) => s.includes("AIChatAuthExpiredHandler"))).toBe(
      false
    );
  });

  it("renderer never value-imports AIChatAuthExpiredHandler", () => {
    const offenders: string[] = [];
    for (const file of walkSourceFiles(RENDERER_ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const spec of collectValueImportSpecs(source)) {
        if (
          spec.includes("AIChatAuthExpiredHandler") ||
          spec === "@/modules/user"
        ) {
          offenders.push(`${toPosixRel(file)} ← ${spec}`);
        }
      }
    }
    expect(
      offenders,
      "src/views must not import AIChatAuthExpiredHandler or @/modules/user:\n" +
        offenders.map((o) => `  - ${o}`).join("\n")
    ).toEqual([]);
  });
});
