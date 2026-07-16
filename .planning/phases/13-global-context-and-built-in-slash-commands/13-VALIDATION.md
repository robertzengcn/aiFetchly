---
phase: 13
slug: global-context-and-built-in-slash-commands
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-04
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `13-RESEARCH.md` § Validation Architecture. Task IDs in the Per-Task map
> are filled during/after planning (`*-PLAN.md` waves).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (main process + utils). Phase 13 uses Vitest exclusively (services + IPC); no Mocha tests. |
| **Config file** | `vite.main.config.mjs` (test block: `include: ['test/vitest/main/**/*.test.ts', '!test/vitest/main/components/**']`, `globalSetup: ['./test/vitest/_typecheck/globalSetup.ts']`). `.vue` component tests use dedicated `test/vitest/main/components/vitest.config.mjs` (happy-dom). |
| **Quick run command** | `yarn testmain -- <TestName>` (e.g. `yarn testmain -- CommandRegistry`) |
| **Full suite command** | `yarn testmain` (typecheck-gated — `tsc --noEmit` runs once at startup) |
| **Estimated runtime** | ~15–30s for the phase 13 subset |

---

## Sampling Rate

- **After every task commit:** Run `yarn testmain -- <relevant test>` (e.g. `-- CommandRegistry`)
- **After every plan wave:** Run `yarn testmain` (full main vitest suite, typecheck-gated)
- **Before `/gsd-verify-work`:** Full `yarn testmain` green + manual QA checklist (design §22)
- **Max feedback latency:** ~30s (targeted vitest run)

---

## Per-Requirement Verification Map

> Task IDs (`{plan}-{wave}-{n}`) attach when plans are finalized. Req → test mapping is locked here so Dimension 8 coverage is unambiguous.

| Req ID | Behavior | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|------------|-----------------|-----------|-------------------|-------------|--------|
| CFG-01 | Loader resolves `~/.aifetchly` (not `userData`); async bounded reads; missing folder → empty snapshot | — | No renderer FS access | unit | `yarn testmain -- AIFetchlyConfigLoader` | ❌ W0 | ⬜ |
| CFG-03 | `settings.json` valid parse; unknown fields ignored; invalid field → default + warning diagnostic | — | Never trust external input | unit | `yarn testmain -- AIFetchlyConfigLoader` | ❌ W0 | ⬜ |
| CFG-04 | Oversized file → diagnostic + ignored (`file-too-large`) | DoS | Size limit before `readFile` | unit | `yarn testmain -- AIFetchlyConfigLoader` | ❌ W0 | ⬜ |
| CFG-05 | Path safety: rejects absolute, `..`, escaping symlinks; returns `{ok:false,reason}` | T-13-01 / Info Disclosure | Mirror `FilePathGuard` | unit | `yarn testmain -- resolveConfigRelativePath` | ❌ W0 | ⬜ |
| CFG-06 | Snapshot has SHA-256 hashes; diff computes added/changed/removed | — | Integrity via SHA-256 | unit | `yarn testmain -- AIFetchlyConfigSnapshotDiff` | ❌ W0 | ⬜ |
| CFG-07 | Frontmatter parser: scalars + arrays only; rejects YAML tags; preserves body; fails closed | T-13-02 / Code Execution | NO js-yaml default schema | unit | `yarn testmain -- AIFetchlyConfigMarkdown` | ❌ W0 | ⬜ |
| CTX-01 | `AGENTS.md` content in assembled messages after base prompt, before durable memory | T-13-03 / Spoofing | Label injected block; never above app prompt | unit | `yarn testmain -- AIChatContextAssembler.aifetchly` | ❌ W0 (extend existing) | ⬜ |
| CTX-03 | Cache miss / loader-not-ready → empty list (no injection); read failure → no crash | — | Fail closed | unit | `yarn testmain -- AIFetchlyContextLoader` | ❌ W0 | ⬜ |
| CMD-01 | Registry lookup order (built-in > workspace > user > plugin); `replaceSource` reconciles delete/rename | — | Built-ins can't be shadowed | unit (table) | `yarn testmain -- CommandRegistry` | ❌ W0 | ⬜ |
| CMD-02 | Parser: `/review src`=cmd; ` /review`=cmd after trim; `//review`≠; `/`=suggest-only; `/unknown` parses | — | Input validation at boundary | unit (table) | `yarn testmain -- SlashCommandParser` | ❌ W0 | ⬜ |
| CMD-03 | Built-ins registered at startup; `list()` includes help/clear/status/reload-config | — | N/A | unit | `yarn testmain -- builtinSlashCommands` | ❌ W0 | ⬜ |
| CMD-04 | Dispatch returns correct discriminated union (submit_prompt / show_result / status:false) | — | N/A | unit | `yarn testmain -- SlashCommandDispatcher` | ❌ W0 | ⬜ |
| CMD-05 | Suggestions render name/desc/source-badge/arg-hint; arrow/Enter/Tab nav; Shift+Enter newline | — | N/A | component (happy-dom) OR manual | `yarn testmain -- AiChatV2SlashSuggestions` | ❌ W0 (optional; manual fallback design §21.5) | ⬜ |
| CMD-07 | Ranking: exact name > exact alias > prefix name > prefix alias > substring desc | — | Deterministic | unit (table) | `yarn testmain -- CommandRegistry` | ❌ W0 | ⬜ |
| CMD-08 | Unknown → message; disabled → trust message; invalid expansion → diagnostics message | — | N/A | unit | `yarn testmain -- SlashCommandDispatcher` | ❌ W0 | ⬜ |
| TRS-05 | AI-serving dispatch gated; list/status/reload NOT gated | T-13-04 / Abuse | `Token.getValue(USER_AI_ENABLED)` fail-closed | unit + IPC | `yarn testmain -- slash-command-ipc` | ❌ W0 | ⬜ |
| TRS-06 | No execution path from prompt commands (phase 13 = built-ins only) | T-13-05 / Code Execution | No `eval`/`exec`/`spawn` in dispatch | boundary (manual review) | n/a — grep dispatch path | ✅ (no code yet) | ⬜ |
| TRS-07 | Renderer never reads `~/.aifetchly` directly | T-13-06 / Info Disclosure | Static boundary test | boundary (static grep) | `yarn testmain -- rendererNoFsAccessToAifetchly` | ❌ W0 | ⬜ |
| DX-01 | Diagnostics have stable codes; source-specific; user-readable | — | N/A | unit | covered by CFG-04/07 + Loader cases | ❌ W0 | ⬜ |
| DX-02 | `/status` returns counts + watcher placeholder + last reload | — | N/A | unit | `yarn testmain -- SlashCommandDispatcher` | ❌ W0 | ⬜ |
| I18-01 | All 6 lang files have `aifetchlyConfig` + `slashCommands` groups | — | N/A | static (lint/grep) | `yarn testmain -- i18nKeysPresent` | ❌ W0 | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### `$ARGUMENTS` Boundary (phase 15 — NOT phase 13)
- `$ARGUMENTS` expansion is **CMD-06 / phase 15**. Phase 13 built-ins take no arguments. The dispatcher MUST NOT contain `$ARGUMENTS` substitution logic; add a code comment marking the phase 15 boundary.

### Rescan Timing
- Phase 13 global startup scan: no hard SLA; characterize during implementation (empty/small `~/.aifetchly` should be <100ms). Log duration. The <500ms SLA is a phase 14 workspace-watcher criterion.

---

## Wave 0 Requirements

- [ ] `test/vitest/main/service/CommandRegistry.test.ts` — covers CMD-01, CMD-07
- [ ] `test/vitest/main/service/SlashCommandParser.test.ts` — covers CMD-02
- [ ] `test/vitest/main/service/SlashCommandDispatcher.test.ts` — covers CMD-04, CMD-08, DX-02
- [ ] `test/vitest/main/service/AIFetchlyConfigMarkdown.test.ts` — covers CFG-07
- [ ] `test/vitest/main/service/AIFetchlyConfigLoader.test.ts` — covers CFG-01, CFG-03, CFG-04, CFG-05, DX-01
- [ ] `test/vitest/main/service/AIFetchlyConfigSnapshotDiff.test.ts` — covers CFG-06
- [ ] `test/vitest/main/service/AIFetchlyContextLoader.test.ts` — covers CTX-01, CTX-03
- [ ] `test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts` — extend existing for AGENTS.md injection ordering
- [ ] `test/vitest/main/ipc/slash-command-ipc.test.ts` — covers CMD-02/03/04/05 IPC, TRS-05 gating matrix
- [ ] `test/vitest/main/rendererNoFsAccessToAifetchly.test.ts` — covers TRS-07 boundary
- [ ] `test/vitest/main/i18nKeysPresent.test.ts` (or lint rule) — covers I18-01
- [ ] Framework config: no new vitest config (existing `vite.main.config.mjs` covers new files via glob)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Slash suggestions UX (dropdown open on `/`, source badges, keyboard nav, Shift+Enter newline) | CMD-05 | `.vue` component harness for AiChatV2 is not yet stable; design §21.5 permits manual QA | Type `/` in AiChatV2 composer → verify dropdown, badge colors, arrow/Enter/Tab nav, Shift+Enter newline |
| Adding `~/.aifetchly/AGENTS.md` changes next AiChatV2 response without restart | Success criterion 1 / CTX-01 | End-to-end live-app behavior across main+renderer | Add `AGENTS.md` to `~/.aifetchly`, send a chat message, confirm context reflects it; no restart |
| `/reload-config` rescan + counts report; `/status` shows config + diagnostics | Success criterion 3 / DX-02 | Live IPC + renderer rendering | Run `/reload-config` and `/status` in composer; verify counts and diagnostics surface |
| All new UI text reads correctly in zh/es/fr/de/ja | I18-01 | Visual locale QA | Switch app language to each of the 6; verify `aifetchlyConfig`/`slashCommands` strings |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
