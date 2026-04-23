# Technology Design: Hybrid AI-Assisted System Dependency Installation

**Version:** 1.0 | **Date:** 2026-04-20 | **Status:** Draft

---

## 1. Design Goals

1. Keep AI diagnosis flexibility
2. Keep local execution safety guarantees
3. Fit existing aiFetchly architecture (`SkillExecutor`, runtime worker, env manager)
4. Minimize regression risk in Python skill execution path

---

## 2. Current Architecture Baseline

### 2.1 Python Runtime

- per-skill virtual environment prepared in `SkillEnvironmentManager`
- skill script runs via `PythonRuntimeWorkerClient` in Electron utility process
- runtime auto-repair exists for missing Python module cases only

### 2.2 Existing Gaps

- known system tool errors are not comprehensively classified
- no install capability for OS dependencies
- PATH/runtime visibility can remain stale after installs

---

## 3. Recommended Hybrid Design

### 3.1 Two-Tool Pattern

Use two distinct capabilities:

1. `resolve_system_dependency` (advisory, no side effects)
2. `install_system_dependency` (side effect, strictly validated)

Why:

- clear trust boundary
- simpler policy enforcement
- better auditability and UX

### 3.2 Trust Model

- AI server suggests `dependency_id` + rationale
- desktop client validates suggestion against local catalog and manifest hints
- installer commands are generated locally from fixed templates only

Never accept raw shell command from AI.

---

## 4. Data Contracts

### 4.1 Resolver Response (Server -> Client)

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

### 4.2 Install Request (Client Internal)

```json
{
  "dependency_id": "poppler",
  "reason": "required by pdf_to_markdown skill",
  "conversation_id": "conv-123",
  "skill_name": "pdf_to_markdown"
}
```

### 4.3 Install Result

```json
{
  "status": "installed",
  "dependency_id": "poppler",
  "probe": "pdfinfo",
  "details": "brew install poppler completed",
  "stderr": ""
}
```

Status enum:

- `installed`
- `already_installed`
- `permission_denied`
- `installer_not_found`
- `unsupported_platform`
- `path_issue`
- `installation_failed`

---

## 5. Dependency Catalog

Use a local structured catalog as the install source of truth:

```json
{
  "poppler": {
    "probe": "pdfinfo",
    "platforms": {
      "darwin": { "manager": "brew", "package": "poppler" },
      "linux": { "manager": "apt", "package": "poppler-utils" },
      "win32": { "manager": "winget", "package": "GnuWin32.Poppler" }
    }
  }
}
```

Guidelines:

- keyed by normalized `dependency_id`
- platform blocks define installer and package names
- optional signed remote update path can refresh catalog safely

---

## 6. Runtime Flow

1. Python skill fails with stderr
2. diagnostics layer classifies as `missing_system_tool`
3. resolver is called (or local mapping fallback)
4. UI shows recommendation and asks user confirmation
5. install tool validates `dependency_id` against catalog
6. platform installer runs via fixed command template
7. dependency probe re-checks binary availability
8. runtime worker/path refreshes if needed
9. skill re-executes once
10. result + audit event returned to chat stream

---

## 7. Implementation Notes for Existing Services

### 7.1 `SkillDiagnosticsService`

Add detector patterns for common tool-missing signatures:

- `PDFInfoNotInstalledError` -> `poppler` / `pdfinfo`
- `TesseractNotFoundError` -> `tesseract`
- ffmpeg binary-not-found traces -> `ffmpeg`

Return structured diagnostic data, not text-only hints.

### 7.2 `SkillEnvironmentManager`

Current behavior removes venv artifacts on missing system probe. Prefer:

- preserve venv when only OS dependency is missing, or
- perform targeted retry prep after install to avoid unnecessary full rebuilds

### 7.3 `PythonRuntimeWorkerClient`

Ensure post-install visibility:

- refresh utility process when PATH updates are required
- include common package manager binary paths in process PATH resolution on macOS

### 7.4 `SkillExecutor` / Permission Flow

Leverage current permission-gating model:

- introduce permission category for system installation (high risk)
- always require user confirmation
- return clear denied vs failed install messages

---

## 8. Platform Strategy

### Phase 2: macOS first

- `brew` backend implementation
- robust PATH handling for GUI-launched Electron environment

### Phase 3: Linux and Windows

- Linux: apt/yum/dnf backend abstraction and elevation handling
- Windows: winget/choco backend and elevation behavior checks

---

## 9. Security Requirements

1. No free-form command execution from model output
2. No free-form package names directly executed
3. Mandatory local validation before running installer
4. Mandatory user confirmation before side effects
5. Full audit logging of attempts and outcomes

---

## 10. Observability and Audit

Log schema should include:

- conversation id
- skill name
- dependency id
- missing binary
- suggested by AI (true/false)
- user decision (allow/deny)
- installer backend and package
- execution status + duration
- stderr summary (sanitized)

---

## 11. Suggested API Boundaries

### Server

- owns recommendation logic and confidence scoring
- returns normalized contract only

### Client

- owns policy, confirmation UX, execution, retry, and audit
- remains safe even if server response is wrong or malicious

---

## 12. Migration / Backward Compatibility

- keep existing failure messages for legacy UI
- add new structured fields incrementally
- resolver unavailable path falls back to local static mapping + manual install hint

