# Fix GitHub Security and Quality Vulnerabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all open GitHub Dependabot vulnerabilities (`node-forge`, `fast-xml-parser`, `minimatch`) and verify codebase health, keeping repository clean with zero open actionable security advisories.

**Architecture:** Use yarn 1 resolutions and targeted dependency bumps to upgrade vulnerable transitive/direct dependencies to patched upstream releases (`node-forge` >= 1.4.3, `fast-xml-parser` >= 5.12.0, `minimatch` >= 11.0.8). Preserve scoped compatibility resolutions for packages that need the 3.x line (`@electron/asar/minimatch: ^3.1.4`). Verify type checking, Vue compilation, unit tests, and security verification scripts.

**Tech Stack:** Node.js, Yarn 1.22 Classic, TypeScript, Vue 3, Vitest, GitHub CLI / Dependabot API.

**Spec:** Open GitHub Dependabot alerts:
- Alert #347: `node-forge` <= 1.4.2 (GHSA-6889-vf6x-f3g5, CVE-2026-125335) -> fixed in 1.4.3
- Alert #346: `node-forge` <= 1.4.2 (GHSA-2r2c-6745-f938) -> fixed in 1.4.3
- Alert #344: `node-forge` <= 1.4.2 (GHSA-5gfc-39fc-j95v) -> fixed in 1.4.3
- Alert #343: `fast-xml-parser` <= 5.11.2 (GHSA-v572-5636-h5vf) -> fixed in 5.12.0
- Alert #342: `minimatch` >= 7.0.0, < 11.0.1 (GHSA-g3hv-75wg-m249, CVE-2026-118764) -> fixed in 11.0.1+ (11.0.8)

## Global Constraints
- `yarn package` / `yarn make` is FORBIDDEN on developer machines (AGENTS.md).
- Must maintain `@electron/asar/minimatch: ^3.1.4` so asar remains on callable CommonJS 3.x line.
- Auto-commit changes after completing work using conventional commits format.

## Review Focus
1. `node-forge` 1.4.3 must not break any crypto/TLS or build operations.
2. `fast-xml-parser` 5.12.0 must not introduce parsing regressions in XML handling.
3. `minimatch` 11.0.8 must satisfy `@typescript-eslint/typescript-estree`, `@vue/language-core`, `editorconfig`, `@electron/universal` without breaking `@electron/asar`.
4. `test/vitest/main/ForgePackagingDependencies.test.ts` must pass.
5. `yarn tsc --noEmit` and `yarn vue-check` must pass without new type errors.

---

### Task 1: Update `package.json` Dependencies and Resolutions

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `package.json`**
  - Change `"minimatch": "^9.0.0"` to `"minimatch": "^11.0.8"` in `devDependencies`.
  - In `resolutions`:
    - Change `"node-forge": "^1.4.1"` to `"node-forge": "^1.4.3"`.
    - Change `"fast-xml-parser": "^5.11.0"` to `"fast-xml-parser": "^5.12.0"`.
    - Change `"@typescript-eslint/typescript-estree/minimatch": "^9.0.7"` to `"^11.0.8"`.
    - Add resolutions for minimatch 9 consumers:
      - `"@vue/language-core/minimatch": "^11.0.8"`
      - `"**/@vue/language-core/minimatch": "^11.0.8"`
      - `"editorconfig/minimatch": "^11.0.8"`
      - `"**/editorconfig/minimatch": "^11.0.8"`
      - `"@electron/universal/minimatch": "^11.0.8"`
      - `"**/@electron/universal/minimatch": "^11.0.8"`

---

### Task 2: Re-resolve `yarn.lock` and Verify Locked Versions

**Files:**
- Modify: `yarn.lock`

- [ ] **Step 1: Remove old entry blocks in `yarn.lock` for stale/vulnerable versions**
  - Surgically remove `node-forge@1.4.2`, `fast-xml-parser@5.11.0`, and `minimatch@9.0.9` blocks so Yarn 1 does not retain cached vulnerable entries.
- [ ] **Step 2: Run `yarn install`**
  - Run `yarn install` to fetch and link the updated dependencies.
- [ ] **Step 3: Verify locked versions in `yarn.lock`**
  - Check `node-forge` resolves to `1.4.3`.
  - Check `fast-xml-parser` resolves to `5.12.0`.
  - Check no `minimatch` in `yarn.lock` resolves to versions in `[7.0.0, 11.0.1)`. All minimatch entries must be either safe 3.x, 5.x, or >= 11.0.8.

---

### Task 3: Regression & Verification Testing

**Files:**
- None (verification commands)

- [ ] **Step 1: Run TypeScript type checking**
  - Run `npx tsc --noEmit`. Expected: exit code 0.
- [ ] **Step 2: Run Vue type checking**
  - Run `yarn vue-check`. Expected: exit code 0.
- [ ] **Step 3: Run packaging dependencies test**
  - Run `npx vitest run test/vitest/main/ForgePackagingDependencies.test.ts`. Expected: PASS.
- [ ] **Step 4: Run component tests**
  - Run `yarn test:components`. Expected: PASS.

---

### Task 4: Documentation & Dependabot Export Update

**Files:**
- Modify: `docs/scecurit_issues/SECURITY_REMEDIATION_REPORT.md`
- Modify: `docs/scecurit_issues/dependabot_alerts.json` (if refreshed)

- [ ] **Step 1: Refresh `dependabot_alerts.json` snapshot via `gh api`**
  - Export current alerts into `docs/scecurit_issues/dependabot_alerts.json`.
- [ ] **Step 2: Run `node docs/scecurit_issues/verify-fixes.js`**
  - Run verify-fixes to confirm that `node-forge`, `fast-xml-parser`, and `minimatch` are recognized as fixed.
- [ ] **Step 3: Add Round 3 section to `docs/scecurit_issues/SECURITY_REMEDIATION_REPORT.md`**
  - Document the remediation of alerts #342, #343, #344, #346, #347.

---

### Task 5: Auto-Commit Changes

**Files:**
- `package.json`
- `yarn.lock`
- `docs/scecurit_issues/SECURITY_REMEDIATION_REPORT.md`
- `docs/scecurit_issues/dependabot_alerts.json`

- [ ] **Step 1: Stage files and commit**
  - `git add package.json yarn.lock docs/scecurit_issues/`
  - `git commit -m "fix(security): resolve Dependabot alerts for node-forge, fast-xml-parser, and minimatch"`
