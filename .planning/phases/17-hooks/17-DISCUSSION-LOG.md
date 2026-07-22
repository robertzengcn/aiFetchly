# Phase 17: Hooks - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-10
**Phase:** 17-hooks
**Areas discussed:** Workspace hook action vocabulary, PreToolUse blocking power, Per-capability trust UX + migration

---

## Gray areas offered (multiSelect)

| Area | Discussed? |
|------|------------|
| Hook execution boundary | Declined as a standalone area — resolved as a side-effect of D-Vocabulary (constraint locked, mechanism left to research) |
| Workspace hook action vocabulary | ✓ |
| PreToolUse blocking power | ✓ |
| Per-capability trust UX + migration | ✓ |

---

## Workspace Hook Action Vocabulary

**Question:** What action types can a workspace hooks.json declare?

| Option | Description | Selected |
|--------|-------------|----------|
| Command + skill-reference | Declare EITHER a sandboxed command string OR a "skill":"<name>" reference; commands route through the execution-boundary worker (never main); skill refs no-op-diagnostic until Phase 18. PRD §7.6 direction. | ✓ |
| Claude-hooks-compat (commands) | Full drop-in Claude hooks.json shape via the existing ClaudeHooksAdapter. Maximizes migration compat, widest command-exec surface now. | |
| Skill-reference only (workspace) | Workspace hooks can ONLY reference a skill — no command strings. Safest; inert until Phase 18. User-global keeps commands. | |
| You decide | Claude picks based on the security model and PRD. | |

**User's choice:** Command + skill-reference
**Notes:** PRD §7.6 direction ("worker or registered skill"). Choosing command+skill SIDE-EFFECT-LOCKS the execution-boundary constraint: config-sourced command hooks must run in the worker/sandbox, never the main process. The exact mechanism (reuse watcher worker vs new hook-exec worker vs restricted in-process) is deferred to research. Skill refs parse+register but emit a non-fatal "skill registry not yet available" diagnostic until Phase 18. User-global uses the same vocabulary (mirror prior phases).

---

## PreToolUse Blocking Power

**Question:** How powerful should PreToolUse hooks be?

| Option | Description | Selected |
|--------|-------------|----------|
| PreToolUse can DENY (gate) | Returns PASS (allow) or DENY (block, reason shown to model/user). Matches Claude exit-code-2 deny + AiFetchly's own .md-write-blocking hook. Workspace deny requires trust. | ✓ |
| Observe + inject only | Hooks observe/log/inject but cannot block — tool always runs. Simplest/safest; loses deny use-case. | |
| Deny + modify input | Hooks can DENY and rewrite tool input args before execution (full Claude power). Widest surface; input rewriting is a subtler attack vector. | |
| You decide | Claude picks; likely deny-only aligned with Claude semantics + the .md-block pattern. | |

**User's choice:** PreToolUse can DENY (gate)
**Notes:** PASS/DENY only this phase — modify/rewrite explicitly deferred. Other events (PostToolUse, SessionStart, Stop) stay observe+inject (only a pre-event can gate; PostToolUse cannot deny retrospectively). Workspace DENY is powerful (DoS-gate risk) so gated behind trust.hooks (TRS-02); built-in/user-global deny hooks are not workspace-sourced. AiFetchly's own PreToolUse .md-block hook is the live in-repo precedent to cite.

---

## Per-Capability Trust UX + Migration

**Question:** How should per-capability trust approval work, and how do existing trusted workspaces migrate?

| Option | Description | Selected |
|--------|-------------|----------|
| Binary approve = all capabilities | Keep Phase 14 binary card; approving sets ALL 5 capability flags together. Entity ships with per-capability columns (TRS-02 ✓) for future granular control; v2.0 UX stays binary. Existing trusted workspaces migrate to all-on (no re-approval). | ✓ |
| Granular per-capability checkboxes | Trust card expands to 5 checkboxes; independent capability approval. Existing migrate to ALL-on; new are granular. More control + more UX/load + card rework. | |
| Binary + per-capability revoke | Approve-all default + advanced toggle to REVOKE individual capabilities post-approval. Hybrid. | |
| You decide | Claude picks; likely binary-approve-all for v2.0. | |

**User's choice:** Binary approve = all capabilities
**Notes:** The deliverable (TRS-02) is the PERSISTED per-capability entity; the v2.0 APPROVAL UX stays binary (all flags written together on approval). Granular checkbox UX deferred — the entity enables it later without a schema migration. Existing Phase-14-trusted workspaces backfilled to all-capabilities-trusted on first run (one-time idempotent migration). Untrusted stay all-untrusted. The AIFetchlyRuntimeRegistrySync per-capability READ path (trust.instructions/commands/agents + new trust.hooks) stays as-is so the granular future works without re-touching sync. Phase 14's in-memory sync approval cache is replaced by reads from the persisted AIFetchlyWorkspaceTrust Module/Model.

---

## Claude's Discretion

- **Execution-boundary mechanism** (constraint locked by D-Vocabulary, mechanism open): reuse Phase 14 watcher worker vs new dedicated hook-exec worker (`src/childprocess/`) vs restricted in-process executor. Researcher traces `CommandHookExecutor` + Phase 14 worker protocol and decides.
- **`hooks.json` schema details** — align with existing `HookDefinitionView`/`HookMatcher` types; `ClaudeHooksAdapter` as reference (drop-in Claude compat is a bonus, not required).
- **`HookRegistry` adapter vs direct `replaceSource`** — tech-design §7.5 allows either; researcher decides from current `HookRegistryImpl` shape.
- **`AIFetchlyWorkspaceTrust` column design** — boolean per capability + workspaceId + approvedAt; confirm against entity conventions.
- **Hook event coverage wiring** — which of PreToolUse/PostToolUse/SessionStart/Stop are already wired; whether AiFetchly's tool-exec path emits the events.
- **Hook priority/ordering/timeouts/cancellation** — confirm what `HookResultAggregator`/`HookOutputValidator` already encode.
- **Diagnostic wording** for unsupported-event / skill-not-available / hook-failure.
- **`/hooks` built-in command** — optional `/agents` parity; defer if scope risk.

## Deferred Ideas

- Hook input MODIFY/rewrite (PreToolUse deny-or-pass only this phase).
- Granular per-capability trust approval UX (checkboxes).
- `skill:` reference resolution (Phase 18 skill registry).
- Plugin-sourced hooks `plugin:<name>:hook:` (Phase 18 SKL-02; reserve rank now).
- Full byte-for-byte Claude-hooks-compat drop-in.
- `/hooks` built-in listing command (optional).
