# Natural-Language Skill Installation and Portable Skill Runtime PRD

## Document Information

| Field                     | Value                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Document version          | v1.0                                                                                                             |
| Status                    | Proposed                                                                                                         |
| Created                   | 2026-08-23                                                                                                       |
| Owner                     | AiFetchly Desktop Product and Engineering                                                                        |
| Product areas             | AiChatV2, skill system, plugin system, workspace tools, shell execution, dependency installation, secret storage |
| Supported desktop targets | Windows, macOS, Linux                                                                                            |

### Related documents

- [Natural-Language Skill Installation Technical Design](./natural-language-skill-installation-technical-design.md)
- [AiFetchly Local Extensibility PRD](./aifetchly-local-extensibility-prd.md)
- [Claude Code Plugin Compatibility PRD](./claude-code-plugin-compatibility-prd.md)
- [Claude Code Plugin Compatibility Technical Design](./claude-code-plugin-compatibility-tech-design.md)
- [Plugin Hub Managed Installation PRD](./plugin-hub-managed-installation-prd.md)
- [Workspace-Aware File Tools Plan](../plans/2026-06-26-workspace-aware-file-tools.md)
- [AI Skills System PRD](../skills/PRD_AI_Skills_System.md)
- [Secret Storage ADR](../adr/0001-secret-storage-safestorage.md)

## 1. Executive Summary

AiFetchly must let a user install and activate an agent skill by describing the desired result in natural language. A request such as the following should become a deterministic, observable installation workflow:

> Set up https://github.com/browser-use/video-use for me. Read install.md first, wire up ffmpeg, register the skill, ask me for the ElevenLabs API key when needed, then read SKILL.md for daily usage. Do not transcribe anything after installation. Tell me when it is ready and wait for footage.

The language model interprets the request and coordinates the conversation. A trusted installation service performs repository acquisition, inspection, dependency planning, permission collection, activation, rollback, and registry reload. The model must not improvise installation through repeated generic shell and file calls when the installation service can perform the operation directly.

This feature also corrects two prerequisite platform defects:

1. Shell and file tools currently operate against different filesystem scopes. File tools use the approved conversation workspace, while shell execution falls back to global home and application roots.
2. Windows shell output is not reliable. Commands can exit successfully while AiFetchly records empty stdout and stderr, making installation verification impossible.

AiFetchly will support two skill contracts:

- **Prompt skills**, defined by a `SKILL.md` file and optional bundled resources such as `helpers/` and `scripts/`.
- **Executable skills**, defined by the existing AiFetchly `manifest.json` contract and executed through the controlled skill runtime.

Prompt skills may be installed as a managed copy or, in an advanced development mode, exposed through a symbolic link or Windows directory junction under `~/.aifetchly/skills`. Installation metadata and secrets remain outside third-party repositories.

The result is a portable skill runtime that can consume common agent-skill repositories without converting them into misleading documentation-only wrappers or requiring users to understand AiFetchly's internal manifest format.

## 2. Background

### 2.1 Current behavior

AiFetchly already has useful building blocks:

- `WorkspaceResolver` resolves the approved workspace for a conversation.
- `FileToolService` can constrain file operations to that workspace.
- `ShellToolService` executes Bash, PowerShell, and cmd commands with permission checks.
- `PluginInstallService` and source fetchers acquire plugins from Git, GitHub, ZIP, npm, URL, and local folders.
- `SkillImportService` installs manifest-based executable skills and accepts a limited `SKILL.md` ZIP fallback.
- `AIFetchlyConfigLoader` scans global `~/.aifetchly` configuration.
- Workspace configuration scanning runs in a child process and returns typed snapshots to the main process.
- `SkillPermissionService`, shell permission checks, and file path guards enforce capability boundaries.
- `SecureStore` provides an Electron `safeStorage` adapter, although the live secret-storage cutover is not complete.

These parts do not yet form a reliable natural-language installation experience.

### 2.2 Observed failure

In the motivating Windows conversation, AiFetchly:

1. Searched for unrelated tools instead of selecting an installation workflow.
2. Loaded a deferred shell tool and required the model to retry manually.
3. Cloned the repository into `C:\Users\<user>\video-use` because shell execution defaulted to a global root.
4. Tried to read `video-use/install.md` through file tools scoped to a different workspace.
5. Repeated clone, directory listing, and file-reading commands without converging.
6. Received exit code `0` with empty stdout and stderr for commands that should have emitted output.
7. Encountered outside-workspace denials after cloning into a path inaccessible to file tools.
8. Never reached dependency setup, credential collection, skill registration, or readiness verification.

This was not primarily a model-quality failure. The available tools exposed inconsistent filesystem semantics and no deterministic installation capability.

### 2.3 Current skill-format mismatch

The global AiFetchly loader currently accepts only real directories containing `manifest.json`. It skips symbolic links and skips directories that contain only `SKILL.md`.

The ZIP importer can synthesize an executable wrapper from `SKILL.md`, but that wrapper runs in documentation-only mode and assumes a narrow `scripts/` convention. This changes the semantics of portable prompt skills and does not preserve general helper layouts such as `helpers/`.

Claude Code uses a different model for ordinary skills:

- A skill is a directory containing `SKILL.md`.
- Directory entries and symbolic links are accepted.
- The canonical real path is used for deduplication.
- The skill base directory is retained and supplied at invocation.
- The skill can refer to its bundled files through a skill-directory variable.
- The skill body is a prompt workflow. It is not automatically converted into an executable plugin.

AiFetchly needs this prompt-skill behavior in addition to its existing executable-skill runtime.

## 3. Problem Statement

Users cannot reliably install common agent skills from natural language because four product boundaries are incomplete.

### 3.1 No installation intent or workflow

The model must discover low-level tools and invent a plan. There is no typed installation session, resumable state, or single tool that represents the user's intent.

### 3.2 Inconsistent filesystem scope

Shell and file tools can operate on different roots within one conversation. A successful shell action can create files that the next file-tool action is forbidden from reading.

### 3.3 Incomplete portable skill support

A normal `SKILL.md` repository cannot be copied or linked into `~/.aifetchly/skills` and become usable without an AiFetchly manifest or lossy conversion.

### 3.4 Unreliable Windows command output

The application cannot confidently inspect files, report errors, or verify dependencies when PowerShell, cmd, and native programs may return empty captured output.

## 4. Product Principles

### 4.1 Natural language chooses intent; typed services perform mutations

The model may understand that the user wants to install a skill, but installation must be executed through validated service methods and explicit states. A model-generated shell transcript is not the installation API.

### 4.2 One conversation, one workspace scope

Every workspace-aware tool in a conversation must resolve the same canonical workspace. A tool may have narrower permissions, but it must not silently select a different root.

### 4.3 Configuration is a control plane; the workspace is a data plane

`~/.aifetchly` controls assistant behavior and installed capabilities. It must not become an ordinary writable workspace. User project files, footage, generated output, and normal edits belong in the approved conversation workspace.

### 4.4 Prompt instructions and executable code are different products

`SKILL.md` content instructs the model. `manifest.json` declares executable runtime behavior. AiFetchly must preserve the distinction and communicate it to the user.

### 4.5 Installation does not imply execution

Installing or activating a skill must never automatically process user files unless the user explicitly requested that processing. “Install and wait” ends at a verified ready state.

### 4.6 Permissions may be narrowed, never expanded by a repository

Repository metadata such as `allowed-tools` may request or narrow capabilities. It cannot bypass application policy, workspace trust, user approval, or operating-system protections.

### 4.7 Verify outcomes, not command exit codes alone

A successful clone requires the expected directory and Git metadata. A successful dependency installation requires a version or health check. A successful activation requires registry discovery. Exit code `0` is necessary but not sufficient.

## 5. Goals

1. Detect natural-language skill installation intent reliably.
2. Install a public Git repository containing a portable `SKILL.md` without requiring an AiFetchly manifest.
3. Use one conversation-scoped filesystem context for shell and file tools.
4. Make PowerShell, cmd, Bash, and native command output reliable and testable.
5. Support managed copy, symbolic link, and Windows junction activation under `~/.aifetchly/skills`.
6. Preserve the existing executable-skill and plugin installation paths.
7. Inspect installation instructions before executing dependency changes.
8. Request user approval for system dependencies, executable setup steps, external writes, and secrets at the correct time.
9. Store API keys through OS-backed secret storage and redact them from logs, tool arguments, chat persistence, and diagnostics.
10. Make installation resumable, repeatable, and safe to retry.
11. Provide actionable diagnostics and never enter an unbounded retry loop.
12. Support updates, disable, uninstall, rollback, and source provenance.
13. Keep all database access in Model and Module layers.
14. Keep worker processes free of direct database access.
15. Provide complete translations and UI tests for every renderer-facing addition.

### 5.1 Requirement traceability catalog

| ID     | Requirement                                                                                                         | Primary acceptance evidence                               |
| ------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| FR-01  | Detect explicit natural-language install, setup, register, and update requests that include a supported source.     | Intent-routing unit tests and `video-use` end-to-end test |
| FR-02  | Create one persisted installation session for each normalized installation identity.                                | State-machine and duplicate-request tests                 |
| FR-03  | Acquire sources into app-owned staging and record immutable provenance when available.                              | Git/local-source integration tests                        |
| FR-04  | Inspect user-named installation instructions before generating the execution plan.                                  | Instruction-precedence fixture tests                      |
| FR-05  | Classify repositories as prompt skills, executable skills, plugins, multi-skill packages, or unsupported packages.  | Repository-layout classification suite                    |
| FR-06  | Present dependencies, commands, permissions, secrets, location, and install mode before activation.                 | Plan schema and component tests                           |
| FR-07  | Route plugin and executable-skill packages through existing installation services.                                  | Service-routing integration tests                         |
| FR-08  | Install root `SKILL.md` packages as first-class prompt skills without generating a manifest in the source.          | Prompt-skill install fixture                              |
| FR-09  | Preserve a canonical skill base directory and portable skill-directory variables.                                   | Invocation-context tests                                  |
| FR-10  | Support managed copy on Windows, macOS, and Linux.                                                                  | Cross-platform activation tests                           |
| FR-11  | Support POSIX directory symlinks and Windows directory junctions in advanced linked mode.                           | Link lifecycle tests                                      |
| FR-12  | Use the approved conversation workspace as the shell and file-tool default root.                                    | Shared-scope integration tests                            |
| FR-13  | Provide read/list and separately approved execute access to the selected skill root without granting write access.  | Capability-boundary tests                                 |
| FR-14  | Detect, prepare, and verify typed dependencies such as ffmpeg and ffprobe.                                          | Dependency-provider tests                                 |
| FR-15  | Pause and resume an installation around user approval and secure credential input.                                  | Restart/resume end-to-end test                            |
| FR-16  | Store secrets through OS-backed secure storage and inject them only into approved processes.                        | Secret persistence and redaction tests                    |
| FR-17  | Verify activation through registry discovery and dependency health checks.                                          | Readiness integration tests                               |
| FR-18  | Preserve post-install user instructions such as “wait” and avoid unintended skill execution.                        | Conversation-contract test                                |
| FR-19  | Support update, repair, disable, uninstall, and rollback.                                                           | Lifecycle integration suite                               |
| FR-20  | Emit structured progress and failure codes suitable for UI rendering and retry decisions.                           | Event-schema and recovery tests                           |
| FR-21  | Advertise prompt skills through one universal invocation tool using bounded name and description metadata.          | Tool-catalog and routing tests                            |
| FR-22  | After invocation, inject normalized `SKILL.md` instructions as hidden model context rather than ordinary tool JSON. | Message-sequencing integration tests                      |
| FR-23  | Preserve invoked-skill identity and effective instructions across context compaction and conversation recovery.     | Compaction and recovery tests                             |
| FR-24  | Apply token-aware instruction budgets and provide progressive resource reads for content that is not injected.      | Token-budget and resource-tool tests                      |
| FR-25  | Route existing documentation-only skill tools through the prompt runtime without breaking stored installations.     | Legacy-wrapper compatibility tests                        |
| NFR-01 | Installation operations must be safe to retry and must not create duplicate active records.                         | Idempotency stress test                                   |
| NFR-02 | Expected-output shell commands must capture output reliably on every supported platform.                            | Required OS CI matrix                                     |
| NFR-03 | No secret may appear in chat persistence, process arguments, logs, diagnostics, or sidecar metadata.                | Redaction tests and security review                       |
| NFR-04 | Repository inspection must remain bounded by file, byte, depth, timeout, and concurrency limits.                    | Resource-exhaustion tests                                 |
| NFR-05 | Activation and rollback must never delete an unresolved, linked, workspace-root, home, or broad configuration path. | Destructive-path safety tests                             |
| NFR-06 | Existing plugin and executable-skill behavior must remain backward compatible.                                      | Regression suites                                         |
| NFR-07 | New AI-serving IPC handlers must enforce the existing AI-enable gate before request parsing or work.                | IPC architecture tests                                    |
| NFR-08 | Every new UI state must be translated into all six supported languages and covered by component tests.              | i18n parity and UI test gates                             |
| NFR-09 | Uninvoked prompt-skill bodies must not consume the normal conversation context budget.                              | Prompt-size and catalog-budget tests                      |
| NFR-10 | Loading a prompt skill must never execute embedded commands, helpers, hooks, or network requests automatically.     | Prompt-injection and no-side-effect tests                 |

## 6. Non-Goals

1. Do not automatically support every arbitrary setup script found on the internet.
2. Do not grant administrator privileges without an explicit operating-system-mediated user action.
3. Do not write generated compatibility manifests into third-party repositories.
4. Do not make installed skill roots generally writable by AI file tools.
5. Do not recursively inject every file under `helpers/` or `scripts/` into the model context.
6. Do not execute a newly installed skill as an installation health check unless it offers a non-destructive self-test and the user approves it.
7. Do not silently import skills from `~/.claude`, `.claude/skills`, or other agents' private configuration.
8. Do not replace the existing plugin system, executable skill sandbox, dependency catalog, or workspace approval model.
9. Do not store credentials in `SKILL.md`, `install.md`, repository `.env` files, plugin plaintext option files, or command-line arguments.
10. Do not permit an installed skill to alter AiFetchly policies, permission rules, system prompts, or trusted configuration outside its declared installation record.

## 7. Target Users

### 7.1 Non-technical operator

Pastes a GitHub URL and expects AiFetchly to explain requirements, ask only necessary questions, install safely, and report readiness.

### 7.2 Power user

Maintains personal skills under `~/.aifetchly/skills`, wants Git-backed updates, and may choose link mode for active development.

### 7.3 Skill author

Publishes a portable `SKILL.md` repository and expects AiFetchly to preserve relative helper paths without requiring a product-specific fork.

### 7.4 Security-conscious administrator

Needs provenance, commit pinning, permission review, dependency visibility, secret isolation, audit records, and the ability to disable capabilities immediately.

### 7.5 Windows user

Expects the same installation reliability as macOS and Linux without manually translating commands between Bash, PowerShell, and cmd.

## 8. Terminology

| Term                 | Meaning                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Prompt skill         | A model-guidance package whose primary entry is `SKILL.md`. It may include read-only resources and helper programs.      |
| Executable skill     | An AiFetchly runtime package with `manifest.json` and an explicit executable entry.                                      |
| Plugin               | A larger package that can contribute skills, MCP servers, commands, agents, or hooks.                                    |
| Skill source         | The immutable or user-controlled repository/folder from which a skill is installed.                                      |
| Skill root           | The canonical directory containing `SKILL.md` or `manifest.json`.                                                        |
| Managed copy         | An AiFetchly-owned copy under the skill installation root.                                                               |
| Linked install       | A symbolic link on POSIX or directory junction/symlink on Windows that exposes an external source as an installed skill. |
| Installation session | A persisted state machine representing one requested installation and its approvals, progress, diagnostics, and result.  |
| Filesystem scope     | The canonical roots and capabilities available to a tool invocation.                                                     |
| Dependency plan      | A typed list of detected, missing, installable, and user-provided requirements.                                          |

## 9. Primary User Experience

### 9.1 Happy path

```text
User asks to install a GitHub skill
        ↓
AiFetchly recognizes installation intent
        ↓
Repository is cloned into app-owned staging
        ↓
AiFetchly inspects metadata and instruction files
        ↓
User sees source, commit, skill type, requested tools, dependencies, and risks
        ↓
User approves the installation plan
        ↓
Dependencies are detected and installed or wired
        ↓
AiFetchly asks for any missing secret through a secure input control
        ↓
Skill is atomically copied or linked and registry is reloaded
        ↓
Readiness checks pass
        ↓
Assistant says the skill is ready and follows the user's requested terminal behavior
```

### 9.2 Conversation contract

The installer must preserve the user's whole request, not only the URL. The installation session stores:

- Requested source and optional branch, tag, or commit.
- Instruction-file ordering such as “read install.md first”.
- Dependency requests such as “wire up ffmpeg”.
- Requested installation mode when stated.
- Credential requests and when they should occur.
- Post-install behavior such as “do not transcribe; wait for footage”.

The post-install behavior applies to the current task unless the user explicitly asks to make it a permanent skill preference.

### 9.3 Approval behavior

AiFetchly may acquire and inspect a public repository in app-owned staging before approval because this is reversible and does not activate code. It must request confirmation before:

- Installing or changing a system dependency.
- Running repository-provided setup code.
- Writing outside app-owned staging or the approved workspace.
- Activating a skill with executable helpers.
- Creating a link to a user-controlled external directory.
- Replacing or updating an installed skill.
- Sending credentials or authenticated requests.

### 9.4 Model-facing installation tools

The main AI tool catalog must expose a small, stable installation surface. The exact names may follow registry conventions, but the product contract is:

| Capability                   | Purpose                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Start or resume installation | Accept source, optional ref/subpath/mode, and the user's non-secret installation constraints; return a session and next required action |
| Get installation status      | Return state, progress, sanitized diagnostics, and pending user decisions                                                               |
| Cancel installation          | Stop active work and roll back or clean staging as required                                                                             |
| Retry installation           | Resume from the last verified checkpoint after a recoverable failure                                                                    |

Secrets must never be accepted as ordinary model tool arguments. They use a dedicated renderer-to-main secure IPC path associated with the installation session.

The start tool must be available in the main tool tier or be directly discoverable from queries containing `install skill`, `set up repository`, `register skill`, or a supported repository URL. A deferred-tool loading response must be handled by the tool runtime itself or retried once automatically; it must not force the model into unrelated filesystem discovery.

The tool result must contain an explicit `next_action` such as:

```text
inspect-in-progress
review-plan
approve-dependency
provide-secret-securely
ready
retryable-error
terminal-error
```

This keeps the model from guessing whether it should clone again, switch paths, or continue after an incomplete step.

### 9.5 Model-facing prompt-skill invocation

Daily prompt-skill use must be separate from installation and from executable skill tools. The model receives one stable invocation capability, referred to in this document as `use_skill`, plus a bounded list of available skill metadata.

```text
User asks for work
        ↓
Model sees matching skill name and description
        ↓
Model calls use_skill with the scoped skill identity
        ↓
AiFetchly returns a short tool acknowledgement
        ↓
AiFetchly injects normalized SKILL.md as hidden model context
        ↓
The next model round follows the skill instructions
```

The catalog must not inject every installed `SKILL.md` into the initial prompt. Discovery includes only the invocation identity, name, bounded description, source/scope label when needed to disambiguate, and optional argument hint.

An explicit user `/skill-name` action and automatic model selection must resolve through the same catalog and invocation service. Frontmatter such as `disable-model-invocation` may prevent automatic selection without preventing an authorized explicit invocation.

## 10. Installation Session State Machine

Every installation must use an explicit state machine.

```text
requested
  → acquiring
  → inspecting
  → awaiting-plan-approval
  → preparing-dependencies
  → awaiting-secret
  → activating
  → verifying
  → ready

Any active state may transition to:
  → failed-recoverable
  → failed-terminal
  → cancelled
  → rolling-back → rolled-back
```

### 10.1 State requirements

- State transitions must be persisted through the Module and Model layers.
- Each transition records timestamp, reason code, and sanitized detail.
- Restarting AiFetchly must allow a recoverable installation to resume.
- A session waiting for a secret must not hold a child process or filesystem lock.
- Retrying must continue from the last verified checkpoint.
- Three repeated failures with the same normalized cause must stop automatic retries and ask the user for direction.
- Cancelling before activation removes staging data.
- Cancelling after activation begins invokes rollback.

### 10.2 Idempotency

Idempotency means a safe retry produces one consistent installation rather than duplicate directories or database records.

The installation identity should include:

```text
normalized source URL + requested ref + discovered skill subpath + installation mode
```

If the same request is already active, AiFetchly should resume it. If the same commit is already installed and healthy, AiFetchly should report it as ready without reinstalling.

## 11. Source Acquisition Requirements

### 11.1 Supported sources for this release

- HTTPS Git repository.
- SSH or `git@` repository when existing user Git credentials can access it.
- GitHub URL.
- Local folder.
- Local ZIP.

Existing plugin sources such as npm and generic URL archives remain plugin features and may be added to standalone skill installation later.

Public GitHub installation must not require a customer-installed Git executable. The source provider should use one of these verified acquisition paths:

1. Existing controlled Git fetcher when Git is available and repository semantics are needed.
2. GitHub archive/API download pinned to a resolved commit for public repositories.
3. Authenticated Git or GitHub acquisition for private repositories after explicit credential authorization.

The acquired directory must enter the same validation pipeline regardless of transport.

### 11.2 Acquisition rules

- Acquisition runs in the Electron main process or a controlled utility process.
- The renderer never selects executable paths or invokes Git directly.
- Git must be invoked with `shell: false` and a typed argument array.
- Credentials must come from existing Git credential helpers or SSH agents, never URL rewriting or command arguments.
- HTTPS is required for anonymous HTTP sources.
- The source URL shown in logs and diagnostics must be redacted.
- Clone into a unique app-owned staging directory created with secure temporary-directory APIs.
- Apply file-count, total-size, individual-file-size, archive traversal, and special-file limits before inspection.
- Ignore or reject devices, FIFOs, sockets, and unsupported filesystem entries.
- Record the resolved Git commit SHA before activation.
- Verification checks the expected on-disk result instead of trusting the Git exit code alone.
- Prompt skills without a declared semantic version use the resolved commit or content hash as their immutable version identity. AiFetchly must not invent a semantic version and write it into the package.

### 11.3 Repository root and skill discovery

AiFetchly must inspect, in order:

1. Native plugin manifests.
2. Claude-compatible plugin manifests.
3. Root `manifest.json` executable skill.
4. Root `SKILL.md` prompt skill.
5. Recognized `skills/<name>/SKILL.md` children.
6. A single wrapper directory containing one of the above.

If multiple independent skills are found, the user must choose which skills to activate or explicitly install all. The installer must not guess based on directory ordering.

## 12. Instruction Inspection and Planning

### 12.1 Instruction-file precedence

When the user names an installation file, AiFetchly must inspect it first after safe acquisition. Case-insensitive conventional candidates are:

1. User-named file, such as `install.md`.
2. `INSTALL.md`.
3. `README.md` installation section.
4. `SKILL.md`.
5. Native manifests and dependency declarations.

Reading an instruction file does not authorize its commands.

### 12.2 Instruction interpretation

The model may summarize repository instructions into a typed plan, but the installer validates every action. The plan separates:

- App-owned file operations.
- Workspace file operations.
- System dependency detection.
- System dependency installation.
- Package-manager operations.
- Repository-provided commands.
- Credential requirements.
- Activation and registration.
- Readiness checks.

Unknown or opaque commands remain visible to the user and require explicit approval.

### 12.3 Helper-directory handling

If `SKILL.md` instructs the agent to read `helpers/`, AiFetchly should retain that instruction and make the canonical skill root available at invocation. It must not automatically inject every helper file because doing so can:

- Exceed context limits.
- Load binaries or generated files.
- Expose accidental secrets.
- Execute instructions unrelated to the current task.

The invoked agent may list and read relevant helper files through read-only skill-resource access.

When `SKILL.md` explicitly requires helpers to be inspected on every invocation, the invocation plan must list or read the relevant helper index before performing the requested task. This is runtime behavior, not a reason to inject the entire directory during installation or global discovery.

### 12.4 Initial safety and resource limits

The first release should reuse existing package limits unless testing justifies a stricter value:

| Resource                                                   | Initial limit                               |
| ---------------------------------------------------------- | ------------------------------------------- |
| Downloaded ZIP                                             | 50 MiB                                      |
| Extracted or cloned package content counted for activation | 250 MiB                                     |
| Files per acquired package                                 | 5,000                                       |
| Prompt skills accepted per source                          | 100                                         |
| `SKILL.md`                                                 | 256 KiB                                     |
| Installation-plan instruction content sent to the model    | 512 KiB total after deterministic selection |
| Repository traversal depth                                 | 20 directories                              |
| Concurrent installation sessions                           | 2 globally, 1 per installation identity     |
| Default acquisition timeout                                | 60 seconds, with an explicit retry path     |

Large models and managed runtime artifacts are not counted as repository content. They follow their existing catalog-specific limits and download plans. Limit failures must be structured and must not leave an active partial installation.

## 13. Skill Classification and Runtime

### 13.1 Prompt skill

A directory is a prompt-skill candidate when it contains a regular `SKILL.md` file and is not claimed exclusively by a native executable manifest.

The loader must:

- Parse supported YAML frontmatter.
- Preserve unknown frontmatter fields for future compatibility.
- Validate name, description, size, encoding, and path safety.
- Store the exact skill body or its content hash without modifying the source file.
- Retain the canonical `skillRoot`.
- Register the skill as a prompt capability, not an executable tool wrapper.
- Expose it through the universal prompt-skill invocation tool rather than registering one documentation tool per skill.
- Load full skill content only when invoked; discovery context uses bounded metadata.
- Clearly label the source as user, workspace, plugin, linked, or managed copy.

### 13.2 Executable skill

Directories containing a valid AiFetchly `manifest.json` continue through the existing import, permission, environment, and sandbox pipeline.

Executable skill requirements remain stricter:

- Explicit runtime and entry point.
- Declared permissions and dependency metadata.
- Path validation under the installed root.
- Controlled execution boundary.
- Structured stdout, stderr, exit, timeout, and diagnostics.

### 13.3 Plugin

Repositories containing plugin manifests continue through `PluginInstallService` and compatibility adapters. The natural-language installer routes to that service instead of reimplementing plugin import.

### 13.4 Ambiguous packages

If a package contains both `SKILL.md` and `manifest.json`, native manifest semantics win for execution, while `SKILL.md` may remain documentation or invocation guidance. The inspection summary must explain this classification.

### 13.5 Naming, precedence, and collisions

Every installed capability needs a stable scoped identity separate from its display name. Recommended identity inputs are source class, installation ID, and declared skill name.

Collision rules:

- User-installed content cannot shadow or replace a built-in skill silently.
- A global user skill and workspace skill with the same display name remain separate scoped capabilities.
- Two entries resolving to the same canonical `SKILL.md` are deduplicated.
- Two unrelated sources declaring the same name require a visible source-qualified choice.
- Updating an existing installation must match its installation identity; a same-name repository from another source is a separate install or an explicit replacement.
- Registry diagnostics must report the winning source and every disabled collision.

### 13.6 Compatibility metadata

Common prompt-skill frontmatter should be handled as follows:

| Field                      | Behavior                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Validated display and invocation name; directory name is the fallback only when compatibility policy permits it      |
| `description`              | Model-facing discovery text and user-facing summary; bounded for catalog context without rewriting the stored source |
| `allowed-tools`            | Mapped to AiFetchly tool identities; unknown tools produce diagnostics and never grant capabilities                  |
| `user-invocable`           | Controls explicit user invocation visibility when present                                                            |
| `disable-model-invocation` | Prevents automatic model selection when present                                                                      |
| Unknown fields             | Preserved for diagnostics and future compatibility, not executed                                                     |

## 14. Prompt-Skill Invocation Contract

Prompt skills use a two-stage lazy-loading contract. Before invocation, the model sees only bounded catalog metadata. After `use_skill` succeeds, the model receives a hidden instruction message equivalent to:

```text
Skill: <name>
Source: <source type and trusted display name>
Base directory for this skill: <canonical skill root>
Writable workspace: <canonical conversation workspace>

<SKILL.md body>
```

The instruction block must not be embedded inside a JSON result object as its long-term delivery mechanism. The invocation tool result should be a short acknowledgement containing the resolved runtime identity, content hash, context revision, and status. The chat orchestrator then appends the hidden instruction message after the required tool-result message and before the next model completion.

### 14.1 Message sequencing

The logical sequence is:

```text
assistant: tool call use_skill(runtime_id, optional arguments)
tool:      { status: "loaded", runtime_id, context_revision }
hidden:    normalized skill instruction block
assistant: continues the user's task under those instructions
```

The hidden message is model-visible but must not render as a user-authored chat bubble. It must be distinguishable from trusted application policy: repository-authored `SKILL.md` remains untrusted instructions constrained by system policy, tool permissions, filesystem capabilities, and user approvals.

Backends that support a dedicated developer or application-context role should use that role. Backends without it may use an internal meta-user message, provided the UI, persistence, and compaction layers preserve its origin and never present it as human text.

The orchestrator must not append the hidden message when resolution fails, the skill is disabled, the content hash cannot be verified, the content violates size/encoding rules, or invocation policy rejects the request.

### 14.2 Skill directory variables

AiFetchly must support:

- `${AIFETCHLY_SKILL_DIR}` as the native portable variable.
- `${CLAUDE_SKILL_DIR}` as an optional compatibility alias.

On Windows, injected command paths must use a representation appropriate for the selected shell. A PowerShell path must not be escaped as though it were Bash.

### 14.3 Token-aware instruction loading

The current fixed character cap must be replaced with a model-aware token budget. The budget policy must account for:

- Current model context window and reserved completion tokens.
- Existing conversation, system policy, active plan, attachments, and tool catalog.
- Already invoked skills and their effective content hashes.
- A per-skill maximum and an aggregate invoked-skill maximum.
- Required space for at least one model response and one tool round.

When the complete normalized `SKILL.md` fits, AiFetchly injects it in full. When it does not fit, AiFetchly injects a deterministic essential block containing the skill identity, base directory, declared workflow, safety constraints, and a truncation notice. The model then uses `skill_resource_read` for omitted named sections or referenced files.

Truncation must be section-aware rather than a raw character slice whenever Markdown headings can be parsed safely. Frontmatter is parsed into metadata and is not repeated verbatim in the instruction body.

### 14.4 Resource capabilities

Prompt skills receive two distinct path capabilities:

| Root                                     | Default capability                                             |
| ---------------------------------------- | -------------------------------------------------------------- |
| Approved conversation workspace          | Read/write according to the requested tool and user permission |
| Installed prompt-skill root              | Read/list; execute only after helper execution approval        |
| `~/.aifetchly` metadata and secret state | No direct tool access                                          |
| App temporary run directory              | Read/write for the current run only                            |

An installed skill must not gain read access to arbitrary sibling skills merely because they share `~/.aifetchly/skills`.

### 14.5 Allowed tools

Frontmatter `allowed-tools` may reduce the tools presented or permitted during invocation. It cannot:

- Enable a globally disabled tool.
- Bypass confirmation.
- Escape filesystem scope.
- Access secrets directly.
- Grant network access when application policy denies it.

### 14.6 Invoked-skill lifecycle

AiFetchly must track invoked skills as conversation runtime state. Each record includes:

- Conversation and optional agent/subagent identity.
- Scoped runtime identity and source scope.
- Canonical `SKILL.md` path.
- Effective content hash and context revision.
- Normalized instruction content or a recoverable reference to the verified content.
- Invocation arguments after secret redaction.
- Invocation timestamp and whether selection was explicit or automatic.

Repeated invocation of the same runtime identity and content hash is idempotent: it returns `already-loaded` and does not duplicate the hidden instruction block. If a linked skill changes, a new content hash creates a new context revision and the user/model receives a visible change notice before the new instructions take effect.

Context compaction and conversation recovery must reattach all still-active invoked skills in deterministic invocation order. The restored message states that these skills were previously invoked and remain applicable. Disabled, uninstalled, missing, or hash-invalid skills are not silently restored; the conversation receives a structured diagnostic.

Skills invoked inside an isolated subagent do not automatically become active in the parent conversation. Propagation requires an explicit runtime policy because subagent instructions may be task-specific.

### 14.7 No automatic execution

Loading a skill is a read-and-context operation only. It must not:

- Execute inline shell syntax embedded in Markdown.
- Run scripts, hooks, installers, or helper files.
- Expand variables by evaluating shell expressions.
- Perform network requests.
- Read the user's workspace beyond content already present in the request.

Subsequent helper execution uses ordinary approved tools or `skill_resource_execute` with independent validation and permission checks.

## 15. Unified Filesystem Scope

### 15.1 Shared resolver

Introduce one main-process scope resolver consumed by shell, file, prompt-skill, and installer services:

```typescript
interface ConversationFilesystemScope {
  readonly conversationId: string;
  readonly workspaceId: number;
  readonly workspaceRoot: string;
  readonly canonicalWorkspaceRoot: string;
  readonly skillCapabilities: readonly SkillRootCapability[];
  readonly temporaryRoot: string;
}
```

The exact type name is implementation-specific, but there must be one source of truth.

### 15.2 Required behavior

- `WorkspaceResolver` remains the authority for the active approved workspace.
- Shell default `cwd` must equal the canonical conversation workspace.
- File tools and shell permission guards must use the same canonical root.
- Explicit `cwd` must remain within a permitted root for that tool call.
- Resolver errors fail closed with a structured `workspace-resolution-failed` result.
- Missing workspace returns `workspace-required`; it must not silently fall back to home or `userData`.
- Canonicalization must resolve symlinks and normalize case where appropriate on Windows.
- Existing conversation workspace approval and revocation apply immediately to new tool calls.
- Revoking a workspace cancels or prevents queued installation steps that depend on it.

### 15.3 Multi-root capability checks

Prompt-skill helpers require a narrow exception to the single writable root. Permission evaluation must understand capabilities, not treat every allowed root equally:

```text
workspace root     read + approved writes
selected skill root read + approved execute
temporary run root read + write
config root        installer service only
secret store       credential service only
```

The generic file-write and shell tools must not receive blanket write access to all roots.

## 16. Windows Shell Reliability

### 16.1 Platform provider abstraction

Shell selection and process behavior must be implemented through platform providers rather than scattered `process.platform` conditions.

Each provider defines:

- Executable detection.
- Spawn arguments.
- Environment baseline.
- Path quoting and command encoding.
- Detached-process behavior.
- Process-tree termination.
- Output decoding.
- Temporary-file behavior.

### 16.2 Windows provider requirements

- Prefer a verified `pwsh` installation when available; otherwise use Windows PowerShell deliberately.
- Support explicit cmd execution for cmd-specific commands.
- Use `shell: false` with typed arguments.
- Default to `detached: false` on Windows unless a verified background-process design requires otherwise.
- Preserve required Windows environment variables, including `SystemRoot`, `ComSpec`, `PATHEXT`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, and `TMP` when present.
- Preserve `PATH` using Windows case-insensitive environment-key semantics.
- Remove known sensitive variables instead of replacing the entire environment with a Unix-centric allowlist.
- Normalize CRLF without erasing other output.
- Decode redirected Windows PowerShell output correctly. If UTF-16LE or a byte-order mark is detected, use an appropriate decoder.
- Wait for stdout and stderr completion before producing the final result.
- Report spawn errors, stream errors, exit code, signal, timeout, and byte counts separately.

### 16.3 Output observability

Diagnostic events may record:

- Provider and executable identifier.
- Whether `detached` was enabled.
- Chunk and byte counts.
- Stream end/close ordering.
- Exit code and duration.
- Encoding selected.

Diagnostics must not record command output, secrets, authenticated URLs, or full environment values.

### 16.4 Required Windows verification matrix

Automated tests on a real Windows runner must cover:

| Provider   | Command                             | Expected result                  |
| ---------- | ----------------------------------- | -------------------------------- |
| PowerShell | `Write-Output 'sentinel'`           | stdout contains `sentinel`       |
| PowerShell | `Get-Content` on a UTF-8 file       | exact expected content           |
| PowerShell | Unicode output                      | decoded text matches input       |
| PowerShell | stderr and non-zero exit            | separated stderr and exit code   |
| cmd        | `echo sentinel`                     | stdout contains `sentinel`       |
| Native Git | `git --version`                     | non-empty version output         |
| Native Git | shallow local fixture clone         | target exists and commit matches |
| Both       | command in a path containing spaces | correct cwd and output           |
| Both       | timeout                             | complete process tree terminates |

Tests must compare `detached: false` behavior and must fail if expected output is empty despite exit code `0`.

## 17. Installation Modes and On-Disk Layout

### 17.1 Recommended layout

```text
~/.aifetchly/
├── skills/
│   ├── video-use/                 # managed copy, symlink, or junction
│   └── another-skill/
├── skill-sources/
│   └── <installation-id>/         # optional managed Git checkout
├── skill-state/
│   └── <installation-id>.json     # non-secret provenance/cache metadata
└── skill-runs/
    └── <run-id>/                  # temporary run artifacts
```

Database records remain the source of truth when persistence is implemented through existing Model and Module conventions. Sidecar state may be used only for loader bootstrapping or recovery and must not duplicate secrets.

### 17.2 Managed copy

Managed copy is the default because it:

- Works without symlink privileges.
- Is predictable across Windows, macOS, and Linux.
- Prevents upstream working-tree edits from immediately changing an active skill.
- Supports staged validation and atomic replacement.

Activation copies into a sibling temporary directory, verifies it, then renames it into place. Existing healthy versions remain available for rollback until activation succeeds.

### 17.3 Linked development mode

Linked mode is an advanced option intended for skill authors.

- POSIX uses a directory symbolic link.
- Windows should prefer a directory junction when normal symlink creation requires elevated privileges or Developer Mode.
- AiFetchly owns the link or junction, not its target.
- Uninstall removes only the link unless the source is explicitly marked app-managed.
- The UI must clearly warn that external edits can change active instructions without an AiFetchly update operation.
- Broken, recursive, or unsupported links produce diagnostics and are not loaded.

### 17.4 Canonicalization and deduplication

The loader must:

- Accept real directories, symbolic links, and supported Windows junctions.
- Resolve the real path of `SKILL.md`.
- Validate that the resolved target is a directory containing a regular `SKILL.md` or valid manifest.
- Deduplicate by canonical `SKILL.md` or manifest real path.
- Detect loops and cap traversal depth.
- Preserve the user-visible installation name separately from canonical identity.

### 17.5 Watch behavior

The global and workspace loaders must rescan when:

- A skill directory or link is added or removed.
- `SKILL.md` or `manifest.json` changes.
- A linked target changes.
- A link target becomes unavailable or available again.

Because watcher libraries vary in link behavior, correctness must not depend solely on recursive watcher defaults. Registry reload must support an explicit rescan, and periodic or event-triggered canonical hash checks should detect missed target changes.

## 18. Dependency Planning and Installation

### 18.1 Dependency categories

The plan classifies every requirement:

- System binary, such as ffmpeg.
- Managed application runtime.
- Language package environment.
- Repository helper.
- MCP server.
- Model or other large artifact.
- Credential or configuration value.

### 18.2 Detection before installation

For each dependency, AiFetchly must report:

- Required name and optional version range.
- Detection command or API.
- Current status and detected version.
- Installation method.
- Download size when known.
- Whether administrator privileges may be required.
- Whether the dependency is shared or skill-specific.
- Verification method.

### 18.3 System dependencies

System dependencies should use the existing dependency catalog and installer services. Repository prose may suggest an installation command, but it cannot directly become a privileged command.

For ffmpeg:

- Detect both `ffmpeg` and `ffprobe`.
- Capture versions through the platform shell provider.
- Prefer an application-managed binary when supported.
- If a system package manager is required, show the exact action and request approval.
- Do not modify global `PATH` silently.
- Store the resolved executable paths in typed skill configuration, not in the repository.

### 18.4 Repository setup commands

Repository-provided commands must be parsed into an approval plan. The user must see:

- Exact command.
- Working directory.
- Environment variable names, with values redacted.
- Expected writes.
- Network/package-manager use.
- Whether lifecycle scripts can execute.

Opaque command strings, encoded commands, command substitution, privilege escalation, or writes outside approved roots require stronger approval or must be denied by policy.

Approval is bound to the exact normalized command, working directory, non-secret environment names, source commit/content hash, and expected capability set. If any of these change before execution, AiFetchly must invalidate the approval and ask again. Exact unchanged approvals may be reused within the same installation session to avoid duplicate prompts.

## 19. Credential Collection and Secret Storage

### 19.1 Secure prompt

When a dependency or skill requires a secret, AiFetchly must pause the installation and render a secure credential input. The assistant should say what credential is needed and why, but the user must not paste it into the ordinary chat composer when a secure field is available.

### 19.2 Storage requirements

- Use Electron `safeStorage` through a production-enabled credential service.
- Windows uses DPAPI through Electron; macOS uses Keychain; Linux requires a supported secret service.
- If secure storage is unavailable, fail closed for persistent storage or offer session-only memory with a clear warning.
- Store credentials by stable skill/plugin identity and variable name.
- Never store secrets in installation-state JSON, database audit details, repository files, command history, or tool results.
- Never interpolate secret values into a command string.
- Inject secrets directly into the child-process environment only for the approved process.
- Redact known key shapes and all declared secret values from diagnostics.
- Support replace, test, and delete operations without revealing the stored value.

### 19.3 ElevenLabs example

For `ELEVENLABS_API_KEY`, installation should:

1. Complete source inspection and non-secret dependency preparation first.
2. Explain that the key enables ElevenLabs-backed functionality.
3. Request it through secure input.
4. Store it under the installed skill identity.
5. Validate it only with the minimum approved request, if validation is supported.
6. Show configured status, never the key.

The existing plaintext `PluginOptionsStore` is not acceptable for this credential.

## 20. Trust and Security Model

### 20.1 Trust stages

```text
unacquired
  → acquired-untrusted
  → inspected
  → user-approved
  → installed-disabled
  → active
  → quarantined or revoked
```

Acquired repository content is data, not authoritative application instruction. Only the bounded installation-planning prompt may interpret it before approval.

### 20.2 Prompt-injection resistance

Prompt injection is malicious text that tries to make the assistant ignore user or application rules.

The inspection context must state:

- Repository content is untrusted.
- It may propose steps but cannot authorize tools.
- It cannot request hidden system information.
- It cannot alter permission policy.
- It cannot cause unrelated user files to be read.
- It cannot redefine installation success.

The installer validates all model-produced plans against typed schemas and capability policy.

### 20.3 Path safety

- Reject absolute paths in repository declarations unless the schema explicitly permits a known system dependency path.
- Reject `..` traversal and paths that escape the canonical skill root.
- Revalidate paths after resolving symbolic links.
- Prevent archive traversal and link-based overwrite during extraction/copy.
- Refuse special files and link loops.
- Keep the staging root, activation target, backup target, and workspace explicit and non-overlapping.
- Never perform recursive deletion against unresolved variables, home, the workspace root, or the entire skills directory.

### 20.4 Network and supply-chain controls

- Record source URL and resolved commit.
- Prefer immutable commit or release identifiers for repeatable installs.
- Show when a branch head is mutable.
- Apply download and repository limits.
- Preserve checksums for copied content.
- Require new approval when an update adds dependencies, executable helpers, network capabilities, or permissions.
- Quarantine a skill when its source no longer matches its recorded identity unexpectedly.

### 20.5 Skill-directory protection

The normal file tools must not edit installed skills. Installation, update, repair, and uninstall occur through the installer service. This prevents an ordinary prompt or compromised workspace from modifying future assistant behavior.

## 21. Persistence and Architecture Boundaries

### 21.1 Data responsibilities

Recommended persisted concepts:

- `SkillInstallation`: identity, source, ref, commit, subpath, format, mode, canonical path, status, timestamps.
- `SkillInstallationSession`: requested intent, current state, approval checkpoints, retry count, sanitized failure.
- `SkillDependencyBinding`: dependency identity, resolved version/path, ownership, verification state.
- `SkillSecretBinding`: secret identifier and credential-store lookup key only; never secret value.
- Existing installed-skill and plugin records remain runtime registration authorities where applicable.

Final entity names may follow existing conventions, but database access must use:

```text
IPC handler
  → installation Module
  → installation Service orchestration
  → Models
  → SQLite/TypeORM
```

### 21.2 Process boundaries

The Electron main process owns:

- Permission and trust decisions.
- Installation state transitions.
- Registry mutation.
- Database operations through Modules and Models.
- Credential storage.
- Final activation and rollback.

A child or utility process may perform:

- Repository scanning.
- Hashing.
- Dependency detection.
- Long-running package setup.
- Non-privileged helper self-tests.

Workers must return typed messages and must never access the database, Electron `safeStorage`, or renderer objects directly.

### 21.3 IPC requirements

Renderer IPC payloads must be schema-validated and sanitized. Suggested operations:

- Start installation from natural-language-derived source and options.
- Get installation plan.
- Approve or reject plan items.
- Submit a secret through a dedicated secure channel.
- Resume, cancel, retry, or roll back.
- Get progress and diagnostics.
- Select copy or linked mode.

Handlers that invoke AI planning must check `USER_AI_ENABLED` before parsing or doing work. Pure installation status and cancellation handlers do not need the AI gate.

### 21.4 Existing component ownership map

The implementation should extend existing ownership boundaries rather than create duplicate runtimes:

| Existing component                            | Required responsibility in this feature                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceResolver`                           | Resolve the approved canonical workspace used by the shared filesystem scope                                                       |
| `ToolExecutor`                                | Supply conversation scope consistently to both file and shell execution                                                            |
| `FileToolService` and `FilePathGuard`         | Enforce workspace and read-only skill-resource capabilities                                                                        |
| `ShellToolService`                            | Consume conversation scope and delegate platform behavior to tested shell providers                                                |
| `PluginInstallService` and source fetchers    | Acquire and install repositories classified as plugins; share bounded acquisition primitives                                       |
| `SkillImportService`                          | Preserve existing executable and legacy documentation-only imports; expose or share validation needed by the new prompt-skill path |
| `AIFetchlyConfigLoader`                       | Discover global prompt skills from real directories, symlinks, and supported junctions                                             |
| `WorkspaceConfigScanner`                      | Apply equivalent prompt-skill parsing under trusted workspace configuration when workspace skills are enabled                      |
| `WorkspaceChokidarWatcher`                    | Emit changes for skill entries and support explicit rescans when linked targets are not followed reliably                          |
| `SkillRegistry` and prompt assembly           | Register bounded discovery metadata and load full prompt-skill content on invocation                                               |
| `SkillPermissionService`                      | Enforce requested tool narrowing and approved helper execution                                                                     |
| System dependency services                    | Detect, install, retry, and verify cataloged dependencies such as ffmpeg                                                           |
| `SecureStore` or successor credential service | Store skill secrets through OS-backed encryption after production cutover                                                          |
| Module and Model layers                       | Persist installation sessions, provenance, dependency bindings, and non-secret credential references                               |

The plaintext `PluginOptionsStore` must not be reused for secrets until it is backed by the approved credential service and migrated safely.

## 22. User Interface Requirements

### 22.1 Conversation experience

Installation progress appears as one stable card rather than dozens of raw tool messages. It shows:

- Source and resolved commit.
- Current state.
- Discovered skill type and name.
- Dependency checklist.
- Permission requests.
- Secure credential requests.
- Current operation and progress.
- Retryable errors.
- Final readiness result.

Low-level tool details remain available in an expandable diagnostic view.

### 22.2 Installation review

Before activation, the user sees:

- Publisher/source identity.
- Mutable branch warning when applicable.
- Skill format.
- Files and subdirectories relevant to execution.
- Requested tools and network access.
- Dependencies and estimated downloads.
- System changes.
- Secret names requested.
- Installation location and mode.
- Update behavior.

### 22.3 Skill management

Installed skill detail must show:

- Enabled state and health.
- Prompt or executable classification.
- Managed copy or linked mode.
- Source URL, ref, and commit.
- Canonical target for links.
- Dependencies and detected versions.
- Configured-secret names and status.
- Granted permissions.
- Last verification and update time.
- Update, repair, disable, uninstall, and reveal-source actions.

### 22.4 Internationalization and UI testing

Every user-facing string must be added to English, Chinese, Spanish, French, German, and Japanese language files. UI changes require matching Vitest component tests. The critical install, approval, secret, resume, and rollback flows require Playwright coverage.

## 23. Diagnostics and Observability

### 23.1 Structured failure codes

At minimum, support:

- `workspace-required`
- `workspace-resolution-failed`
- `source-invalid`
- `source-auth-required`
- `source-acquisition-failed`
- `source-limit-exceeded`
- `skill-not-found`
- `multiple-skills-found`
- `skill-format-invalid`
- `instruction-file-invalid`
- `plan-approval-required`
- `dependency-missing`
- `dependency-install-failed`
- `secret-required`
- `secure-storage-unavailable`
- `activation-conflict`
- `link-unsupported`
- `link-target-missing`
- `registry-reload-failed`
- `readiness-check-failed`
- `shell-output-missing`
- `rollback-failed`

Each error includes recoverability, user action, sanitized technical detail, and installation session ID.

### 23.2 Progress events

Progress events must be monotonic and scoped to a session. Suggested fields:

```typescript
interface SkillInstallationProgress {
  readonly sessionId: string;
  readonly state: string;
  readonly step: string;
  readonly completedUnits?: number;
  readonly totalUnits?: number;
  readonly messageKey: string;
  readonly recoverable: boolean;
}
```

### 23.3 Privacy

Never log:

- Secret values.
- Full authenticated URLs.
- Git credential-helper output.
- Full environment contents.
- Arbitrary repository file contents.
- User footage or attachment contents.

## 24. Update, Repair, Disable, and Uninstall

### 24.1 Update

- Reacquire into new staging.
- Resolve the new commit.
- Compare permissions, dependencies, executable files, and instruction hashes.
- Require approval for expanded capabilities.
- Activate atomically.
- Preserve credential bindings by stable skill identity unless the requested variable set changes.
- Retain the previous healthy installation until verification succeeds.

### 24.2 Repair

Repair rechecks:

- Source path or link target.
- Content hash.
- Registry registration.
- Dependencies.
- Credential presence, without reading values into UI.
- Helper executability.
- Platform compatibility.

Repair must not silently update to a newer commit.

### 24.3 Disable

Disable removes the skill from model discovery and invocation immediately but preserves files, provenance, dependencies, and secrets unless the user asks to remove them.

### 24.4 Uninstall

- Managed copy: remove only the exact installed skill directory after canonical target verification.
- Linked install: remove only the link or junction; never delete the external target.
- App-managed source checkout: remove it only when no other installed skill references it.
- Shared dependencies remain when referenced by other skills.
- Secrets are deleted or retained based on an explicit user choice, defaulting to delete when no other binding uses them.
- Database changes flow through Module and Model layers.
- Material removal must be reported to the user with recovery status.

## 25. Backward Compatibility and Migration

### 25.1 Existing executable skills

Existing manifest-based skills continue to load without behavioral changes.

### 25.2 Existing documentation-only imports

Existing generated documentation-only skills remain supported. The management UI may offer an explicit migration when the original installed package contains a valid `SKILL.md`:

```text
Keep legacy wrapper | Convert to prompt skill
```

Migration must preserve the original package backup until the prompt skill passes discovery checks.

During the compatibility period, an existing documentation-only tool name must delegate internally to `use_skill` using the installation's scoped runtime identity. The compatibility result may include a deprecation marker for diagnostics, but the model must receive the same hidden instruction context as a natively registered prompt skill. AiFetchly must not maintain two different instruction-delivery semantics indefinitely.

The adapter must preserve existing attachment routing and `run_skill_script` affordances until equivalent prompt-resource flows are verified. Executable sidecars remain permission-controlled operations and are not triggered by loading the prompt.

### 25.3 Existing local-extensibility skills

The loader expands from:

```text
directory + manifest.json only
```

to:

```text
directory/link/junction + manifest.json or SKILL.md
```

Native manifests retain precedence. Invalid new prompt-skill candidates produce diagnostics without preventing valid existing skills from loading.

### 25.4 Existing plugin compatibility

Claude plugin adapters continue owning plugin-contained `SKILL.md` behavior. Shared parsing and prompt-skill runtime components should be reused, but plugin provenance and component enablement remain intact.

## 26. Testing Strategy

### 26.1 Unit tests

- Natural-language installation intent classification.
- Installation plan schema validation.
- State transitions and invalid-transition rejection.
- URL normalization and provenance redaction.
- Repository layout classification.
- `SKILL.md` parsing and frontmatter validation.
- Capability narrowing from `allowed-tools`.
- Canonical path and symlink/junction validation.
- Link-loop and broken-target handling.
- Deduplication by real `SKILL.md` path.
- Copy activation and rollback.
- Workspace-scope resolution shared by shell and file tools.
- Platform environment construction.
- Secret binding without secret persistence.
- Retry cap and resume behavior.
- Universal `use_skill` resolution by scoped runtime identity.
- Catalog metadata excludes full `SKILL.md` bodies.
- Frontmatter stripping and deterministic base-directory header generation.
- Token-aware full, section-aware truncated, and resource-fallback instruction loading.
- Same-hash repeated invocation returns `already-loaded` without duplicate context.
- Changed linked-skill hash creates a new context revision.
- Embedded shell syntax and helper references do not execute during loading.

### 26.2 Main-process integration tests

- Git acquisition into staging.
- Installer routing to prompt skill, executable skill, or plugin service.
- Dependency detection and approval boundaries.
- Registry reload after copy and link activation.
- Workspace revocation during installation.
- Cancellation at every state.
- Rollback after partial activation.
- Existing-skill update with permission expansion.
- Secure-storage unavailable behavior.
- Tool acknowledgement precedes hidden skill context in the model message sequence.
- Hidden skill context is model-visible but absent from user-authored chat bubbles.
- Disabled or hash-invalid skills are rejected before instruction injection.
- Explicit invocation and automatic model invocation share one resolver.
- Legacy documentation-only tools delegate to the prompt invocation service.
- Invoked skill state remains scoped to its conversation or subagent.

### 26.3 Windows integration tests

Windows CI is a release gate. It must exercise real `powershell.exe`, available `pwsh`, cmd, Git, Unicode, paths with spaces, environment handling, output capture, timeout termination, junction creation, junction discovery, and junction uninstall safety.

### 26.4 Component tests

- Install-progress rendering.
- Plan approval and rejection.
- Copy/link selection.
- Secure-secret form does not echo or persist input.
- Recoverable failure and retry.
- Ready, disabled, linked-target-missing, and rollback states.
- All translated labels render through i18n keys.

### 26.5 End-to-end tests

Critical flows:

1. Install a fixture prompt skill from a local Git repository.
2. Pause for a fake API key, resume, and reach ready.
3. Install with a missing mock ffmpeg dependency and approve managed setup.
4. Cancel before activation and verify staging cleanup.
5. Fail after activation begins and verify rollback.
6. Install through a link/junction and uninstall without deleting the source.
7. Restart while awaiting a secret and resume.
8. Confirm “install and wait” does not invoke the skill.
9. Invoke an installed prompt skill and confirm its complete instructions influence the next model round.
10. Compact and recover the conversation, then confirm the invoked skill remains active exactly once.
11. Invoke a large prompt skill and confirm progressive resource reads replace raw character truncation.
12. Invoke a legacy documentation-only skill and confirm it follows the same hidden-context path.

### 26.6 Regression tests

- Existing plugin installs remain functional.
- Existing executable skills run unchanged.
- Workspace file-tool permissions do not broaden.
- Shell deny and ask policies remain enforced.
- Workers still cannot access the database.
- Renderer still cannot read arbitrary filesystem paths.
- Existing executable skills remain ordinary executable tools and are never converted into hidden prompt instructions.
- Skill content never appears in the initial catalog unless the skill has been invoked.
- Existing attachment workflows remain functional during legacy-wrapper migration.

## 27. Acceptance Scenario: `browser-use/video-use`

The release candidate must pass this scenario on Windows and at least one POSIX platform.

### 27.1 Input

```text
Set up https://github.com/browser-use/video-use for me.

Read install.md first to install this repo, wire up ffmpeg, register the skill
with whichever agent you're running under, and set up the ElevenLabs API key;
ask me to paste it when you need it. Then read SKILL.md for daily usage, and
always read helpers/ because that's where the editing scripts live. After
install, don't transcribe anything on your own; just tell me it's ready and
wait for me to drop footage into a folder.
```

### 27.2 Required behavior

1. AiFetchly recognizes skill installation intent without catalog-search detours.
2. It acquires one staging checkout and records the resolved commit.
3. It reads the requested installation instructions before planning commands.
4. It classifies the repository correctly as a prompt skill or compatible package based on its actual files.
5. It detects ffmpeg and ffprobe or offers a typed installation action.
6. It displays requested helper execution and network capabilities before activation.
7. It asks for the ElevenLabs key only when the installation can otherwise continue.
8. The key is submitted through secure input and never appears in chat history or tool logs.
9. It activates the skill under `~/.aifetchly/skills` using the selected mode.
10. Registry reload discovers the skill and preserves its canonical base directory.
11. The skill can later locate relevant files under `helpers/`.
12. Shell commands still run in the user's selected footage workspace, not the skill or home directory.
13. Readiness verification reports dependency versions, registration, and credential status.
14. AiFetchly does not transcribe, inspect footage, or run editing helpers after installation.
15. The assistant returns a concise ready message and waits.
16. Repeating the same request does not create duplicate checkouts or records.

### 27.3 Later daily-use invocation

After the installation-only turn has ended, a later request involving dropped footage must demonstrate the optimized prompt-skill runtime:

1. The initial model context contains video-use metadata, not the entire `SKILL.md`.
2. The model invokes video-use through `use_skill` before acting on skill-specific instructions.
3. AiFetchly resolves the exact installed runtime identity and verified content hash.
4. The tool returns a short loaded acknowledgement.
5. AiFetchly injects a hidden instruction message containing the normalized `SKILL.md`, base directory, and approved workspace.
6. Relevant helper files are listed or read progressively according to the skill instructions; the entire helper tree is not injected.
7. Helper execution remains separately permission controlled.
8. A repeated invocation in the same context does not duplicate the instructions.
9. After compaction, the invoked skill remains active once with the same effective hash.

## 28. Success Metrics

### 28.1 Reliability

- At least 95% of valid public prompt-skill fixture repositories reach either `ready` or one actionable user decision without manual path correction.
- 100% of expected-output Windows shell fixtures capture non-empty output.
- Zero shell/file workspace-root mismatches in automated tests and production diagnostics.
- Zero duplicate active installation records for identical installation identities.
- 100% of failed activations either roll back or surface `rollback-failed` with preserved recovery data.
- 100% of successful prompt-skill invocations deliver a tool acknowledgement followed by one effective hidden instruction block.
- 100% of compaction/recovery fixtures restore active invoked skills without duplication or source confusion.

### 28.2 User experience

- Median public prompt-skill install requires no more than one plan approval plus required credential prompts.
- The conversation shows one installation card instead of repeated clone/list/read attempts.
- Users can identify source, commit, mode, permissions, dependencies, and secret status from skill details.
- Uninvoked skills consume only bounded catalog metadata, keeping ordinary conversations responsive as the installed catalog grows.

### 28.3 Security

- Zero secret values persisted in chat messages, installation audit detail, sidecar metadata, or command arguments.
- Zero uninstall operations deleting linked source directories.
- Zero unapproved writes outside app staging, the exact activation target, temporary run root, or approved workspace.
- Permission-expanding updates always require renewed approval.
- Zero skill-load operations execute embedded commands, helper scripts, hooks, or network calls.

## 29. Rollout Plan

### Phase 0: Diagnostics and fixtures

- Add Windows shell diagnostic matrix and fixture repositories.
- Record current shell/file workspace mismatch through failing tests.
- Build the `video-use` compatibility fixture or pin a reviewed upstream commit for testing.

Exit criteria: failures reproduce deterministically.

### Phase 1: Unified filesystem scope

- Introduce the shared conversation filesystem scope.
- Move shell cwd and permission guards onto `WorkspaceResolver` output.
- Remove silent global-root fallback for conversation tools.
- Add capability-aware skill-root reads.

Exit criteria: shell and file tools resolve identical workspace roots in every platform test.

### Phase 2: Windows shell provider

- Add platform providers.
- Correct environment handling, detached behavior, encoding, and output diagnostics.
- Make Windows CI a required gate.

Exit criteria: the full Windows verification matrix passes repeatedly.

### Phase 3: Prompt-skill runtime

- Add `SKILL.md` discovery alongside native manifests.
- Add the universal `use_skill` tool and bounded metadata catalog.
- Inject invoked instructions through hidden model context rather than long JSON tool results.
- Add token-aware instruction loading and progressive resource reads.
- Persist invoked-skill state across compaction and recovery.
- Preserve skill root and directory variables.
- Support directory, symlink, and junction candidates.
- Add real-path deduplication and watcher/rescan behavior.

Exit criteria: copied and linked fixtures are discoverable; invocation injects one verified hidden instruction block; large skills use progressive resource reads; compaction restores active skills exactly once.

### Phase 4: Deterministic installer

- Add installation sessions, source acquisition, inspection, plan approval, atomic activation, verification, and rollback.
- Reuse existing plugin and executable skill import paths.
- Default to managed copy and expose linked development mode.

Exit criteria: supported fixture repositories install without model-generated clone commands.

### Phase 5: Dependencies and credentials

- Integrate system dependency catalog and verification.
- Complete OS-backed secure credential storage.
- Add resumable secure-input flow.

Exit criteria: ffmpeg and mock ElevenLabs scenarios pass without secret leakage.

### Phase 6: Product UI and gradual availability

- Add installation and management UI with all translations and tests.
- Ship behind a feature flag.
- Enable for internal users, then opt-in beta, then general availability.
- Keep a kill switch that disables new installs without disabling already trusted skills.

Exit criteria: success, failure, security, and rollback metrics meet thresholds.

## 30. Risks and Mitigations

| Risk                                               | Impact                                 | Mitigation                                                                               |
| -------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Repository instructions manipulate the model       | Unapproved commands or data access     | Treat acquisition as untrusted data; validate typed plans; preserve tool approvals       |
| Linked skill changes outside AiFetchly             | Active behavior changes unexpectedly   | Advanced-mode warning, content hashes, change notification, rapid disable                |
| Windows link privileges differ                     | Installation fails for ordinary users  | Managed copy default; directory junction fallback; explicit capability detection         |
| Broad skill-root shell access leaks sibling skills | Cross-skill data exposure              | Per-skill read/execute capability, canonical target validation, no parent-root grant     |
| Secret storage is unavailable                      | Credentials stored insecurely          | Fail closed for persistent storage; explicit session-only option when acceptable         |
| Package managers run lifecycle scripts             | Arbitrary code execution               | Exact command review, stronger approval, controlled process, typed dependency installers |
| Mutable Git branch changes                         | Unreviewed update                      | Record commit SHA; never auto-activate permission-expanding updates                      |
| Watcher misses linked-target changes               | Stale or unsafe registration           | Explicit rescan plus canonical content-hash verification                                 |
| Rollback deletes the wrong path                    | User data loss                         | Resolve exact targets, ownership metadata, no recursive deletion of unresolved paths     |
| Large repositories exhaust resources               | App instability                        | File, byte, depth, timeout, and concurrency limits before activation                     |
| Every installed skill body is injected eagerly     | High token cost and degraded routing   | Bounded metadata catalog plus lazy universal invocation                                  |
| Skill guidance remains ordinary tool JSON          | Weak instruction adherence             | Short acknowledgement followed by hidden normalized context                              |
| Compaction drops invoked skill instructions        | Behavior changes midway through a task | Persist runtime identity, hash, revision, and restorable normalized instructions         |
| Linked skill changes after invocation              | Unreviewed instructions enter context  | Hash revisions, change notification, and explicit reload policy                          |

## 31. Open Decisions With Recommendations

### 31.1 Default activation mode

**Recommendation:** managed copy. It works on every supported platform and creates a stable reviewed snapshot. Linked mode remains opt-in for development.

### 31.2 Source checkout layout

**Recommendation:** start with direct managed copies under `skills/`. Add `skill-sources/` shared Git checkouts only when update and multi-skill repository requirements justify the extra ownership complexity.

### 31.3 Prompt-skill persistence

**Recommendation:** persist installation provenance and state in SQLite while loading `SKILL.md` content from the active skill root with hash validation. Do not duplicate full repository contents in the database.

### 31.4 Compatibility variable

**Recommendation:** support both `${AIFETCHLY_SKILL_DIR}` and `${CLAUDE_SKILL_DIR}`. Document the AiFetchly name as preferred while making common Claude skills work unchanged.

### 31.5 Automatic dependency installation

**Recommendation:** allow automatic installation only through trusted typed dependency providers. Repository-provided commands always require review and must not be silently promoted into trusted providers.

### 31.6 Secure storage fallback

**Recommendation:** fail closed for persistent credentials when OS-backed encryption is unavailable. A session-only secret may be offered when the skill can operate without persistence and the user accepts the limitation.

### 31.7 Prompt-skill context role

**Recommendation:** use a backend-supported developer/application-context role after the required tool result. When unavailable, use an internal meta-user message whose origin is preserved and hidden from the visible transcript. Never mislabel repository-authored instructions as trusted system policy.

### 31.8 Prompt-skill loading strategy

**Recommendation:** expose bounded metadata eagerly and load instructions lazily through one `use_skill` tool. Do not register every prompt skill as an independent documentation tool, and do not inject all installed skill bodies at conversation start.

### 31.9 Compaction persistence

**Recommendation:** preserve the normalized effective instruction block plus runtime identity, source, content hash, and context revision. A verified stored block provides deterministic continuation when a linked source changes or disappears during a long conversation.

## 32. Definition of Done

This feature is complete only when:

- Natural-language install intent routes to one deterministic installation workflow.
- Shell and file tools share the approved conversation workspace.
- Missing workspace never silently becomes the user home directory.
- Windows PowerShell, cmd, and Git output tests pass on a real Windows runner.
- Both prompt and executable skill formats are supported without semantic conversion.
- Prompt skills are advertised through one universal invocation tool using metadata-only discovery.
- Successful invocation produces a short tool acknowledgement followed by one hidden, verified instruction block.
- Prompt instructions include a canonical base directory and safe compatibility variables.
- Repeated same-version invocation does not duplicate context.
- Token-aware loading and progressive resource reads replace the fixed 8,000-character guidance cap.
- Invoked prompt skills survive compaction and conversation recovery with their identity and content hash intact.
- Loading a prompt skill performs no command, helper, hook, or network execution.
- Legacy documentation-only tools delegate to the same prompt invocation path during migration.
- Managed copy works on all supported platforms.
- POSIX symlink and Windows junction installation, discovery, change detection, and uninstall safety are tested.
- Installation is atomic, resumable, repeatable, cancellable, and reversible.
- Dependencies are detected, approved, installed, and verified through typed providers.
- Secrets use OS-backed storage and never appear in chat or logs.
- Permission-expanding updates require approval.
- The `browser-use/video-use` acceptance scenario passes without manual path repair.
- Installation ends without executing the newly installed skill when the user requested “install and wait”.
- All main-process, component, Windows, and end-to-end tests pass.
- All new user-facing text exists in all six supported languages.
- Operational documentation explains install, update, repair, linked mode, troubleshooting, and secure credential behavior.
