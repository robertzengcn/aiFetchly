# Universal Agent Skills and Project Trust — Product Requirements

Status: Proposed; this document does not claim implementation or release readiness.
Date: 2026-11-06 (Asia/Shanghai).
Scope: Desktop skill discovery, project trust, prompt-skill use, refresh, and management.
Companion: [Technical design](2026-11-06-universal-agent-skills-and-project-trust-technical-design.md).
Related foundation: [Natural-language skill installation PRD](../../prd/natural-language-skill-installation-prd.md) and [technical design](../../prd/natural-language-skill-installation-technical-design.md).

## 1. Product decision and decision provenance

Users must be able to place or install portable Agent Skills in shared project and global directories and have AiFetchly discover them without a separate import, copy, or application restart. When a user selects a project as a workspace, AiFetchly must obtain an explicit project-trust decision before allowing project-authored capabilities to influence the AI.

This specification preserves the preceding discussion. Two requirements were explicitly requested by the user: shared-directory support, especially `.agents/skills/` and `~/.agents/skills/`, and a trust question when selecting a project. The detailed defaults below are design recommendations synthesized from that discussion and code investigation. They are proposed product decisions for review, not additional claims of user approval.

The defining distinctions are:

1. Selecting and authorizing a folder for workspace file operations is separate from trusting its AI instructions and automation.
2. Trusting project content is separate from authorizing tool execution, credentials, network access, or dependency installation.
3. Detecting a skill is separate from enabling it, making it visible to the model, and verifying its runtime compatibility.
4. Shared files remain owned by their existing installer or the user. AiFetchly consumes them in place.

## 2. Problem and intended outcome

Users already install skills through other AI clients, the `skills` ecosystem, Git repositories, and manual file operations. Requiring a second installation in AiFetchly creates duplicate copies, update drift, and uncertainty about which version is active. Project-specific skills also need to follow the selected workspace instead of leaking into unrelated chats.

The intended experience is:

> A user installs a research skill in `~/.agents/skills/`. AiFetchly discovers it and can activate it in an eligible chat. The user then selects a project containing `.agents/skills/research/SKILL.md`. AiFetchly asks whether to trust the project. After trust is granted, the project version takes precedence for chats using that project. A different project's chats retain their own skill selection. Disabling the shared skill in AiFetchly does not alter files used by another client.

## 3. Current baseline and implementation gaps

The source investigation for this proposal establishes the following baseline. The technical design provides the source map; these observations describe current code, not the promised end state.

| Existing capability | Gap this proposal closes |
| --- | --- |
| A portable prompt-skill catalog, `use_skill` invocation, hidden context attachments, and bounded resource helpers exist. | Shared folders should feed this runtime instead of creating another skill execution system. |
| The global config loader discovers `SKILL.md` under its native root, normally `~/.aifetchly/skills/`. | Additional shared global roots need discovery and live refresh. |
| The workspace scanner reads native `.aifetchly` configuration and executable skill manifests. | It does not currently emit equivalent portable project prompt-skill discoveries. |
| Workspace approval and per-capability trust records exist. | Selection, instruction trust, automatic hooks, remembered decisions, and migration need a consistent product contract. |
| Workspace synchronization filters instructions, commands, agents, hooks, and executable skills. | `promptSkills` must receive explicit trust filtering before registration. |
| The existing frontmatter parser intentionally supports a restricted format. | Valid portable YAML, including multiline descriptions and nested metadata, can fail parsing. |
| Catalog scope precedence and realpath deduplication exist. | Same-scope source priority, retention of fallback candidates, and source-aware management need extension. |
| Skills screens are backed by legacy or managed-installation records. | Externally discovered skills can be usable without appearing in those listings or having durable enable/disable preferences. |

## 4. Goals, non-goals, and anti-goals

### Goals

- Discover shared skills automatically while retaining native, plugin, and built-in support.
- Ask for informed project trust before loading project-derived AI capabilities.
- Keep source selection deterministic and understandable.
- Preserve cross-chat workspace isolation, saved disabled states, and external file ownership.
- Support the portable `SKILL.md` format, linked directories, and bundled resources.
- Refresh installations and updates without restarting the application.
- Provide clear availability, conflict, compatibility, and error states.
- Deliver complete translations and automated tests for all affected UI.

### Non-goals for this release

- Replacing existing executable skills, installation orchestration, or permission systems.
- Installing, upgrading, repairing, or removing shared packages during discovery or activation.
- Automatically installing dependencies or accepting credentials from skill metadata.
- Guaranteeing that every tool name or client-specific workflow in an arbitrary skill is supported.
- Automatically loading every discovered instruction body into each chat.
- Automatically scanning ancestor repositories, every child project, arbitrary home directories, or all client-specific skill locations.
- Making `AGENTS.md` itself a skill or introducing new project-instruction file conventions.
- Treating an arbitrary skill script as a new trusted Electron extension or worker entry point.
- Synchronizing trust decisions or external-skill preferences between machines.

### Anti-goals

- A fresh clone silently contributes AI guidance or automation before trust is granted.
- A shared installation is rewritten or deleted by an AiFetchly management action.
- A rescan re-enables a skill the user disabled.
- The same skill name selects different sources depending on scan order.
- Revoked instructions continue to reach later requests through saved context or summaries.
- A discovered skill is advertised as fully functional merely because its Markdown parsed.

## 5. Terminology

| Term | Meaning |
| --- | --- |
| Portable prompt skill | A directory whose instruction entry is `SKILL.md`, optionally containing scripts, references, assets, and other resources. |
| Executable skill | An existing AiFetchly manifest-based executable capability; its current runtime remains distinct. |
| Workspace binding | A chat's approved association with a local folder for the existing file-access workflow. |
| Project trust | A remembered local decision about project-authored AI capabilities for a canonical folder and trust-policy version. |
| Source | A specific discovery root and scope, with stable identity and explicit priority. |
| Candidate | One detected skill from one source, including overridden, disabled, or invalid entries. |
| Effective skill | An eligible candidate selected for a particular chat after trust, enablement, compatibility, precedence, and deduplication. |
| Activation | Loading a selected skill's instructions into model context; activation is not script execution. |
| Externally managed | Files installed or maintained outside AiFetchly's managed installation lifecycle. |
| Revision | A fingerprint combining the instruction hash, canonical target, and bounded resource-manifest hash used by an activation. |

## 6. Personas and user stories

| ID | Story | Observable result |
| --- | --- | --- |
| US-01 | I already installed a global skill through another client. | It appears in AiFetchly without import or copy. |
| US-02 | My team commits project-specific skills. | Trusted workspace chats use them; unrelated chats do not. |
| US-03 | I want to inspect a newly downloaded project first. | I can continue without project trust and retain the existing approved file-access controls. |
| US-04 | I maintain a skill through a linked Git checkout. | AiFetchly follows the supported link, refreshes changes, and explains blocked or broken links. |
| US-05 | I disabled a noisy shared skill only in AiFetchly. | The preference survives restart and does not change other clients. |
| US-06 | Two sources provide the same name. | I can see the active source, the overridden version, and the reason. |
| US-07 | I revoke trust after using a project skill. | Future requests and project-triggered actions exclude that project's revoked capabilities. |
| US-08 | A skill needs a tool unavailable in AiFetchly. | Its instructions may remain useful, but the missing capability is clearly reported. |

## 7. Discovery contract

### FR-01 — Supported roots

| Scope | Root | Priority within scope |
| --- | --- | --- |
| Workspace | `<workspace>/.aifetchly/skills/` | 1: native |
| Workspace | `<workspace>/.agents/skills/` | 2: shared |
| User | `~/.aifetchly/skills/` | 1: native |
| User | `~/.agents/skills/` | 2: shared |
| User | `<config-home>/agents/skills/` | 3: compatibility |

`<config-home>` is an absolute `XDG_CONFIG_HOME` when configured; otherwise it is `~/.config`. Relative values are ignored with a diagnostic. Resolve `~` through the operating system home-directory API. Never use the application's launch directory as the project root.

The project path convention and the skill format are related but distinct: the format specification does not mandate installation locations. The extra config-home root addresses the current installer convention for its Universal target. This compatibility decision is documented and testable rather than inferred from a marketing label.

### FR-02 — Supported layouts and bounded discovery

- Support `<root>/<skill-name>/SKILL.md` and linked skill directories.
- Support bounded collection nesting, such as `<root>/gstack/review/SKILL.md`, because collections can place several skills beneath one shared folder.
- Continue looking for nested skill directories even when a collection root has its own `SKILL.md`; exclude resource/build directories from traversal.
- Match the entry filename exactly as `SKILL.md`; warn about a casing-only mismatch on filesystems that allow detecting it.
- Ignore unrelated files. Skip `.git`, `node_modules`, build/cache directories, and resource subtrees such as `scripts`, `references`, and `assets` during discovery. These remain available through bounded resource access after activation.
- Bound depth, visited directories, candidates, bytes, and scan time. Reaching a limit produces an explicit diagnostic; the management UI must not imply the scan was complete.
- One malformed or unreadable skill must not prevent other skills from being discovered.
- Absent roots are normal. No directories are created merely to scan them.

## 8. Workspace selection and trust

### FR-03 — Explicit selection decision

Before a newly selected project can contribute AI instructions, skills, agents, commands, or hooks, obtain an explicit trust decision. This is required even when no skill is detected: project capabilities may be added later.

Proposed dialog:

> **Do you trust this project?**
>
> This project may contain AI instructions, skills, and automation that influence AiFetchly's behavior. Enable them only if you trust the project's authors.
>
> Folder: `<selected folder>`
>
> Detected: `<bounded capability summary; scan may still be in progress>`
>
> **Trust project** · **Continue without trust** · **Cancel**

Use an application-owned dialog with keyboard access, accessible labels, focus management, and a neutral default focus. Opening a folder picker, closing the dialog, or waiting does not constitute trust.

### FR-04 — Choice semantics

| Choice | Workspace file binding | Project capability policy | Existing workspace |
| --- | --- | --- | --- |
| Trust project | Approve the selected folder through existing file-access rules. | Enable instructions, skill availability, command availability, and agent-definition availability. Automatic hooks remain separately disabled until explicitly enabled. | Switch only after the new binding and decision are committed. |
| Continue without trust | Approve the selected folder through existing file-access rules. | Disable all project-derived AI capabilities. Global/plugin/built-in capabilities remain subject to their own policies. | Switch after the restricted binding is committed. |
| Cancel/dismiss | Create no active replacement binding and grant no trust. | No change. | Preserve the prior workspace and its policy. |

Availability of a command or agent definition does not authorize running it. Trust never bypasses existing deny rules, approvals, tool allowlists, file boundaries, or credential controls. Automatic hooks require a separate control and follow existing execution permissions.

### FR-05 — Persistence, identity, and scope

- Remember trusted and restricted decisions locally for the current application profile and canonical project folder, including the trust-policy version.
- Reopening the same canonical folder with a valid remembered decision shows its trust status without repeating a modal on every chat.
- An alias resolving to the same canonical folder shares the remembered decision; a changed link target does not.
- A renamed/moved project, another clone, another worktree, or a nested project is a distinct path-based trust decision. Do not inherit trust from a parent, Git remote, workspace label, or repository-memory grouping key.
- Trust is shared across chats using that canonical folder, but each chat's binding and effective catalog remain isolated.
- Provide visible Trust project / Manage trust / Revoke trust actions near the workspace selector and in settings.
- Revoking project trust leaves the folder binding available under the current file rules; removing workspace file approval remains a separate action.
- Existing approval and migrated capability flags are not sufficient evidence of informed consent to this new policy. On first eligible interactive use after upgrade, obtain a versioned decision. Background runs must not display dialogs; project capabilities stay unavailable until reviewed interactively.

### FR-06 — Untrusted preview and revocation

- Before trust, AiFetchly may perform bounded local metadata inspection to display counts and diagnostics. It must not inject project descriptions or instructions into model context or run project automation.
- An explicit user request to inspect a project file, including `SKILL.md` or `AGENTS.md`, may use the existing approved file-read path in restricted mode. Return that content as clearly delimited, provenance-tagged untrusted task data, never as an activated skill or project instruction. This exception does not permit automatic capability discovery to disclose instructions to the model, and reading a file does not grant trust or authorize its commands.
- Treat preview metadata as plain untrusted text; no HTML execution, remote image loading, or model interpretation.
- Revocation removes project candidates from subsequent model-visible catalogs, blocks activation/resources, and invalidates applicable loaded instruction attachments.
- Invalidate project-derived summaries, compacted context, cached prompts, queued work, and delegated contexts carrying those instructions. If provenance cannot be separated safely, discard/rebuild that derived context conservatively.
- Abort affected in-flight requests and owned work best effort and reject their late results for continued automation. Recheck policy before the next tool starts. A command already executing or data already sent cannot be undone; do not promise otherwise.
- Changes apply across open chats referencing the same canonical project. Explicit user-authored messages remain user messages; historical audit entries may remain visible without being re-injected as instructions.
- Revocation invalidates capability-derived guidance and its derived context. Independently user-requested file data remains governed by file permissions and its task-data provenance; it cannot be relabeled as trusted guidance. If task data and capability-derived guidance cannot be separated, use the conservative context rebuild above.

## 9. Identity, selection, and activation

### FR-07 — Stable identity and precedence

Use the following order for ordinary name-based selection:

```text
Workspace native > Workspace shared > User native > User shared
  > User config-home compatibility > Plugin > Built-in
```

Within the plugin and built-in scopes, retain existing explicit-identity/ambiguity behavior. Two different candidates at the same exact rank with the same name are ambiguous; do not let filesystem enumeration order decide. A blocked, disabled, or invalid higher-priority candidate does not erase a lower eligible candidate. Show the fallback and the reason. Do not allow skill names to replace reserved application tool identifiers.

Eligibility is evaluated for the invocation mode before selecting a winner. A manual-only project skill can win explicit user selection while an eligible global skill with the same name remains the automatic-selection fallback. Show that distinction rather than implying that one version wins in every mode.

Preserve all candidates and source ownership. Removing an override restores the eligible fallback. Canonical-file aliases should appear as one effective skill within a chat while retaining sufficient source records for fallback, trust, and preference reconciliation. Explicitly selecting an eligible overridden candidate by its scoped ID is allowed; crossing into another workspace or bypassing trust is not.

### FR-08 — Progressive loading and explicit invocation

- Present only eligible skill metadata to the model; load instructions through the existing `use_skill` path when selected.
- Preserve explicit skill invocation through the existing command/mention system. Respect `user-invocable` and `disable-model-invocation` independently.
- Include the chosen source and skill identity in the activation activity entry.
- Resolve relative resource paths against the canonical skill directory through existing resource helpers.
- Global skill resources may be read through that narrow resource capability; discovery must not grant generic file tools access to the home directory.
- Preserve the existing context budgets and structured activation acknowledgement. Do not flood context with all discovered instructions.
- If metadata exceeds presentation limits, disclose truncation and provide deterministic paging/search over eligible skills so omitted entries are still discoverable.
- Repeated activation of the same eligible instruction-and-resource revision is idempotent. Instruction, target, or resource-only changes produce a visible stale/reload outcome rather than silently swapping an active revision. A deliberate reactivation must work even when only a script changed and `SKILL.md` stayed identical.

### FR-09 — Portable metadata and compatibility

- Support YAML frontmatter, multiline/folded descriptions, quoted values, arrays where supported, and nested metadata. Preserve unknown fields without giving them authority.
- New shared-format skills require usable names and descriptions. Minor naming/specification deviations produce warnings where a stable identity is still possible. Malformed frontmatter must not silently become instruction text.
- Preserve the existing clearly identified legacy native no-frontmatter behavior where required for compatibility; do not apply that fallback to malformed standard YAML.
- Version metadata is informational. No semantic version is required to discover a skill.
- `allowed-tools` can describe or narrow requested capabilities; it cannot grant permissions. Unknown tool names and client-specific fields such as `context: fork` are reported when unsupported and are not silently emulated.
- Distinguish fully usable instruction guidance, guidance with unverified requirements, unavailable required dependencies/tools, invalid files, and policy-blocked resources.
- Never execute code, invoke package managers, inspect credentials, or start services merely to determine compatibility. Unsupported script execution does not have to prevent useful instruction-only operation, but the limitation must be visible.

## 10. Lifecycle and management

### FR-10 — Live refresh

- Discover skills at startup, workspace attachment, explicit refresh, and bounded filesystem-change events.
- Watch all supported roots, including roots created after launch. Watch approved linked targets deliberately; do not recursively watch the entire home directory or project.
- Handle atomic saves, rename/delete, missing targets, permission loss, and worker restarts.
- Publish coherent source snapshots; older scans cannot overwrite newer changes or trust decisions.
- A newly installed eligible skill becomes visible by the next request after refresh completes, without restart.
- A changed skill is available for a new activation revision. Active instructions are pinned; known resource changes must not be silently mixed into an existing operation. The technical design defines staging/revalidation boundaries rather than claiming arbitrary directory immutability.
- Removal/disable/revocation blocks future use and removes stale active attachments from subsequent requests. Another valid candidate may become the effective name fallback.

### FR-11 — Unified management view

Extend the existing skills management experience rather than adding a competing independent inventory. It must include managed installations, external prompt skills, executable skills, plugin skills, and built-ins, with clear kind and source labels.

Each row/detail must expose:

- Name, description, kind, scope, source label, and declared version if present.
- Logical location and resolved location when linked; full paths can be shown in a details view.
- Enablement, trust eligibility, compatibility, selection status, and diagnostics as separate state dimensions.
- The active winner and override reason, with access to candidate details.
- Last successful scan and current scanning/unavailable/partial state.

External-source actions are Enable/Disable in AiFetchly, Open folder, View instructions, and Refresh. They must not imply ownership of shared files. Delete/uninstall is unavailable for externally managed entries in this release. Existing managed uninstallation retains its separate established confirmation and ownership rules.

### FR-12 — Durable preferences

- Persist app-local external-skill enablement against a stable source/scope/location identity, not only a name or content hash.
- Editing instructions, renaming their declared display name, rescanning, and restarting must not reset a disabled preference while the logical source location remains the same.
- A same-location changed symlink target must invalidate linked-target approval and active revisions; retaining a disabled preference is safe.
- Missing sources retain preference tombstones for future rediscovery. Do not delete preferences during a scan.
- If several aliases reach the same canonical skill, disabling its effective row must not allow another alias in the same visible scope to resurrect it. The technical design specifies candidate and canonical preference composition.
- Preferences are application-profile local. No preferences are written inside shared skills, repositories, installer lockfiles, or another client's settings.

### FR-13 — Presentation, accessibility, and translation

Proposed primary state labels are Available, Disabled, Requires project trust, Requires linked-folder approval, Overridden, Missing requirement, Compatibility unverified, Invalid skill, and Source unavailable. A skill can have more than one state; the detail panel must explain all applicable reasons.

All new text, dialogs, labels, notices, and errors must have keys in English, Chinese, Spanish, French, German, and Japanese. Vue components use `t()` and an English fallback. Trust dialogs and settings must support keyboard-only use, screen readers, visible focus, and non-color status indicators. Closing a dialog restores focus to its initiating control.

## 11. Boundaries and exceptional cases

| Situation | Required product behavior |
| --- | --- |
| No workspace selected | Global/plugin/built-in skills can remain available under their own policies; file operations still follow existing workspace requirements. |
| Untrusted project with malicious descriptions | Metadata stays in local plain-text preview; the model receives none of that project's capability content. |
| Project skill links outside the workspace | Follow only an already authorized exact skill target or obtain a separate linked-folder decision; otherwise show a blocked diagnostic. Project trust is not blanket external-folder trust. |
| Broken link or permission denied | Show the affected source/skill as unavailable; do not crash or silently run a stale copy. |
| Duplicate name in one equally ranked source | Mark ambiguous and require a specific candidate ID. |
| Invalid override and valid global fallback | Show the invalid candidate and use only the valid, eligible fallback. |
| Trust revoked during a scan or request | Reject stale publication, cancel/ignore affected ongoing work, filter subsequent context, and recheck before execution. |
| Skill changes during an activation | Keep the pinned revision or stop with a change notice; never silently substitute changed instructions. |
| Background/scheduled/delegated task without trust | Do not prompt or grant trust; proceed only with capabilities already authorized for that task, or return an actionable blocked outcome. |
| Project changes while another chat is open | Refresh the shared source while computing eligibility separately for each chat binding. |

## 12. Nonfunctional requirements and success measures

The values below are proposed acceptance targets, not measured current performance.

- No synchronous directory walking or YAML parsing on the renderer thread.
- On a reference local SSD with 200 small skills and no network filesystem, complete initial discovery within 2 seconds at p95 and publish a normal settled edit within 2 seconds after the last write. Record fixture size and hardware in evidence.
- Discovery is bounded even for a hostile directory tree; diagnostics identify any truncation or timeout. Network/remote folders may exceed targets and must remain cancellable.
- Preserve existing prompt budgets: default total activation allowance 16,000 tokens and per-skill maximum 8,000 tokens, subject to the conversation's actual remaining budget. Never treat those defaults as guaranteed model capacity.
- Keep skill instructions and local file contents out of discovery telemetry. Normal activation may send selected instructions to the configured model provider under the existing chat data policy; trust UI must not imply that all activated content stays local.
- Release acceptance requires zero automatic project-capability disclosure/activation before trust, zero cross-workspace candidate access, and durable disabled-state recovery across restart. Explicit file-inspection data is tested separately under the restricted-mode exception.
- Track local counters for scan duration/failures, candidates/overrides, stale activations, and trust-policy blocks. Do not add remote analytics collection as part of this feature.

## 13. Acceptance scenarios

| ID | Scenario | Pass condition |
| --- | --- | --- |
| AC-01 | Install a global standard skill while app is open. | It appears and activates after refresh without import, copy, or restart. |
| AC-02 | Install under config-home compatibility root. | Discovery uses the configured absolute config home and deduplicates aliases. |
| AC-03 | Select a new project. | Explicit three-choice trust dialog appears before project capabilities enter context. |
| AC-04 | Choose Continue without trust. | File binding follows current approval rules; no project skills, instructions, commands, agents, or hooks are model-active. A user-requested instruction-file inspection is permitted only as untrusted task data. |
| AC-05 | Cancel while another workspace is active. | Prior binding and capabilities remain unchanged. |
| AC-06 | Trust a project containing hooks. | Skills/instructions become eligible; automatic hooks remain off until separately enabled. |
| AC-07 | Reopen a remembered canonical folder in another chat. | No repeated modal for the valid policy version; status and revocation control remain visible. |
| AC-08 | Same skill name exists in project and global sources. | Project wins only in its workspace; override reason is shown. |
| AC-09 | Remove the winning source or a realpath alias. | Eligible fallback returns without a restart or loss of preferences. |
| AC-10 | Disable external skill, edit name/body, restart. | It remains disabled and files are untouched. |
| AC-11 | Parse multiline YAML and nested metadata. | Name/description are correct, metadata is preserved, and frontmatter is absent from instructions. |
| AC-12 | Malformed skill beside valid skills. | Invalid entry has a diagnostic; valid skills still work. |
| AC-13 | Linked root/skill changes target or becomes a loop. | Policy is re-evaluated; no stale target or unbounded traversal is used. |
| AC-14 | Revoke trust after activation and compaction. | Future requests exclude revoked instructions and affected derived context across all relevant chats. |
| AC-15 | Revoke trust while a scan, subagent, or tool is queued. | Stale snapshots and new project-triggered actions are rejected; late results cannot resume automation. |
| AC-16 | Create a previously missing shared folder. | It becomes watched and its skills appear. |
| AC-17 | Two different projects use identical skill names. | Candidate lookup and resources cannot cross workspace boundaries. |
| AC-18 | Missing client-specific tool or dependency. | Useful instruction guidance and limitations are accurately distinguished; nothing auto-installs. |
| AC-19 | Hundreds of discovered skills exceed prompt presentation budget. | UI inventory remains complete within scan limits; model-facing paging/search reaches eligible omitted entries. |
| AC-20 | Use all six UI languages and keyboard-only navigation. | Translations, dialog choices, status announcements, and focus behavior are complete. |
| AC-21 | Global skill reads a bundled reference. | Scoped resource read works without granting generic home-directory file access. |
| AC-22 | Disabled/untrusted skill requested by explicit runtime ID. | Direct-ID lookup enforces the same policy as name-based lookup. |
| AC-23 | Update active instructions or a script/reference while leaving `SKILL.md` unchanged. | Subsequent use returns a change/reload outcome; deliberate reactivation loads the new combined revision instead of repeatedly reporting already-loaded. |
| AC-24 | Upgrade an existing approved workspace or start a scheduled run. | No implicit new trust or hook permission is granted; interactive review is required where no current decision exists. |

## 14. Delivery and release gates

1. Implement shared pure discovery, portable parsing, source identity, complete candidate retention, and preference reconciliation.
2. Implement versioned workspace trust, restricted binding, prompt-skill trust filtering, and effective revocation. These are release blockers for project-path support.
3. Add bounded global/workspace watches and linked-target lifecycle handling.
4. Integrate unified management, source explanations, explicit invocation parity, and metadata overflow access.
5. Verify migrations, six-language UI, component tests, critical Electron E2E flows, and cross-platform path/link behavior.

The release may be staged, but it must not expose project skills before trust filtering and revocation are complete. Disabling the discovery feature does not restore revoked trust or reactivate stale context. Feature rollback within a policy-aware binary keeps trust decisions/preferences and preserves externally managed files. Migration also clears legacy capability flags for unknown/restricted decisions while retaining file approval. Running an older binary is a separately gated downgrade: it is not covered by the feature-rollback guarantee because it may ignore context provenance or the new trust policy.

No local Electron Forge packaging is permitted. Safe local evidence uses targeted tests, `yarn test:components`, `yarn build`, and `yarn build:e2e`/`yarn test:e2e` where appropriate. Packaged Windows/macOS/Linux verification belongs to operator/CI gates; record it as pending or environment-blocked until performed.

## 15. Proposed defaults and deferred choices

| Decision | Proposed default | Rationale |
| --- | --- | --- |
| Same-scope native versus shared priority | Native first. | Preserve intentional AiFetchly-specific customization. |
| Universal compatibility root | Include absolute XDG config home, otherwise `~/.config`. | Cover the installer convention without scanning arbitrary home subtrees. |
| Remember trust | Profile-local canonical-folder decision with policy version. | Avoid repeated prompts while retaining explicit first consent. |
| Automatic hooks | Off after ordinary Trust project. | Keep automatic execution a separate decision. |
| External deletion | Unavailable. | Preserve shared-file ownership. |
| Ancestor discovery | Deferred. | Avoid ambiguous project scope and inherited trust. |
| Additional `.claude/skills` locations | Deferred; existing explicit imports remain. | Keep the initial source contract finite and testable. |
| Arbitrary custom roots | Deferred. | Avoid adding a new permission/configuration surface in the first release. |
| Tool-name translation and fork semantics | Explicit adapters only; unsupported behavior diagnosed. | Avoid promising host-specific execution compatibility. |

Detailed limits and engineering defaults appear in the technical design and may be tuned with fixture evidence without weakening trust, ownership, or isolation requirements. Material product changes require updating both documents before implementation.

## 16. Standards and research references

These sources were inspected during the design discussion on 2026-11-06. They inform interoperability; AiFetchly-specific defaults above remain product decisions.

- [Agent Skills specification](https://agentskills.io/specification): portable skill contents and progressive loading.
- [Adding skills support](https://agentskills.io/client-implementation/adding-skills-support): client integration, source scopes, and shared-path convention.
- [Vercel skills supported-agent paths](https://github.com/vercel-labs/skills/blob/main/docs/agents.md): differing shared global locations, including the Universal target.
- [Vercel skills project](https://github.com/vercel-labs/skills): installation ecosystem context. AiFetchly discovery does not depend on invoking this CLI.
