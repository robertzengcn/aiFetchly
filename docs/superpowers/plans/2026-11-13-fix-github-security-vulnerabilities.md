# Fix GitHub Security and Quality Vulnerabilities Implementation Plan (Round 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 2 open GitHub Dependabot vulnerabilities for `@hono/node-server` (advisories GHSA-jpvv-r467-5p4w / CVE-2026-126210 and GHSA-qv5m-9pm6-hqp3 / CVE-2026-126343) and verify codebase health, keeping repository clean with zero open actionable security advisories.

**Architecture:** Use yarn 1 resolutions to pin the transitive dependency `@hono/node-server` to patched release `^2.1.8` (satisfies first patched release `2.1.6` and `@modelcontextprotocol/sdk` requirement `^1.19.9 || ^2.0.5`). Verify type checking, Vue compilation, unit tests, and security verification scripts.

**Tech Stack:** Node.js, Yarn 1.22 Classic, TypeScript, Vue 3, Vitest, GitHub CLI / Dependabot API.

**Spec:** Open GitHub Dependabot alerts:
- Alert #348: `@hono/node-server` >= 2.0.0, < 2.1.6 (GHSA-jpvv-r467-5p4w, CVE-2026-126210: Backslash in request path bypasses path-based access control at reverse proxy) -> fixed in 2.1.6+ (2.1.8)
- Alert #349: `@hono/node-server` >= 2.0.0, < 2.1.6 (GHSA-qv5m-9pm6-hqp3, CVE-2026-126343: Unhandled ECONNRESET on socket during async WebSocket upgrade crashes process) -> fixed in 2.1.6+ (2.1.8)

## Global Constraints
- `yarn package` / `yarn make` is FORBIDDEN on developer machines (AGENTS.md).
- Auto-commit changes after completing work using conventional commits format.

---

### Task 1: Update `package.json` Resolutions

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `@hono/node-server` resolution to `package.json`**
  - In `resolutions`: add `"@hono/node-server": "^2.1.8"`.

---

### Task 2: Re-resolve `yarn.lock` and Verify Locked Versions

**Files:**
- Modify: `yarn.lock`

- [ ] **Step 1: Remove old `@hono/node-server@2.1.4` entry block in `yarn.lock`**
  - Surgically remove the cached `2.1.4` block so Yarn 1 does not retain the vulnerable version.
- [ ] **Step 2: Run `yarn install`**
  - Run `yarn install` to fetch and link the updated dependency.
- [ ] **Step 3: Verify locked versions in `yarn.lock`**
  - Check `@hono/node-server` resolves to `2.1.8`.

---

### Task 3: Regression & Verification Testing

**Files:**
- None (verification commands)

- [ ] **Step 1: Run packaging dependencies test**
  - Run `npx vitest run --exclude ".worktrees/**" test/vitest/main/ForgePackagingDependencies.test.ts`. Expected: PASS.
- [ ] **Step 2: Run TypeScript type checking**
  - Run `npx tsc --noEmit`. Expected: exit code 0.
- [ ] **Step 3: Run Vue type checking**
  - Run `yarn vue-typecheck`. Expected: exit code 0.

---

### Task 4: Documentation & Dependabot Export Update

**Files:**
- Modify: `docs/scecurit_issues/SECURITY_REMEDIATION_REPORT.md`
- Modify: `docs/scecurit_issues/dependabot_alerts.json`

- [ ] **Step 1: Refresh `dependabot_alerts.json` snapshot via `gh api`**
  - Export current alerts into `docs/scecurit_issues/dependabot_alerts.json`.
- [ ] **Step 2: Run `node docs/scecurit_issues/verify-fixes.js`**
  - Run verify-fixes to confirm that `@hono/node-server` is recognized as fixed.
- [ ] **Step 3: Add Round 4 section to `docs/scecurit_issues/SECURITY_REMEDIATION_REPORT.md`**
  - Document the remediation of alerts #348 and #349.

---

### Task 5: Auto-Commit Changes
- [ ] **Step 1: Commit with conventional message**
  - `fix(security): resolve Dependabot alerts for @hono/node-server`
