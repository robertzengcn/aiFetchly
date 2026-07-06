# Phase 15: Prompt Command Files - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Load **markdown prompt commands** (`commands/*.md`) from global (`~/.aifetchly/commands/`) and trusted-workspace (`<workspace>/.aifetchly/commands/`) sources. This phase delivers:

- Reading + frontmatter validation of `commands/*.md` (CMD-06 schema), producing `SlashCommandDefinition` entries the existing Phase-13 `CommandRegistry` already consumes.
- **`$ARGUMENTS` expansion** in the Phase-13 `SlashCommandDispatcher` — the argument-token substitution Phase 13 deliberately deferred (marked at the TRS-06/CMD-06 boundary in source).
- **Source-replacement reconciliation** for command files via the existing `CommandRegistry.replaceSource` (add/change/delete/rename, live — no restart).
- **Workspace-command trust gating** via the Phase-14 `applyWorkspaceSnapshot(snapshot, trust)` filter (untrusted workspace commands are NOT registered).
- **`argumentHint` surfaced in the slash-suggestion dropdown** (Phase 13's `AiChatV2SlashSuggestions`).

**Out of scope (locked boundaries — do NOT pull in):**
- Dynamic agents (Phase 16), hooks (Phase 17), skills/plugins (Phase 18).
- Per-capability trust entity `AIFetchlyWorkspaceTrust` (Phase 17) — Phase 15 reuses Phase 14's binary trust.
- Built-in slash commands (`/help`, `/status`, `/reload-config`, `/clear`) — already shipped in Phase 13 (CMD-07/CMD-08). Phase 15 is USER-DEFINED prompt commands only.
- Parser rework — Phase 13's `SlashCommandParser` is final; Phase 15 only adds expansion downstream.
- Fuzzy search in suggestions (§11.2 explicitly defers Fuse-style matching).
- Positional tokens (`$1`, `$2`), context tokens (`$WORKSPACE_PATH`, `$CONVERSATION_ID`), and `\$ARGUMENTS` escaping — deferred (see D-01).

</domain>

<decisions>
## Implementation Decisions

### $ARGUMENTS Expansion
- **D-01: Minimal whole-string substitution.** A single token `$ARGUMENTS` is substituted with the entire argument string the user typed after the command name (e.g. `/review src/service` → `$ARGUMENTS = "src/service"`). **ALL occurrences** of `$ARGUMENTS` in the body are replaced (if the body uses it twice, both are replaced). **NO escaping** (`\$ARGUMENTS` is not special — it's left as-is, no literal-escape mechanism), **NO positional tokens** (`$1`, `$2`), **NO context tokens** (`$WORKSPACE_PATH`, `$CONVERSATION_ID`). This matches tech-design §11.3 "Phase 1 = `$ARGUMENTS` only" and SC2. Substitution happens in the **main-process dispatcher** (Phase 13 already marked this as the Phase-15 boundary), NOT the renderer — the renderer submits `rawInput` and receives the expanded `prompt` back via `submit_prompt`.

### Prompt Body Assembly
- **D-02: Body is a template; append args when `$ARGUMENTS` is absent.** Render the command body with `$ARGUMENTS` substituted everywhere it appears. If the body contains **no** `$ARGUMENTS` token AND the user passed non-empty args, **append** the raw args after the body, separated by a blank line (`body + "\n\n" + args`). The rendered result is returned as `action: "submit_prompt"` with `prompt: <rendered>` and the renderer submits it through the normal Chat V2 send path (replacing the user's literal `/review ...` input). If the body has no `$ARGUMENTS` and args are empty, the body is submitted as-is. Empty body is rejected at frontmatter validation (CMD-06 requires non-empty body) so there is no "empty prompt" edge at dispatch.

### Global vs Workspace Precedence
- **D-03: Workspace shadows global.** When `~/.aifetchly/commands/review.md` (global) and `<workspace>/.aifetchly/commands/review.md` (workspace, trusted) both define the same command name, the **workspace** command wins — only the workspace entry is registered in `CommandRegistry` and dispatched. Rationale: workspace = more-specific local override (matches the "workspace-specific intent" model). Built-in commands still cannot be shadowed by either source (CMD-01 lookup order, locked in Phase 13's `SOURCE_RANK`). No conflict diagnostic in Phase 15 — shadowing is silent and intentional (add a diagnostic only if profiling shows user confusion; deferred). The same name within a single source is a frontmatter/readdir collision → diagnostic + last-wins-undefined-behavior avoided by treating duplicate-name-in-one-source as a validation diagnostic (CMD-06).

### Suggestions UI — argumentHint
- **D-04: Show argumentHint inline when present; nothing when empty.** In `AiChatV2SlashSuggestions`, render the command row as `/<name> <argumentHint> — <description>` when `argumentHint` is non-empty (e.g. `/review <path> — Review code`), plus the Phase-13 source badge. When `argumentHint` is empty, render `/<name> — <description>` (NO generic `<args>` placeholder — keeps the row compact and avoids implying all commands take args). `argumentHint` is already part of `SlashCommandView` metadata exposed by the Phase-13 list response (CMD-07: list responses expose metadata only, not the prompt body — unchanged).

### Carry-Forward from Prior Phases (locked, do not re-litigate)
- **Frontmatter schema (CMD-06, locked):** `name` matches `^[a-z][a-z0-9_-]*$`; `description` ≤500 chars; ≤10 aliases (same regex as name); `argumentHint` ≤100 chars; `type: "prompt"` (Phase 15 only handles `prompt`); non-empty body. Invalid frontmatter → diagnostic + the command is ignored (SC4). Reuse the Phase 13-01 restricted frontmatter parser.
- **Size cap (CFG-04, locked):** `commandMdBytes = 64 * 1024` in `AIFetchlyConfigConstants`. Oversized command file → diagnostic + skipped. Already enforced by the scanner.
- **Source replacement (Phase 13-02, locked):** `CommandRegistry.replaceSource(sourceId, entries)` atomically reconciles add/change/delete/rename so stale entries never survive. Phase 15 wires the workspace-command scan results into `replaceSource` exactly as Phase 13 did for global commands.
- **Trust gating (Phase 14-02, locked):** workspace command entries pass through `applyWorkspaceSnapshot(snapshot, trust)` before registry mutation. Untrusted workspace → commands dropped (TRS-01). Phase 15 does NOT add a new trust surface.
- **Three-layer DB / worker-no-DB (CLAUDE.md, locked):** N/A for Phase 15 — prompt-command loading + expansion is main-process + renderer; the workspace-config WORKER (Phase 14) only snapshots files and returns them. No DB, no new entity.
- **AI-feature IPC checks `USER_AI_ENABLED` first (CLAUDE.md + Phase 13 TRS-05 Strategy A, locked):** the dispatcher returns `submit_prompt`; the actual AI submission flows through the existing `AI_CHAT_V2_STREAM` IPC which already gates on `USER_AI_ENABLED`. Phase 15 adds NO new AI-gated path — the prompt-command dispatch is NOT itself AI-serving (it returns a prompt; the stream IPC is the single gate). Verify ZERO `registerAiValidatedHandler` is needed.
- **i18n (CLAUDE.md, locked):** Phase 15 adds NO new user-facing UI strings — `argumentHint` and `description` are author-supplied DATA, not app strings. The existing `slashCommands` / `aifetchlyConfig` i18n groups (Phase 13) cover any framework chrome. If a new diagnostic string is needed, add it to all 6 lang files.
- **Preload dual whitelists (Phase 13 Pitfall 3, locked):** Phase 15 adds NO new IPC channels — it reuses Phase 13's `SLASH_COMMAND_LIST` / `SLASH_COMMAND_DISPATCH` / `AIFETCHLY_CONFIG_CHANGED`. No whitelist changes.
- **NEVER use `any`**; immutability; explicit error handling; zod at boundaries.

### Claude's Discretion
- Exact `$ARGUMENTS` matcher (regex vs `String.split` + join) — planner picks; prefer a literal-token replace-all that is robust to `$ARGUMENTS` appearing mid-word.
- Where expansion lives precisely within the dispatcher (a small `expandPrompt(body, args)` pure function is recommended, mirroring Phase 13's "parser is pure" boundary).
- Diagnostic message wording for "command file invalid" / "duplicate name in source" — reuse Phase 13/14 diagnostic shape (`ioDiagnostic` / `diagnostic(...)`).
- Whether to unit-test the global-vs-workspace shadow at the registry level or the scan-assembly level (recommend both — registry invariant + end-to-end dispatch).
- Trust-card / preview integration — N/A (commands aren't previewed via the trust card; they're either registered or not, based on trust).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked design (authoritative — the equivalent of CONTEXT.md USER DECISIONS)
- `docs/prd/aifetchly-local-extensibility-technical-design.md` §11 (Slash Command Implementation) — §11.1 Parser (FINAL, Phase 13), §11.2 Suggestions (CMD-07 done), §11.3 Dispatch IPC (the `submit_prompt` shape Phase 15 returns), §11.4 Built-in commands (Phase 13, not Phase 15). **Phase 15 = the `$ARGUMENTS`-expansion + `commands/*.md` loading gap.**
- `docs/prd/aifetchly-local-extensibility-prd.md` — CMD-06 requirement (frontmatter schema, `$ARGUMENTS`, source replacement). PRIMARY requirements source.
- `.planning/REQUIREMENTS.md` — CMD-06 (Phase 15, Pending); CMD-07/CMD-08 already Complete in Phase 13.

### Requirements + roadmap
- `.planning/ROADMAP.md` §Phase 15 — goal + 4 success criteria.

### Phase 13 surfaces this phase consumes (read the SUMMARYs)
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-02-SUMMARY.md` — `CommandRegistry.replaceSource`, `SlashCommandParser` (pure; expansion deferred to Phase 15 — boundary marked in source), `SlashCommandDefinition`.
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-03b-SUMMARY.md` — `SlashCommandDispatcher`, `SLASH_COMMAND_DISPATCH` IPC returning `submit_prompt`, `SlashCommandModule`.
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-04-SUMMARY.md` — `AiChatV2SlashSuggestions` dropdown (where `argumentHint` renders), `SlashCommandView` metadata.

### Phase 14 surfaces this phase consumes
- `.planning/phases/14-workspace-watcher-worker/14-02-SUMMARY.md` — `applyWorkspaceSnapshot(snapshot, trust)` trust filter (workspace-command gating happens here, NOT in a new Phase-15 path).
- `.planning/phases/14-workspace-watcher-worker/14-01-SUMMARY.md` — `WorkspaceConfigScanner` already scans `commands/*.md` into snapshots (Phase 15 consumes its output; it does NOT re-scan).

### Project rules + constants
- `./CLAUDE.md` — three-layer DB, worker-no-DB (N/A here), i18n, no `any`, zod at boundaries, AI-feature gating.
- `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` — `AIFETCHLY_CONFIG_LIMITS.commandMdBytes = 64 * 1024` (CFG-04 size cap for command files).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`SlashCommandParser`** (Phase 13-02) — pure function, returns `{name, args, raw}`. Phase 15 does NOT touch it; expansion is downstream in the dispatcher.
- **`CommandRegistry.replaceSource(sourceId, entries)`** (Phase 13-02) — atomic add/change/delete/rename reconciliation. Phase 15 calls it with the workspace-command scan results (source-ranked: workspace > global; built-in > all).
- **`SlashCommandDispatcher`** (Phase 13-03b) — THE place `$ARGUMENTS` expansion lands. It already returns `{action: "submit_prompt", prompt, commandId}` for the built-in/handler path; Phase 15 adds the prompt-command expansion branch.
- **`AIFetchlyConfigLoader`** (Phase 13-01) — restricted frontmatter parser + size limits + path safety. The workspace scanner (Phase 14-01 `WorkspaceConfigScanner`) already uses it to parse `commands/*.md` into snapshot entries. Phase 15 consumes those entries (validates per CMD-06, including `argumentHint` ≤100).
- **`AiChatV2SlashSuggestions`** (Phase 13-04) — the dropdown. Phase 15 extends the row to render `argumentHint` inline (D-04). `SlashCommandView` already carries the metadata (CMD-07).
- **`applyWorkspaceSnapshot(snapshot, trust)`** (Phase 14-02) — the trust gate workspace commands pass through before reaching the registry.

### Established Patterns
- **Source-replacement on scan** (Phase 13-02) — every workspace rescan calls `replaceSource("workspace:" + workspaceId, entries)`, so renames/deletes reconcile automatically (SC3).
- **`submit_prompt` return shape** (Phase 13 dispatch) — Phase 15 prompt commands return the same `{action: "submit_prompt", prompt}` shape; the renderer's submit path is unchanged.
- **Diagnostic shape** (`ioDiagnostic` / `diagnostic(sourceId, path, kind, message, fatal)`) — invalid frontmatter / oversized file / duplicate name → diagnostic + skip (SC4).
- **`SOURCE_RANK` lookup order** (Phase 13 CMD-01) — built-in > workspace > global; the registry enforces it on every mutation.

### Integration Points
- `WorkspaceConfigScanner.scan()` (Phase 14) emits `commands[]` in the snapshot → `applyWorkspaceSnapshot(snapshot, trust)` filters by trust → for trusted workspaces, the command entries flow into `CommandRegistry.replaceSource`.
- `SLASH_COMMAND_DISPATCH` IPC (Phase 13) — dispatcher looks up the command, and for `type: "prompt"` commands, calls the new `expandPrompt(body, args)` → returns `submit_prompt`.
- Renderer `AiChatV2SlashSuggestions` — renders `argumentHint` from the existing `SlashCommandView` metadata (no IPC change).

</code_context>

<specifics>
## Specific Ideas

- **D-01 strictness:** the user explicitly chose the *minimal* `$ARGUMENTS` model over richer tokens. Do not "round up" to positional/context tokens even if they look easy — the deliberate Phase-1 intent is to keep prompt commands trivially substitutable. Escaping (`\$ARGUMENTS`) was considered and rejected for Phase 15.
- **D-02 "append when absent" rationale:** command authors who forget the `$ARGUMENTS` token shouldn't silently drop the user's args — appending is fail-safe. If the body DOES contain `$ARGUMENTS`, the args are only substituted there (not also appended).
- **D-03 workspace-shadow rationale:** workspace = local override is the least-surprising model for "I want `/review` to do X in *this* repo but Y globally." Silent shadow (no diagnostic) keeps the UX clean; the source badge in suggestions already disambiguates which one is active.
- **D-04 no-placeholder rationale:** an empty `argumentHint` should not render `<args>` because not every prompt command takes arguments, and a generic placeholder would mislead. Hint shows only when the author declared one.

</specifics>

<deferred>
## Deferred Ideas

- **Positional arguments** (`$1`, `$2`, `$@`) — beyond Phase 15; would need a quoting/escaping story first.
- **Context tokens** (`$WORKSPACE_PATH`, `$CONVERSATION_ID`, `$DATE`) — beyond Phase 15; raises a workspace-path-leak-into-prompt trust question worth its own design pass.
- **`$ARGUMENTS` escaping** (`\$ARGUMENTS` for a literal token in docs) — beyond Phase 15.
- **Fuzzy search** in slash suggestions (Fuse-style) — explicitly deferred by tech design §11.2.
- **Conflict diagnostic** for global-vs-workspace same-name collisions — deferred unless UX feedback shows confusion (D-03 makes shadowing silent by design).
- **Command namespacing / disambiguation when both sources should coexist** — beyond Phase 15 (D-03 picks one winner).

</deferred>

---

*Phase: 15-prompt-command-files*
*Context gathered: 2026-07-06*
