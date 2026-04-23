# PRD: Hybrid System Dependency Installation for Python Skills

**Version:** 1.0 | **Date:** 2026-04-20 | **Status:** Draft

---

## 1. Overview

### 1.1 Problem Statement

Python skills in aiFetchly can install Python packages into per-skill virtual
environments, but they cannot self-heal missing OS-level binaries such as
`pdfinfo`, `tesseract`, and `ffmpeg`.

Current experience:

- runtime fails with dependency errors
- AI can diagnose but cannot complete install safely
- users must manually run platform install commands

### 1.2 Product Goal

Add a safe, user-approved flow where AI can suggest dependency fixes while the
desktop app enforces installation policy.

### 1.3 Core Principle

AI is advisory. The client is authoritative for execution.

---

## 2. Scope

### In Scope

- structured dependency diagnosis and recommendation
- user confirmation before any install attempt
- constrained installer execution with local allowlist
- structured install result and one-time retry

### Out of Scope (v1)

- generic shell command tool
- free-form package names from model output
- silent installs without user approval

---

## 3. User Stories

1. As a user, I want missing system dependencies detected and explained clearly.
2. As a user, I want to approve or deny system installation in chat.
3. As a product owner, I want no arbitrary command execution from AI outputs.

---

## 4. Functional Requirements

### FR-1: Structured Failure Detection

The runtime should detect known system dependency failures and return
machine-readable fields (`missing_binary`, `dependency_id`, `reason`).

Acceptance criteria:

- detects common signatures (pdfinfo/poppler, tesseract, ffmpeg)
- keeps backward-compatible text errors
- includes platform-aware install hints

### FR-2: `resolve_system_dependency` (No Side Effects)

Add an advisory resolver path:

- input: stderr + platform + manifest hints
- output: normalized `dependency_id`, confidence, reason, candidates

Acceptance criteria:

- no install command is executed
- output is structured JSON (no shell text)
- low-confidence cases are flagged for manual review

### FR-3: `install_system_dependency` (Side Effect, Policy-Gated)

Install tool executes only approved dependency IDs.

Acceptance criteria:

- requires explicit user approval
- validates against local dependency catalog
- executes fixed command templates only
- returns typed result status

### FR-4: Retry and Verification

After installation, app re-probes and retries skill execution once.

Acceptance criteria:

- dependency probe runs before retry
- runtime process/path is refreshed when required
- retry result is visible in chat

### FR-5: Auditability

All install actions are auditable.

Acceptance criteria:

- logs include dependency, platform, user decision, outcome, reason
- failed stderr is stored in sanitized form

---

## 5. Non-Functional Requirements

### Security

- no arbitrary commands from AI
- allowlist validation before installer execution
- mandatory user confirmation
- separation between recommendation and execution tools

### Reliability

- idempotent handling (`already_installed`)
- structured error taxonomy
- clear manual fallback when unsupported

### Performance

- resolver should be fast (<2s target, excluding network variance)
- installer may be long-running but must provide progress/result feedback

---

## 6. Tool Contracts

### 6.1 `resolve_system_dependency`

Example response:

```json
{
  "dependency_id": "poppler",
  "missing_binary": "pdfinfo",
  "confidence": 0.96,
  "reason": "Matched PDFInfoNotInstalledError",
  "platform_candidates": {
    "darwin": { "manager": "brew", "package_name": "poppler" },
    "linux": { "manager": "apt", "package_name": "poppler-utils" },
    "win32": { "manager": "winget", "package_name": "GnuWin32.Poppler" }
  }
}
```

### 6.2 `install_system_dependency`

Input:

```json
{
  "dependency_id": "poppler",
  "reason": "Needed for pdfinfo binary required by skill runtime"
}
```

Output statuses:

- `installed`
- `already_installed`
- `permission_denied`
- `installer_not_found`
- `unsupported_platform`
- `path_issue`
- `installation_failed`

---

## 7. Dependency Catalog Strategy

Do not hard-code package names directly in tool logic. Use a local catalog
(`dependency_id` => per-platform manager/package/probe), with optional signed
server updates.

AI can suggest `dependency_id`; client resolves exact package safely.

---

## 8. Rollout Plan

### Phase 1

- improve diagnostics and structured error payload
- UI surfaces guided manual fix

### Phase 2 (macOS first)

- add resolver and installer tools
- add confirmation + install + retry loop

### Phase 3

- Linux/Windows support with elevation flows
- enhanced telemetry and robustness hardening

---

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| wrong AI suggestion | Medium | local catalog validation + probe checks |
| prompt injection via stderr | High | no command execution from model text |
| PATH not refreshed | High | runtime worker restart/re-probe |
| Linux elevation complexity | Medium | phased rollout, explicit unsupported status |

---

## 10. Success Metrics

- system dependency auto-remediation success rate > 85% (supported platform)
- reduction in user-manual dependency fixes
- zero arbitrary command execution incidents
- confirmation acceptance/denial telemetry with clear user intent

