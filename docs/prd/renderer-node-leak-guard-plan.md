# Renderer → Node-leak guard (plan)

Prevent the recurring `ERR_ABORTED` / `Cannot access "node:module.createRequire"` class of bug, where a renderer module transitively imports a main-process module that uses a Node-only API, Vite silently externalizes it for the browser, the chunk throws at runtime, and the page aborts on launch.

User chose: **Both, phased** (denylist now → allowlist follow-up) + execute in **vite build/CI, vite dev, AND a dedicated vitest test**.

## Context facts (verified)

- Renderer entry: `index.html` → `<script type="module" src="/src/views/main.ts">`. Vite render config: `vite.render.config.mjs`.
- The crash chain was: `AiChatV2.vue` → `@/service/AIChatErrorMapper` → `@/modules/Logger` → `node:module`. Logger uses `electron-log`, `electron.app`, `fs`, `node:module.createRequire` — all Node-only.
- Existing (incomplete, manual) defenses: `rollupOptions.external: ['electron-store','electron','keytar']`, `resolve.alias` stubbing `fs`→`src/shims/fs.empty.ts` and `crypto`→`src/shims/crypto.empty.ts`. `node:module` and `@/modules/Logger` were NOT on any list → silent externalize → crash.
- `vite-plugin-checker` already runs `tsc` in the render dev server (gated by `AIFETCHLY_SKIP_VITE_CHECKER`). A static `tsc` check CANNOT catch this — the import is type-valid; the crash is a Vite bundling/runtime-externalization issue. The guard MUST be a Vite plugin that inspects the resolved module graph.
- CI runs `vite build --config vite.render.config.mjs` (via `yarn build`) — so a `buildEnd` throw becomes a merge gate.
- Existing plugin pattern: `vite-plugin-close.ts` (plain object with hooks). Follow this style.

## Phase 1 (now): denylist guard — green immediately

### 1.1 New Vite plugin: `vite-plugin-renderer-node-guard.ts` (repo root, next to `vite-plugin-close.ts`)

A plain plugin object (match `vite-plugin-close.ts` style) with two hooks:

**`resolveId` (catch at resolution time — fastest, works in dev AND build):**
- Maintain an importer stack per module id (`Map<string, string[]>`), populated via `moduleParsed`/`transform`.
- When `resolveId` resolves a denied specifier, check whether the importer (or any ancestor in its stack) is a renderer file (`src/views/**`, `src/api/**`, `src/preload.ts`). If yes → throw a loud `Error` printing the full chain (so the dev sees `AiChatV2.vue → AIChatErrorMapper → Logger → node:module`).

**`buildEnd` (backstop — whole-graph scan):**
- Walk `this.getModuleInfo()` / the bundle from the entry; for every module whose `importers` chain reaches the renderer entry, check (a) its id/specifier against the denylist, and (b) a source-level regex scan of its code for `from "node:` / `require("node:` / `from "electron"` / `from "electron-log` that would be externalized. Throw with the chain.
- Backstops cases where aliasing/`@/` indirection hides the specifier from `resolveId`.

**Denylist (curated starter set — extend as leaks surface):**
- Node builtins (protocol + bare): `node:module`, `node:fs`, `node:path`, `node:os`, `node:crypto`, `node:child_process`, `node:http`, `node:https`, `node:url`, `node:stream`, `node:util`, `node:events`, `node:buffer`, `node:zlib`; plus bare `fs`, `path`, `os`, `child_process`, `crypto`.
- Electron: `electron`, `electron/main`, `electron-log`, `electron-log/main`, `electron-log/node`.
- Native/main-only deps: `electron-store`, `keytar`, `better-sqlite3`, `sqlite-vec`, `puppeteer`/`puppeteer-core`.
- **Internal main-process modules**: `@/modules/Logger` (the one that bit us).

**Bypass env:** `AIFETCHLY_DISABLE_RENDERER_NODE_GUARD=1` (mirrors `AIFETCHLY_SKIP_TSC` convention; document that committed code must pass clean, never commit code needing this).

### 1.2 Wire into `vite.render.config.mjs`
- `import rendererNodeGuard from './vite-plugin-renderer-node-guard.ts'`
- Add `rendererNodeGuard()` to `plugins:` (before `ClosePlugin` so its `buildEnd` runs first).

### 1.3 Dedicated vitest test: `test/vitest/main/rendererNodeLeakGuard.test.ts`
- Uses Vite's programmatic `build()` with `vite.render.config.mjs`, `build.write=false`, `logLevel:'error'`.
- Case 1 (clean): current code → build resolves without the guard throwing (no Node-only module in renderer graph).
- Case 2 (regression): a temp fixture renderer file that does `import { log } from "@/modules/Logger"` → assert the guard throws and the message names the chain.
- Runs under `yarn testmain` → already a CI gate in `.github/workflows/ci.yml`.

### 1.4 Bypass toggle
- `AIFETCHLY_DISABLE_RENDERER_NODE_GUARD=1` fully bypasses (tight inner loops only). Document in CLAUDE.md alongside `AIFETCHLY_SKIP_TSC` that committed code must pass clean.

## Phase 2 (follow-up task, NOT this change): allowlist boundary migration

- Boundary: `src/views/**` + `src/api/**` + `src/preload.ts`.
- FAIL on ANY runtime import reaching `src/modules/**`, `src/service/**`, `src/main-process/**`, `src/model/**`, `src/childprocess/**`, `src/controller/**` except an explicit `rendererSafeModules` allowlist.
- Seed allowlist by running guard in "report-only" mode (log, don't throw) to enumerate current cross-boundary imports; triage each (most are `import type`-only, erased at build; others need extraction to a pure module like `AIChatErrorSentinels.ts`).
- Flip report → enforce only once allowlist is complete and zero unallowed runtime imports remain.
- Open as a separate task after Phase 1 lands.

## TDD order for Phase 1
1. Write `rendererNodeLeakGuard.test.ts` first (RED) — regression case (bad import → throws) + clean case (current graph → passes).
2. Implement `vite-plugin-renderer-node-guard.ts` (GREEN).
3. Wire into `vite.render.config.mjs`.
4. Run: `yarn build` (passes — graph clean post-Logger-fix), `yarn testmain` (new test green), `yarn dev` (guard active, no false positives).
5. Commit each logical unit (plugin, config wire, test) per auto-commit rule.

## Files
- NEW `vite-plugin-renderer-node-guard.ts`
- NEW `test/vitest/main/rendererNodeLeakGuard.test.ts`
- EDIT `vite.render.config.mjs` (import + add to plugins)
- (Phase 2 only, later) extend plugin with allowlist mode + `rendererSafeModules`

## Verification of Phase 1
- `yarn build` — passes (current graph clean after the Logger fix).
- `yarn testmain` — `rendererNodeLeakGuard.test.ts` passes (both cases).
- `yarn dev` — guard active; no false positives on normal navigation.
- Manual smoke: temporarily re-add `import { log } from "@/modules/Logger"` to a renderer file → `yarn dev` fails loudly with the chain. Remove → green.
