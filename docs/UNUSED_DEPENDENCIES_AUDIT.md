# Unused Dependencies Audit — 2026-08-21

> **Verified by:** Full-repo scan of 2,902 text files (src/, test/, scripts/,
> installer-scripts/, agent-harness/, config/, root configs, every `vite.*.config.mjs`,
> forge.config.js, .vue/.scss/.html/.cjs). For each package below: zero static imports,
> zero side-effect imports, zero dynamic `require()`/`import()` of the package string,
> and zero references in build/config files. Every reference found was either the
> `package.json` declaration itself or text in `docs/`/`specs/`/`memory/`.
>
> **Methodology caveat:** a static-text scan cannot detect truly dynamic requires where
> the package name is constructed at runtime (e.g. `"foo" + "-bar"`). All such cases
> known in this repo (e.g. `sherpa-onnx-node`, `sqlite-vec`) were verified to be in the
> KEEP list. After removing any batch, run `yarn tsc` + `yarn testmain` + `yarn build`
> to confirm nothing breaks.

## Batch 1 — Confirmed UNUSED, safe to remove (high confidence)

Zero occurrences in code, configs, or build files. References exist only in
`package.json`, `docs/`, `specs/`, or `memory/`.

| # | Package | Dependency section | Evidence / why dead |
|---|---------|--------------------|----------------------|
| 1 | `argparse` | dependencies | 0 code hits anywhere. No CLI parser entry uses it. |
| 2 | `core-js` | dependencies | 0 hits; no Babel/Vue-CLI polyfill preset references it. |
| 3 | `fetch-intercept` | dependencies | 0 hits. |
| 4 | `filenamify` | dependencies | 0 hits. |
| 5 | `http-proxy-agent` | dependencies | 0 hits. Only `https-proxy-agent` is imported (1 file). |
| 6 | `jshint` | dependencies | 0 hits. The `jshint/minimatch` `resolutions` entry is transitive-only and can stay or go. |
| 7 | `pg-hstore` | dependencies | 0 hits. Project uses SQLite/TypeORM — no Postgres anywhere. |
| 8 | `progress-stream` | dependencies | 0 hits. |
| 9 | `socks5-http-client` | dependencies | 0 hits. Project uses `fetch-socks` for SOCKS. |
| 10 | `whatwg-fetch` | dependencies | 0 hits. Electron ships native `fetch`. |
| 11 | `vite-plugin-commonjs` | dependencies | Only appears in **commented-out** import lines (`vite.utilityCode.config.mjs:5`, `vite.buckEmail.config.mjs:5`). |

### Removal commands (Batch 1)

```bash
# Production deps
yarn remove argparse core-js fetch-intercept filenamify http-proxy-agent \
  jshint pg-hstore progress-stream socks5-http-client whatwg-fetch \
  vite-plugin-commonjs
```

After removal, also drop the now-orphaned `resolutions` entry:
`"jshint/minimatch": "^3.1.4"`.

---

## Batch 2 — Planned-feature dependencies already absent or orphaned

These packages are referenced only by design documents under `docs/prd/` for
features that are not currently implemented. The runtime packages are already
absent from `package.json`; only the orphaned type package still needs removal.
Re-add the runtime packages and types when the corresponding feature is built.

| # | Package | Current state | Note |
|---|---------|---------------|------|
| 1 | `libphonenumber-js` | Already absent | Phone validation currently uses a custom digit-count regex (`src/modules/platforms/YelpComAdapter.ts:487`, `YellowPagesScraper.ts:5605`). PRD `contact-verification-ai-tool-*.md` plans to use `libphonenumber-js/max`. |
| 2 | `validator` | Already absent | No code imports. A PRD plans to use `validator.isEmail()`. |
| 3 | `@types/validator` | Orphaned devDependency | No code imports, and its matching `validator` runtime package is absent. Safe to remove. |

### Removal commands (Batch 2)

```bash
yarn remove @types/validator
```

## Already removed — no action required

| Package | Evidence |
|---|---|
| `vuex` | Not declared in the current `package.json`. The Pinia migration is complete; the only source reference is a historical comment in `userStore.ts`. |
| `vuex-module-decorators` | Not declared in the current `package.json`; its only source reference is the same historical comment. |

---

## KEEP — initially looked unused, actually used (do NOT remove)

Recorded here so the next audit does not re-investigate these.

| Package | How it is actually used |
|---|---|
| `@napi-rs/canvas` | `forge.config.js:113`, `vite.main.shared.mjs:53,320`; `overrides`+`resolutions` alias `canvas → @napi-rs/canvas`. |
| `@rollup/plugin-alias` | Imported in 17 vite configs. |
| `apexcharts` | Transitive peer of `vue3-apexcharts` (5 dashboard charts). ⚠️ **Version mismatch**: `vue3-apexcharts` peer wants `apexcharts >=4.0.0` but pinned to `^3.44.0` — keep but bump. |
| `sherpa-onnx-node` | Loaded dynamically via scoped `require("sherpa-onnx-node")` (bundler-opaque); `scripts/build-local-ai-runtime.mjs`. |
| `sqlite-vec` | Native extension loaded by name; in `config/native-dependency-policy.json` requiredPackages; `VectorDatabaseFactory.ts`, `Vector.entity.ts`, `agent-harness`. |
| `puppeteer-core` | `forge.config.js:156`, `vite.main.shared.mjs:29` (externalized). |
| `ajv-formats` | `forge.config.js:155`, `vite.taskCode.config.mjs:129`, test bundle list. |
| `bufferutil` / `utf-8-validate` | Optional `ws` peers; externalized in 17 worker vite configs + `forge.config.js:624`. |
| `winreg` | `forge.config.js:157`. |
| `word-extractor` | Imported and executed by `ChunkingService.ts` and `DocumentService.ts` for legacy `.doc` extraction. |
| `@types/word-extractor` | Required because `word-extractor@1.0.4` does not ship TypeScript declarations. |
| `ejs` | Runtime dependency of `protocol-registry`, which is imported by `src/background.ts`. The copied platform implementation calls `require("ejs")`; keep the `forge.config.js:158` packaging allow-list entry. |
| `@types/better-sqlite3`, `@types/papaparse`, `@types/turndown`, `@types/ws` | Consumed by `tsc` (runtime deps imported in 6/2/1/5 files respectively). |

---

## Verification checklist (run after each batch)

```bash
yarn tsc-result          # tsc --noEmit, one-shot
yarn vue-typecheck       # vue-tsc --noEmit, one-shot
yarn testmain            # vitest main-process + utilityCode suites
yarn build               # vite render build
yarn build:e2e           # electron E2E build (optional, slower)
```

If any of the above breaks, the removed package was used in a way the static scan
could not see — restore it and note the usage path here.
