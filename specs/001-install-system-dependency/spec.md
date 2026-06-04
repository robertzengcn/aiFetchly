# Feature Specification: System Dependency Installation for Python Skills

**Feature Branch**: `001-install-system-dependency`
**Created**: 2026-04-20
**Status**: Draft
**Input**: User description: "Add a safe, user-approved flow where AI can suggest system dependency fixes for Python skills while the desktop app enforces installation policy. Covers structured diagnosis, advisory resolution, policy-gated installation, retry/verification, and audit logging."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Diagnose Missing System Dependency (Priority: P1)

A user runs a Python skill that requires an OS-level binary (e.g., `pdfinfo`, `tesseract`, `ffmpeg`). The skill fails because the binary is not installed. The system detects the failure, identifies the missing dependency, and presents a clear explanation to the user in the chat interface.

**Why this priority**: Without diagnosis, nothing else in the feature works. Detection is the foundation for the entire self-healing flow.

**Independent Test**: Can be fully tested by running a skill that requires a missing binary and verifying that the error message includes the dependency name, a human-readable reason, and platform-aware install hints.

**Acceptance Scenarios**:

1. **Given** a Python skill requires `pdfinfo` and it is not installed, **When** the skill runs and fails, **Then** the error includes `missing_binary: "pdfinfo"`, `dependency_id: "poppler"`, and a human-readable reason.
2. **Given** a skill fails with an unrecognized error pattern, **When** the system analyzes it, **Then** the original text error is preserved (backward compatibility) and no false dependency_id is returned.

---

### User Story 2 - Advisory Dependency Resolution (Priority: P2)

After a dependency failure is detected, the system provides a structured recommendation without executing any install commands. The recommendation includes the normalized dependency ID, confidence level, reason, and per-platform install candidates.

**Why this priority**: This bridges diagnosis and installation by giving the AI and user the information needed to decide on action, while enforcing that no side effects occur during this step.

**Independent Test**: Can be tested by triggering a known failure and verifying the resolver returns structured JSON with a confidence score, dependency_id, and platform candidates — without any install commands being run.

**Acceptance Scenarios**:

1. **Given** a `PDFInfoNotInstalledError` is detected, **When** the resolver processes it, **Then** it returns `dependency_id: "poppler"`, `confidence: >0.9`, and platform candidates for macOS, Linux, and Windows.
2. **Given** a low-confidence or ambiguous error, **When** the resolver processes it, **Then** the result is flagged for manual review with a confidence below the threshold and no install candidates are offered.

---

### User Story 3 - User-Approved Dependency Installation (Priority: P3)

The user sees the dependency recommendation in chat and chooses to approve or deny the installation. If approved, the system validates the dependency against a local allowlist and executes a fixed, pre-approved install command template. The result (success or failure) is reported back in chat.

**Why this priority**: This is the core value delivery — the actual self-healing. It depends on P1 (diagnosis) and P2 (resolution) but delivers the most user benefit.

**Independent Test**: Can be tested by approving a known dependency install (e.g., `poppler` on macOS via Homebrew) and verifying the binary becomes available, or by denying and verifying no changes are made.

**Acceptance Scenarios**:

1. **Given** a user approves installing `poppler`, **When** the install tool runs, **Then** the dependency_id is validated against the local catalog, the fixed command template executes, and a typed result status is returned.
2. **Given** a user denies the installation, **When** the denial is recorded, **Then** no install command runs and the result shows `permission_denied`.
3. **Given** an AI suggests a dependency_id not in the catalog, **When** the install tool validates it, **Then** the installation is blocked and an appropriate error is returned.

---

### User Story 4 - Retry and Verification After Install (Priority: P4)

After a successful installation, the system re-probes for the binary and automatically retries the failed skill execution once. The retry result is visible in chat.

**Why this priority**: Completes the self-healing loop. Without retry, the user must manually re-trigger the skill after install.

**Independent Test**: Can be tested by installing a missing dependency, then verifying the system probes for the binary, refreshes the runtime path if needed, and retries the skill automatically.

**Acceptance Scenarios**:

1. **Given** `poppler` was just installed, **When** the system re-probes, **Then** `pdfinfo` is detected as available and the original skill is retried automatically.
2. **Given** installation completed but the binary is still not found in PATH, **When** re-probe fails, **Then** the system reports `path_issue` and suggests a manual step (e.g., restart the app).

---

### User Story 5 - Audit Trail for Install Actions (Priority: P5)

All dependency diagnosis, user decisions, installation attempts, and outcomes are logged in a structured audit trail. Failed install stderr is stored in sanitized form.

**Why this priority**: Important for debugging and compliance but not blocking the core user flow.

**Independent Test**: Can be tested by performing an install action and verifying a log entry exists with all required fields (dependency, platform, user decision, outcome, reason).

**Acceptance Scenarios**:

1. **Given** a user approves and installs `tesseract`, **When** the install completes, **Then** an audit log entry records dependency_id, platform, user decision (approved), outcome (installed/failed), and reason.
2. **Given** an install fails with stderr output, **When** the error is logged, **Then** the stderr is stored in sanitized form (no secrets, no full paths).

---

### Edge Cases

- What happens when the package manager (brew, apt, winget) is not installed or not in PATH?
- How does the system handle a dependency that is already installed (idempotency)?
- What happens when the AI suggests a dependency_id that matches the catalog but the platform has no candidate (e.g., unsupported OS)?
- How does the system handle a long-running install (e.g., ffmpeg on slow network) — does the user get progress feedback?
- What happens when the runtime process needs a PATH refresh but the app cannot restart the worker?
- How does the system behave when a skill fails for multiple reasons (e.g., both a missing binary and a Python package)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST detect known system dependency failures (poppler/pdfinfo, tesseract, ffmpeg) and return machine-readable fields (`missing_binary`, `dependency_id`, `reason`).
- **FR-002**: System MUST preserve backward-compatible text error messages when returning structured dependency failure information.
- **FR-003**: System MUST include platform-aware install hints in dependency failure responses.
- **FR-004**: System MUST provide an advisory resolver that takes error output, platform, and manifest hints as input and returns a normalized `dependency_id`, confidence score, reason, and per-platform install candidates — without executing any install commands.
- **FR-005**: System MUST flag low-confidence resolver results for manual review instead of offering automatic installation.
- **FR-006**: System MUST require explicit user approval (approve or deny) before any dependency installation attempt.
- **FR-007**: System MUST validate the requested `dependency_id` against a local dependency catalog before executing installation.
- **FR-008**: System MUST execute only fixed, pre-approved command templates from the catalog — never free-form commands from AI output.
- **FR-009**: System MUST return a typed result status for installations: `installed`, `already_installed`, `permission_denied`, `installer_not_found`, `unsupported_platform`, `path_issue`, or `installation_failed`.
- **FR-010**: System MUST re-probe for the binary after installation and automatically retry the failed skill execution exactly once.
- **FR-011**: System MUST refresh the runtime process/PATH when required after installation.
- **FR-012**: System MUST make the retry result visible to the user in the chat interface.
- **FR-013**: System MUST log all install actions with dependency, platform, user decision, outcome, and reason.
- **FR-014**: System MUST store failed installation stderr in sanitized form (no secrets or sensitive paths).
- **FR-015**: System MUST use a local dependency catalog mapping `dependency_id` to per-platform manager/package/probe information, not hard-coded package names.
- **FR-016**: System MUST keep the advisory resolver and install executor as separate tools — recommendation must never directly trigger execution.

### Assumptions

- The local dependency catalog ships with the application and can be updated via optional signed server updates (v1 ships with a static catalog).
- macOS is the first supported platform for the installer (Phase 2 rollout), with Linux and Windows following.
- User approval is collected inline in the chat interface (approve/deny buttons or equivalent).
- The package manager (Homebrew on macOS) is assumed to be pre-installed; if not found, the system returns `installer_not_found`.
- A single retry after install is sufficient; repeated failures fall back to manual guidance.
- The resolver confidence threshold for automatic suggestion vs. manual review is configurable but defaults to 0.8.

### Key Entities

- **Dependency Catalog Entry**: Maps a `dependency_id` to per-platform install information (package manager, package name, probe command). The catalog is local, versioned, and optionally updatable from a signed server.
- **Resolution Result**: The advisory output containing `dependency_id`, `missing_binary`, `confidence`, `reason`, and `platform_candidates`. No side effects.
- **Install Request**: A user-approved request to install a specific `dependency_id`, including a reason for the installation.
- **Install Result**: The typed outcome of an install attempt — status, dependency_id, and optional error details.
- **Audit Log Entry**: A record of any install-related action including diagnosis, user decision, installation attempt, and outcome.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users see a clear, human-readable explanation of the missing dependency within the chat interface immediately after a skill failure (no manual investigation needed).
- **SC-002**: System dependency auto-remediation succeeds for over 85% of cases on supported platforms (the binary is available and the skill retries successfully).
- **SC-003**: Zero arbitrary command execution incidents — all installed packages originate from the local catalog's fixed command templates, validated before execution.
- **SC-004**: Users can approve or deny installation from the chat interface, and their decision is respected without exception.
- **SC-005**: Every install attempt (approved, denied, succeeded, failed) produces a structured audit log entry with all required fields.
- **SC-006**: Dependency resolution completes within 2 seconds (excluding network-related variance for catalog updates).
- **SC-007**: Reduction in user-manual dependency fixes compared to baseline, measured by a decrease in support requests or manual install attempts.
