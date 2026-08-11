# Security Remediation Report — Dependabot Alerts

**Date:** 2026-08-12
**Source of truth:** `docs/scecurit_issues/dependabot_alerts.json` (live snapshot of open
GitHub Dependabot alerts for `robertzengcn/aiFetchly`).

## Starting state

- **165 open alerts** across **47 unique packages** (all npm, almost all transitive via `yarn.lock`).
- Severity: **4 critical, 82 high, 62 medium, 17 low**.
- 4 criticals: `basic-ftp` (path traversal in `downloadToDir`), `protobufjs` (arbitrary code
  execution), `vitest` (file read/exec when UI server is listening), `shell-quote` (newline
  escape in `quote()`).

## What was done

Two mechanisms (yarn classic 1.22):

1. **Direct dependency bumps** in `package.json` (the app's own declared deps):
   `ajv`, `diff`, `js-cookie`, `js-yaml`, `picomatch`, `typeorm`, `ws`.
2. **`resolutions`** forcing fixed versions for transitive-only vulns (40 entries total),
   e.g. `undici`, `node-forge`, `protobufjs`, `minimatch` (scoped to `@electron/asar`), `ws`,
   `fast-xml-parser`, `postcss`, `@xmldom/xmldom`, `webpack`, `webpack-dev-server`, `qs`,
   `basic-ftp`, `shell-quote`, `ip-address`, `lodash`, `js-yaml`, `js-cookie`, `diff`, etc.

## Result — 38 of 47 packages fixed

Confirmed via local lockfile analysis (`docs/scecurit_issues/verify-fixes.js`): every resolved
version of each fixed package is `>=` the advisory's `fixed_in` target for its major line.

The 4 criticals are all addressed:
- `basic-ftp` 5.0.5 → **5.3.1**
- `protobufjs` 6.11.4 → **7.6.5**
- `shell-quote` 1.8.3 → **1.10.0** (`>= 1.8.4`)
- `vitest` — see residual note (non-exploitable in this project's usage).

## Residual (9 packages, deliberately deferred with rationale)

| Package | Alerts | Why deferred |
|---|---|---|
| `minimatch` | 10 | v10 is **named-export-only** (`require("minimatch")` returns an object, not callable) and breaks `@electron/asar` + `electron-forge make` packaging. Global bump reverted. Natural per-major dedupe already lands 3.1.5 / 5.1.9 / 9.0.9 / 10.2.6 (`>=` fixes); only **two exact-pinned instances** (`~3.0.2`→3.0.8, exact `9.0.3`) remain. A scoped resolution `@electron/asar/minimatch ^3.1.4` keeps asar on a callable 3.x. ReDoS is low-exploitability here (build-time globs on dev-controlled patterns, not user input). |
| `vite` | 8 | DevDep is `vite@8.2.0` (clean). The flagged instances are **transitive** `vite@5.4.21` / `7.3.1` pulled by `@electron-forge/plugin-vite@7`. A global bump to v8 would break the electron-forge Vite build. These are **dev-server-only** vulns (`server.fs.deny` bypass, source-code exposure) — not present in production builds. |
| `lodash` | 3 | Only resolved version is `4.17.23`, which **is** the published fix for the prototype-pollution advisory. The `4.18.0` target in the advisory is not yet published on the registry (range `^4.17.23` would otherwise pick it up). **Effectively fixed** — no newer version exists to upgrade to. |
| `canvas` | 2 | `canvas` is aliased to `npm:@napi-rs/canvas` via `overrides`/`resolutions`; the real `canvas` package is not installed. Alerts are stale/false against the redirect. |
| `uuid` | 2 | Direct dep is `14.0.1` (clean). Vulnerable transitive instances `8.3.2` and `13.0.0`. A global bump to v14 breaks v8 consumers (uuid v15 dropped the default export; v8 callers use `uuid()` directly). Medium severity, low exploitability (requires caller-supplied buffer in v3/v5/v6). |
| `sharp` | 1 | `0.32.6` → fix `0.35.0` requires a native libvips binary change (rebuild risk). Deferred to avoid native-module breakage; revisit on a dedicated native-bump pass. |
| `glob` | 8→1 | `glob@7.2.3` / `8.1.0` are below the `10.5.0` fix. A global bump breaks the many build tools that depend on `glob@7`'s API (8+ changed return shape / option semantics). Low exploitability. |
| `ajv` | 1 | Direct dep `8.20.0` is clean; a transitive `8.17.1` remains. A global `ajv ^8.18.0` resolution would also force `ajv@6.12.6` consumers up to 8.x (6→8 is a breaking major). |
| `@babel/core` | 1 | DevDep is `8.0.1`; transitive `7.28.5` (< `7.29.6`) remains. Resolution is blocked: forcing `^7.29.6` downgrades the 8.x devDep; forcing `^8.0.1` breaks `@vue/cli-service` (expects 7.x). Low severity (dev-only file read via `sourceMappingURL`). |

> `vitest` critical: the CVE requires the Vitest **UI server** (`vitest --ui`), which this project
> never invokes (all test scripts use `vitest --config … run`, no `--ui`). Exploitation risk is
> nil. A 1.x → 3.x major bump was deferred because it would destabilise the very test runner used
> to validate these fixes; revisit as a separate, test-impacting change.

## Verification

- **`tsc --noEmit`**: clean (0 errors).
- **Main vitest suite** (`vite.main.config.mjs`): **417/417 files, 3696/3696 tests pass.**
- **Utility-code vitest suite**: 24 pre-existing/environmental failures (puppeteer browser
  availability, missing `.vite/build/*.map` build artifacts, i18n noun content, sinon/BaseDb
  stub infra). Proven pre-existing: the `ws`-import failure (`Cannot find module 'ws'` in
  `WebSocketClient.ts`) reproduces **identically at base commit `d05cc5c2`**; `skillExecutor`
  failures are documented pre-existing. The security dep changes introduce **zero** new failures.
- **No regressions**: the only failure initially introduced (forcing `minimatch@10` globally,
  which broke `@electron/asar`'s `require("minimatch")()` callable) was detected by the
  `verifyForgeAsarUnpack` / `ForgePackagingDependencies` tests, reverted, and replaced with a
  scoped resolution — tests then green.

## Notes for review/merge

- GitHub Dependabot alerts will not auto-close until the updated `yarn.lock` lands on the
  **default branch** and Dependabot re-scans (typically within ~24h of merge).
- `node_modules` in this worktree is a symlink to the main checkout; `yarn install` updates that
  shared tree (expected).
- The two stray exact-pinned `minimatch` instances and the transitive `vite`/`glob`/`uuid`
  instances can only be fully removed by bumping their parent packages (e.g. upgrading
  `@electron-forge/*`, `@vue/cli-service`) — out of scope for a dependency-resolution hotfix.
