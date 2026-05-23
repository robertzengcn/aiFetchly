# Phase 2 Research: Module and Worker Implementation

**Phase:** 2 - Module and Worker Implementation
**Date:** 2026-05-23

## RESEARCH COMPLETE

### Key Findings

#### 1. BaseModule Pattern (src/modules/baseModule.ts)

- Abstract class with `protected dbpath` and `protected sqliteDb`
- Constructor gets dbpath from `Token` service via `USERSDBPATH`
- Has `ensureConnection()` method for database init
- GoogleMapsModule should extend BaseModule (even though Phase 2 doesn't persist, Phase 4 will)

#### 2. Worker Process Pattern (src/childprocess/)

Workers use one of two patterns:
- **YellowPagesScraper.ts**: Full class-based scraper with `YellowPagesScraperProcess` as the worker process wrapper
- **ContactExtractionWorker.ts**: Simpler `process.on('message')` pattern with `initializeWorker()` function

For Google Maps, the simpler ContactExtractionWorker pattern is more appropriate:
- `process.on('message', handler)` for receiving commands
- `process.send()` for sending results/progress back
- `parentPort` from `worker_threads` for communication

#### 3. Worker Communication Protocol

Workers communicate via typed messages:
- `process.send({ type: 'progress', ... })` — progress updates
- `process.send({ type: 'result', ... })` — final results
- `process.send({ type: 'error', ... })` — errors
- `process.on('message', (msg) => { if (msg.type === 'cancel') ... })` — cancellation

#### 4. Module Spawning Pattern

Modules spawn workers using `child_process.fork()`:
- Pass search parameters via `worker.send({ type: 'start', ... })`
- Listen for `worker.on('message', ...)` for progress/results
- Handle `worker.on('exit', ...)` for cleanup
- Kill with `worker.kill()` for cancellation

#### 5. Forge Build Configuration

Each worker needs:
- Entry in `forge.config.js` under `build` array
- A corresponding `vite.<name>.config.mjs` file
- External modules: `sqlite3`, `better-sqlite3`, `typeorm`, `bindings`
- Uses `@rollup/plugin-alias`, `nodeResolve`, `sourcemaps`, `ClosePlugin`

#### 6. ToolExecutor Integration

Phase 1 created a stub `executeGoogleMapsSearch()` that returns "not yet implemented".
Phase 2 must replace this with:
1. Create `GoogleMapsModule` instance
2. Call `module.executeSearch(input)`
3. Wait for results (async, worker-based)
4. Return `GoogleMapsSearchResult`

The YellowPages pattern polls task status, but Google Maps is simpler:
- Single request, single response
- Module spawns worker, collects messages, resolves Promise
- No need for task polling — use Promise-based async pattern

### Architecture Decisions

1. **GoogleMapsModule extends BaseModule**: Even though Phase 2 has no DB ops, Phase 4 adds persistence. Extending now avoids refactoring later.

2. **Worker file**: `src/childprocess/google-maps/GoogleMapsWorker.ts` — follows the directory convention for workers with multiple files.

3. **Module pattern**: Promise-based — `executeSearch()` returns a Promise that resolves when the worker sends results. No polling needed (unlike YellowPages which has task status polling).

4. **Cancellation**: Module stores active worker reference, `cancelSearch()` kills the process.

5. **Timeout**: Default 10 minutes, configurable. Module sets timer, kills worker on expiry.

### Risks

- **Medium**: Google Maps DOM structure may change. Selectors must be isolated and have fallbacks.
- **Low**: Worker spawning pattern is well-established in this codebase.
- **Low**: Type contracts from Phase 1 are stable and well-defined.
