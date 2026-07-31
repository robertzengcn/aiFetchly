# Phase 15: Prompt Command Files - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-06
**Phase:** 15-prompt-command-files
**Areas discussed:** $ARGUMENTS expansion scope, Prompt body assembly shape, Global vs workspace command precedence, argumentHint in suggestions UI

---

## $ARGUMENTS Expansion Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal — `$ARGUMENTS` only, all occurrences | Single whole-string token; all occurrences replaced; no escaping, no positional/context tokens. Matches §11.3 "Phase 1". | ✓ |
| Minimal + escape support (`\$ARGUMENTS`) | Same + literal-escape for the token. | |
| Add `$WORKSPACE_PATH` + `$CONVERSATION_ID` | Context tokens now; richer but expands Phase 15 surface + trust story. | |

**User's choice:** Minimal — `$ARGUMENTS` only, all occurrences (D-01).
**Notes:** Tech design §11.3 explicitly scopes Phase 1 to `$ARGUMENTS`. User chose to keep substitution trivially simple and defer positional/context tokens. Escaping considered and rejected for Phase 15.

---

## Prompt Body Assembly Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Body template; append args if `$ARGUMENTS` absent | Substitute everywhere; if body has no token AND args non-empty, append args after body (blank-line). Submitted as single user message. | ✓ |
| Body template; drop args if `$ARGUMENTS` absent | Stricter "body is the whole prompt"; args lost if author forgot the token. | |
| Body + small "command invoked" header | Prepend a system note so the model knows a command ran. | |

**User's choice:** Body template; append args if `$ARGUMENTS` absent (D-02).
**Notes:** Fail-safe rationale — a command author who forgets the `$ARGUMENTS` token shouldn't silently drop the user's args. If the body DOES contain the token, args are substituted there only (not also appended). Empty body rejected at CMD-06 frontmatter validation, so no empty-prompt edge.

---

## Global vs Workspace Command Precedence

| Option | Description | Selected |
|--------|-------------|----------|
| Workspace shadows global | Workspace = local override; only workspace entry registered+dispatched. Built-ins still win (CMD-01). | ✓ |
| Global shadows workspace | Global = universal preference. | |
| Both listed with source disambiguation | Suggestions show both; dispatch picks by source/rank. | |
| Emit a conflict diagnostic, register neither | Strictest; blocks both until rename. | |

**User's choice:** Workspace shadows global (D-03).
**Notes:** Workspace = more-specific local override is least-surprising. Silent shadow (no diagnostic) keeps UX clean; the Phase-13 source badge already disambiguates. Built-ins cannot be shadowed (CMD-01 SOURCE_RANK, locked in Phase 13).

---

## argumentHint in Suggestions UI

| Option | Description | Selected |
|--------|-------------|----------|
| Show hint when present; nothing when empty | `/<name> <hint> — <desc>` when non-empty; `/<name> — <desc>` when empty. | ✓ |
| Show hint; generic `<args>` placeholder when empty | Uniform "accepts arguments" signal. | |
| Don't show argumentHint in suggestions | Keep Phase 13 row (name + desc + source badge). | |

**User's choice:** Show hint when present; nothing when empty (D-04).
**Notes:** Not every prompt command takes args; a generic placeholder would mislead. `argumentHint` already rides on `SlashCommandView` metadata (CMD-07 — metadata only, no prompt body). No IPC change.

---

## Claude's Discretion

- Exact `$ARGUMENTS` matcher (regex vs split/join) — prefer a literal-token replace-all robust to mid-word occurrences.
- Where expansion lives in the dispatcher (recommend a small pure `expandPrompt(body, args)`).
- Diagnostic wording for invalid frontmatter / duplicate-name-in-source (reuse Phase 13/14 diagnostic shape).
- Test strategy for shadow (recommend registry-invariant + end-to-end dispatch).

## Deferred Ideas

- Positional arguments (`$1`, `$2`, `$@`) — needs quoting/escaping story first.
- Context tokens (`$WORKSPACE_PATH`, `$CONVERSATION_ID`, `$DATE`) — workspace-path-leak-into-prompt trust question.
- `\$ARGUMENTS` escaping for literal token in docs.
- Fuzzy search in suggestions (§11.2 explicit defer).
- Conflict diagnostic for global-vs-workspace collisions (D-03 makes shadow silent by design).
- Command namespacing when both sources should coexist.
