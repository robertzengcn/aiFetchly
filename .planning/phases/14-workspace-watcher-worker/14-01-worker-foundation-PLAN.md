---
phase: 14-workspace-watcher-worker
plan: 01
slug: worker-foundation
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - forge.config.js
  - vite.aifetchlyConfigWorker.config.mjs
  - src/entityTypes/aifetchlyWorkspaceWatchTypes.ts
  - src/entityTypes/aifetchlyConfigTypes.ts
  - src/service/workspaceWatch/WorkspaceWatchProtocol.ts
  - src/service/workspaceWatch/WorkspaceConfigScanner.ts
  - src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts
  - src/childprocess/aifetchly-config/WorkspaceChokidarWatcher.ts
  - src/childprocess/aifetchly-config/workerScanner.ts
  - test/vitest/main/service/workspaceWatch/WorkspaceWatchProtocol.test.ts
  - test/vitest/main/service/workspaceWatch/WorkspaceConfigScanner.test.ts
  - test/vitest/main/childprocess/WorkspaceChokidarWatcher.debounce.test.ts
  - test/vitest/main/childprocess/WorkerNoDbBoundary.test.ts
  - test/vitest/main/childprocess/rescanSla.test.ts
  - test/vitest/main/childprocess/_fixtures/workspaceTmpdir.ts
autonomous: true
requirements: [WAT-02, WAT-05, WAT-06, CFG-02]
tags: [typescript, electron, child-process, chokidar, zod, worker-sandbox, ipc]

must_haves:
  truths:
    - "WorkspaceConfigWatchWorker.ts is forkable via child_process.fork() and communicates ONLY via process.on('message')/process.send() (D-02)"
    - "Worker watches ONLY <workspace>/.aifetchly/** + optional <workspace>/AGENTS.md (D-01, design §9.5) — never the whole workspace"
    - "chokidar is pinned at ^3.6.0 (CJS, matches installed transitive 3.6.0 and the format:'cjs' worker vite config) — NOT 4.x/5.x (ESM-first)"
    - "chokidar options: ignoreInitial=true, awaitWriteFinish={stabilityThreshold:500,pollInterval:100}, atomic=true, depth=5, scoped globs, persistent=true (design §9.6)"
    - "Per-workspace 500ms debounce coalesces event bursts; a monotonic scan-generation counter discards stale out-of-order scans (design §9.6)"
    - "SC5 SLA clock window = scan-start → snapshot-applied (EXCLUDES the 500ms debounce and awaitWriteFinish event-coalescing); typical .aifetchly = ≤10 files / ≤512KB total"
    - "Main→worker commands (watch-workspace/unwatch-workspace/rescan-workspace/shutdown) and worker→main events (snapshot/changed/diagnostic/error) are zod discriminated unions (WAT-06)"
    - "Worker→main safeParse failure in main → terminate + restart worker (never apply the malformed snapshot) — verified by table-driven protocol tests"
    - "WorkspaceConfigScanner discovers .aifetchly/{AGENTS.md,settings.json,commands/*.md} + optional root AGENTS.md; missing .aifetchly → empty snapshot (CFG-02)"
    - "Worker entry registered in forge.config.js build section + vite.aifetchlyConfigWorker.config.mjs created (mirroring vite.contactExtractionWorker.config.mjs)"
  artifacts:
    - "src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts (fork target, pure-Node)"
    - "src/childprocess/aifetchly-config/WorkspaceChokidarWatcher.ts (chokidar wrapper + debounce + generations)"
    - "src/childprocess/aifetchly-config/workerScanner.ts (worker-side scan, reuses Phase 13 frontmatter parser + size limits)"
    - "src/service/workspaceWatch/WorkspaceWatchProtocol.ts (zod schemas for §9.4 unions)"
    - "src/service/workspaceWatch/WorkspaceConfigScanner.ts (main-process workspace-rooted scanner, CFG-02)"
    - "src/entityTypes/aifetchlyWorkspaceWatchTypes.ts (WatchedWorkspaceState, WorkspaceWatchAcquireInput, WorkspaceWatchCommand/Event TS types)"
    - "vite.aifetchlyConfigWorker.config.mjs (worker vite config, format cjs, externalize electron/better-sqlite3/typeorm)"
    - "test/vitest/main/childprocess/WorkerNoDbBoundary.test.ts (WAT-02 grep gate)"
  prohibitions:
    - "src/childprocess/aifetchly-config/**/*.ts MUST NOT import the Electron main module, the ORM, business-logic modules (@/modules), DB models (@/model), or any repository/datasource/SqliteDb symbol — enforced structurally by child_process.fork (pure-Node) AND by the WorkerNoDbBoundary grep-gate test"
    - "Worker comments and source MUST NOT contain literal import-path strings that the WAT-02 grep gate regex matches — describe prohibited modules by concept, not by literal `from 'X'` snippet (Rule 3 / Phase 13-03b lesson #429)"
    - "chokidar 4.x/5.x MUST NOT be installed (ESM-first; breaks the CJS worker build). Pin ^3.6.0."
    - "Worker MUST NOT call process.exit(0) on shutdown message — exit via the manager sending SIGTERM then force-kill after timeout (WAT-07 lifecycle owned by main)"
  key_links:
    - "forge.config.js entry → vite.aifetchlyConfigWorker.config.mjs → WorkspaceConfigWatchWorker.ts (fork target must resolve at runtime in packaged app)"
    - "WorkspaceConfigWatchWorker process.on('message') → workerCommandSchema.safeParse → dispatch (watch/unwatch/rescan/shutdown)"
    - "WorkspaceChokidarWatcher event → 500ms debounce → generation bump → workerScanner.scan() → process.send({type:'changed'|'snapshot'})"
---

<objective>
Build the workspace config watcher child process: a pure-Node worker forked via `child_process.fork()` that uses `chokidar@^3.6.0` to watch `<workspace>/.aifetchly/**` + optional `<workspace>/AGENTS.md`, parses bounded input into typed snapshots using the Phase 13 frontmatter parser + size limits, debounces (500ms) + reconciles via scan generations (§9.6), and streams typed events to the main process over a zod-validated IPC protocol (§9.4). WAT-02 (worker sandbox) is enforced structurally (fork → pure-Node) and by a grep-gate test.

Purpose: Establish the worker half of the watcher architecture — the sandboxed file watcher + scanner + protocol that the main-process manager (Plan 14-02) will drive. Per D-02, `child_process.fork()` makes WAT-02 architectural: the worker physically cannot import the Electron main module or the ORM.

Output: A forkable worker entry under `src/childprocess/aifetchly-config/`, the chokidar wrapper with debounce+generations, the worker-side scanner, main-process-side `WorkspaceConfigScanner` (CFG-02 workspace-rooted variant of `AIFetchlyConfigLoader`), the `WorkspaceWatchProtocol.ts` zod schemas, the worker's forge/vite build config, the chokidar direct production dependency, and the WAT-02/protocol/scanner/SC5 tests.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/14-workspace-watcher-worker/14-CONTEXT.md
@.planning/phases/14-workspace-watcher-worker/14-RESEARCH.md
@.planning/phases/14-workspace-watcher-worker/14-VALIDATION.md
@.planning/phases/13-global-context-and-built-in-slash-commands/13-01-SUMMARY.md

# Primary design source (read §9.1-§9.8 in full before Task 2)
@docs/prd/aifetchly-local-extensibility-technical-design.md

# Closest repo analog for the fork-IPC pattern (process.on('message')/process.send)
@src/childprocess/contact-extraction/ContactExtractionWorker.ts

# Reuse the Phase 13 frontmatter parser + size limits + path safety + snapshot types
@src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts
@src/entityTypes/aifetchlyConfigTypes.ts

# Worker vite config template (mirror the rollupOptions + external + empty-modules shape)
@vite.contactExtractionWorker.config.mjs
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add chokidar dependency, forge/vite worker build config, types, and zod protocol schemas</name>
  <files>package.json, forge.config.js, vite.aifetchlyConfigWorker.config.mjs, src/entityTypes/aifetchlyWorkspaceWatchTypes.ts, src/entityTypes/aifetchlyConfigTypes.ts, src/service/workspaceWatch/WorkspaceWatchProtocol.ts, test/vitest/main/service/workspaceWatch/WorkspaceWatchProtocol.test.ts</files>
  <read_first>
    - .planning/phases/14-workspace-watcher-worker/14-CONTEXT.md (D-01 chokidar, D-02 fork)
    - .planning/phases/14-workspace-watcher-worker/14-RESEARCH.md (§Standard Stack chokidar pin, §Pattern 4 zod schemas, §Pitfall 4 ESM/CJS)
    - docs/prd/aifetchly-local-extensibility-technical-design.md §9.2 (entry point), §9.4 (protocol discriminated unions), §14.4 (message size limits)
    - vite.contactExtractionWorker.config.mjs (mirror the format:'cjs' + external array + empty-modules plugin shape)
    - forge.config.js (find the contactExtractionWorker entry block to mirror)
    - src/entityTypes/aifetchlyConfigTypes.ts (existing AIFetchlyConfigSnapshot/Diff/Diagnostic shapes to reference, NOT redefine)
    - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts (existing source/sourceId conventions)
  </read_first>
  <behavior>
    - workerCommandSchema accepts the 4 main→worker commands: watch-workspace {workspaceId, workspaceRoot, includeRootAgentsFile}, unwatch-workspace {workspaceId}, rescan-workspace {workspaceId}, shutdown {}
    - workerEventSchema accepts the 4 worker→main events: snapshot {workspaceId, snapshot}, changed {workspaceId, snapshot, diff}, diagnostic {workspaceId, diagnostic}, error {workspaceId, message (≤2000 chars), recoverable}
    - safeParse rejects: missing workspaceId, empty workspaceRoot, unknown type literal, oversized error.message (>2000 chars), non-string fields
    - The schemas reuse (import) the existing Phase 13 aifetchlyConfigSnapshot shape — do NOT redefine snapshot/diff/diagnostic inline
  </behavior>
  <action>
    Add chokidar as a DIRECT production dependency at ^3.6.0. Run `npm view chokidar versions --json` first to confirm 3.6.0 is still resolvable from the registry (resolves open question A1). If the registry is reachable and lists 3.6.0, proceed with `yarn add chokidar@^3.6.0`. If `npm view` times out (network-blocked, as in the research session), surface it to the user as a dynamic auth/availability gate before installing — do NOT silently install an unverified package. After install, assert `node -e "console.log(require('./node_modules/chokidar/package.json').version)"` prints 3.6.0 and `require('./node_modules/picomatch/package.json').version` still prints a 4.x.

    Create `vite.aifetchlyConfigWorker.config.mjs` mirroring `vite.contactExtractionWorker.config.mjs`: same `defineConfig` shape, `plugins: [alias(), nodeResolve(), emptyModulesPlugin(), sourcemaps(), ClosePlugin(), checker({typescript:true})]`, `resolve.alias.@ → ./src`, `resolve.conditions: ['node']`, `build.rollupOptions.external: ['sqlite3','better-sqlite3','bindings','typeorm','electron']`, `build.ssr: true`, `sourcemap: true`. This is the CJS-compatible config that bundles the worker for the packaged app.

    Register the worker entry in `forge.config.js` build section: add `{ entry: 'src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts', config: 'vite.aifetchlyConfigWorker.config.mjs' }` adjacent to the existing contactExtractionWorker entry. Mirror the surrounding block exactly.

    Create `src/entityTypes/aifetchlyWorkspaceWatchTypes.ts` with pure TS types (no zod, no runtime): `WorkspaceWatchAcquireInput` {workspaceId, workspaceRoot, consumerId, reason?}, `WatchedWorkspaceState` {workspaceId, workspaceRoot, consumers: ReadonlySet<string>, lastSnapshot?}, `WorkspaceWatchManagerStatus` for /status reporting. Re-export `WorkspaceWatchCommand`/`WorkspaceWatchEvent` from the protocol module. Keep the file under 200 lines.

    Extend `src/entityTypes/aifetchlyConfigTypes.ts` with the minimal Phase 14 trust shape: add `AIFetchlySourceTrust` interface {instructions: boolean; commands: boolean; agents: boolean; hooks: boolean; skills: boolean}. Do NOT modify the existing AIFetchlyConfigSnapshot type (it already has optional workspaceId + source discriminator per Phase 13).

    Create `src/service/workspaceWatch/WorkspaceWatchProtocol.ts` exporting `workerCommandSchema` and `workerEventSchema` as zod discriminated unions on the `type` field, plus the inferred `WorkspaceWatchCommand`/`WorkspaceWatchEvent` types. Use the existing Phase 13 snapshot/diff/diagnostic zod schemas if they exist in `src/service/aifetchlyConfig/`; otherwise reference the TS types via `z.custom<AIFetchlyConfigSnapshot>()` (do NOT redefine the snapshot shape). Enforce §14.4 size limits: error.message ≤2000 chars, workspaceId non-empty string. Use `z.discriminatedUnion("type", [...])` per the repo zod ^3.24.0 pattern.

    Write `test/vitest/main/service/workspaceWatch/WorkspaceWatchProtocol.test.ts` as table-driven cases asserting safeParse acceptance of valid messages AND rejection of malformed ones (missing workspaceId, unknown type literal, oversized error.message, non-string snapshot). Per WAT-06 the rejection cases are the security-relevant ones — malformed messages will trigger worker terminate+restart in Plan 14-02.
  </action>
  <verify>
    <automated>cd .claude/worktrees/merry-stirring-scroll && npx vitest run --config vite.main.config.mjs WorkspaceWatchProtocol && node -e "console.log('chokidar:', require('./node_modules/chokidar/package.json').version)" && yarn tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `node -e "console.log(require('./node_modules/chokidar/package.json').version)"` prints 3.6.x
    - `node -e "console.log(require('./node_modules/picomatch/package.json').version)"` prints 4.x (still hoisted)
    - `package.json` `dependencies` contains `"chokidar": "^3.6.0"` (NOT in devDependencies)
    - `forge.config.js` contains the literal entry path `src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts`
    - `vite.aifetchlyConfigWorker.config.mjs` exists and `build.rollupOptions.external` lists `typeorm` and `electron`
    - `src/service/workspaceWatch/WorkspaceWatchProtocol.ts` exports `workerCommandSchema`, `workerEventSchema`, `WorkspaceWatchCommand`, `WorkspaceWatchEvent`
    - `workerCommandSchema.safeParse({type:"watch-workspace",workspaceId:"w1",workspaceRoot:"/tmp",includeRootAgentsFile:true}).success` === true
    - `workerCommandSchema.safeParse({type:"watch-workspace",workspaceId:""}).success` === false (empty id rejected)
    - `workerEventSchema.safeParse({type:"error",workspaceId:"w1",message:"x".repeat(2001),recoverable:false}).success` === false (§14.4 size limit)
    - Vitest protocol test file passes (accept + reject cases green)
    - `yarn tsc --noEmit` clean
  </acceptance_criteria>
  <done>chokidar ^3.6.0 installed as a direct prod dep; worker forge/vite build config wired; pure types + zod protocol schemas committed and green; WAT-06 reject-cases verified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: WorkspaceConfigScanner (workspace-rooted variant), WorkspaceChokidarWatcher (debounce + generations), and the WorkspaceConfigWatchWorker fork entry</name>
  <files>src/service/workspaceWatch/WorkspaceConfigScanner.ts, src/childprocess/aifetchly-config/workerScanner.ts, src/childprocess/aifetchly-config/WorkspaceChokidarWatcher.ts, src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts, test/vitest/main/service/workspaceWatch/WorkspaceConfigScanner.test.ts, test/vitest/main/childprocess/WorkspaceChokidarWatcher.debounce.test.ts, test/vitest/main/childprocess/_fixtures/workspaceTmpdir.ts</files>
  <read_first>
    - .planning/phases/14-workspace-watcher-worker/14-RESEARCH.md (§Pattern 1 fork-IPC, §Pattern 2 chokidar options PINNED, §Code Examples WorkspaceConfigScanner)
    - docs/prd/aifetchly-local-extensibility-technical-design.md §9.5 (watch paths — scoped, never whole workspace), §9.6 (debounce + generations + full-snapshot reconciliation), §9.7 (scanner)
    - src/childprocess/contact-extraction/ContactExtractionWorker.ts (fork-IPC template: process.on('message'), process.send, uncaughtException/unhandledRejection handlers, worker-ready signal)
    - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts (reuse scanGlobalRoot's bounded-read + frontmatter-parse + size-limit pipeline — extract or compose, do not duplicate)
    - src/entityTypes/aifetchlyConfigTypes.ts (AIFetchlyConfigSnapshot shape — emit this from scan())
  </read_first>
  <behavior>
    - WorkspaceConfigScanner.scan({workspaceId, workspaceRoot, includeRootAgentsFile}) discovers `.aifetchly/{AGENTS.md, settings.json, commands/*.md}` + optional root `AGENTS.md`; missing `.aifetchly` dir → returns empty snapshot with `source:"workspace"`, `sourceId:"workspace:<id>"`, empty files/instructions/commands/diagnostics; respects CFG-04 size limits (AGENTS 256KB, command 64KB, settings 32KB) and CFG-05 path safety (rejects absolute/`..`/escaping symlinks via the reused Phase 13 helper)
    - WorkspaceChokidarWatcher: one chokidar FSWatcher per workspace; `add`/`change`/`unlink`/`addDir`/`unlinkDir` events coalesce through a 500ms per-workspace debounce timer; bumping a per-workspace monotonic generation counter on debounce-fire; the scan callback tags its result with the generation at scan-start and the watcher exposes a `lastGeneration` field; an out-of-order scan (generation < current) is discarded by the caller (the worker)
    - WorkspaceConfigWatchWorker: process.on('message') safeParses via workerCommandSchema; on watch-workspace → create WorkspaceChokidarWatcher + scan once → emit {type:'snapshot'}; on unwatch-workspace → close the watcher; on rescan-workspace → scan once → emit {type:'changed', diff} (diff via reused AIFetchlyConfigSnapshotDiff); on shutdown → close all watchers + return (exit handled by main sending SIGTERM)
    - Worker sets env WORKER_TYPE=aifetchly-config (read by the no-DB guard pattern); handles uncaughtException/unhandledRejection by emitting {type:'error', recoverable:false} then exiting non-zero (main restarts per WAT-07)
  </behavior>
  <action>
    Create `src/service/workspaceWatch/WorkspaceConfigScanner.ts` (main-process class, also reused inside the worker via the worker-side thin wrapper). Constructor accepts the same dependencies as `AIFetchlyConfigLoader` (frontmatter parser, size limits, path-safety helper) — either compose a new `AIFetchlyConfigLoader({rootPath: workspaceRoot})` and call its existing scan, OR extract the bounded-read pipeline into a shared helper. Prefer composition: `new AIFetchlyConfigLoader({rootPath: path.join(workspaceRoot, ".aifetchly")})` then post-process the result to set source/sourceId/workspaceId. Scan candidates: AGENTS.md, settings.json, commands/*.md under `.aifetchly/`; plus `<workspaceRoot>/AGENTS.md` when includeRootAgentsFile. Return `AIFetchlyConfigSnapshot` with `source:"workspace"`, `sourceId:"workspace:<workspaceId>"`, `workspaceId`, `rootPath: workspaceRoot`. Empty/missing `.aifetchly` → empty snapshot (no throw). Never trust renderer paths — the scanner operates on the root the main process resolved via WorkspaceResolver.

    Create `src/childprocess/aifetchly-config/workerScanner.ts` as the worker-side thin wrapper around the shared scan pipeline. This file lives under `src/childprocess/` per CLAUDE.md mandate. It MUST NOT import `@/modules`, `@/model`, the Electron main module, or the ORM — only the shared parser/limits/path-safety helpers (which are pure and DB-free). If those helpers live under `src/service/aifetchlyConfig/`, import them directly (they have no DB coupling — verified Phase 13-01).

    Create `src/childprocess/aifetchly-config/WorkspaceChokidarWatcher.ts` exporting `createWorkspaceWatcher(workspaceRoot, includeRootAgentsFile, onDebouncedChange)` returning `{ watcher, bumpGeneration, getLastGeneration, close }`. Use the PINNED chokidar options from research §Pattern 2: `ignoreInitial:true`, `awaitWriteFinish:{stabilityThreshold:500, pollInterval:100}`, `atomic:true`, `depth:5`, `persistent:true`, scoped `watchPaths` to `.aifetchly` + optional root `AGENTS.md` only, and an `ignored` predicate filtering `node_modules` and `.git`. Maintain one debounce timer per workspace instance and a monotonic generation counter incremented on each debounce-fire. The class MUST NOT import `@/modules`, `@/model`, the Electron main module, or the ORM.

    Create `src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts` as the fork entry. Mirror the ContactExtractionWorker.ts shape: `process.on('message', raw => workerCommandSchema.safeParse(raw) → dispatch)`, `process.on('uncaughtException')` + `process.on('unhandledRejection')` handlers emitting `{type:'error', recoverable:false}` then `process.exit(1)`, and a worker-ready signal `process.send({type:'snapshot', workspaceId:'__ready__', snapshot: emptyPlaceholder})` OR (preferred) defer the ready signal to the first watch-workspace response. Maintain a `Map<workspaceId, {watcher, lastSnapshot}>` inside the worker. On watch-workspace: create watcher + scan once + emit snapshot. On unwatch: close watcher + delete entry. On rescan-workspace: scan + compute diff vs lastSnapshot + emit changed. On shutdown: close all watchers (do NOT process.exit — main owns the lifecycle). Tag every emitted event with the generation at scan-start so main can discard stale scans (defense-in-depth; the worker discards first, main second).

    Create the test fixture helper `test/vitest/main/childprocess/_fixtures/workspaceTmpdir.ts` exporting `tmpdirSync()` (os.tmpdir + mkdtempSync) and `writeFiles(root, files)` where files is `Array<{path, size|content}>`. Reuse across scanner + chokidar + SC5 tests.

    Write `WorkspaceConfigScanner.test.ts` covering: (a) missing `.aifetchly` → empty snapshot, (b) `.aifetchly/AGENTS.md` only → 1 instruction block, (c) `.aifetchly/commands/review.md` → commands array populated (Phase 14 reads command files but does NOT expand `$ARGUMENTS` — that is Phase 15; the snapshot carries the raw frontmatter), (d) optional root `AGENTS.md` included only when includeRootAgentsFile=true, (e) oversized AGENTS.md (>256KB) → ignored + diagnostic, (f) path traversal (`..`) in a command filename → rejected + diagnostic.

    Write `WorkspaceChokidarWatcher.debounce.test.ts` using `vi.useFakeTimers()`: (a) burst of 5 add events within 100ms → exactly ONE onDebouncedChange call after 500ms, (b) generation counter increments exactly once per debounce-fire, (c) close() stops future events (chokidar mocked or tmpdir-backed). Do NOT test cross-platform FS event semantics (that is the manual verification per VALIDATION.md).
  </action>
  <verify>
    <automated>cd .claude/worktrees/merry-stirring-scroll && npx vitest run --config vite.main.config.mjs WorkspaceConfigScanner WorkspaceChokidarWatcher && yarn tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts` exists and contains `process.on("message"` and `process.send(` (fork-IPC pattern, mirroring ContactExtractionWorker)
    - `src/service/workspaceWatch/WorkspaceConfigScanner.ts` exports class `WorkspaceConfigScanner` with method `scan(input: WorkspaceConfigScanInput): Promise<AIFetchlyConfigSnapshot>`
    - `src/childprocess/aifetchly-config/WorkspaceChokidarWatcher.ts` exports `createWorkspaceWatcher` and the chokidar options literal includes `awaitWriteFinish` and `ignoreInitial` and `atomic` keys
    - WorkspaceConfigScanner test asserts: missing `.aifetchly` → empty snapshot; root `AGENTS.md` included only when includeRootAgentsFile=true; oversized AGENTS.md → diagnostic
    - WorkspaceChokidarWatcher debounce test asserts: 5 events within 100ms → exactly 1 onDebouncedChange call after 500ms (using fake timers)
    - `yarn tsc --noEmit` clean
  </acceptance_criteria>
  <done>Worker fork entry, chokidar wrapper with debounce+generations, and main-process workspace scanner all committed and green; the worker is structurally pure-Node (WAT-02) and ready to be driven by the manager in Plan 14-02.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: WAT-02 grep-gate boundary test + SC5 rescan SLA log+assert</name>
  <files>test/vitest/main/childprocess/WorkerNoDbBoundary.test.ts, test/vitest/main/childprocess/rescanSla.test.ts</files>
  <read_first>
    - .planning/phases/14-workspace-watcher-worker/14-RESEARCH.md (§Validation Architecture → "WAT-02 grep gate" and "SC5 <500ms Rescan SLA Verification" sections — concrete test bodies provided)
    - .planning/phases/14-workspace-watcher-worker/14-VALIDATION.md (per-task verification table rows 14-WAT02-grep and 14-SC5-perf)
    - CLAUDE.md (worker-no-DB rule, three-layer DB architecture)
    - The 4 worker files created in Task 2 (to confirm the test walks the actual directory)
  </read_first>
  <behavior>
    - WorkerNoDbBoundary.test.ts walks `src/childprocess/aifetchly-config/` recursively for `.ts` files and asserts NONE of them match the forbidden-import regex set
    - The test fails if the directory does not exist OR contains zero `.ts` files (positive assertion that the worker dir is populated)
    - rescanSla.test.ts measures `WorkspaceConfigScanner.scan()` elapsed time on a typical fixture (≤10 files / ≤512KB) and asserts <450ms (SLA is 500ms; 50ms headroom catches regressions early); logs `[SC5] rescan elapsed: Xms` for observability
    - rescanSla.test.ts also logs elapsed for an empty `.aifetchly` (smoke — no SLA assertion, just observability)
  </behavior>
  <action>
    Create `test/vitest/main/childprocess/WorkerNoDbBoundary.test.ts` per research §Validation Architecture. The test walks `src/childprocess/aifetchly-config/` with `readdirSync`/`statSync`, reads each `.ts` file, and asserts (via `expect(src).not.toMatch(re)`) that NONE matches the forbidden-import regex set. The canonical regex list lives IN THIS TEST FILE (it is the authority). Reference the regex list by name ("the WorkerNoDbBoundary forbidden-import set") in plan prose and in worker source comments — do NOT inline the literal regex patterns in worker source or in this plan's action body (Rule 3 / Phase 13-03b lesson #429). Use `describe`/`it` shape consistent with the repo's vitest tests. The forbidden set covers: import-from or require-of the Electron main module, the ORM, the `@/modules` business-logic tree, the `@/model` DB-model tree, and any direct repository/datasource/SqliteDb access symbol.

    Create `test/vitest/main/childprocess/rescanSla.test.ts` per research §Validation Architecture → SC5. Use the `_fixtures/workspaceTmpdir.ts` helper from Task 2. Fixture: `.aifetchly/AGENTS.md` 64KB + `.aifetchly/settings.json` 4KB + 8× `.aifetchly/commands/cmdN.md` 8KB each (total ~10 files / ~132KB — well under the 512KB typical ceiling). Measure `performance.now()` around `scanner.scan(...)`; log `[SC5] rescan elapsed: ${elapsed.toFixed(1)}ms (files=${snap.files.length})`; assert `elapsed < 450` (SLA 500ms with 50ms regression headroom). Add a second `it` for an empty `.aifetchly` that only logs (no SLA assert — observability smoke).

    Run both tests; both MUST pass. If the WAT-02 test fails, the worker contains a forbidden import — fix by removing the import or moving the shared helper to a DB-free location. If the SC5 test fails, investigate scanner hotspot (likely the frontmatter parse or hashing — profile before optimizing).
  </action>
  <verify>
    <automated>cd .claude/worktrees/merry-stirring-scroll && npx vitest run --config vite.main.config.mjs WorkerNoDbBoundary rescanSla && yarn tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `test/vitest/main/childprocess/WorkerNoDbBoundary.test.ts` exists and passes
    - The test walks `src/childprocess/aifetchly-config/` and asserts the directory contains at least 1 `.ts` file (positive gate — fails if worker dir is empty/missing)
    - The test asserts none of the worker `.ts` files match the forbidden-import regex set
    - `test/vitest/main/childprocess/rescanSla.test.ts` exists and passes; log line `[SC5] rescan elapsed:` appears in test output
    - The SLA assert uses `<450` (not `<500`) for regression headroom
    - `yarn tsc --noEmit` clean
  </acceptance_criteria>
  <done>WAT-02 grep gate green (worker sandbox verified at the file-content level); SC5 SLA log+assert green on every commit; the worker half of the architecture is fully validated and ready for the manager (Plan 14-02).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| main → worker (IPC command) | Main sends watch/unwatch/rescan/shutdown commands; worker safeParses defensively (defense-in-depth — main is trusted but the worker guards anyway). |
| worker → main (IPC event) | Worker sends snapshot/changed/diagnostic/error events; this is an UNTRUSTED boundary even though we forked the worker ourselves — main MUST zod-safeParse every message before use (WAT-06). |
| worker → filesystem (read) | Worker reads `<workspace>/.aifetchly/**` only; bounded by CFG-04 size limits and CFG-05 path safety (rejects absolute, `..`, escaping symlinks). |
| worker → packaged-app runtime | Worker is a pure-Node child; the boundary is the absence of the Electron main module / ORM / DB symbols (structural, WAT-02). |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-14-02 | Elevation | WorkspaceConfigWatchWorker.ts + all files under src/childprocess/aifetchly-config/ | high | mitigate | Structural: `child_process.fork` makes the worker pure-Node (cannot import Electron/ORM). Grep-gate test WorkerNoDbBoundary.test.ts enforces at the file-content level on every commit. |
| T-14-06 | Tampering | WorkspaceWatchProtocol.ts (worker→main event validation) | high | mitigate | zod `safeParse` on every worker→main message (workerEventSchema); malformed → terminate + restart (implemented in Plan 14-02 manager). Worker also guards main→worker defensively. |
| T-14-SC | Tampering | chokidar npm package install (supply chain) | high | mitigate | chokidar ^3.6.0 verified in node_modules (3.6.0) and cited from github.com/paulmillr/chokidar. Task 1 runs `npm view chokidar versions --json` first to resolve the SUS false-positive (network-blocked gate in research). If registry unreachable, surface a dynamic human-verify gate before install (npmjs.com/package/chokidar). |
| T-14-Path | Info Disclosure / Tampering | WorkspaceConfigScanner path traversal | medium | mitigate | Reuse Phase 13 `resolveConfigRelativePath` / `FilePathGuard` (CFG-05) — rejects absolute, `..`, escaping symlinks. Scanner test covers the `..` case. |
| T-14-DoS-Size | DoS | Oversized AGENTS.md / settings.json parse | medium | mitigate | CFG-04 size limits enforced via `fs.stat` before `fs.readFile` (reused from Phase 13). Scanner test covers the 256KB AGENTS.md case. |
</threat_model>

<verification>
- `npx vitest run --config vite.main.config.mjs WorkspaceWatchProtocol WorkspaceConfigScanner WorkspaceChokidarWatcher WorkerNoDbBoundary rescanSla` — all 5 test files green
- `yarn tsc --noEmit` clean
- `node -e "console.log(require('./node_modules/chokidar/package.json').version)"` prints 3.6.x
- `grep -c "src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts" forge.config.js` returns ≥1
</verification>

<success_criteria>
- WAT-02 (worker sandbox): structural (fork) + grep-gate test green
- WAT-05 (debounce + generations): chokidar wrapper coalesces bursts, generation counter discards stale scans
- WAT-06 (protocol): zod schemas accept valid, reject malformed
- CFG-02 (scanner): workspace-rooted discovery of the explicit file set, missing-dir → empty snapshot
- SC5 (SLA): typical .aifetchly scan completes <450ms (log+assert)
</success_criteria>

<output>
Create `.planning/phases/14-workspace-watcher-worker/14-01-SUMMARY.md` when done
</output>

## Artifacts this plan produces

**New files:**
- `src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts` — fork target (pure-Node worker entry)
- `src/childprocess/aifetchly-config/WorkspaceChokidarWatcher.ts` — chokidar wrapper + debounce + generations
- `src/childprocess/aifetchly-config/workerScanner.ts` — worker-side thin scan wrapper
- `src/service/workspaceWatch/WorkspaceWatchProtocol.ts` — zod schemas (workerCommandSchema, workerEventSchema)
- `src/service/workspaceWatch/WorkspaceConfigScanner.ts` — main-process workspace-rooted scanner (CFG-02)
- `src/entityTypes/aifetchlyWorkspaceWatchTypes.ts` — pure types (WatchedWorkspaceState, WorkspaceWatchAcquireInput, status)
- `vite.aifetchlyConfigWorker.config.mjs` — worker vite config (CJS, externalize electron/typeorm)
- `test/vitest/main/service/workspaceWatch/WorkspaceWatchProtocol.test.ts`
- `test/vitest/main/service/workspaceWatch/WorkspaceConfigScanner.test.ts`
- `test/vitest/main/childprocess/WorkspaceChokidarWatcher.debounce.test.ts`
- `test/vitest/main/childprocess/WorkerNoDbBoundary.test.ts` — WAT-02 grep gate
- `test/vitest/main/childprocess/rescanSla.test.ts` — SC5 log+assert
- `test/vitest/main/childprocess/_fixtures/workspaceTmpdir.ts` — shared fixture helper

**Modified files:**
- `package.json` — add `chokidar: ^3.6.0` to `dependencies`
- `forge.config.js` — register the worker entry in the build section
- `src/entityTypes/aifetchlyConfigTypes.ts` — add `AIFetchlySourceTrust` interface (consumed by Plan 14-02)

**New symbols exported:**
- `workerCommandSchema`, `workerEventSchema`, `WorkspaceWatchCommand`, `WorkspaceWatchEvent` (from WorkspaceWatchProtocol.ts)
- `WorkspaceConfigScanner` class with `scan()` (from WorkspaceConfigScanner.ts)
- `createWorkspaceWatcher` factory (from WorkspaceChokidarWatcher.ts)
- `WatchedWorkspaceState`, `WorkspaceWatchAcquireInput`, `WorkspaceWatchManagerStatus` types (from aifetchlyWorkspaceWatchTypes.ts)
- `AIFetchlySourceTrust` interface (from aifetchlyConfigTypes.ts — consumed by Plan 14-02's `applyWorkspaceSnapshot`)
