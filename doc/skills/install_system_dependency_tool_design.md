# install_system_dependency Tool Design (AI-Driven Self-Healing)

## Background

Current failure scenario for imported PDF skills:

- A skill script uses `pdf2image`.
- `pdf2image` depends on the system binary `pdfinfo` (from poppler).
- The Python `.sandbox_env` can auto-install Python packages, but cannot install OS-level binaries.
- Result: `PDFInfoNotInstalledError: Unable to get page count. Is poppler installed and in PATH?`

This is why the AI can diagnose the issue but cannot currently resolve it automatically.

## Core Question

Can we solve this with:

- a narrowly scoped built-in tool `install_system_dependency`, and
- UI flow for user approval and password input when required?

## Answer

Yes. This is a valid and safe architecture, and it can solve the problem.

However, it requires additional app infrastructure that does not currently exist.

## Current App Capability (as of this analysis)

- The app has skill permission gating (allow/deny execution).
- The app does not currently implement privileged package installation flows.
- No existing implementation was found for:
  - `brew install` / `apt-get install` execution pipeline,
  - OS privilege elevation helper (`sudo-prompt`, `pkexec`, etc.),
  - dedicated UI password escalation flow for system package installation.

## Platform Nuances

- macOS + Homebrew:
  - Usually does not require password for `brew install` (user-owned prefix).
  - Still may fail if `brew` is missing from Electron process PATH.
- Linux:
  - Typically requires `sudo` for `apt/yum/dnf` installs.
  - Password/elevation handling is needed.
- Windows:
  - Depends on installer route (`winget/choco` + elevation behavior).

## Why Not a Generic Bash Tool

A raw Bash tool is high risk in an end-user Electron product with imported third-party skills:

- Over-broad command surface (prompt injection risk).
- Hard to safely validate command strings.
- Weak least-privilege guarantees.

Preferred pattern: strict allowlist + structured installer API.

## Recommended Tool Contract

Tool name: `install_system_dependency`

Suggested parameters:

- `package_name`: enum allowlist, e.g. `["poppler", "tesseract", "ffmpeg", "ghostscript"]`
- `reason`: string for audit/UI display

No free-form shell command parameter should be accepted.

## Security and UX Requirements

1. Explicit user confirmation before any install attempt.
2. Allowlisted package mapping only (no arbitrary command execution).
3. Platform-specific command mapping in main process:
   - macOS: `brew install <pkg>`
   - Linux: `apt-get install ...` (or distro-specific)
   - Windows: `winget/choco` if supported
4. Elevation flow only when needed:
   - detect permission failure,
   - prompt user,
   - request password/elevated execution through a secure path.
5. Full audit logs for who/what/when/why.
6. Clear, structured result returned to AI.

## Suggested Structured Results

- `installed`
- `already_installed`
- `permission_denied`
- `installer_not_found`
- `unsupported_platform`
- `path_issue` (installer exists but not in PATH)
- `installation_failed` (stderr attached)

## Integration with Existing Skill Error Flow

Enhance `DocSkillScriptRunnerService` error parsing:

- Detect known system dependency failures (e.g. missing `pdfinfo`).
- Return a structured mode such as `systemDependencyMissing` with:
  - dependency identifier (`poppler`),
  - detected missing binary (`pdfinfo`),
  - platform-specific suggested fix,
  - machine-readable fields to trigger `install_system_dependency`.

This keeps current behavior backward-compatible while enabling AI-driven repair.

## Practical Rollout Strategy

Phase 1 (low risk):

- Add structured `systemDependencyMissing` detection.
- Show actionable fix guidance to user.

Phase 2:

- Add `install_system_dependency` tool with confirmation dialog.
- Implement macOS Homebrew install path first.

Phase 3:

- Add Linux/Windows support with elevation workflow and stronger telemetry.

## Final Recommendation

Yes, Option 2 is the right long-term solution for AI-driven self-healing.

Implement it as a constrained installer tool (not generic Bash), gated by explicit user approval, with optional password/elevation flow only when the OS requires it.
