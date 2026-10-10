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

---

## Round 2 — 2026-10-04 (5 open alerts: 4 Dependabot high + 1 code-scanning error)

**Source:** `gh api repos/robertzengcn/aiFetchly/dependabot/alerts` and `/code-scanning/alerts`.

### Fixed (version bumps via `resolutions`)

| Package | From | To | Advisory | Mechanism |
|---|---|---|---|---|
| `http-cache-semantics` | 4.2.0 | 4.3.0 | GHSA-ch52-4w7c-c8xp (max-stale cross-user cache disclosure) | Added `"http-cache-semantics": "^4.3.0"` to `resolutions` (was unpinned; transitive via `got`). |
| `basic-ftp` | 5.3.1 | 6.2.1 | GHSA-c475-qrg2-pj4r (quadratic-time ReDoS in `Client.list()` Unix parser) | Bumped existing pin `"basic-ftp": "^5.3.1"` → `"^6.2.1"`. The old pin held it on the vulnerable 5.x line. `basic-ftp` is not imported in `src/` (transitive via `get-uri`), so the 6.0 separate-transfer-host default change is a no-op. |

Lockfile re-resolved via `yarn install` after surgically removing the vulnerable blocks (yarn 1.22 trusts existing lockfile entries). Both packages now single-instance at patched versions. Commit `4b55952a` on `test`; PR #88 → `master`.

### Dismissed (no upstream patch — `tolerable_risk`)

Both have **Patched: None** on the advisory — the vulnerable version *is* the latest published. Dismissed via `gh api -X PATCH` with documented justification, not a silent bypass.

| Package | Version | Advisory | Dismissal rationale |
|---|---|---|---|
| `braces` | 3.0.3 | GHSA-vfj7-8cjw-p6xm (stack-exhaustion ReDoS via deeply-nested patterns) | Alert #279. ReDoS only triggers on deeply-nested brace patterns supplied to `chokidar`/`micromatch` glob expansion at dev-time — not user-controlled input. No upstream fix. Re-evaluate when one ships. |
| `node-forge` | 1.4.0 | GHSA-86w9-cpqp-85rv (RSA PKCS#1 v1.5 sig verification accepts extra nested DigestAlgorithm elements) | Alert #278. Only reachable via `http-mitm-proxy`, which is declared but **never imported** in `src/`. No upstream fix; tracking `digitalbazaar/forge#1152`. Re-evaluate when a patched release ships. |

### Code-scanning fix

| Rule | File:line | Fix |
|---|---|---|
| `js/unnecessary-use-of-cat` (CWE-078) | `test/modules/codesignRetryShim.test.ts:77` | Replaced `spawnSync("cat", [counterFile], …)` with `fs.readFileSync(counterFile, "utf8")` (added `readFileSync` to the existing `node:fs` import). Clears the command-injection-class rule; `spawnSync` stays imported for the `runShim` helper. All 6 suite cases pass. Commit `128ce048` on `master`. |

### Net after Round 2

- Dependabot: 2 fixed by bump (pending PR #88 merge to land on default branch), 2 dismissed (no upstream patch) → **0 actionable open**.
- Code scanning: 1 fixed (pending CodeQL rescan of `master` to close alert #67) → **0 actionable open**.
- Follow-up (out of scope): remove the unused direct deps `http-mitm-proxy`, `basic-ftp`, `node-forge` from `package.json` — they are declared but never imported. Does not clear any no-patch alert on its own (braces still arrives via `chokidar`/`ts-loader`).

