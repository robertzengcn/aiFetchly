# Universal Agent Skills and Project Trust — Technical Design

Status: Proposed. Components, fields, channels, and limits marked proposed below are not implemented merely because they appear here.
Date: 2026-11-06 (Asia/Shanghai).
Product contract: [PRD](2026-11-06-universal-agent-skills-and-project-trust-prd.md).
Foundation: [Portable prompt-skill runtime and installation design](../../prd/natural-language-skill-installation-technical-design.md).

## 1. Architecture decision

Extend the existing portable prompt-skill pipeline with multiple explicitly described source roots, complete candidate retention, versioned project trust, and app-local external-source preferences. Reuse `PromptSkillCatalog`, `PromptSkillInvocationService`, the existing context assembler, and bounded skill resource helpers. Do not route shared `SKILL.md` through executable manifests or documentation-only JavaScript wrappers.

Separate the pure filesystem scan from main-process reconciliation. A worker can inspect files and return bounded serializable facts. The main process supplies authorized roots, reconciles persisted preferences through Modules/Models, computes eligibility for each chat, applies trust, and publishes revisioned views.

```text
Native/shared/global/workspace source roots
    |
    v
Pure bounded scanner + portable frontmatter parser
    |  worker: source IDs, generations, hashes, metadata, diagnostics
    v
Main-process source coordinator
    +--> WorkspaceResolver / approved binding
    +--> project trust Module --> Model --> SQLite
    +--> external preference Module --> Model --> SQLite
    +--> canonical-target and ownership checks
    |
    v
Candidate store (retain every source contribution)
    |
    +--> eligibility + precedence + per-context realpath deduplication
    |       |
    |       v
    |   PromptSkillCatalog --> metadata catalog / explicit invocation
    |       |
    |       v
    |   use_skill --> instruction revision --> provenance-aware context
    |       |
    |       +--> bounded resource reads / pinned operation resources
    |       +--> existing permission-gated execution paths, if compatible
    |
    +--> unified management projection --> IPC/preload --> Vue UI

Trust/preference/workspace changes --> policy epoch barrier
    --> invalidate catalogs, activations, derived context, queued actions
```

The authoritative trust and preference data stays in SQLite. Files are authoritative for skill content. Runtime catalogs and compatibility projections are rebuildable indexes, not ownership records for external files.

## 2. Verified implementation map

Paths are repository-relative links. The observations were checked during the design investigation; line numbers in earlier discussion are navigation hints rather than a permanent API contract.

| Existing source | Observed behavior | Integration responsibility |
| --- | --- | --- |
| [AIFetchlyConfigLoader.ts](../../../src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts) | Scans native global `skills/` for portable prompt skills; reconciles some discoveries with managed installation rows. | Extract a pure shared scanner; preserve managed row identity/enablement during main-process reconciliation. |
| [WorkspaceConfigScanner.ts](../../../src/service/workspaceWatch/WorkspaceConfigScanner.ts) | Scans workspace `.aifetchly`, including `manifest.json` executable skill drafts; does not emit portable prompt drafts. | Add native/shared workspace prompt-source discovery without introducing DB access. |
| [AIFetchlyRuntimeRegistrySync.ts](../../../src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts) | Registers `snapshot.promptSkills`; workspace trust filter currently gates other capabilities but not this array. Derives workspace IDs by parsing source strings and fallback installation IDs from source/name. | Add prompt trust filtering; replace string-derived authority with explicit typed source/binding metadata and stable location-based IDs. |
| [AIFetchlyConfigMarkdown.ts](../../../src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts) | Restricted frontmatter parser for native configuration. | Keep restrictive native behavior; use a separate portable parser for standard skills. |
| [PromptSkillLoader.ts](../../../src/service/PromptSkillLoader.ts) | Canonical root checks, 256 KiB Markdown limit, content hash, invocation flags, and legacy metadata fallbacks. Unsupported frontmatter can be treated as absent. | Preserve path/hash safeguards; distinguish malformed portable frontmatter from supported legacy no-frontmatter input. |
| [promptSkillTypes.ts](../../../src/entityTypes/promptSkillTypes.ts) | Runtime IDs, scopes, definitions, invocation attachments, resource contracts; unknown fields currently string/string-array only. | Add source/location/provenance metadata and bounded nested JSON-compatible unknown data. |
| [PromptSkillCatalog.ts](../../../src/service/PromptSkillCatalog.ts) | Scope ranking, source replacement, explicit IDs, name ambiguity, ingestion-time canonical deduplication, and 100-entry cap. | Retain all candidates independently; apply source ranking and deduplication at context projection rather than discarding fallback registrations. |
| [PromptSkillInvocationService.ts](../../../src/service/PromptSkillInvocationService.ts) | `use_skill`, explicit/model invocation policy, hash verification, idempotent same-revision load, durable attachments, 16,000/8,000-token defaults. | Add policy epochs, source eligibility rechecks, explicit revision transitions, and dependency provenance. |
| [PromptSkillContextAssembler.ts](../../../src/service/PromptSkillContextAssembler.ts) | Lazy instruction assembly with base-directory information and application-owned boundaries. | Preserve lower-authority wrapping; carry source revision and eligibility into each emitted attachment. |
| [PromptSkillResourceService.ts](../../../src/service/PromptSkillResourceService.ts) | Bounded list/read operations with skill-root containment. | Recheck current source/binding/trust; support narrow global-resource access and versioned operation resources. |
| [AIChatContextAssembler.ts](../../../src/service/AIChatContextAssembler.ts) | Exposes metadata catalog per turn. | Use one authorized context snapshot; filter stale attachments and tainted derived context before provider serialization. |
| [WorkspaceResolver.ts](../../../src/service/WorkspaceResolver.ts) | Resolves an approved workspace per conversation; absent/unapproved bindings return null. | Remain the main-process authority for chat workspace scope. |
| [WorkspaceModule.ts](../../../src/modules/WorkspaceModule.ts) | Creates pending bindings; approval retires other active rows. | Add transactional selection finalization so a cancelled candidate never hides/replaces the prior workspace. |
| [AIFetchlyWorkspaceTrustModule.ts](../../../src/modules/AIFetchlyWorkspaceTrustModule.ts) | Per-capability trust; missing trust means false. Legacy migration can seed approved workspaces with all capabilities true. | Version consent and stop treating migrated all-true rows as consent to the new trust/hook policy. |
| [WorkspaceWatchManager.ts](../../../src/service/workspaceWatch/WorkspaceWatchManager.ts) | Main-process coordination for workspace scans/watches. | Integrate source generations, per-binding projections, and policy barriers. |
| [WorkspaceChokidarWatcher.ts](../../../src/childprocess/aifetchly-config/WorkspaceChokidarWatcher.ts) | Watches `.aifetchly` and optional root `AGENTS.md`; 500 ms write stabilization/debounce, atomic saves, bounded depth. | Extend scoped source watches and missing-root detection; do not widen to recursive whole-project/home watches. |
| [workerScanner.ts](../../../src/childprocess/aifetchly-config/workerScanner.ts) | Worker scan pipeline delegates to the pure workspace scanner. | Transport typed prompt-source drafts; keep workers free of Electron/DB/registry imports. |
| [AIFetchlyConfigManager.ts](../../../src/service/aifetchlyConfig/AIFetchlyConfigManager.ts), [background.ts](../../../src/background.ts) | Global initialization/reload scans and startup wiring. | Add global shared-root lifecycle and avoid duplicate native scans/registrations. |
| [skills.vue](../../../src/views/pages/systemsetting/skills.vue), [SkillInstallManager.vue](../../../src/views/components/aiChatV2/SkillInstallManager.vue) | Existing management surfaces rely on legacy/managed installation lists. | Supply a unified inventory projection without pretending external candidates are owned installations. |
| [FileToolService.ts](../../../src/service/FileToolService.ts) | Strict workspace mode confines generic file operations to the workspace. | Preserve this boundary; global skill resources use narrow resource helpers instead of expanding workspace roots. |

Proposed file names in later sections are implementation suggestions. Verify existing neighboring APIs when building; do not infer delivery from this document.

## 3. Invariants

1. No automatic project-capability metadata disclosure or instruction activation occurs until the current project policy permits it. Explicit user-requested file inspection can supply untrusted task data under existing file permissions; it cannot activate that capability.
2. Folder file approval, project capability trust, and tool execution authorization are separate checks.
3. Every lookup path, including direct runtime IDs and resource reads, enforces the same current scope and policy.
4. A source scan cannot grant trust, overwrite preferences, or invent a workspace ID.
5. All raw candidates survive deduplication/overrides until their owning source removes them.
6. An external-source management action never rewrites or deletes external files.
7. No DB, Electron-main, or runtime registry operation runs inside a scanner/watch worker.
8. Revocation wins over queued scans, cached contexts, and later tool dispatch; late results cannot resume invalidated automation.
9. Active instruction revisions are explicit; known changed resources cannot be silently substituted into an operation.
10. Global resource access is limited to the authorized skill root and does not expand generic home-directory access.
11. Capability declarations and unknown YAML fields can never expand permission.
12. Project skills and project instructions retain separate loaders and context roles even when governed by the same trust decision.

## 4. Source discovery and path policy

### 4.1 Root construction

Main-process source descriptors are constructed from the operating-system home path, validated XDG config home, and the canonical root of an approved or pending user-selected workspace. Use `path.join` and existing platform path helpers. Tilde and environment expansion are application-controlled; do not invoke a shell.

| Source kind | Logical root | Scope rank | Source rank |
| --- | --- | --- | --- |
| workspace-native | `<workspace>/.aifetchly/skills` | 0 | 0 |
| workspace-shared | `<workspace>/.agents/skills` | 0 | 1 |
| user-native | `<home>/.aifetchly/skills` | 1 | 0 |
| user-shared | `<home>/.agents/skills` | 1 | 1 |
| user-config | `<absolute XDG_CONFIG_HOME or home/.config>/agents/skills` | 1 | 2 |
| plugin | Existing plugin-owned skill sources | 2 | Existing ambiguity rules |
| built-in | Existing bundled sources | 3 | Existing ambiguity rules |

An XDG value must be absolute. Reject empty/relative/NUL-containing overrides and fall back to the documented default with a diagnostic. Roots resolving to the same physical directory can share an underlying watcher/scan, but retain their logical source identities and priorities.

Neither `process.cwd()`, the application repository, a renderer-supplied workspace key, nor a Git remote is an authority for chat project scope. Do not walk ancestors in this release. Native executable manifests continue through their existing pipeline, without acquiring shared-directory executable autoloading.

### 4.2 Traversal

Use a deterministic sorted walk rooted only at registered skills roots. The first child is depth 1; a skill entry can be found through directory depth 4. Detect nested collections even if an intermediate directory has its own `SKILL.md`. Do not descend into `.git`, `node_modules`, cache/build/output directories, or `scripts`, `references`, and `assets` while searching for skills.

Track visited canonical directories to stop cycles and duplicate traversal. Enforce limits against both logical entries and real targets so symlink fans cannot evade bounds. A file that changes while read is retried once after stabilization; persistent instability becomes a candidate diagnostic. Sort diagnostics and candidate publication deterministically.

Portable parser/scanner output contains source identity, logical relative path, canonical skill root, canonical Markdown path, raw file hash, validated metadata, file facts, and diagnostics. Instruction bodies may be kept in a bounded local scan cache but are never model-disclosed during discovery. Do not copy resources or execute anything in the scan.

### 4.3 Symlinks, junctions, and root aliases

Support directory symlinks and Windows junctions using realpath resolution and containment checks based on path components, never string prefix matching. Re-evaluate targets at refresh, activation, resource access, and operation preparation.

- User-owned shared sources can point at external skill checkouts. Authorize only the resolved exact skill root as a resource capability, not its parent or the whole home directory.
- A project link resolving inside its canonical workspace follows the project trust decision.
- A project link resolving outside the workspace is usable only when it targets an exact already-eligible global skill root or has an explicit linked-target approval for that project and location. Otherwise retain a blocked candidate for management/preview.
- A linked skills root itself is subject to the same rule. Approving one external root does not approve arbitrary sibling targets added later.
- A link target change invalidates approval and existing activation/resource handles even if the logical path and Markdown name remain unchanged.
- Record broken links, cycles, escapes, permission failures, and unsupported reparse points as bounded diagnostics. Do not silently fall back to cached executable resources.

For a target under a blocked user/global candidate, a project alias must not use the global-root exception to bypass that candidate's policy; require independent explicit target approval or remain blocked. File ownership and readability are not equivalent to project trust.

## 5. Proposed data contracts and identity

### 5.1 Pure shared types

The following sketches are proposed data shapes, not drop-in replacements for current exported interfaces. Place pure types under `src/entityTypes/`; shared scanner/parser code must remain free of main-process imports.

```typescript
export type PortableMetadataValue =
  | null
  | boolean
  | number
  | string
  | readonly PortableMetadataValue[]
  | { readonly [key: string]: PortableMetadataValue };

export type SkillSourceKind =
  | "workspace-native"
  | "workspace-shared"
  | "user-native"
  | "user-shared"
  | "user-config";

export interface SkillSourceDescriptor {
  readonly sourceId: string;
  readonly kind: SkillSourceKind;
  readonly scope: "workspace" | "user";
  readonly logicalRoot: string;
  readonly canonicalWorkspaceHash: string | null;
  readonly sourceRank: number;
  readonly ownership: "external" | "mixed-native";
}

export interface PortableSkillCandidate {
  readonly candidateId: string;
  readonly sourceId: string;
  readonly logicalRelativePath: string;
  readonly canonicalRoot: string;
  readonly skillMarkdownPath: string;
  readonly contentHash: string;
  readonly name: string;
  readonly description: string;
  readonly sourceGeneration: number;
  readonly scanEpoch: number;
  readonly valid: boolean;
}

export interface SkillRequestPolicyContext {
  readonly conversationId: string;
  readonly workspaceBindingId: number | null;
  readonly canonicalWorkspaceHash: string | null;
  readonly bindingEpoch: number;
  readonly policyEpoch: number;
  readonly catalogRevision: number;
}
```

Keep compatibility/diagnostic/manifest details in additional typed fields. Use `unknown` at unvalidated worker and IPC boundaries, then validate. Never introduce `any`; all implemented functions require explicit return types.

### 5.2 Identity rules

- `canonicalWorkspaceHash`: hash of normalized canonical project path under the existing profile-local DB. It is the trust key, not the Git-derived memory grouping key.
- `sourceId`: versioned hash of scope, canonical project identity when applicable, source kind, and normalized logical root. Do not derive it from a skill name or content hash.
- `candidateId`: versioned hash of source ID plus normalized logical relative skill-directory path. Editing metadata or changing the declared name does not change it.
- `canonicalFileKey`: canonical `SKILL.md` realpath identity used for alias grouping, not as the sole candidate identity.
- `targetApprovalKey`: project hash + logical source/location + canonical target. Changing the target invalidates that approval.
- `contentHash`: SHA-256 of raw `SKILL.md` bytes; a revision, not identity.
- `resourceManifestHash`: hash of the sorted, bounded activation manifest, including each relative resource path, canonical target, content hash or unavailable reason, and manifest completeness. It is computed on activation, not ordinary discovery.
- `activationRevision`: versioned hash of instruction `contentHash`, canonical target identity, and `resourceManifestHash`. This is the activation-idempotency key; a script-only update must change it even if the Markdown hash does not.

Normalize separators and platform-specific equivalence through a tested path helper. Preserve case on case-sensitive volumes. Do not lowercase every Unix path or assume Windows drive-letter normalization alone handles all case/UNC behavior.

Managed native entries reconciled to existing installation rows preserve their persisted installation ID and enabled state. Unmanaged entries use an `external-<candidateId>` installation-identity namespace; this does not create a managed installation row. Construct runtime IDs through the existing builder:

```text
User:       prompt:user:external-<candidateId>
Workspace:  prompt:workspace:<bindingId>:external-<candidateId>
Managed:    preserve existing persisted installation-ID contract
```

A raw project candidate can be shared by several chats attached to the same folder, but workspace runtime projections use each chat's actual binding ID. Maintain separate typed source and projection IDs. Do not parse a numeric workspace ID from an extended source string: the current `Number(sourceId.replace(...))` pattern would yield invalid or zero IDs with multiple source suffixes.

## 6. Portable frontmatter parsing

Add a dedicated parser adapter for portable skills rather than broadening every native config parser. Input is UTF-8 Markdown with optional BOM; YAML boundaries must be recognized at the document start with supported line endings. If an opening frontmatter delimiter exists but the closing delimiter or YAML data is invalid, report invalid frontmatter. Never treat that case as a plain instruction body.

### 6.1 Required support

- Scalar/quoted values, comments, block/folded descriptions, string sequences, and nested data mappings.
- Standard `name`, `description`, `license`, `compatibility`, `metadata`, and `allowed-tools` metadata.
- Existing `user-invocable` and `disable-model-invocation` controls with validated booleans; compatibility aliases must be deliberate and tested.
- Experimental `allowed-tools` string form and existing string-array compatibility form, normalized as declarations without permission grants.
- Unknown bounded data retained as `PortableMetadataValue`, including nested metadata, for diagnostics/future adapters.
- Strip accepted frontmatter from emitted instruction content while preserving the meaningful Markdown body and relative-path base.

New shared skills with no usable name/description are invalid candidates. Warn rather than silently sanitize recoverable naming deviations. Never make two names identical by destructive normalization. Preserve the existing native legacy fallback only for a file with genuinely absent frontmatter and an explicitly selected legacy compatibility mode; a malformed YAML block is always an error.

### 6.2 Parser safety and engine choice

Use a data-only schema: no constructors, arbitrary tags, code execution, object prototypes, remote includes, or implicit permission interpretation. Reject duplicate security-relevant keys, nonfinite numbers, excessive nesting, and oversized scalars/collections. Anchors/aliases must either be rejected through a syntax-aware parser policy or expanded under a proven hard bound. Do not implement alias protection through a regex over raw Markdown, which would misinterpret quoted prose.

The repository already declares `js-yaml`. Reuse it only if the adapter can demonstrate these bounds and data semantics with tests; otherwise add a directly declared parser dependency that provides the required controls. This engine-level choice is left to implementation within the acceptance contract, rather than depending on an unverified parser option. Never rely on a transitive dependency being present.

Unknown metadata is inert and never executable. Preserve original values for diagnostics without exposing full raw metadata to every model request. The parser must distinguish ordinary warnings from errors; one error affects one candidate, not the entire root.

## 7. Candidate storage, selection, and preferences

### 7.1 Retain candidates before projecting winners

Keep an in-memory `sourceId -> complete candidate set` store owned by a main-process coordinator. A validated source replacement is atomic. Registry publication is a projection of this store plus current policies and preferences.

The existing catalog's global `byRealPath` deduplication can discard a user candidate when a workspace alias is registered, and can affect another workspace's access to that global skill. Replace ingestion-time destructive deduplication with context-specific alias grouping. A single source refresh must not delete another source's raw contributions.

For one request context:

1. Resolve the actual conversation/binding through main-process services.
2. Select that workspace's candidates plus user/plugin/built-in candidates.
3. Validate source availability, current trust, target approval, enablement, metadata validity, compatibility policy, and the explicit/model invocation mode.
4. Group eligible canonical-file aliases within this context, preserving source records.
5. Rank by scope, then explicit source priority. Do not use enumeration order as priority.
6. Produce name-resolution groups, effective winners, overridden entries, and ambiguities.
7. Apply the metadata presentation budget to that mode's eligible results.

At the same exact source rank, different physical skills with one normalized lookup name remain ambiguous. Case-insensitive lookup may preserve the existing name behavior but must never rename candidates. Explicit IDs can select an eligible overridden candidate; they cannot cross scope or bypass trust/disable checks. Existing plugin/built-in reserved tool IDs remain protected.

Compute automatic and explicit views separately. For example, a project manual-only skill can win explicit lookup while an eligible global skill with the same name is the automatic-selection fallback. Explain the selection mode and source in management/activity. Do not rank first and then hide the manual-only winner in a way that makes the eligible automatic fallback disappear.

### 7.2 Persistent external preferences

Proposed `ExternalSkillPreference` storage:

| Field | Contract |
| --- | --- |
| `preferenceKey` | Unique versioned location or alias-group key. |
| `kind` | `candidate-location` or `canonical-group`. |
| `scopeKey` | `user` or canonical workspace hash; prevents one project's setting from silently changing another project's policy. |
| `sourceId` / `logicalRelativePath` | Location identity where relevant. |
| `canonicalFileKey` | Alias-group identity where relevant; never authorization by itself. |
| `enabled` | Explicit boolean; absence means default policy. |
| `revision` | Monotonic CAS revision for concurrent UI changes. |
| `updatedAt` | Local audit timestamp. |

Implement the entity/model/module using existing TypeORM patterns. Models own repositories; Modules use `BaseModule`, `Token`, and `USERSDBPATH`. IPC and workers do not query repositories.

Effective enablement is the conjunction of applicable managed-installation state, candidate-location preference, and canonical-group preference. A false value cannot be overridden by another alias. The group key is scoped to user or canonical project, so an explicit project override can have its own preference even when a global copy is disabled.

Disabling an effective external row writes a false group preference and false location preferences for its currently visible aliases in one transaction. Enabling the same row explicitly clears/sets true the current group's applicable preferences in one transaction and reports any remaining policy block. A new alias to a disabled canonical group remains disabled. A changed target retains its location's disabled preference but has a new target approval/revision. Keep missing-source preference rows as tombstones; scans never delete them. Managed installation lifecycle remains authoritative for owned files and is not silently merged with an unrelated external row by name.

## 8. Workspace trust, binding, and migration

### 8.1 Two independent state machines

Keep the existing workspace binding/file approval (`pending`, `approved`, `revoked`) distinct from a versioned project capability decision (`unknown`, `restricted`, `trusted`). An approved binding can legitimately have restricted project capabilities. This allows ordinary approved file operations without loading project-authored instructions.

In restricted mode, a user can explicitly ask to inspect `SKILL.md`, `AGENTS.md`, or another project capability file. The normal approved file reader may return its bytes as delimited lower-authority task data. Record disclosure purpose (`user-requested-task-data` versus `project-capability-guidance`) in provenance. An automatic skill lookup, a project file telling the agent to load another file, or a model request to activate a skill is not evidence of user authorization for this exception. Task-data reads never register definitions, create invocation attachments, enable hooks, or expand permissions.

Proposed trust additions, preferably extending the existing trust entity/model rather than creating competing authorities:

| Field | Meaning |
| --- | --- |
| `canonicalWorkspaceHash` / canonical path | Main-process verified trust identity. |
| `decision` | Unknown, restricted, or trusted. |
| `consentPolicyVersion` | Version of the user-facing trust meaning. |
| `decisionOrigin` | Explicit user decision versus legacy migration seed. |
| `capabilityFlags` | Existing instructions/commands/agents/hooks/skills flags. |
| `policyEpoch` | Persisted monotonic generation for authorization/context invalidation. |
| `decidedAt` | Timestamp for an explicit decision; absent for synthetic legacy consent. |

Audit all trust-hash producers and consumers so they receive the canonical project path. A lexical-path hash helper does not become canonical merely because a new column is named canonical. Migrate/reconcile aliases through one main-process identity service; do not keep parallel raw-path and canonical-path trust authorities.

First explicit Trust project sets instructions/commands/agents/skills true and hooks false. Explicit hook enablement remains separate. Restricted sets all project flags false. Advanced management can narrow individual flags; expanding a flag requires a user action, never a filesystem change.

### 8.2 Selection transaction

1. Main receives a folder-selection request, validates access and canonical identity, and creates a short-lived in-memory selection token bound to the current profile, conversation, and prior binding epoch.
2. Run bounded local metadata preview only. Return a current trust decision or a dialog payload; do not register project capabilities or mutate the active binding.
3. If a current remembered decision exists, explain it in the workspace UI and use it without a repeated modal. Otherwise accept only one of the three explicit choices for that token.
4. On Trust/Restricted, re-resolve the folder and compare identity. If changed, invalidate the token and refresh the dialog. Do not apply the previous target's decision.
5. Through a Module/Model transaction, create/approve the new binding, supersede old active rows, and save the explicit trust decision where needed. Preserve current binding and trust if the transaction fails.
6. Increment the conversation binding epoch, invalidate its old projected project context, then attach/publish the new policy-filtered sources.
7. Cancel/dismiss expires the token and leaves prior DB/runtime state unchanged.

The current `setWorkspace` creates a pending row that can become the newest row for a conversation. Do not call it before the dialog and assume cancellation is harmless. Add a narrow transactional finalization method or equivalent safe binding mechanism. A confirmed workspace switch invalidates old queued project actions; it is not permission for the new project's tasks to inherit old resources.

### 8.3 Migration policy

Legacy workspace approval and all-true migration flags have no new informed-consent provenance. Add versioned fields with defaults that leave new project capability policy unknown. In the same migration transaction, set the existing legacy capability-flag columns false for unknown/restricted decisions, so an older consumer cannot infer consent from leftover all-true flags. Preserve the existing file-approval records and managed installation IDs. New trusted writes maintain the existing flag columns consistently with current policy, including hooks false unless separately enabled.

On first interactive use/attachment of a legacy workspace, require the new decision before any project capability enters context. Until then, apply a restricted effective policy and leave automatic hooks disabled. Do not repeatedly seed missing versioned trust as all-true. Background/scheduled/subagent paths return a trust-required outcome without opening dialogs or silently consenting.

Apply schema updates through the application's actual desktop initialization path and any registered CLI migration path; verify both. Migrations must be idempotent. Downgrade/rollback preserves external files and preference records; do not equate a feature flag rollback with restoration of revoked capability flags.

## 9. Authorization barriers and revocation

### 9.1 Trust filtering before registry mutation

Add explicit `promptSkills: trust.skills ? snapshot.promptSkills : []` semantics at the workspace apply boundary, alongside existing capability filters. This small change is necessary but insufficient: scope, preferences, target approvals, and current epochs must also be enforced by catalog resolution and resource/activation services.

Do not apply raw workspace snapshots through the unrestricted global apply path. Typed source descriptors determine whether filtering is required; no authority is inferred from string prefixes. A no-longer-trusted source publishes an empty effective contribution while raw candidates remain in local management state.

### 9.2 Dispatch policy lease

Each assembled provider request, activation, resource read, delegated task, and tool dispatch captures the policy context: conversation, binding epoch, canonical workspace, source/candidate revision, policy epoch, and catalog revision where relevant.

Before provider serialization and immediately before starting an action, recheck the authoritative policy. Serialize the short authorization-and-start decision with trust mutation in the main process; do not insert an unguarded await between a final allow check and execution start. Never hold a DB transaction or dispatch lock over a model/network/process lifetime.

On revoke or a capability-specific disable:

1. Enter an immediate in-memory deny barrier for the affected canonical project/capability.
2. Persist the narrowed policy and incremented epoch through a Module/Model transaction.
3. Invalidate affected per-chat projections, request caches, activations, resource handles, and queued/delegated work across all bindings for that project.
4. Abort owned in-flight requests/processes best effort; mark late completions stale. New tool dispatch cannot proceed under the old lease.
5. Publish authoritative trust state and an activity notice after persistence. Report persistence failure honestly; keep the current process restricted pending reconciliation and do not claim a durable revoke succeeded.

The revocation acknowledgement means no subsequent application-dispatched action may use the old authorization. It cannot retract already transmitted data or reverse commands already started. The same barrier applies to a switch away from a workspace for the switching conversation, without revoking trust globally for other chats that remain there.

### 9.3 Context and compaction provenance

Extend invoked-skill attachments and derived context records with source ID, candidate ID, content hash, resource-manifest hash, combined activation revision, canonical project hash when applicable, binding epoch, and policy epoch. Derived summaries/compaction artifacts retain the union of input dependencies. Agent inheritance carries the same dependency and policy set; child agents cannot mint authority from skill content.

Also retain the disclosure purpose. Independently user-requested file-inspection data is governed by the still-current workspace file approval and remains untrusted data; it cannot become project guidance because a later summary drops its original wrapper. Project capability revocation does not itself revoke ordinary file approval. Mixed/unknown purpose inherits the stricter capability-derived classification when provenance cannot separate it.

At every provider assembly:

- Filter attachments whose source is disabled/removed, whose project is revoked or no longer bound, or whose lease/revision is invalid.
- Exclude summaries, normalized instruction caches, automatic memories, and delegated results derived from those attachments until rebuilt from eligible inputs.
- If a prior assistant/tool message may contain copied skill instructions, do not assume removing the original attachment is enough. Use provenance to exclude/rebuild contaminated machine-generated context. When provenance is missing, conservatively rebuild from before the earliest affected activation/project-instruction exposure, retaining subsequent explicit user messages but withholding dependent machine-generated messages.
- Preserve the full local historical transcript/audit for the user; mark it excluded from future model context where needed. Do not delete explicit user-authored messages or unrelated user memories.
- Apply the same filtering to retries, resumed conversations, queued turns, compaction rehydration, subagents, and restored sessions.

Expose a notice when rebuilding context causes prior generated content to be omitted. A background summary cannot reintroduce revoked text by changing its record type or losing provenance.

## 10. Activation, resources, and revision coherence

### 10.1 Reuse the existing activation path

Keep `use_skill` as instruction activation only. Existing mutation rejection, secret-shaped argument checks, explicit/model invocation flags, context budgets, structured acknowledgement, and lower-authority instruction wrapping remain in force. Add current source/trust/preference checks before loading and before attachment persistence.

Re-read `SKILL.md`, verify current target/hash and catalog eligibility, then build/validate the bounded resource manifest before applying activation idempotency. Compare the combined `activationRevision`, not the Markdown hash alone. On the same combined revision and eligible active attachment, return already-loaded. On changed instructions, canonical target, or resources, return a visible stale/reload result containing the current proposed activation revision.

Extend the activation contract with an optional `expectedActivationRevision` for a deliberate reload. A new activation with no existing attachment loads normally; a same-revision repeat remains idempotent. If an existing attachment is stale, the next deliberate call supplies the revision returned by the stale result. Recompute/verify that revision and replace the old attachment only if it still matches; otherwise return a new stale outcome. Both an explicit UI reload and an explicit model tool call can perform this transition without inventing a permission prompt. Target or trust changes still require their own authorization.

Persist the combined revision and resource-manifest hash on invocation state and carry them on attachments/resource handles. Existing saved activations that lack this provenance must be revalidated through the new path; never assume their unchanged Markdown hash proves their resources are unchanged. Update uniqueness/deduplication checks that currently use only `contentHash`, and replace/invalidate the prior revision instead of appending contradictory versions.

The model-facing activation entry identifies the chosen source and version/hash. System-owned policy remains higher authority than skill text, including any instruction claiming that its own tools are pre-approved.

### 10.2 Resource containment

Resource list/read requests accept an eligible runtime ID and a relative resource path, never an arbitrary renderer/model-provided absolute root. Main resolves the ID under the current chat context, verifies the source target again, canonicalizes the requested file, and checks containment in the authorized skill root or revision snapshot. Reject traversal, NULs, unexpected absolute paths, escapes through resource symlinks, and policy-invalid handles.

Global resources use the narrow skill-root service. Do not add the home directory or global skill tree to `FileToolService` workspace roots. Resource authorization is read-only and gives no general-purpose write/delete capability.

### 10.3 Pinning and operation staging

Instruction pinning alone does not make an arbitrary directory immutable. The implementation must distinguish:

1. An immutable instruction attachment containing the exact activated Markdown hash.
2. A bounded activation resource manifest recording canonical paths and content hashes for resources eligible for pinned use.
3. An operation resource snapshot containing the exact bytes a resource-backed action will read or execute.

Build the activation resource manifest on demand, after authorization, under the limits in section 13. Include resources outside the conventional three directories when explicitly included by the supported skill format. Record oversized/unreadable resources as unavailable for pinned operations instead of silently considering them verified. No full resource hashing occurs during ordinary metadata discovery.

Before returning a resource or preparing an operation, verify that it matches the activation manifest; a new or changed resource requires a new combined activation revision and a change notice, including when Markdown is unchanged. For supported execution routes, stage the required verified files together into an application-owned bounded temporary snapshot, preserve relative layout and necessary executable metadata, and use those staged paths/handles. Keep them tied to the active policy epoch and activation revision. Do not execute a later re-read from the mutable original source path.

An operation that needs more resources must verify and stage them under the same activation manifest. A change detected during staging aborts preparation; do not assemble a partial old/new snapshot. Delete owned temporary snapshots after their lease expires, operation completes, or trust is revoked; never delete the original source files. Snapshot cleanup is best effort with bounded startup cleanup for orphaned snapshots.

This is a consistency boundary for supported AiFetchly resource/execution routes, not an assertion that any arbitrary shell command is confined. If an execution route cannot bind to verified resources, report pinned skill-script execution as unsupported for that route and retain instruction-only operation. Shell/interpreter availability, network, credentials, and dependencies still pass existing tool permissions. Do not auto-run script entry points during activation.

## 11. Refresh, watchers, and concurrency

### 11.1 Watch ownership

Keep watch-specific code in `src/childprocess/`. Extend the existing config worker protocol or add a dedicated worker only if isolation/lifecycle needs justify it. Any new entry point must be registered in Forge/Vite build configuration. Do not put worker initialization or chokidar ownership in `src/modules/`.

The main process owns a reference-counted source/watch table. Several chats using one canonical project may share a raw scan/watch, while each has a separate binding projection. Canonically identical global roots may share watcher resources without losing logical-source priority.

Watch supported roots and approved linked targets only. For a missing root, use the nearest existing ancestor with nonrecursive or tightly filtered child-entry watching; progressively attach narrower watches as path components appear. A home-level parent watch must never recurse through home contents. After directory creation, perform an initial bounded scan to cover files created before the watcher attaches.

Retain 500 ms write stabilization/debounce and atomic-save handling as starting defaults. Bound link-following/watch counts separately from scan depth. Deletions, target changes, permission changes, and watch errors trigger availability reconciliation. Do not follow every external link merely because a watcher library defaults to following symlinks.

### 11.2 Worker protocol and stale-result rejection

Proposed messages include:

```text
main -> worker: watch-skill-source(sourceDescriptor, scanEpoch)
main -> worker: rescan-skill-source(sourceId, scanEpoch, reason)
main -> worker: unwatch-skill-source(sourceId, scanEpoch)
worker -> main: skill-source-snapshot(sourceId, scanEpoch, generation,
                                     candidates, diagnostics, completeness)
worker -> main: skill-source-error(sourceId, scanEpoch, generation, code)
```

The main process validates payload shape/size, source existence, epoch, monotonic generation, expected scope/root, and canonical path policy before reconciliation. A worker-supplied source ID does not authorize an arbitrary root or binding. Re-read critical target/hash facts before activation because scanner output is not an execution authorization.

Reject results older than the latest requested generation, from a previous worker epoch, or for a removed source. Trust/preference changes always trigger projection from current policy, not the policy captured when scanning began. Do not publish a trusted snapshot after a revoke just because its file generation is new.

### 11.3 Failure semantics and publication

Publish complete candidate replacements per source with a monotonically increasing catalog revision. A partial scan retains only currently validated candidates and marks the source partial; do not advertise stale candidates as usable. On a wholly unavailable source, remove its effective contribution, retain its last metadata as unavailable for UI inspection, and preserve preferences. Every activation still verifies the file.

Batch independent sources where safe, but never hold DB transactions while scanning. Reconcile managed installation matches and external preferences main-side before publication. Avoid fire-and-forget delete/reinsert patterns that race disabled-state persistence. Worker restart or explicit refresh rebuilds sources idempotently without resetting preference or trust epochs.

When watchers are deliberately disabled, provide explicit refresh and a bounded pre-request freshness check for subscribed sources; do not state that every external change is instantly detected. Activation/resource hash checks remain mandatory. Cache those checks only within a single immutable prepared operation, not across arbitrary filesystem changes.

## 12. Management, model disclosure, and IPC

### 12.1 Unified management projection

Return a paginated inventory view combining existing owned installation records and external candidate metadata. Keep `kind`, `ownership`, `scope`, trust, enablement, compatibility, selection, and source availability as independent fields. A single status string is a convenience derived from these fields, not the persistence model.

Suggested external actions: toggle eligibility, inspect local plain-text instructions, reveal location, refresh source, and approve a specific external target. Existing owned-installation actions remain routed to their established lifecycle service. Do not fabricate managed installation IDs or route external deletion to `uninstall`.

Model metadata and management inventory are different projections. An untrusted project can appear in a local management preview without appearing in a provider request. Metadata overflow must not be silent: preserve existing catalog presentation bounds and supply a scoped `list_available_skills` paging/search tool or equivalent existing discovery surface over all eligible retained candidates. Search is deterministic and never a cloud query over untrusted local descriptions.

For explicit versus automatic selection, apply invocation flags independently: manual-only skills remain reachable by the user while excluded from automatic selection metadata; non-user-invocable skills are not offered in command autocomplete. Both paths share the same current authorization resolver.

### 12.2 Proposed IPC surface

Names are proposed contracts to reconcile with existing workspace/skill channels during implementation.

| Operation | Input | Output/effect |
| --- | --- | --- |
| Prepare workspace selection | Conversation ID, selected folder handle/path, expected binding epoch | Main-verified selection token, canonical display path, remembered decision, bounded preview. |
| Complete workspace selection | Selection token, trust/restricted/cancel, expected epoch | Authoritative binding/trust view after commit; cancel changes nothing. |
| Get/set project trust | Main-resolved binding/project handle, explicit decision/capability narrowing, expected policy epoch | Versioned policy; stale writes return a conflict. |
| List skill inventory | Optional active conversation, filters, cursor, bounded page size | Managed/external rows, candidates, diagnostics, revision/completeness. |
| Toggle external skill | Runtime/candidate ID, desired enabled state, expected preference revision | Updated authoritative preference/projection. |
| Refresh skill sources | Main-known source IDs or current-chat scope | Accepted refresh and later revisioned update event. |
| Preview/reveal external skill | Candidate ID | Bounded plain text or OS reveal for a main-resolved authorized location. |
| Approve linked target | Project-bound candidate handle, expected target and policy epoch | Exact target approval after explicit user action. |

Validate IPC with existing schema conventions and sanitize output. Renderer input is never authoritative for canonical roots, project hashes, trust identity, or ownership. Bound page sizes, cursors, preview text, and diagnostic text. Expire selection/target approval tokens and prevent reuse across profiles/chats.

AI-serving handlers check `Token`/`USER_AI_ENABLED` before parsing AI payloads or starting work, returning the repository-standard `{ status: false, msg, data: null }` when disabled. Read-only local settings/management handlers can remain usable when AI is disabled; they must not dispatch model work. Keep this distinction explicit rather than accidentally blocking users from revoking trust while AI is off.

Publish narrow revisioned events for inventory, trust, and workspace binding changes. The renderer ignores older revisions and re-fetches after reconnect. Do not send instruction bodies in broad inventory-change broadcasts.

### 12.3 UI integration

Use existing workspace selector/trust components and skills screens where possible. The dialog must clearly distinguish Trust project, Continue without trust, and Cancel; default focus must not accidentally consent on Enter. Show canonical location for aliases and capability counts with an incomplete-scan indicator. Preview is inert plain text.

Show source and override explanations in details and activation activity. Enable/disable failures restore the authoritative state and show a localized actionable error. Restricted mode remains visible near the workspace selector with a route to change trust. Automatic hooks have a separate control explaining their trigger behavior.

All new UI keys belong in `src/views/lang/{en,zh,es,fr,de,ja}.ts`, with `t()` and an English fallback. Component tests cover rendering, loading/error/disabled states, all three trust choices, keyboard focus, and preference/override behavior. Critical cross-component flows also receive Electron Playwright coverage.

## 13. Proposed limits and compatibility evaluation

These are implementation defaults to validate with fixtures, not current measured behavior. Keep them in one tested configuration contract and expose diagnostics when bounds apply.

| Boundary | Initial default |
| --- | --- |
| Skill-directory depth | 4 under a registered skills root. |
| Visited directories | 2,000 per root per scan. |
| Retained candidates | 1,000 per root, deterministic order; overflow is partial scan. |
| Raw `SKILL.md` | Existing 256 KiB maximum. |
| Frontmatter | 64 KiB, nesting depth 16, at most 10,000 bounded data nodes. |
| Aggregate Markdown bytes per root scan | 16 MiB; report partial when exhausted. |
| Scan deadline | 10 seconds per root, cancellable; reference performance target is much lower. |
| Watch stabilization/debounce | Start from existing 500 ms defaults. |
| Linked watch targets | 128 per root; excess targets need explicit refresh and remain reported. |
| Model-facing metadata | At most 100 entries and 8,000 estimated tokens, whichever is reached first; scoped paging/search reaches remaining eligible entries. |
| Activation instruction budget | Existing defaults: 16,000 total available, 8,000 per skill; actual provider/context budget can be smaller. |
| Activation resource manifest/snapshot | At most 2,000 regular files and 64 MiB total hashed/staged content; unavailable oversized resources are diagnosed. |
| Inventory page | Default 50, hard maximum 200 rows. |
| Local preview | At most 256 KiB with explicit truncation. |

The candidate-store bound and metadata presentation bound are different. Refactor the current catalog's 100-entry ingestion cap so it does not silently discard otherwise retained candidates. Resources exceeding pinning bounds may remain identified in management, but resource-backed operations requiring them are unavailable; instruction-only guidance can still be eligible.

Compatibility evaluation is conservative and side-effect free. It can compare declared requirements against registered tool availability and existing dependency-catalog facts. Do not run shell probes, package managers, remote downloads, credential checks, or a skill's own health script during discovery. Report requirements as unverified where static checks cannot establish them. A declared `compatibility` prose string is not a machine-verifiable dependency list.

Retain unsupported client-specific fields for explanation. Implement explicit tool-name or execution adapters only when their semantics can be honored. `allowed-tools`, `context: fork`, hooks-like metadata, and arbitrary environment declarations never create new tools, workers, trust grants, or secrets.

## 14. Diagnostics and observability

Proposed stable error families:

| Code family | Meaning / recovery |
| --- | --- |
| `SKILL_SOURCE_UNAVAILABLE` | Missing permissions/target; show source and refresh action. Ordinary never-created root is an informational absence. |
| `SKILL_SCAN_PARTIAL` / `SKILL_SCAN_LIMIT` | Depth/time/count/byte bound reached; show completeness and bounded evidence. |
| `SKILL_FRONTMATTER_INVALID` | Portable parser failed; correct local file and refresh. |
| `SKILL_METADATA_WARNING` | Recoverable naming/unknown-field issue; retain candidate where usable. |
| `SKILL_REQUIRES_PROJECT_TRUST` | No current project policy; direct user to trust management. |
| `SKILL_REQUIRES_TARGET_APPROVAL` | External project link target not authorized. |
| `SKILL_DISABLED` / `SKILL_AMBIGUOUS` | User preference or unresolved equal-rank name. |
| `SKILL_REQUIREMENT_MISSING` / `SKILL_COMPATIBILITY_UNVERIFIED` | Host capability limitation; no automatic repair. |
| `SKILL_REVISION_STALE` | Markdown/resource/target changed; refresh and deliberately reactivate. |
| `SKILL_POLICY_STALE` | Binding/trust changed; stop and re-resolve policy. |
| `SKILL_RESOURCE_SNAPSHOT_LIMIT` | Required pinned resource exceeds bounds or cannot be staged. |
| `WORKSPACE_SELECTION_STALE` / `TRUST_WRITE_CONFLICT` | Token or expected revision changed; re-fetch before user action. |

Map existing runtime error codes to these views where possible rather than breaking established consumers. Do not replace detailed errors with successful empty lists. Local logs record source kind, stable IDs, timing, counts, revisions, and bounded codes; raw Markdown, arguments, credentials, and full home paths are excluded from routine telemetry. User-requested diagnostics may show local paths explicitly. This feature introduces no remote telemetry transport.

## 15. File-level implementation outline

This is a dependency outline, not authorization to implement in this documentation change.

| Area | Proposed changes |
| --- | --- |
| Pure contracts | Extend `promptSkillTypes.ts` and config snapshot types; add typed source/candidate/provenance contracts. |
| Pure discovery/parser | New `src/service/skillSources/PortableSkillScanner.ts`, `PortableSkillFrontmatterParser.ts`, and source-limit/path helpers. Shared by main/worker without DB imports. |
| Worker lifecycle | Extend `src/childprocess/aifetchly-config/` watcher and scan protocol for skill sources; keep all worker-specific code there. |
| Main coordination | New `SkillSourceCoordinator` and candidate/projection index under `src/service/`; integrate native config and workspace watch managers. |
| Persistence | Add external preference and exact-target approval entities/models/modules; extend existing trust provenance/version/epoch fields. Register both desktop and migration schema paths. |
| Binding/trust | Extend `WorkspaceModule`/Model with transactional selection finalization; update existing trust module and legacy seeding. |
| Runtime | Refactor candidate retention/deduplication, explicit source ranks, per-binding definitions, and all lookup checks; retain `use_skill`. |
| Context | Add provenance and epoch filtering to attachments, compaction, retries/resume, memory derivation, and delegated tasks. |
| Resources | Extend existing resource service for active revision manifests and bounded temporary operation snapshots where execution integration supports them. |
| IPC/preload/API | Add validated selection/trust/external-inventory operations through existing bridge conventions. |
| Renderer | Extend current trust/workspace selector and skill management surfaces; translate all six locales and add same-change tests. |

Any proposed helper serving DB business logic belongs in a Module that delegates to a Model. No IPC handler or worker may instantiate a TypeORM repository directly. No database path may be derived directly from Electron `userData`; use the existing Token/USERSDBPATH path management.

## 16. Verification and requirement traceability

### 16.1 Automated coverage

| PRD requirements / scenarios | Required test focus | Suggested placement |
| --- | --- | --- |
| FR-01, FR-02; AC-01, AC-02, AC-11, AC-12, AC-13, AC-16 | Root construction, XDG validation, nested collections, limits, missing roots, link loops, YAML blocks/maps, malformed versus absent frontmatter. | Pure scanner/parser tests under `test/vitest/main/` or the existing service test suite. |
| FR-03, FR-04; AC-03, AC-04, AC-05, AC-06 | No pre-trust context; restricted approved binding; cancel preserves prior workspace; hooks remain separate; failed transaction rollback. | Main service/Module tests and workspace trust component tests. |
| FR-05, FR-06; AC-07, AC-14, AC-15, AC-24 | Canonical path identity, explicit versus legacy consent, shared-project chats, revoke barriers, queued scans, direct-ID access, restored/compacted/delegated context. | Main/database integration and critical Electron E2E. |
| FR-07; AC-08, AC-09, AC-17, AC-22 | Full priority matrix; equally ranked ambiguity; retained fallback; two workspaces aliasing one global realpath; no cross-binding lookup. | Catalog/projection/authorization tests. |
| FR-08, FR-09; AC-18, AC-19, AC-21, AC-23 | Flags, catalog paging/search, strict scoped resources, unknown tools, hash changes, pinned operation bytes, mutation rejection. | Invocation/resource/context integration tests. |
| FR-10; AC-01, AC-13, AC-15, AC-16 | Atomic saves, linked-root retarget, missing ancestor appearance, stale generations/worker epochs, watch restarts, reference counts. | Watch worker protocol tests with temporary directories. |
| FR-11, FR-12; AC-09, AC-10 | Unified inventory; managed identity preserved; alias disable persistence; rename/body edits; source loss/reappearance; no external file writes/deletes. | Preference Module/Model and component tests. |
| FR-13; AC-20 | Six-locale keys, keyboard actions, accessible dialog, focus restoration, unavailable/partial/error states. | `test/vitest/main/components/` and `test/e2e/specs/`. |

Tests must assert absence of automatically disclosed unauthorized capability bytes in the actual serialized provider request, not only absence of an inventory row. Separately verify that an explicit user-requested instruction-file read is carried as untrusted task data and never becomes an activation or gains execution authority. Race tests pause scans, persistence, provider assembly, and queued tool dispatch around revocation to verify the barrier. A key regression fixture has two chats, two canonical projects, duplicate names, and a shared global realpath; one project's alias must not remove the other chat's global candidate.

Revision tests change Markdown and, in a separate case, only a script/reference between discovery, activation, resource read, staging, and execution preparation. A same-Markdown resource edit must change the combined revision, produce stale instead of already-loaded, and permit the next deliberate expected-revision reload. Verify that no changed original bytes are used after a pinned snapshot is selected, and that unsupported execution routes report their limitation rather than claiming isolation.

### 16.2 UI/E2E gates

All renderer changes require matching component tests committed in the same implementation unit. Critical selection/trust/revocation, workspace switching, global discovery, disabled persistence, and source-explanation flows receive Electron E2E coverage. Include trust revoked after compaction and a restart/resume case. Native symlink/junction tests need OS-specific fixtures; a mocked POSIX link is not Windows evidence.

Suggested verification commands, selected for the actual changed files:

```text
yarn testmain
yarn test:components
yarn typecheck
yarn vue-typecheck
yarn build
yarn test:e2e
```

Run focused scanner/catalog/database suites through the repository's corresponding test runner as well. The commands above are future implementation gates, not results produced by this document change. Do not run the repository's watch-mode `yarn tsc` as a finite CI check.

### 16.3 Operator/CI evidence

Packaged worker entry resolution, process shutdown, application permissions, links/junctions, and filesystem behavior require Windows/macOS/Linux operator/CI evidence. Local `yarn package`, `yarn make`, and any equivalent Electron Forge packaging are forbidden by project guidance. Use safe `yarn build` and `yarn build:e2e` locally; record missing packaged evidence as pending/environment-blocked. Do not bypass the packaging restriction to satisfy this document.

## 17. Rollout, rollback, and decisions

### Delivery order

1. Pure source scanner/parser, identity, candidate retention, source priority, and preference persistence.
2. Versioned trust and transactional selection, prompt trust filter, context provenance/revocation, and execution barriers.
3. Global/workspace watcher lifecycle, stale-publication protection, link-target approvals, and operation-resource consistency.
4. Unified inventory, model metadata overflow discovery, accessible trust UI, six-language strings, and explicit activation explanation.
5. Migration/restart/concurrency tests, performance fixtures, and cross-platform release evidence.

Project-path discovery cannot ship model-active before stage 2. Instruction-only compatibility can ship with honestly reported unsupported execution routes; do not mark script-dependent workflows fully supported without verification.

### Rollback

- This section covers disabling/reverting the feature inside a binary that still enforces versioned trust, current capability flags, and context provenance. A binary downgrade is a separate operator/CI compatibility gate; do not promise that an older release can enforce fields or hidden-context filtering it does not understand.
- Disable new source publication without deleting external files or dropping preferences/trust decisions.
- Keep effective revocation and legacy-policy restrictions enforced while old/new catalogs coexist during rollout.
- Remove/invalidate new-source activations from future context when disabling the feature; do not retain hidden behavioral effects.
- Preserve managed native IDs, executable registry behavior, plugin namespaces, and existing explicit imports.
- Schema changes are additive where possible; migration rollback must not convert restricted decisions into all-true legacy flags.
- Clear legacy capability flags for unknown/restricted consent and retain them as false during feature rollback. A proposed binary downgrade must additionally verify stored activation/summary compatibility or invalidate incompatible derived context before use; if that cannot be established, do not approve the downgrade path as a trust-preserving rollback.

### Proposed engineering defaults and builder choices

| Topic | Decision |
| --- | --- |
| Source authority | Main-process constructed typed descriptors. |
| Candidate ownership | Raw source contributions retained; effective selection is per request context. |
| Project identity | Canonical path, profile-local; distinct from Git/memory grouping. |
| Consent | Versioned explicit decision; hooks separately enabled. |
| External state | Separate local preferences/target approvals; external files remain untouched. |
| Parser | Dedicated bounded data-only portable adapter; precise engine chosen by tests. |
| Revision consistency | Immutable instructions plus bounded resource manifests and staged operation bytes where supported. |
| Catalog overflow | Full bounded inventory plus eligible metadata paging/search; no silent ingestion loss. |
| Worker topology | Prefer extending existing config worker; builder may split it if lifecycle evidence justifies the extra process. |
| Public IPC names / component names | Reconcile with existing conventions without changing the specified behavior. |
| Trust prompt repetition | One explicit decision per canonical folder and policy version; visible status/actions on reuse. |

Remaining engine/component naming and fixture-tuned limits are delegated engineering choices within these contracts. Changes to remembered trust semantics, default hooks, source priority, ownership, or revocation guarantees are material product changes and require updating the PRD and design together.

## 18. References

- [Companion PRD and external standards references](2026-11-06-universal-agent-skills-and-project-trust-prd.md#16-standards-and-research-references).
- [Workspace-aware file tools PRD](../../prd/workspace-aware-file-tools-prd.md) and [technical design](../../prd/workspace-aware-file-tools-technical-design.md).
- [Natural-language skill installation PRD](../../prd/natural-language-skill-installation-prd.md) and [technical design](../../prd/natural-language-skill-installation-technical-design.md).
- [Repository development and architecture requirements](../../../AGENTS.md).

This document extends those foundations for automatic shared sources and explicit project trust. It does not replace their independent execution, credential, installation, or database-boundary requirements.
