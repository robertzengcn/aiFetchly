# Natural-Language Skill Installation and Portable Skill Runtime Technical Design

## Document Information

| Field               | Value                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Status              | Proposed                                                                                                           |
| Audience            | Electron, AI runtime, platform, security, and QA engineers                                                         |
| Product requirement | [Natural-Language Skill Installation and Portable Skill Runtime PRD](./natural-language-skill-installation-prd.md) |
| Platforms           | Windows, macOS, Linux                                                                                              |
| Last updated        | 2026-08-23                                                                                                         |

## 1. Purpose

This document defines the architecture for installing and using skills from
natural-language requests. It addresses four coupled problems:

1. Shell and file tools currently resolve different filesystem scopes.
2. Windows shell commands can report success while returning no output.
3. AiFetchly's executable-skill manifest is not the portable `SKILL.md`
   prompt-skill format used by other agents.
4. Installation is currently an emergent sequence of generic tool calls rather
   than a durable, typed, resumable workflow.

The core decision is to introduce an installation control plane. The model
expresses intent and selects bounded options; typed services acquire, inspect,
plan, approve, mutate, verify, activate, and persist. Generic shell and file
tools remain available for ordinary work but do not coordinate installation.

## 2. Scope

### 2.1 In scope

- One conversation filesystem context shared by every path-bearing tool.
- Testable Windows and POSIX process providers.
- Git and GitHub archive acquisition.
- Discovery of `SKILL.md`, legacy `manifest.json`, and plugins.
- Managed-copy and linked activation under `~/.aifetchly/skills`.
- Prompt-skill registration without executable wrapper conversion.
- Existing executable-skill compatibility.
- Dependency, credential, verification, update, repair, disable, and uninstall
  workflows.
- Durable sessions, audit events, restart recovery, and rollback.
- Windows symbolic-link and junction support.

### 2.2 Out of scope

- Treating arbitrary repository prose as trusted shell code.
- Automatically running transcription or daily-use actions after installation.
- A remote public marketplace.
- Container-grade isolation for arbitrary native programs.
- Cross-device synchronization.
- Replacement of the existing plugin system.

### 2.3 PRD traceability

| Requirement | Technical design coverage                                                   |
| ----------- | --------------------------------------------------------------------------- |
| FR-01       | Section 8 typed model-facing installation tools                             |
| FR-02       | Sections 5.3, 8.4, and 14 session identity, state, lease, and persistence   |
| FR-03       | Section 9 app-owned acquisition and immutable provenance                    |
| FR-04       | Section 9.3 instruction precedence and hashes                               |
| FR-05       | Sections 5.2 and 9.3 deterministic classification/discovery                 |
| FR-06       | Section 8.3 immutable reviewable plan                                       |
| FR-07       | Sections 10 and 11.4 separate prompt catalog and legacy routing             |
| FR-08       | Section 10 first-class prompt runtime                                       |
| FR-09       | Sections 10.2 and 11 stable base directory and compatibility variables      |
| FR-10       | Section 11.2 cross-platform managed copy                                    |
| FR-11       | Sections 10.4 and 11.3 symlink/junction lifecycle                           |
| FR-12       | Section 6 shared conversation context                                       |
| FR-13       | Sections 6.3 and 10.3 resource capabilities and separate execution approval |
| FR-14       | Section 12 typed dependencies and multi-probe verification                  |
| FR-15       | Sections 5.3, 8.4, 13, and 15 pause/resume and recovery                     |
| FR-16       | Section 13 fail-closed storage and per-process injection                    |
| FR-17       | Section 18 readiness verification levels                                    |
| FR-18       | Sections 2.2 and 18.1 explicit ready-and-stop contract                      |
| FR-19       | Sections 8.2, 8.4, 11, and 16 lifecycle and rollback                        |
| FR-20       | Section 19 structured errors, progress, and metrics                         |
| FR-21       | Sections 10.3 and 10.4 universal invocation and bounded catalog             |
| FR-22       | Sections 10.5 and 10.6 hidden normalized context delivery                   |
| FR-23       | Section 10.10 invoked-skill persistence, compaction, and recovery           |
| FR-24       | Sections 10.7 and 10.8 token budgets and progressive resource loading       |
| FR-25       | Sections 10.11 and 17 legacy documentation-tool compatibility               |
| NFR-01      | Sections 5.3 and 8 state revisions, idempotency, and leases                 |
| NFR-02      | Section 7 required cross-platform output contract and Windows matrix        |
| NFR-03      | Section 13 secret isolation and redaction                                   |
| NFR-04      | Section 9.2 bounded acquisition and inspection                              |
| NFR-05      | Sections 6.3, 11, and 16 canonical path and ownership safety                |
| NFR-06      | Sections 10 and 11.4 backward-compatible runtime split                      |
| NFR-07      | Sections 8.2 and 15 AI-gated thin IPC handlers                              |
| NFR-08      | Sections 20.3 and 21.4 six-language UI and component tests                  |
| NFR-09      | Sections 10.3 and 10.7 metadata-only discovery and aggregate token budgets  |
| NFR-10      | Sections 10.12 and 16 load-time no-side-effect security rules               |

## 3. Current-State Findings

### 3.1 Filesystem scope split

`ToolExecutor` resolves file tools through `WorkspaceResolver` and constructs a
workspace-scoped `FileToolService`. `ShellToolService` independently calls
`getDefaultWorkspaceRoots()` and chooses its own current directory. A repository
can therefore be cloned successfully outside the roots that `file_read` and
`glob_files` may inspect.

This explains the observed loop: Git reported success in `C:\Users\zengj`, file
tools searched another workspace, absolute reads were correctly denied, and the
model repeatedly cloned or tried different shell readers. A better prompt cannot
fix two services observing different worlds.

### 3.2 Windows process output is unverified

The shell currently uses piped streams, UTF-8 decoding, `detached: true`, a
reduced environment allowlist, and PowerShell in automatic mode. Existing
Windows tests skip execution. Empty output affects `dir`, `type`, `Get-Content`,
`Test-Path`, and Git while exit codes still report zero.

Evidence does not prove a single cause. Environment stripping, interpreter
selection, detached behavior, encoding, and propagation must be isolated by a
diagnostic matrix before locking in a fix.

### 3.3 Prompt and executable skills are conflated

The current `SkillManifest` requires a runtime and entry. A `SKILL.md`-only ZIP
becomes a documentation-only JavaScript wrapper. This preserves compatibility
but does not model a portable prompt skill with instructions, helpers,
references, templates, and a stable base directory.

Global and workspace scanners require `manifest.json` and accept only directory
entries, so symbolic links and junctions can be skipped before target inspection.

### 3.4 Current prompt-skill context delivery

AiFetchly currently advertises every registered documentation skill as a normal
client tool containing name, description, and parameters. When the model calls
that tool, the execute handler reads `SKILL.md`, truncates it to 8,000
characters, embeds it in a JSON `skillGuidance` field, and appends the serialized
result as a `role: "tool"` message for the next completion.

This is lazy loading, but it is not a first-class prompt-skill contract:

- each prompt skill consumes a separate tool definition;
- instruction text is shaped as tool data rather than hidden behavioral context;
- raw character truncation can cut required sections or examples;
- no canonical base-directory header is guaranteed;
- no prompt-skill-specific invoked state is restored after full conversation
  compaction;
- legacy wrapper behavior and native prompt-skill behavior can diverge.

The optimized runtime keeps lazy loading but replaces per-skill documentation
tools with a universal invocation tool, normalized hidden context, token-aware
loading, and explicit recovery state.

### 3.5 Identity and persistence are too narrow

The registry and `InstalledSkillEntity` use globally unique names. Auto-discovered
sources unregister and re-register names with best-effort database writes. This
cannot safely represent same-named built-in, user, workspace, plugin, copied, and
linked skills. Installation identity, source identity, runtime identity, and
display name must be distinct.

`DB_MIGRATIONS` is also empty. The repository requires a baseline migration
before packaged builds can safely accept incremental migrations. New persistence
must not ship as an isolated migration before that baseline.

## 4. Architecture Overview

```text
Natural-language request
        |
        v
AI intent and typed install tools
        |
        v
SkillInstallationModule <------ Review / approval / secure-secret UI
        |
        +-- ConversationFilesystemContextService
        +-- SkillSourceAcquisitionService
        +-- SkillPackageInspectionService
        +-- SkillInstallPlanner
        +-- SkillDependencyOrchestrator
        +-- SkillCredentialService
        +-- SkillActivationService
        +-- SkillInstallationVerifier
        |
        v
Model layer / SQLite state and audit

Long-running native work:
Main process -> typed protocol -> utility process -> progress/result
                                     |
                                     +-- PlatformProcessProvider

Daily runtime:
PromptSkillCatalog -> prompt assembly -> skill_resource_* tools
Executable SkillRegistry -> existing SkillExecutor
```

The main process owns policy, approval, persistence, secret access, and registry
mutation. Utility processes perform acquisition, hashing, and native dependency
commands. The renderer sends validated IPC and renders progress. Utility
processes never access SQLite.

## 5. Core Domain Model

### 5.1 Identity

```typescript
export type SkillInstallationId = string;
export type SkillInstallationSessionId = string;
export type SkillRuntimeId = string;
export type SkillSourceId = string;

export type PortableSkillKind =
  | "prompt"
  | "executable"
  | "plugin"
  | "ambiguous";

export type SkillActivationMode =
  | "managed-copy"
  | "symbolic-link"
  | "junction"
  | "legacy-installed";

export type SkillScope = "user" | "workspace";
```

Identifiers are opaque UUIDs except runtime IDs, which include scope and
installation identity. A bare skill name is never an ownership key.

Recommended runtime IDs:

```text
prompt:user:<installation-uuid>
prompt:workspace:<workspace-id>:<installation-uuid>
executable:user:<installation-uuid>
plugin:<plugin-name>:<component-path>
```

### 5.2 Classification

Classification is deterministic:

1. Supported plugin descriptor: `plugin`.
2. Valid existing executable `manifest.json`: `executable`.
3. `SKILL.md` without executable manifest: `prompt`.
4. Conflicting or incomplete signals: `ambiguous`, requiring a user choice or
   supported compatibility adapter.

### 5.3 Session state

```typescript
export type SkillInstallationState =
  | "requested"
  | "acquiring"
  | "inspecting"
  | "planning"
  | "awaiting_approval"
  | "installing_dependencies"
  | "awaiting_secret"
  | "activating"
  | "verifying"
  | "ready"
  | "failed"
  | "cancelled"
  | "rollback_required";
```

Only `SkillInstallationModule` changes state. Updates use compare-and-set against
state and revision so duplicate model calls, renderer retries, and late worker
messages cannot repeat mutations.

### 5.4 Source and idempotency

```typescript
export interface SkillSourceDescriptor {
  readonly kind: "github" | "git" | "local-directory" | "local-archive";
  readonly canonicalUri: string;
  readonly requestedRevision?: string;
  readonly subdirectory?: string;
}

export interface ResolvedSkillSource {
  readonly sourceId: SkillSourceId;
  readonly canonicalUri: string;
  readonly resolvedRevision: string;
  readonly acquiredRoot: string;
  readonly contentHash: string;
  readonly acquisitionMethod: "git" | "github-archive" | "local-copy";
}
```

Canonical URIs exclude credentials and normalize GitHub `.git`, trailing slash,
host casing, and subdirectories. The idempotency key covers canonical URI,
resolved revision, subdirectory, scope, workspace, and activation mode.

## 6. Unified Conversation Filesystem Context

### 6.1 Context

Add `ConversationFilesystemContextService`, which resolves the active workspace
once per tool-execution batch:

```typescript
export type FilesystemCapability =
  | "read"
  | "write"
  | "execute"
  | "watch"
  | "activate";

export interface FilesystemRootCapability {
  readonly id: string;
  readonly kind:
    | "workspace"
    | "skill-source"
    | "skill-activation"
    | "install-staging";
  readonly canonicalPath: string;
  readonly capabilities: ReadonlySet<FilesystemCapability>;
}

export interface ConversationFilesystemContext {
  readonly conversationId: string;
  readonly workspaceId: number;
  readonly defaultCwd: string;
  readonly roots: readonly FilesystemRootCapability[];
  readonly revision: string;
}
```

The initial context has only the approved workspace. An installation session may
receive narrow staging, source, and activation roots. Installing a skill never
adds the whole home directory or repository parent.

### 6.2 Resolution contract

`WorkspaceResolver` remains workspace authority. The new service wraps it and
does not silently fall back when a conversation has no approved workspace. A
missing workspace is `WORKSPACE_NOT_APPROVED`, not permission to use home.
Legacy non-chat callers may request an explicitly named legacy context.

`ToolExecutor` resolves once and injects the same object:

```typescript
fileToolService.execute(args, filesystemContext);
shellToolService.execute(args, filesystemContext);
```

`ShellToolService` stops resolving roots independently. Missing `cwd` means
`filesystemContext.defaultCwd`; an explicit `cwd` requires `execute` capability.

### 6.3 Capability-aware path policy

Replace equal-permission root arrays with operation checks:

```typescript
pathPolicy.assertAllowed({
  path: requestedPath,
  operation: "write",
  context: filesystemContext,
});
```

The policy must:

1. Normalize Windows drives and separators.
2. Realpath existing paths.
3. Resolve the closest existing ancestor for new paths, then append unresolved
   segments.
4. Reject symlink or junction escape.
5. Use platform-appropriate case comparison.
6. Reject device paths, alternate data streams, and reserved Windows names.
7. Audit root id and capability without sensitive file contents.

Workers receive a serialized capability projection, not `WorkspaceResolver`, a
database path, or unrestricted home access.

## 7. Cross-Platform Process Execution

### 7.1 Provider contract

Create `src/service/process/`:

```typescript
export interface ProcessInvocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  readonly cancellationId?: string;
}

export interface ProcessExecutionResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly durationMs: number;
  readonly provider: "windows" | "posix";
  readonly diagnosticCode?: string;
}

export interface PlatformProcessProvider {
  execute(invocation: ProcessInvocation): Promise<ProcessExecutionResult>;
}
```

Interpreter resolution converts a shell request to executable and arguments.
The provider owns spawn, environment, capture, cancellation, and termination.

### 7.2 Windows rules

Automatic interpreter order:

1. verified `pwsh.exe`;
2. `powershell.exe`;
3. `cmd.exe` only when explicitly requested or safely required.

PowerShell uses explicit `-NoLogo -NoProfile -NonInteractive -Command`
arguments. Do not wrap opaque PowerShell inside another shell. Use
`detached: false` on Windows unless tests prove a specific tree requirement;
use a documented Windows process-tree cancellation mechanism instead of POSIX
groups.

Start from the application environment and scrub secrets instead of using a
Unix-only allowlist. Preserve at least `PATH`, `PATHEXT`, `SystemRoot`, `WINDIR`,
`ComSpec`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`,
`TEMP`, and `TMP`.

### 7.3 Output capture

Collect raw buffers and byte counts before decoding. Detect UTF-8 and UTF-16LE
BOMs and use a deterministic active-code-page fallback when available. Preserve
stdout and stderr independently. A wrapper must never turn non-empty bytes into
an empty tool result.

When a command expected to emit output exits zero with both byte counts zero,
return `PROCESS_OUTPUT_EMPTY_UNEXPECTED`; do not fabricate content or treat the
command as verification.

### 7.4 Required Windows diagnostic matrix

| Interpreter | Command                                        | Assertion                       |
| ----------- | ---------------------------------------------- | ------------------------------- |
| PowerShell  | `Write-Output`, `Get-ChildItem`, `Get-Content` | non-empty stdout                |
| cmd         | `echo`, `dir`, `type`                          | non-empty stdout                |
| direct      | `git --version`, `ffmpeg -version`             | expected stream non-empty       |
| mixed       | stdout plus stderr                             | streams independently preserved |
| Unicode     | CJK and emoji fixture                          | exact round trip                |
| large       | output over limit                              | explicit truncation metadata    |
| timeout     | long-running child                             | tree terminated, timeout true   |

Run cases under current and proposed settings to isolate environment, detached
mode, encoding, or propagation. Production changes require regression coverage
for the confirmed cause. Windows tests may not be skipped.

## 8. Installation Orchestrator

### 8.1 Model-facing tools

Expose a small typed surface:

```text
skill_install_prepare
skill_install_approve
skill_install_submit_secret
skill_install_status
skill_install_cancel
skill_install_repair
skill_install_update
```

`prepare` may acquire and inspect but stops before approval-required mutations.
`approve` accepts a session id and plan revision, not arbitrary commands. The
server reloads the persisted typed plan and executes validated operations.

### 8.2 Module API

`SkillInstallationModule` extends `BaseModule`. IPC and tool adapters call it;
they never use repositories directly.

```typescript
export interface SkillInstallationModuleApi {
  prepare(request: PrepareSkillInstallationRequest): Promise<InstallSnapshot>;
  approve(request: ApproveSkillInstallationRequest): Promise<InstallSnapshot>;
  submitSecret(request: SubmitSkillSecretRequest): Promise<InstallSnapshot>;
  getStatus(sessionId: string): Promise<InstallSnapshot>;
  cancel(sessionId: string): Promise<InstallSnapshot>;
  repair(installationId: string): Promise<InstallSnapshot>;
  update(installationId: string): Promise<InstallSnapshot>;
  disable(installationId: string): Promise<void>;
  uninstall(installationId: string): Promise<UninstallResult>;
}
```

AI-serving IPC handlers check `Token` and `USER_AI_ENABLED` before parsing input
or performing work.

### 8.3 Immutable plan

```typescript
export interface SkillInstallPlan {
  readonly planVersion: 1;
  readonly planRevision: string;
  readonly sessionId: SkillInstallationSessionId;
  readonly source: ResolvedSkillSource;
  readonly discoveredSkills: readonly DiscoveredSkillPackage[];
  readonly selectedSkillIds: readonly string[];
  readonly activation: ActivationPlan;
  readonly dependencies: readonly DependencyPlanItem[];
  readonly credentials: readonly CredentialRequirement[];
  readonly commands: readonly ApprovedCommandTemplate[];
  readonly permissions: readonly RequestedSkillPermission[];
  readonly warnings: readonly InstallWarning[];
  readonly verification: readonly VerificationProbe[];
}
```

Any change creates a new revision and invalidates prior approval. Plans contain
structured executable/argument templates rather than one concatenated script.
Instruction hashes are part of the revision.

### 8.4 Lease, concurrency, and rollback

One mutating session may lease an installation identity. The session stores
revision, state, lease owner, and expiry. Workers renew through typed messages.
After restart, only idempotent checkpoints may resume.

Allow two global preparations, one mutation per installation identity, and one
operation per package manager. Before activation, writes remain in staging.
Activation uses a temporary sibling and atomic rename where supported; an old
activation is retained until verification passes.

Rollback removes the incomplete activation, restores prior activation and
registry snapshot, reverts metadata, deletes session-only secrets, and retains
shared system dependencies. Failure becomes `rollback_required` and never
reports ready.

## 9. Acquisition and Inspection

### 9.1 Layout

```text
<userData>/skill-installation/sessions/<session-id>/
  source/
  extraction/
  plan.json
  logs/

<userData>/skill-sources/<source-id>/<resolved-revision>/
```

Never clone into home just because it is a shell default.

### 9.2 Acquisition

For GitHub, prefer verified Git with explicit destination and immutable revision.
If Git is unavailable, use an HTTPS archive with redirect, host, timeout, and
size limits. Generic Git URLs require Git initially. Local sources require an
explicitly authorized path.

Never embed credentials in URLs or command text. Extraction rejects absolute
paths, traversal, escaping link targets, excessive files, depth, or expanded
size.

Initial limits:

- acquisition: 60 seconds before explicit continuation;
- archive: 50 MiB compressed, 250 MiB expanded;
- files: 5,000; traversal depth: 20;
- `SKILL.md`: 256 KiB;
- aggregate instructions: 512 KiB;
- manifest: 64 KiB.

### 9.3 Discovery and instruction precedence

Walk without following links by default. Inspect a link only when its canonical
target stays in the acquired root. Candidate roots contain `SKILL.md`, a valid
legacy manifest, or plugin descriptor. Explicit URL subdirectory wins, then a
root package; otherwise show multiple candidates instead of guessing.

Read in this order:

1. applicable repository security/agent guidance;
2. explicitly requested installation document;
3. recognized `install.md` variants;
4. `SKILL.md` for runtime contract;
5. helper inventory and directly referenced files needed for planning.

Repository prose is untrusted. It may propose operations but cannot grant roots,
permissions, commands, secrets, or waive approvals.

```typescript
export interface DiscoveredSkillPackage {
  readonly candidateId: string;
  readonly rootRelativePath: string;
  readonly kind: PortableSkillKind;
  readonly name: string;
  readonly description: string;
  readonly skillMarkdownPath?: string;
  readonly legacyManifestPath?: string;
  readonly helperSummary: readonly SkillResourceSummary[];
  readonly compatibilityWarnings: readonly InstallWarning[];
}
```

## 10. Prompt-Skill Runtime

### 10.1 Separate catalog

Add `PromptSkillCatalog`; do not force prompt skills through executable
`SkillRegistry`.

```typescript
export interface PromptSkillDefinition {
  readonly runtimeId: SkillRuntimeId;
  readonly installationId: SkillInstallationId;
  readonly sourceId: string;
  readonly scope: SkillScope;
  readonly name: string;
  readonly description: string;
  readonly canonicalRoot: string;
  readonly skillMarkdownPath: string;
  readonly contentHash: string;
  readonly enabled: boolean;
}

export interface PromptSkillCatalogApi {
  replaceSource(
    sourceId: string,
    skills: readonly PromptSkillDefinition[]
  ): readonly SkillCatalogDiagnostic[];
  resolve(
    name: string,
    context: PromptSkillResolutionContext
  ): PromptSkillDefinition | null;
  list(context: PromptSkillResolutionContext): readonly PromptSkillDefinition[];
}
```

Precedence is workspace, user, plugin, built-in. Collisions are diagnostics and
never delete another source's database row or files.

### 10.2 Portable manifest and invocation

Allow optional YAML front matter for name and description, with conservative
derivation from directory and first heading:

```typescript
export interface PromptSkillManifest {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly description: string;
  readonly allowedTools?: readonly string[];
  readonly declaredCredentials?: readonly string[];
  readonly resourceDirectories?: readonly string[];
}
```

Unknown fields cannot expand capability. Prompt assembly includes identity,
canonical base directory, bounded `SKILL.md`, user request, and product policy.
Support `${CLAUDE_SKILL_DIR}` as a compatibility alias and
`${AIFETCHLY_SKILL_DIR}` as native. Resolve them through resource capabilities,
not blind substitution into shell text.

### 10.3 Metadata-only discovery catalog

`PromptSkillCatalog` produces a bounded model-facing view; it never returns
instruction bodies during ordinary discovery:

```typescript
export interface AvailablePromptSkill {
  readonly runtimeId: SkillRuntimeId;
  readonly name: string;
  readonly description: string;
  readonly sourceLabel?: string;
  readonly argumentHint?: string;
  readonly userInvocable: boolean;
  readonly modelInvocable: boolean;
}
```

`PromptSkillCatalogPresenter` applies a total catalog token budget. When every
description fits, it renders name, description, and disambiguating source. When
the catalog exceeds budget, it shortens descriptions deterministically and may
group undisplayed skills behind the existing deferred-tool search mechanism.
It never solves this pressure by injecting `SKILL.md` bodies eagerly.

The catalog is attached as an application-authored context section such as:

```text
Available prompt skills (invoke with use_skill):
- prompt:user:… — video-use: Edit and produce videos using repository helpers.
- prompt:workspace:42:… — release-check: Validate this workspace before release.
```

### 10.4 Universal `use_skill` tool

Register one always-discoverable built-in tool instead of one documentation tool
per prompt skill:

```typescript
export interface UsePromptSkillInput {
  readonly skill: string;
  readonly arguments?: string;
  readonly invocationReason?: string;
}

export interface UsePromptSkillResult {
  readonly status: "loaded" | "already-loaded";
  readonly runtimeId: SkillRuntimeId;
  readonly name: string;
  readonly contentHash: string;
  readonly contextRevision: number;
}
```

`skill` accepts a runtime ID or an unambiguous visible name. The service resolves
names against the current conversation workspace, source precedence, enablement,
and invocation policy. Ambiguity returns candidates and performs no injection.
The optional reason is diagnostic metadata, not authority.

Explicit `/skill-name` actions and automatic model tool calls enter the same
`PromptSkillInvocationService`. Frontmatter `disable-model-invocation` blocks
automatic selection but not an allowed explicit request. `user-invocable`
controls UI/slash-command visibility without expanding model authority.

### 10.5 Model-message sequencing

The message sequence must remain valid for tool-calling APIs while separating
acknowledgement from instructions:

```text
assistant  tool_call: use_skill({ skill: "prompt:user:…" })
tool       { status: "loaded", runtimeId, contentHash, contextRevision }
hidden     normalized PromptSkillContextAttachment
assistant  next completion follows the invoked instructions
```

The tool result is deliberately small. `AIChatQueryLoop` appends it first to
satisfy the assistant-tool-call pairing. It then appends the hidden context
message before requesting the next completion.

Use a backend developer/application-context role when supported. Otherwise use
an internal meta-user message with explicit origin metadata. It must be visible
to the model, omitted from normal user chat bubbles, retained in model context,
and distinguishable from a human-authored message. Repository instructions are
never represented as trusted system policy.

```typescript
export interface PromptSkillContextAttachment {
  readonly type: "invoked_prompt_skill";
  readonly conversationId: string;
  readonly agentId?: string;
  readonly runtimeId: SkillRuntimeId;
  readonly name: string;
  readonly sourceLabel: string;
  readonly canonicalRoot: string;
  readonly contentHash: string;
  readonly contextRevision: number;
  readonly normalizedInstructions: string;
  readonly tokenEstimate: number;
  readonly invokedAt: string;
}
```

The renderer may show a compact “Skill loaded” tool card using the
acknowledgement, but does not render `normalizedInstructions` as a user message.

### 10.6 Context assembly and normalization

`PromptSkillContextAssembler` builds the effective block in this order:

```text
<invoked_prompt_skill runtime_id="…" content_hash="…">
Skill: <name>
Source: <safe source label>
Base directory for this skill: <canonical root>
Writable workspace: <canonical conversation workspace>

<normalized SKILL.md body>
</invoked_prompt_skill>
```

Assembly performs these pure transformations:

1. Verify the current file matches the catalog content hash or load the approved
   retained snapshot.
2. Parse and remove YAML frontmatter from the instruction body.
3. Normalize line endings and reject invalid text encoding.
4. Substitute `${AIFETCHLY_SKILL_DIR}` and the compatibility alias
   `${CLAUDE_SKILL_DIR}` with a display-safe canonical skill directory.
5. Substitute supported non-secret invocation arguments without evaluating
   shell expressions.
6. Apply token-aware selection.
7. Add source, base-directory, workspace, and truncation metadata.

Variable substitution produces text for model understanding. Actual resource
or process operations resolve runtime ID through capabilities again; they never
trust a path copied back from the model.

### 10.7 Token-budget policy

Create `PromptSkillTokenBudgetService`, using the model context window from
`AIChatModelCatalogService` and the existing `AIChatPromptBudget` conventions.
The service receives current assembled token estimate, reserved completion/tool
budget, active skill estimates, and normalized Markdown sections.

```typescript
export interface PromptSkillBudgetDecision {
  readonly mode: "full" | "section-selected" | "metadata-only";
  readonly availableTokens: number;
  readonly selectedSections: readonly string[];
  readonly omittedSections: readonly string[];
  readonly estimatedTokens: number;
  readonly resourceReadRequired: boolean;
}
```

Policy order:

1. Full body when it fits the per-skill and aggregate active-skill budgets.
2. Deterministic section selection when the body is too large: always keep the
   opening contract, workflow, safety/constraint sections, and sections matching
   the invocation arguments or current request.
3. Metadata-only refusal when even the essential block cannot fit; ask the model
   to compact or the user to start a fresh context instead of silently dropping
   policy.

Section selection parses headings and preserves whole fenced blocks. It never
raw-slices in the middle of a command, JSON example, or safety rule. The injected
block lists omitted headings and instructs the model to use
`skill_resource_read`. Initial defaults should be measured in tokens, not the
current 8,000-character cap, and remain configurable per model family.

### 10.8 Resource tools

```text
skill_resource_list
skill_resource_read
skill_resource_execute
```

`list` and `read` are bounded read-only operations relative to runtime ID. They
reject absolute paths, traversal, escaping links, binaries, and over-limit text.
Read results include canonical relative path, content hash, truncation metadata,
and the text needed for the current model round.

`execute` is not enabled because a helper exists. It requires a supported file
type, explicit permission, argument validation, conversation context for
workspace I/O, platform-provider execution, and audit.

“Always read helpers” means inventory helpers at invocation and progressively
load relevant instructions. It never means execute every helper during setup.

### 10.9 Links and watchers

Scanners accept directories or symbolic links, resolve targets, verify directory
type, canonicalize, and deduplicate by real `SKILL.md` path. Broken or escaping
links create diagnostics. Windows junctions follow the same rules.

Watch canonical targets explicitly rather than relying on platform-dependent
recursive link following. A disappeared target deactivates its source without
deleting it. A content change creates a new hash but does not mutate an already
active conversation invisibly.

### 10.10 Invoked-skill persistence and compaction

`PromptSkillInvocationModule` persists active invocation state through a Model;
`AIChatQueryLoop` and `AIChatContextAssembler` consume module views. Add:

```typescript
export interface PromptSkillInvocationRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly agentId?: string;
  readonly runtimeId: SkillRuntimeId;
  readonly contentHash: string;
  readonly contextRevision: number;
  readonly normalizedInstructions: string;
  readonly tokenEstimate: number;
  readonly invocationArgumentsJson: string;
  readonly invocationSource: "explicit" | "model" | "legacy-adapter";
  readonly active: boolean;
  readonly invokedAt: string;
}
```

Persistence occurs before the next model completion. A unique constraint on
conversation, agent scope, runtime ID, and content hash makes repeated invocation
idempotent. Same-hash invocation returns `already-loaded`; a verified new hash
increments `contextRevision` and emits `SKILL_CONTENT_CHANGED` before replacing
the effective instructions.

Full compaction summarizes ordinary conversation history but does not summarize
away active skill contracts. After `AIChatCompactSummary` is loaded,
`AIChatContextAssembler` reattaches active prompt-skill contexts in deterministic
invocation order. Recovery uses the stored normalized snapshot so a linked file
that changed or disappeared cannot rewrite past context silently.

Conversation clear/deletion deactivates or removes its invocation rows through
`PromptSkillInvocationModule`. Parent and subagent scopes remain separate unless
an explicit propagation policy copies a verified invocation.

### 10.11 Legacy documentation-skill adapter

During migration, existing documentation-only registry entries remain callable.
Their execute handler stops returning long `skillGuidance` JSON and delegates to
`PromptSkillInvocationService` with `invocationSource: "legacy-adapter"`.

The adapter returns the same short acknowledgement and schedules the same hidden
context attachment. It preserves attachment routing and separately approved
`run_skill_script` behavior until resource-tool parity is verified. Existing
executable skills never use this adapter.

A runtime feature flag allows rollback to the legacy result path during staged
deployment. New prompt-skill installations never create
`__skill_md_wrapper__.js` once the universal runtime is enabled.

### 10.12 Load-time safety

Invocation is a bounded file-read and context-assembly operation only. The
loader must not execute inline Markdown shell syntax, code fences, hooks,
helpers, imports, network references, or variable expressions. `allowed-tools`
may narrow later tool access but cannot authorize loading side effects.

The loader treats `SKILL.md` as untrusted repository content and wraps it with
application-owned boundary markers. Tool permissions, path capabilities,
network policy, secret isolation, and user approval remain authoritative when
the model follows the loaded instructions.

## 11. Activation and Paths

### 11.1 Central path service

```typescript
export interface AIFetchlyPathSet {
  readonly configHome: string;
  readonly globalPromptSkills: string;
  readonly installationState: string;
  readonly executableSkills: string;
  readonly sourceCache: string;
  readonly sessionStaging: string;
}
```

`AIFetchlyPaths` resolves these once. Default `configHome` is `~/.aifetchly` and
`globalPromptSkills` is `~/.aifetchly/skills`. Electron `userData` retains state,
source cache, environments, and existing executable `installed_skills`.
`AIFETCHLY_CONFIG_HOME` may override config home for tests/advanced deployments.

### 11.2 Managed copy

Default global prompt activation:

```text
~/.aifetchly/skills/<normalized-name>/
```

Write a same-parent temporary directory, verify hashes, then atomically rename.
Add non-secret ownership metadata with installation id and source revision.
Update replaces atomically. Uninstall removes only a canonical path whose
metadata proves AiFetchly owns that exact activation.

### 11.3 Linked development mode

- POSIX: directory symbolic link.
- Windows: symbolic link when allowed.
- Windows fallback: directory junction.
- Final fallback: managed copy with visible warning.

Before linking, canonicalize target/parent, reject cycles, verify approved
`SKILL.md` hash, and reject an unowned destination. Uninstall removes the link or
junction, never its target. Automatic update blocks on a dirty linked checkout.

### 11.4 Existing executable skills

Keep executable packages in Electron `userData/installed_skills` and route them
through `SkillImportService`, `SkillEnvironmentManager`, and `SkillExecutor`.
Do not copy them to the prompt directory. Legacy documentation wrappers remain;
migration to prompt registration is opt-in and non-destructive.

## 12. Dependencies

```typescript
export type DependencyKind =
  | "system-binary"
  | "python-environment"
  | "node-environment"
  | "repository-command";

export interface DependencyPlanItem {
  readonly id: string;
  readonly kind: DependencyKind;
  readonly name: string;
  readonly currentStatus: "satisfied" | "missing" | "incompatible" | "unknown";
  readonly requiredVersion?: string;
  readonly installMethod?: string;
  readonly requiresElevation: boolean;
  readonly approvalRisk: "low" | "medium" | "high";
  readonly probes: readonly VerificationProbe[];
}
```

Inspection extracts proposals; a local validated catalog maps them to supported
operations. Unknown system packages cannot use the typed installer. Extend
catalog entries to multiple probes: video-use's ffmpeg requirement is satisfied
only when both `ffmpeg` and `ffprobe` pass when both are declared.

Refactor current synchronous installation:

- `SystemDependencyModule`: policy, catalog, audit, state;
- utility-process runner under `src/childprocess/`: native operation;
- `PlatformProcessProvider`: capture;
- main process Model/Module path: `DependencyInstallAudit` persistence.

Workers never write SQLite. Homebrew, apt, and winget remain catalog-constrained;
elevation is separately approved. Never silently invoke sudo/UAC or edit shell
profiles.

Python and Node environments live under
`<userData>/skill-environments/<installation-id>/`. Lockfiles and requirements
are hashed. Python retains hash-pinning policy. Node lifecycle scripts are a
separate high-risk plan item. Do not mutate global `process.env.PATH`; return a
new environment snapshot for later probes.

## 13. Credentials

```typescript
export interface CredentialRequirement {
  readonly id: string;
  readonly name: string;
  readonly environmentVariable: string;
  readonly provider: string;
  readonly required: boolean;
  readonly validationProbe?: CredentialValidationProbe;
}
```

The renderer uses a secure input only after planning a declared credential.
Plaintext must not enter chat history, generic tool arguments/results, logs, or
plans.

Create `SkillCredentialService` as a fail-closed wrapper around Electron
`safeStorage`. Do not use the current plaintext fallback for persistent skill
credentials. Store encrypted data in an application-owned store and only an
opaque binding id/metadata in SQLite. If OS encryption is unavailable, offer
session-only use or block persistence.

At helper execution, the main process injects only declared variables for one
child invocation. Redact stdout, stderr, exceptions, events, and diagnostics
before persistence or rendering. Rotation keeps binding identity. Uninstall
removes a reference and deletes a shared secret only when unused or explicitly
requested.

Video-use pauses at `awaiting_secret`, asks securely for
`ELEVENLABS_API_KEY`, optionally validates it with a minimal approved probe, and
resumes without echoing it.

## 14. Persistence

### 14.1 Entities

`SkillInstallationEntity`:

| Column                                                          | Purpose                            |
| --------------------------------------------------------------- | ---------------------------------- |
| `id`                                                            | UUID installation identity         |
| `runtimeId`                                                     | unique scoped runtime identity     |
| `name`, `kind`, `scope`, `workspaceId`                          | discovery and resolution           |
| `sourceId`, `sourceUri`, `sourceRevision`, `sourceSubdirectory` | provenance                         |
| `activationMode`, `activationPath`, `contentHash`               | verified activation                |
| `status`, `enabled`, `metadataJson`                             | lifecycle; metadata is non-secret  |
| audit timestamps                                                | extends established auditable base |

Uniqueness uses source, revision, subdirectory, scope, workspace, and mode—not
bare name.

`SkillInstallationSessionEntity` stores id, installation id, conversation id,
state, revision, versioned plan JSON, redacted errors, lease owner/expiry, and
timestamps.

`SkillDependencyBindingEntity` stores dependency identity, resolved version,
provider, environment path, probes, and last verification. It never claims
ownership of shared system packages.

`SkillCredentialBindingEntity` stores installation, credential metadata, opaque
secure reference, and status—never the secret.

`SkillInstallationEventEntity` is append-only and ordered for transitions,
approvals, dependencies, activation, verification, rollback, and cancellation.

`PromptSkillInvocationEntity` stores conversation id, optional agent id, runtime
id, content hash, context revision, normalized instruction snapshot, token
estimate, redacted invocation arguments, invocation source, active flag, and
timestamps. The normalized snapshot is required for deterministic compaction
recovery when a linked source changes or disappears. It contains no credential
values and is local conversation state, not installation metadata.

Unique active identity:

```text
conversationId + agentId + runtimeId + contentHash
```

A later hash creates a new revision and deactivates the prior effective record
inside one Model transaction.

### 14.2 Models and modules

```text
src/model/SkillInstallation.model.ts
src/model/SkillInstallationSession.model.ts
src/model/SkillDependencyBinding.model.ts
src/model/SkillCredentialBinding.model.ts
src/model/SkillInstallationEvent.model.ts
src/model/PromptSkillInvocation.model.ts

src/modules/SkillInstallationModule.ts
src/modules/SkillCredentialModule.ts
src/modules/PromptSkillInvocationModule.ts
```

Models own repositories, queries, compare-and-set updates, and transactions.
Modules own business rules. IPC handlers and workers never access repositories.
Workers never receive database paths.

### 14.3 Migration sequence

1. Establish and verify the repository baseline migration.
2. Confirm packaged startup without destructive synchronization.
3. Generate a distinct skill-installation migration.
4. Register it in `DB_MIGRATIONS` and entities in `DB_ENTITIES`.
5. Test populated upgrade and clean install.

Before baseline completion, synchronization is acceptable only for disposable
development databases and is not release evidence.

Existing `InstalledSkillEntity` remains authority for legacy executable/plugin
skills during transition. Backfill `legacy-installed` records while retaining
old rows and use a compatibility adapter. Rescan local prompt sources whose
canonical path cannot be proven instead of guessing ownership.

The feature migration also creates prompt invocation state. No historical
documentation-tool result is backfilled as an active invocation because a JSON
tool result does not prove that its instructions remained applicable. New
invocations begin using the optimized path after rollout.

## 15. IPC and Worker Protocol

### 15.1 Renderer IPC

Add Zod schemas and channels:

```text
SKILL_INSTALL_PREPARE
SKILL_INSTALL_APPROVE
SKILL_INSTALL_SUBMIT_SECRET
SKILL_INSTALL_STATUS
SKILL_INSTALL_CANCEL
SKILL_INSTALL_UPDATE
SKILL_INSTALL_REPAIR
SKILL_INSTALL_UNINSTALL
SKILL_INSTALL_PROGRESS
```

Progress snapshots have monotonic sequence numbers. `SUBMIT_SECRET` is separate
from chat text and ordinary logging. Responses use a consistent safe envelope.

### 15.2 Utility process

All worker entry points and worker-only code live under:

```text
src/childprocess/skill-installation/
  SkillInstallationWorker.ts
  SkillInstallationWorkerProtocol.ts
  SourceAcquisitionWorker.ts
  DependencyExecutionWorker.ts
```

Register the entry in Forge/Vite configuration. Validate Zod discriminated
unions in both directions. Requests contain operation/session ids, serialized
capabilities, limits, and structured arguments. They exclude database paths,
secret-store handles, renderer handles, and global roots.

Unexpected exit marks the operation failed, records redacted diagnostics,
expires the lease, and evaluates rollback. Renderer disconnect alone does not
cancel an approved installation.

## 16. Security Model

| Input/component          | Trust                       | Handling                        |
| ------------------------ | --------------------------- | ------------------------------- |
| User intent              | authorized but unstructured | typed request                   |
| Repository instructions  | untrusted                   | constrain and review            |
| Paths/archives/links     | hostile                     | canonicalize and bound          |
| Model tool arguments     | untrusted                   | Zod validate and authorize      |
| Renderer IPC             | untrusted boundary          | validate and gate               |
| Worker messages          | untrusted boundary          | validate, correlate, redact     |
| Local dependency catalog | app-trusted                 | validated/versioned             |
| Credential plaintext     | highly sensitive            | transient main-process handling |

Approval binds to exact source revision, instruction hashes, activation target,
permissions, dependencies, command templates, elevation, lifecycle scripts, and
persistent credential choice. Any relevant change invalidates approval.

Prefer executable plus argument vector. A true shell step is a separate high-risk
plan item with reviewed interpreter/text. Never concatenate secrets or unchecked
paths. Pin source revisions, hash activated content, honor lockfiles, restrict
downloads, and record package/version/probes.

Uninstall accepts installation id, loads recorded canonical activation, and
checks ownership. It never builds a path from a user-supplied skill name. Managed
copies may be removed; links/junctions are unlinked; source targets and shared
dependencies remain by default.

## 17. Registry and Permission Migration

Implement native `replaceSource` in `PromptSkillCatalog` rather than asynchronous
unregister/delete behavior. Persistence and registry mutation are ordered by the
module. Prompt catalog resolution supports source-scoped duplicates.

Keep executable registry names during compatibility. Add runtime-id mapping and
define collision behavior before migrating it; initially reject new executable
collisions rather than overwrite.

AI request building lists concise prompt skill metadata for the current user and
workspace. Load full `SKILL.md` only after selection. Migrate permission keys
from bare `SKILL_PERMISSION_<name>` to scoped runtime IDs. Legacy tokens may be
read through compatibility but new grants cannot authorize another same-named
source.

### 17.1 Runtime migration stages

1. **Shadow catalog:** build `PromptSkillCatalog` alongside existing
   documentation tools and compare resolution/diagnostics without changing model
   messages.
2. **Universal invocation opt-in:** advertise `use_skill`; new prompt installs
   use hidden context while legacy tools remain available.
3. **Legacy delegation:** existing documentation tools call
   `PromptSkillInvocationService` and stop returning long guidance JSON.
4. **Catalog cleanup:** remove per-prompt-skill tool definitions after telemetry
   shows no unresolved clients or scheduled tasks depend on them.
5. **Wrapper retirement:** stop generating `__skill_md_wrapper__.js`; retain a
   read-only loader for packages installed by older versions.

Use separate feature flags for universal catalog advertisement, hidden context
injection, legacy delegation, and compaction recovery. A rollback can return to
legacy delivery without uninstalling or rewriting skill packages.

### 17.2 Chat-query integration

`AIChatQueryEngine` requests metadata from `PromptSkillCatalogPresenter` and
adds one `use_skill` definition to normal and resumed plan turns.
`AIChatQueryLoop` recognizes a successful prompt invocation result, appends the
tool acknowledgement, then asks `PromptSkillInvocationModule` for the verified
context attachment and appends its hidden model message.

`AIChatContextAssembler` loads active invocations after the compact summary and
before recent conversation messages. This ordering gives persistent skill
contracts a stable position while allowing more recent explicit user messages
to refine the task. Application system policy remains earlier and higher
authority.

The older `StreamEventProcessor` continuation path must use the same shared
context-injection helper or remain behind the legacy feature flag. Maintaining
two message-sequencing implementations would recreate the current behavioral
split.

### 17.3 Deletion and lifecycle integration

Conversation deletion calls `PromptSkillInvocationModule.deleteByConversation`.
Skill disable or uninstall marks matching active invocations unavailable for new
rounds and emits a safe diagnostic. Historical conversation records may retain
their instruction snapshot for audit/recovery policy, but cannot authorize
resource access after the installation is disabled.

## 18. Verification and Readiness

Required verification levels:

1. Acquisition: source, revision, and hash exist.
2. Inspection: approved instruction hashes still match.
3. Activation: destination resolves to expected canonical content.
4. Dependency: every required probe passes.
5. Credential: every required binding exists; provider validation only when
   declared and approved.
6. Registry: intended runtime ID resolves in target scope.
7. Smoke: `SKILL.md` and helper inventory are readable through daily runtime
   resource tools.

Only all required levels passing transitions to `ready`.

### 18.1 Video-use acceptance fixture

1. Acquire the repository into session staging.
2. Read `install.md` before deriving mutation plan.
3. Inspect `SKILL.md` and helper inventory without executing helpers.
4. Probe `ffmpeg` and `ffprobe` independently.
5. Offer catalog-backed dependency installation only when missing.
6. Activate under `~/.aifetchly/skills` using approved mode.
7. Request `ELEVENLABS_API_KEY` through secure input.
8. Persist only an opaque binding.
9. Resolve through `PromptSkillCatalog`.
10. Report ready and stop.
11. Never transcribe or modify footage until a later explicit request.

Routine CI uses a local fixture mirror. A separate network test may verify GitHub
compatibility without depending on a mutable external repository.

## 19. Errors and Observability

Structured error codes include:

```text
WORKSPACE_NOT_APPROVED
FILESYSTEM_SCOPE_MISMATCH
PATH_CAPABILITY_DENIED
SOURCE_ACQUISITION_FAILED
SOURCE_LIMIT_EXCEEDED
SOURCE_REVISION_CHANGED
SKILL_NOT_FOUND
SKILL_AMBIGUOUS
SKILL_DISABLED
SKILL_CONTEXT_HASH_MISMATCH
SKILL_CONTEXT_BUDGET_EXCEEDED
SKILL_CONTEXT_INJECTION_FAILED
SKILL_RESOURCE_READ_REQUIRED
SKILL_CONTENT_CHANGED
INSTRUCTION_LIMIT_EXCEEDED
PLAN_REVISION_MISMATCH
APPROVAL_REQUIRED
DEPENDENCY_UNSUPPORTED
DEPENDENCY_INSTALL_FAILED
DEPENDENCY_PROBE_FAILED
SECRET_REQUIRED
SECURE_STORAGE_UNAVAILABLE
ACTIVATION_COLLISION
LINK_CREATION_FAILED
ACTIVATION_VERIFICATION_FAILED
REGISTRY_COLLISION
WORKER_CRASHED
PROCESS_OUTPUT_EMPTY_UNEXPECTED
ROLLBACK_FAILED
```

Progress events contain session, sequence, state, operation, safe summary,
timestamp, and optional error code. Do not expose secret-bearing commands,
environment dumps, output, or unnecessary absolute paths.

Measure prepare-to-ready time, failures by state/platform, Windows empty-output
frequency, link fallback, rollback success, dependency probe accuracy, restart
recovery, and repeated generic-tool calls during installation. Prompt-runtime
metrics include catalog tokens, invoked instruction tokens, full versus
section-selected load rate, duplicate invocation suppression, hidden-context
injection failure, compaction restoration, legacy-adapter calls, and resource
read follow-through. Metrics contain runtime category and counts, not instruction
text, user requests, paths, or arguments.

## 20. File-Level Implementation Plan

### 20.1 Filesystem and process

| File                                                  | Responsibility                         |
| ----------------------------------------------------- | -------------------------------------- |
| `src/entityTypes/filesystemContextTypes.ts`           | Roots and capabilities.                |
| `src/service/ConversationFilesystemContextService.ts` | Resolve immutable context.             |
| `src/service/FilePathGuard.ts`                        | Capability and canonical path checks.  |
| `src/service/FileToolService.ts`                      | Consume shared context.                |
| `src/service/ShellToolService.ts`                     | Consume context; delegate to provider. |
| `src/service/ToolExecutor.ts`                         | Resolve once and inject.               |
| `src/service/process/PlatformProcessProvider.ts`      | Contract.                              |
| `src/service/process/PosixProcessProvider.ts`         | POSIX execution.                       |
| `src/service/process/WindowsProcessProvider.ts`       | Windows execution/capture.             |
| `src/service/process/ShellInterpreterResolver.ts`     | Interpreter discovery.                 |

### 20.2 Installation and prompt runtime

| File                                           | Responsibility                               |
| ---------------------------------------------- | -------------------------------------------- |
| `src/entityTypes/skillInstallationTypes.ts`    | Session, plan, source, dependency types.     |
| `src/entityTypes/promptSkillTypes.ts`          | Prompt manifest, catalog, resource types.    |
| `src/service/SkillSourceAcquisitionService.ts` | Acquisition policy and worker orchestration. |
| `src/service/SkillPackageInspectionService.ts` | Discovery, parsing, classification, hashes.  |
| `src/service/SkillInstallPlanner.ts`           | Immutable typed plan.                        |
| `src/service/SkillActivationService.ts`        | Copy/link/junction and rollback.             |
| `src/service/SkillInstallationVerifier.ts`     | Readiness probes.                            |
| `src/service/PromptSkillCatalog.ts`            | Scoped source-aware registry.                |
| `src/service/PromptSkillCatalogPresenter.ts`   | Bounded model-facing metadata catalog.       |
| `src/service/PromptSkillLoader.ts`             | Bounded `SKILL.md` parsing.                  |
| `src/service/PromptSkillInvocationService.ts`  | Resolve, normalize, persist, and inject.     |
| `src/service/PromptSkillContextAssembler.ts`   | Build verified hidden context attachments.   |
| `src/service/PromptSkillTokenBudgetService.ts` | Model-aware section selection and estimates. |
| `src/service/PromptSkillResourceService.ts`    | Relative resource operations.                |
| `src/modules/SkillInstallationModule.ts`       | State machine and business transaction.      |
| `src/modules/PromptSkillInvocationModule.ts`   | Durable conversation invocation state.       |

Update global/workspace scanners to discover links and prompt skills, and update
the watcher to monitor canonical linked targets explicitly.

### 20.3 Persistence, IPC, worker, and UI

| Area        | Files/change                                                                   |
| ----------- | ------------------------------------------------------------------------------ |
| Entities    | Installation/session/dependency/credential/event plus `PromptSkillInvocation`. |
| Models      | Corresponding `src/model/*.model.ts` transaction/query classes.                |
| Credentials | `SkillCredentialService` and `SkillCredentialModule`.                          |
| Database    | Baseline first, then feature migration and entity registration.                |
| Schemas     | `src/schemas/ipc/skillInstallation.ts`.                                        |
| IPC         | Thin AI-gated `skill-installation-ipc.ts` and channel constants.               |
| Worker      | `src/childprocess/skill-installation/*` and Forge/Vite entry.                  |
| Preload/API | Narrow typed renderer bridge and subscriptions.                                |
| UI          | Review, approval, secure secret, progress, repair, uninstall.                  |
| i18n        | English, Chinese, Spanish, French, German, Japanese.                           |

Chat integration also updates `AIChatQueryEngine`, `AIChatQueryLoop`,
`AIChatContextAssembler`, the compact/recovery flow, conversation deletion, and
the legacy documentation handlers in `SkillImportService` and
`PluginImportService`. Put message ordering in one shared helper so streaming
implementations cannot diverge.

UI implementation and its component tests must ship together.

## 21. Testing Strategy

### 21.1 Unit

- shared context and no home fallback;
- path capability checks for missing paths, symlinks, junctions, case, traversal,
  device paths, and alternate streams;
- URI normalization and idempotency;
- package classification and instruction limits;
- plan revisions and legal state transitions;
- activation ownership, collision, and rollback;
- secret redaction and fail-closed storage;
- dependency mapping and multi-probe verification;
- same-name prompt skill precedence;
- uninstall never deletes linked target.
- metadata presenter never includes instruction bodies;
- universal invocation resolution, ambiguity, disablement, and model-invocation policy;
- frontmatter removal, base-directory headers, and safe variable substitution;
- full, section-selected, and budget-exceeded context decisions;
- Markdown selection never cuts fenced blocks or required safety sections;
- same-hash idempotency and changed-hash revision behavior;
- prompt loading has no process, hook, helper, or network side effects;
- resource reads remain within the selected runtime root.

### 21.2 Platform provider

Run on every OS. Assert bytes, decoding, streams, Unicode, truncation, timeout,
cancellation, cwd, and essential environment. Windows cases are mandatory.

### 21.3 Main/database integration

- durable prepare and immutable plan;
- stale/duplicate approval safety;
- validated correlated worker messages;
- restart recovery and lease reclaim;
- failed activation restoration;
- monotonic progress sequence;
- AI-disabled early return;
- clean schema and populated-baseline upgrade;
- source-scoped duplicates and append-only events;
- legacy executable backfill.
- valid assistant-tool/short-tool-result/hidden-context ordering;
- hidden context is absent after failed resolution or hash verification;
- active invocation persistence precedes the next model completion;
- full compact reattaches active skills once in deterministic order;
- recovery uses the stored snapshot when a linked source changed or vanished;
- parent/subagent invocation state remains isolated;
- conversation deletion clears invocation state through Module/Model layers;
- legacy documentation handlers produce the same invocation attachment.

### 21.4 UI and E2E

Component tests cover plan risk grouping, revision invalidation, secure input,
link fallback, all lifecycle states, safe uninstall wording, localization, and
accessible announcements.

E2E fixtures cover managed copy, linked reload, GitHub archive fallback,
dependency approval, secret pause/resume, restart, same-name scopes, video-use
stopping at ready, Windows output, rollback, lazy `use_skill` invocation,
token-constrained progressive resource reads, compaction recovery, linked-skill
change notification, and legacy-wrapper delegation.

## 22. Delivery Phases

### Phase 0: Evidence

Add Windows probes, a shell/file mismatch regression, local prompt fixtures, and
the error/event contract. Exit when failures reproduce without network access.

### Phase 1: Shared filesystem context

Inject one context into shell and file tools, remove chat fallback to home, and
harden canonicalization. Exit when a shell-created workspace file is immediately
readable by file tools and neither can escape.

### Phase 2: Process providers

Separate interpreters from capture, implement POSIX/Windows providers, fix
confirmed output causes, and integrate dependency execution. Exit on full
cross-platform CI including Windows.

### Phase 3: Prompt runtime

Add the separate catalog, metadata presenter, universal `use_skill` tool,
normalized hidden context, token-budget service, invocation persistence,
compaction recovery, resources, directory/link/junction scanning, activation,
and legacy adapter. Exit when copied/linked `SKILL.md` works without an
executable manifest, instruction bodies remain absent before invocation, the
next model round receives exactly one verified context block, and compaction
restores it exactly once.

### Phase 4: Read-only prepare

Add acquisition, inspection, planning, session persistence, and review UI with
no mutations. Exit when plans are accurate and survive restart.

### Phase 5: Mutation and rollback

Add approvals, dependency runner, activation, verification, rollback, and audit.
Establish database baseline and feature migration before release. Exit when
copy/link installation is idempotent and recoverable.

### Phase 6: Credentials and lifecycle

Add fail-closed secrets, update, repair, disable, uninstall, and video-use
acceptance. Exit when it reaches ready, stores no plaintext key, and performs no
daily-use work.

### Phase 7: Gradual enablement

Feature-flag by platform/cohort: prepare diagnostics, managed copy, then links
and system dependencies. Exit when PRD reliability/security metrics pass.

## 23. Decisions

| Decision               | Choice                                   | Reason                                      |
| ---------------------- | ---------------------------------------- | ------------------------------------------- |
| Coordinator            | Typed module/state machine               | Prevent retries and partial success claims. |
| Filesystem             | Immutable conversation context           | All tools observe one world.                |
| Prompt runtime         | Separate catalog                         | Instructions are not executable manifests.  |
| Prompt discovery       | Metadata only                            | Unused skills do not consume context.       |
| Prompt invocation      | One universal `use_skill` tool           | Stable routing and lower tool-schema cost.  |
| Instruction delivery   | Short tool result plus hidden context    | Instructions remain behavioral context.     |
| Context retention      | Persist verified normalized snapshot     | Compaction cannot silently drop/change it.  |
| Instruction sizing     | Model-aware section selection            | Avoid unsafe raw character truncation.      |
| Default activation     | Managed copy                             | Portable and predictable.                   |
| Development activation | Symlink, then Windows junction           | Live editing without target deletion.       |
| Prompt directory       | `~/.aifetchly/skills`                    | Stable agent-visible convention.            |
| Executable directory   | Keep `userData/installed_skills`         | Preserve existing environments.             |
| Windows process        | Dedicated provider, non-detached default | Testable lifecycle and capture.             |
| Secrets                | Fail-closed OS encryption                | No plaintext downgrade.                     |
| Database               | Baseline before feature migration        | Current registry has no safe baseline.      |
| Dependencies           | Validated catalog                        | Repo prose cannot choose elevated commands. |
| Completion             | Independent probes                       | Exit zero is insufficient.                  |

## 24. Open Engineering Questions

1. Which Windows tree-termination implementation is reliable for supported
   Electron/Node versions?
2. Should `~/.aifetchly` be user-configurable in UI, especially for roaming
   Windows profiles?
3. Which prompt front-matter fields form the portable minimum?
4. Do linked Git sources pin revisions or track an explicit development branch?
5. How is the dependency catalog signed and updated?
6. Which provider credential probes are safe and optional?
7. When is the database baseline scheduled relative to persistence work?
8. Which backend role is available for hidden application context on every
   supported AI provider, and where is the meta-user fallback required?
9. What initial per-skill and aggregate token fractions preserve enough space
   for attachments, tools, and one completion across supported model windows?
10. Should an active linked skill update require explicit user reload in every
    case, or may unchanged-permission updates reload automatically between turns?

## 25. Definition of Done

- Shell and file tools share one proven conversation scope.
- Windows output passes non-skipped CI.
- Prompt skills load from directories, links, and junctions with canonical
  deduplication.
- Initial model context contains bounded prompt-skill metadata, never every
  installed instruction body.
- One universal invocation tool resolves explicit and automatic selection.
- A successful invocation appends a short tool acknowledgement followed by one
  hidden normalized context attachment.
- Instruction context includes verified runtime identity, content hash, base
  directory, and approved workspace.
- Token-aware section selection and resource reads replace the 8,000-character
  guidance slice.
- Same-hash repeat invocation is context-idempotent; changed content creates a
  visible revision.
- Active prompt skills survive compaction/recovery exactly once using a stored
  verified snapshot.
- Legacy documentation-only tools delegate to the same invocation service.
- Loading instructions executes no Markdown command, helper, hook, or network
  reference.
- Copy/link activation under `~/.aifetchly/skills` is atomic and safely removed.
- Installation is durable, typed, idempotent, and recoverable.
- Repository instructions cannot grant themselves capabilities.
- Dependencies are catalog-backed and independently probed.
- Secrets use fail-closed encryption or session-only mode.
- Persistence ships through a baseline and feature migration.
- Workers live under `src/childprocess/` and never access SQLite.
- AI IPC gates before parsing/work.
- UI text covers all six languages and ships with component tests.
- The video-use fixture installs, verifies, reports ready, and stops without
  transcribing footage.
