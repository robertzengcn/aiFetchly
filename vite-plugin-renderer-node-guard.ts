// vite-plugin-renderer-node-guard.ts
//
// Prevents the recurring renderer launch crash:
//
//   Failed to load URL: Error: ERR_ABORTED (-3) loading 'http://localhost:5173/'
//   Uncaught Error: Module "node:module" has been externalized for browser
//   compatibility. Cannot access "node:module.createRequire" in client code.
//   at Logger.ts:1:23
//
// Root cause: a renderer module transitively imported a main-process module
// (`@/modules/Logger`) that uses a Node-only API (`node:module.createRequire`,
// `fs`, `electron`, `electron-log`). Vite silently externalizes Node builtins
// for the browser, so evaluating the chunk throws at runtime and the page
// aborts on launch.
//
// This plugin fails FAST and LOUDLY at module-resolution time (dev + build)
// instead of letting the leak ship and crash at runtime. It maintains an
// importer chain per resolved module; when a denied specifier would enter the
// renderer module graph (rooted at `src/views/**`, `src/api/**`,
// `src/preload.ts`, `index.html`), it throws with the full chain so the dev
// sees exactly which import to fix — e.g.
//
//   [rendererNodeGuard] Node-only module reached the renderer graph:
//     node:module
//   import chain: src/views/components/aiChatV2/AiChatV2.vue
//     → src/service/AIChatErrorMapper.ts
//     → src/modules/Logger.ts
//     → node:module
//   Fix: move the renderer-needed value into a pure, Node-free module
//   (see src/service/AIChatErrorSentinels.ts for the pattern) or make the
//   renderer import `import type`-only.
//
// Bypass (tight inner loops only — committed code MUST pass clean, mirroring
// the AIFETCHLY_SKIP_TSC rule in CLAUDE.md):
//   AIFETCHLY_DISABLE_RENDERER_NODE_GUARD=1

import * as path from "path";
import { fileURLToPath } from "url";
import { NODE_BUILTINS } from "./vite.main.shared.mjs";

/**
 * Minimal local types for the Vite/Rollup plugin hooks we use. Defined here
 * (not `import type { Plugin } from "vite"`) because the root tsconfig uses
 * `moduleResolution: node`, under which Vite 8's package `exports` don't
 * resolve — a static `import ... from "vite"` fails `tsc --noEmit` (and the
 * vite-plugin-checker gate during `yarn build`). Same convention as
 * `vite-plugin-close.ts` (no Vite type import). See
 * test/vitest/main/ViteImportModuleResolutionGuard.test.ts.
 */
interface RollupBundle {
  facadeModuleId?: string | null;
  modules?: Record<string, unknown>;
}
interface RollupOutputChunk extends RollupBundle {
  [key: string]: unknown;
}
interface OutputBundle {
  [fileName: string]: RollupOutputChunk;
}
interface ResolvedId {
  id: string;
}

/**
 * Project root (this file lives at the repo root). Derived from
 * `import.meta.url` the same way `vite.main.shared.mjs` does — Vite shims
 * `__dirname` for the *config* file it loads, but NOT for modules imported
 * from it, and NOT when this module is imported directly (e.g. in tests).
 */
const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));

/** True when the bypass env is set. */
function isDisabled(): boolean {
  return process.env.AIFETCHLY_DISABLE_RENDERER_NODE_GUARD === "1";
}

/**
 * Renderer entry roots. A module is "renderer-reachable" if it is, or is
 * transitively imported by, a file under one of these trees. `index.html`
 * is the Vite render entry (`<script src="/src/views/main.ts">`); the `.ts`/
 * `.vue` roots cover programmatic `build.lib` fixtures that don't use html.
 */
const RENDERER_ROOT_GLOBS: readonly string[] = [
  path.join(PROJECT_ROOT, "src", "views") + path.sep,
  path.join(PROJECT_ROOT, "src", "api") + path.sep,
  path.join(PROJECT_ROOT, "src", "preload.ts"),
];

/** True if an absolute module id is a renderer entry root. */
function isRendererRootId(id: string): boolean {
  if (!id) return false;
  // Normalize for both POSIX and Windows path separators.
  const norm = id.replace(/\\/g, "/");
  if (
    norm ===
    path.posix.join(PROJECT_ROOT, "src", "preload.ts").replace(/\\/g, "/")
  ) {
    return true;
  }
  return RENDERER_ROOT_GLOBS.some((glob) => {
    const globNorm = glob.replace(/\\/g, "/");
    return norm.startsWith(globNorm);
  });
}

/**
 * Internal main-process-only modules that use Node-only APIs. These resolve
 * to real files (not Node builtins), so NODE_BUILTINS does not cover them.
 * The one that bit us is `@/modules/Logger` (imports `node:module.createRequire`).
 */
const INTERNAL_MAIN_PROCESS_MODULES: readonly string[] = [
  "@/modules/Logger",
  // Alias-resolved absolute form (after Vite rewrites "@" → src).
  path.join(PROJECT_ROOT, "src", "modules", "Logger.ts"),
];

/**
 * The full denylist of specifiers/modules that must never enter the renderer
 * graph. Composed of:
 *   - Node builtins (bare + `node:` protocol) and electron (from NODE_BUILTINS)
 *   - electron-log variants (uses Electron app at module scope)
 *   - native / main-process-only runtime deps
 *   - internal main-process modules (INTERNAL_MAIN_PROCESS_MODULES)
 */
export const RENDERER_NODE_GUARD_DENYLIST: readonly string[] = [
  ...NODE_BUILTINS,
  "electron-log",
  "electron-log/main",
  "electron-log/node",
  "electron-store",
  "keytar",
  "better-sqlite3",
  "sqlite-vec",
  "puppeteer",
  "puppeteer-core",
  "puppeteer-extra",
  "puppeteer-extra-plugin-stealth",
  ...INTERNAL_MAIN_PROCESS_MODULES,
];

/** A denylist entry matched against a resolved id / specifier. */
const DENY_PATTERNS: readonly RegExp[] = (() => {
  // Escape regex special chars in each entry; `node:fs` → `node:fs` (':'
  // is not regex-special). Match as exact specifier OR as a path segment
  // for absolute-path entries.
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return RENDERER_NODE_GUARD_DENYLIST.map((entry) =>
    entry.endsWith(".ts") ? escapeRe(entry) : escapeRe(entry)
  ).map((pat) => new RegExp(`(^|[/\\\\]|^node:)${pat}([/\\\\]|$)`));
})();

/**
 * True if a specifier or resolved id matches the denylist. Exported for unit
 * testing.
 */
export function isDeniedSpecifier(specifier: string): boolean {
  if (!specifier) return false;
  // Fast exact-match path first.
  if (RENDERER_NODE_GUARD_DENYLIST.includes(specifier)) return true;
  // `node:module` / `node:fs` etc. — also match when bare `module`/`fs` are
  // denied via NODE_BUILTINS but the specifier uses the protocol form.
  if (specifier.startsWith("node:")) {
    const bare = specifier.slice("node:".length);
    if (RENDERER_NODE_GUARD_DENYLIST.includes(bare)) return true;
  }
  // Absolute-path / alias-resolved entries (e.g. .../src/modules/Logger.ts).
  return DENY_PATTERNS.some((re) => re.test(specifier));
}

/**
 * Build the plugin. Returns a Vite plugin object. Tracks importer chains via
 * the `resolveId` hook so it can fail loudly at resolution time (dev + build),
 * with a `generateBundle` backstop that walks the final graph for anything
 * resolution missed (e.g. dynamic imports, alias indirection).
 */
/** Return type of the guard plugin (local — avoids importing Vite types). */
interface RendererNodeGuardPlugin {
  name: string;
  resolveId(source: string, importer: string | undefined): ResolvedId | null;
  generateBundle: (opts: unknown, bundle: OutputBundle) => void;
}

export default function rendererNodeGuard(): RendererNodeGuardPlugin {
  if (isDisabled()) {
    return {
      name: "renderer-node-guard",
      resolveId() {
        return null;
      },
      generateBundle() {
        // bypass: no-op
      },
    };
  }

  // importer → list of modules it imports (resolved ids). Built incrementally
  // during resolveId so we can reconstruct the chain from any node back to a
  // renderer root.
  const importersOf = new Map<string, Set<string>>();
  // id → the specifier as written by the importer (for readable errors).
  const specOf = new Map<string, string>();

  const recordEdge = (importer: string, resolved: string, spec: string) => {
    if (!importer || !resolved) return;
    let set = importersOf.get(resolved);
    if (!set) {
      set = new Set();
      importersOf.set(resolved, set);
    }
    set.add(importer);
    if (!specOf.has(resolved)) specOf.set(resolved, spec);
  };

  /**
   * Walk importers from `id` back to a renderer root. Returns the chain
   * (root-first) if one exists, else null.
   */
  const chainToRendererRoot = (id: string): string[] | null => {
    const seen = new Set<string>();
    const stack: string[] = [id];
    const parentOf = new Map<string, string | null>([[id, null]]);
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      if (isRendererRootId(cur)) {
        // Reconstruct path root → id.
        const chain: string[] = [];
        let node: string | null = cur;
        while (node) {
          chain.push(node);
          node = parentOf.get(node) ?? null;
        }
        return chain.reverse();
      }
      const parents = importersOf.get(cur);
      if (parents) {
        for (const p of parents) {
          if (!parentOf.has(p)) parentOf.set(p, cur);
          stack.push(p);
        }
      }
    }
    return null;
  };

  const formatChain = (ids: string[]): string =>
    ids
      .map((id) => {
        const rel = path.relative(PROJECT_ROOT, id).replace(/\\/g, "/") || id;
        const spec = specOf.get(id);
        return spec && spec !== id ? `${rel} (imports ${spec})` : rel;
      })
      .join("\n  → ");

  /**
   * Walk importer chain from `id` back to a renderer root using Rollup's
   * module graph (`this.getModuleInfo`). Returns the chain (root-first) or
   * null. Used by the generateBundle backstop, which runs after the full
   * graph is resolved — so getModuleInfo is fully populated here.
   */
  function chainToRendererRootViaModuleInfoThis(
    this: unknown,
    id: string,
    isRoot: (id: string) => boolean
  ): string[] | null {
    const getModuleInfo = (
      this as { getModuleInfo?: (id: string) => unknown }
    ).getModuleInfo?.bind(this);
    if (typeof getModuleInfo !== "function") return null;
    const seen = new Set<string>();
    const parentOf = new Map<string, string | null>([[id, null]]);
    const stack: string[] = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      if (isRoot(cur)) {
        const chain: string[] = [];
        let node: string | null = cur;
        while (node) {
          chain.push(node);
          node = parentOf.get(node) ?? null;
        }
        return chain.reverse();
      }
      const info = getModuleInfo(cur) as {
        importers?: readonly string[];
      } | null;
      const parents = info?.importers ?? [];
      for (const p of parents) {
        if (!parentOf.has(p)) parentOf.set(p, cur);
        stack.push(p);
      }
    }
    return null;
  }

  return {
    name: "renderer-node-guard",

    // Track edges as modules resolve. `resolveId` receives the importing
    // file (`importer`) and the raw specifier. We record the edge, then if
    // the resolved id is denied AND reachable from a renderer root, throw.
    resolveId(source: string, importer: string | undefined): ResolvedId | null {
      if (!importer) return null;
      recordEdge(importer, source, source);
      // We won't know the resolved id until Vite resolves it; but we can
      // check the raw specifier right now for exact denylist matches
      // (node:*, electron-log, @/modules/Logger). For absolute-path forms
      // the generateBundle backstop catches it.
      if (isDeniedSpecifier(source)) {
        const chain = chainToRendererRoot(importer) ?? [importer];
        const relImporter = path
          .relative(PROJECT_ROOT, importer)
          .replace(/\\/g, "/");
        throw new Error(
          `[rendererNodeGuard] Node-only / main-process-only module would enter the renderer graph:\n` +
            `    ${source}\n` +
            `import chain (renderer root → offender):\n  → ${formatChain(
              chain
            )}\n  → ${relImporter} (imports ${source})\n` +
            `Fix: move the renderer-needed value into a pure, Node-free module ` +
            `(see src/service/AIChatErrorSentinels.ts for the pattern) or make ` +
            `the renderer import \`import type\`-only.\n` +
            `Bypass (NOT for committed code): AIFETCHLY_DISABLE_RENDERER_NODE_GUARD=1`
        );
      }
      return null;
    },

    // Backstop: walk the final bundle graph for denied modules whose chain
    // reaches a renderer root. Catches alias-resolved absolute-path forms
    // (e.g. "@/modules/Logger" → ".../src/modules/Logger.ts") and dynamic
    // imports that resolveId's specifier check above didn't catch.
    generateBundle(_opts: unknown, bundle: OutputBundle): void {
      const deniedInGraph: Array<{ id: string; chain: string[] }> = [];

      // Collect every module id present in the emitted chunks, and treat each
      // chunk's facadeModuleId (the build entry) as a renderer root. The real
      // render build's entry is src/views/main.ts (already covered by
      // RENDERER_ROOT_GLOBS); programmatic build.lib fixtures live in temp
      // dirs, so their entry is the only reliable renderer root.
      const idsInBundle = new Set<string>();
      const entryRoots = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        const facade = (chunk as { facadeModuleId?: string | null })
          .facadeModuleId;
        if (facade) entryRoots.add(facade);
        const moduleIds =
          (chunk as { modules?: Record<string, unknown> }).modules ?? {};
        for (const id of Object.keys(moduleIds)) idsInBundle.add(id);
      }
      const isRoot = (id: string): boolean =>
        isRendererRootId(id) || entryRoots.has(id);

      // Only flag project-authored offenders (files under the project's own
      // `src/`, including alias-resolved `@/...` paths). Third-party
      // `node_modules/` packages (Vuetify, typeorm/browser, buffer, sha.js,
      // …) legitimately use Node builtins internally and are handled by
      // Vite's browser-compat external proxy + the render config's shims.
      // Vite's `__vite-browser-external:` stubs are also skipped — they are
      // the external proxy itself, not a real leak. The bug class we prevent
      // is *project* code (e.g. @/modules/Logger) reaching Node-only APIs.
      const isProjectAuthoredId = (id: string): boolean => {
        if (!id) return false;
        if (id.startsWith("__vite-browser-external:")) return false;
        const norm = id.replace(/\\/g, "/");
        return (
          norm.includes("/src/modules/") ||
          norm.includes("/src/service/") ||
          norm.includes("/src/main-process/") ||
          norm.includes("/src/model/") ||
          norm.includes("/src/childprocess/") ||
          norm.includes("/src/controller/") ||
          // Alias-resolved @/modules/Logger etc. via the @ → src alias.
          norm.startsWith(
            path.join(PROJECT_ROOT, "src").replace(/\\/g, "/") + "/"
          )
        );
      };

      // For each denied id, walk importers (via getModuleInfo) back to a
      // renderer root. If reachable, it's a real leak.
      for (const id of idsInBundle) {
        if (!isDeniedSpecifier(id)) continue;
        if (!isProjectAuthoredId(id)) continue;
        const chain = chainToRendererRootViaModuleInfoThis.call(
          this,
          id,
          isRoot
        );
        if (chain) deniedInGraph.push({ id, chain });
      }

      if (deniedInGraph.length > 0) {
        const detail = deniedInGraph
          .map(
            ({ id, chain }) =>
              `    ${id}\n  import chain:\n  → ${formatChain(chain)}`
          )
          .join("\n\n");
        throw new Error(
          `[rendererNodeGuard] Node-only / main-process-only module(s) reached the renderer graph:\n` +
            detail +
            `\nFix: move the renderer-needed value into a pure, Node-free module ` +
            `(see src/service/AIChatErrorSentinels.ts for the pattern) or make ` +
            `the renderer import \`import type\`-only.\n` +
            `Bypass (NOT for committed code): AIFETCHLY_DISABLE_RENDERER_NODE_GUARD=1`
        );
      }
    },
  };
}
