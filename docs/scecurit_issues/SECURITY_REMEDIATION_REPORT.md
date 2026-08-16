# Security Remediation Report — Dependabot Alerts

**Date:** 2026-08-12
**Source of truth:** `docs/scecurit_issues/dependabot_alerts.json` (canonical GitHub export, 165 open alerts).
**Checker:** `node docs/scecurit_issues/verify-fixes.js` (range-aware; handles the canonical concatenated-array format).

## Result — 42 of 47 vulnerable packages FIXED (~158 of 165 alerts)

All **4 critical** alerts are addressed:
- `basic-ftp` 5.0.5 → **5.3.1** (path traversal in `downloadToDir`)
- `protobufjs` 6.11.4 → **7.6.5** (arbitrary code execution)
- `shell-quote` 1.8.3 → **1.10.0**
- `vitest` 1.6.1 → **3.2.7** (CVE-2026-47429; also eliminated vulnerable transitive `vite@5.4.21` and `vite@7.3.1`)

### How (yarn classic 1.22)
1. **Direct dependency bumps** in `package.json`: `ajv`, `diff`, `js-cookie`, `js-yaml`, `picomatch`, `typeorm`, `ws`, `vitest` (1→3), `@typescript-eslint/*` (^5/^6→^7), removed unused `vite-node`.
2. **`resolutions`** forcing fixed versions for transitive-only vulns (~50 entries): `undici`, `node-forge`, `protobufjs`, `lodash` (4.18.1), `sharp` (0.35), `uuid` (^14.0.1 global), `ws`, `fast-xml-parser`, `postcss`, `fast-uri`, `@xmldom/xmldom`, `webpack`, `webpack-dev-server`, `qs`, `basic-ftp`, `shell-quote`, `ip-address`, `nanoid`, `serialize-javascript`, `tmp`, `joi`, `glob` (scoped to `@rollup/plugin-commonjs`), `@babel/core` (scoped to `@vitejs/plugin-vue-jsx`), `ajv` (scoped to `conf`/`schema-utils`/`ajv-formats`), etc.
3. **Lockfile re-resolve**: yarn 1 trusts existing lockfile entries, so for stubborn transitive instances (lodash 4.17.23, glob 10.4.5, ajv 8.17.1, eslint@6 orphans) the vulnerable version blocks were surgically removed and re-resolved against the resolutions.

### Vitest 1→3 migration (test API)
Migrated 12 test fixtures to vitest 3 types (`vi.fn<[P],R>` → `vi.fn<(...args:[P])=>R>`, `SpyInstance`→`MockInstance`). `ErrorClassification.test.ts` pins a keyword-free stack so the UNKNOWN-fallback case is deterministic across runners (vitest 3 injects "process" frames the classifier's stack scan matched; product behavior unchanged).

## Residual (5 packages) — all have NO upstream patch (or stale)

| Package | Alerts | Status |
|---|---|---|
| `xlsx@0.18.5` | 2 | **No upstream patch.** SheetJS prot-pollution/ReDoS; fixes are in the commercial SheetJS Pro, not OSS. Replace `xlsx` (e.g. with `exceljs`) to clear. |
| `canvas` | 2 | **Stale / not installed.** `canvas` is aliased to `@napi-rs/canvas` via `overrides`; the real `canvas` package is absent from the lockfile. Alerts will clear once Dependabot re-scans the merged lockfile. |
| `@ai-sdk/provider-utils@3.0.17` | 1 | **No upstream patch** published yet. |
| `elliptic@6.6.1` | 1 | **No upstream patch.** |
| `vue-template-compiler@2.7.16` | 1 | **No upstream patch.** Vue 2 EOL; only used as a devDep. Remove once Vue 2 tooling is dropped. |

> Net: of 165 open alerts, **~158 are resolved** (incl. all criticals and all high-severity with fixes). The residual ~7 are 4 no-upstream-fix packages (5 alerts) and 2 stale canvas alerts (not installed). Every alert that has a published fix is now closed — `minimatch` was the last, cleared by bumping `@vue/eslint-config-typescript` 12→13 (drops the `@typescript-eslint@6` peer that pulled in `typescript-estree@6`→`minimatch@9.0.3`; still eslint 8 legacy config).

