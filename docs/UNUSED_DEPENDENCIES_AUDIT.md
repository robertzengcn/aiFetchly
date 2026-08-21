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
| 11 | `word-extractor` | dependencies | 0 hits. |
| 12 | `@types/word-extractor` | devDependencies | 0 hits; pairs with the dead `word-extractor` runtime dep. |
| 13 | `vuex` | dependencies | 0 code imports. The Pinia migration is **complete**: no `store/index.ts`; the only store files (`appMain.ts`, `userStore.ts`) use Pinia `defineStore`. Every `vuex` reference in source is a comment. `docs/architecture-optimization-review.md` claiming it is "load-bearing" is stale. |
| 14 | `vuex-module-decorators` | dependencies | 0 code imports. Same as `vuex` — only comment references remain. |
| 15 | `vite-plugin-commonjs` | dependencies | Only appears in **commented-out** import lines (`vite.utilityCode.config.mjs:5`, `vite.buckEmail.config.mjs:5`). |

### Removal commands (Batch 1)

```bash
# Production deps
yarn remove argparse core-js fetch-intercept filenamify http-proxy-agent \
  jshint pg-hstore progress-stream socks5-http-client whatwg-fetch \
  word-extractor vuex vuex-module-decorators vite-plugin-commonjs

# Dev dep (no matching runtime dep)
yarn remove @types/word-extractor --dev
```

After removal, also drop the now-orphaned `resolutions` entry if desired:
`"jshint/minimatch": "^3.1.4"` (harmless to leave; it only pins a transitive).

---

## Batch 2 — Referenced only by unbuilt PRDs (planned features, not yet implemented)

These appear **only** in design docs under `docs/prd/` (the contact-verification
AI tool and email-thread-aware-reply-reliability features — currently PRDs/design
docs, not shipped code). Removing them is safe for now; **re-add when the feature
is actually built** — the PRDs document the dependency intent.

| # | Package | Section(s) | Note |
|---|---------|-----------|------|
| 1 | `libphonenumber-js` | dependencies | 0 code imports. Phone validation today uses a custom digit-count regex (`src/modules/platforms/YelpComAdapter.ts:487`, `YellowPagesScraper.ts:5605`). PRD `contact-verification-ai-tool-*.md` plans to use `libphonenumber-js/max`. |
| 2 | `validator` | dependencies | 0 code imports. PRD plans `validator.isEmail()`. |
| 3 | `@types/validator` | devDependencies | Orphaned type pkg for the dead `validator` runtime dep. |
| 4 | `ejs` | dependencies **and** devDependencies | 0 code imports. Also remove the stale line `"ejs"` from the `forge.config.js:158` runtime-require allow-list in the same change. |

### Removal commands (Batch 2)

```bash
yarn remove libphonenumber-js validator ejs
yarn remove @types/validator --dev
# Then edit forge.config.js to delete the "ejs", line (~158).
```

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
