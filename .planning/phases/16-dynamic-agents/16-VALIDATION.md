---
phase: 16
slug: dynamic-agents
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-08
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `16-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (main-process + utilitycode configs) + Mocha (modules). tsc gate via `test/vitest/_typecheck/globalSetup.ts` at every vitest run. |
| **Config file** | `vite.main.config.mjs`, `vite.utilityCode.config.mjs` |
| **Quick run command** | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs <filter>` |
| **Full suite command** | `yarn testmain` |
| **Estimated runtime** | ~30–60 seconds (scoped) |

> Do NOT commit code that needs `AIFETCHLY_SKIP_TSC=1` — the tsc gate is mandatory (CLAUDE.md).

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --config vite.main.config.mjs <touched-test-filter>` + `npx tsc --noEmit`
- **After every plan wave:** Run `yarn testmain` (full vitest main suite)
- **Before `/gsd-verify-work`:** Full suite must be green + manual live-app checks
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

> Task IDs are provisional (planner assigns final IDs). Requirement → test mapping is authoritative; rows track the requirement, not a specific task number.

| Task Area | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-----------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| Registry refactor (class + replaceSource + rank map) | 01 | 1 | AGT-01 | — | Built-ins unshadowable; defensive copies returned | unit | `npx vitest run --config vite.main.config.mjs AgentDefinitionRegistry` | ❌ W0 (rewrite utilitycode test) | ⬜ pending |
| Agent frontmatter validator (buildAgentDefinition) | 01 | 1 | AGT-02 | V5 | Fixed-order validation; first violation wins | unit | `npx vitest run --config vite.main.config.mjs agentFrontmatter` | ❌ W0 | ⬜ pending |
| Global agent loader (~/.aifetchly/agents) | 02 | 2 | AGT-02 | V12/CFG-04 | Scoped IDs `user:agent:<name>`; 128KB cap | unit | `npx vitest run --config vite.main.config.mjs AIFetchlyConfigLoader.agents` | ❌ W0 | ⬜ pending |
| Workspace scanner agent scan (worker, raw drafts only) | 02 | 2 | AGT-02 | WAT-02 | No validation/registry mutation in worker | unit | `npx vitest run --config vite.main.config.mjs WorkspaceConfigScanner WorkerNoDbBoundary` | ❌ W0 | ⬜ pending |
| Trust filter extension (applyWorkspaceSnapshot `agents`) | 02 | 2 | AGT-02/TRS-01 | V4 | Untrusted workspace agents dropped | unit | `npx vitest run --config vite.main.config.mjs AIFetchlyRuntimeRegistrySync.trust` | ✅ extend | ⬜ pending |
| Workspace agent draft → definition | 02 | 2 | AGT-02 | — | Scoped IDs `workspace:<id>:agent:<name>` | unit | `npx vitest run --config vite.main.config.mjs buildWorkspaceAgentDefinitions` | ❌ W0 | ⬜ pending |
| Dispatch resolution swap (registry-first, DB fallback) | 03 | 3 | AGT-03 | — | Built-ins still resolve via DB fallback; existing tests green | unit | `npx vitest run --config vite.main.config.mjs AgentRuntime runSubagentTool` | ✅ extend | ⬜ pending |
| `run_subagent` agentId description + unknown-ID rejection | 03 | 3 | AGT-03 | — | Unknown ID → clear error, no fuzzy resolve | unit | (same) | ✅ extend | ⬜ pending |
| `/agents` built-in command (show_result, sorted by precedence) | 03 | 3 | AGT-03 | TRS-07 | Computed string only; no file bytes to renderer | unit | `npx vitest run --config vite.main.config.mjs SlashCommandDispatcher` | ✅ extend | ⬜ pending |
| "Available agents" context block injection | 03 | 3 | AGT-02/D-Discovery | — | Graceful degradation on error; cached, rebuilt on change | unit | `npx vitest run --config vite.main.config.mjs AIChatContextAssembler.aifetchly` | ✅ extend | ⬜ pending |
| Tool-allowlist runtime intersection (unchanged path) | 01 | 1 | AGT-02 | V4/Elevation | Dynamic defs flow through AgentToolPolicyService | unit | `npx vitest run --config vite.main.config.mjs agentToolPolicyService` | ✅ extend | ⬜ pending |
| `agent-tool-invalid` parse-time diagnostic (non-fatal) | 01 | 1 | AGT-02/DX-01 | — | Does not block registration | unit | `npx vitest run --config vite.main.config.mjs agentFrontmatter` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/vitest/main/service/AgentDefinitionRegistry.test.ts` — AGT-01 (replaces existing utilitycode test; built-ins stay testable via `listBuiltIns()`)
- [ ] `test/vitest/main/service/agentFrontmatter.test.ts` — AGT-02 (validation order + D-ToolDiagnostic)
- [ ] `test/vitest/main/service/AIFetchlyConfigLoader.agents.test.ts` — AGT-02 global scan (mirror `.commands.test.ts`)
- [ ] Extend `AIFetchlyRuntimeRegistrySync.trust.test.ts` — agent trust cases (TRS-01)
- [ ] Extend `WorkspaceConfigScanner.test.ts` — agent scan cases
- [ ] Extend `SlashCommandDispatcher.test.ts` — `/agents` show_result branch
- [ ] Extend `AIChatContextAssembler.aifetchly.test.ts` — available-agents block + ordinal
- [ ] Extend `runSubagentTool.test.ts` — updated agentId description + registry-first dispatch
- [ ] Extend `AgentRuntime.test.ts` — registry-first resolution with DB fallback
- [ ] Extend `WorkerNoDbBoundary.test.ts` — WAT-02 grep gate after `tryReadAgentFiles`

*Framework install: none — Vitest + Mocha already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `~/.aifetchly/agents/lead-researcher.md` → appears in `/agents` output | AGT-02/SC1 | Requires live app + filesystem outside test tmpdir | Create `~/.aifetchly/agents/lead-researcher.md`, open AiChatV2, run `/agents`, confirm `user:agent:lead-researcher` row |
| Model dispatches `run_subagent` with scoped ID from available-agents block | AGT-03/SC2 | Requires live AI model dispatch round-trip | With a dynamic agent registered, prompt the model to use the agent; confirm `run_subagent` is called with the exact scoped ID |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
