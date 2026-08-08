# Phase 16: Dynamic Agents - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 16-dynamic-agents
**Areas discussed:** Name precedence, AI discovery & IDs, /agents & diagnostics

---

## Gray areas offered (multiSelect)

| Area | Discussed? |
|------|------------|
| Custom-agent schema (author-settable fields, outputSchema) | Declined by user — deferred to Claude's Discretion |
| Name precedence (user vs workspace) | ✓ |
| AI discovery & IDs | ✓ |
| /agents & diagnostics | ✓ |

---

## Name Precedence

**Question:** When a user-global agent and a trusted-workspace agent share the same name, which wins?

| Option | Description | Selected |
|--------|-------------|----------|
| Workspace wins (match commands) | Trusted workspace agent shadows user-global. Matches Phase 15 D-03 + CommandRegistry SOURCE_RANK. Deviates from literal AGT-01. | |
| User wins (follow AGT-01) | built-in > user > trusted workspace > plugin, exactly as AGT-01 / tech-design §7.4. | ✓ |
| You decide | Claude picks during planning. | |

**User's choice:** User wins (follow AGT-01)
**Notes:** Order is `built-in > user > trusted workspace > plugin`; built-ins unshadowable. This diverges from commands (where workspace wins) — accepted. Divergence must be documented in source.

---

## AI discovery & IDs

**Question 1:** How should the AI model discover which dynamic agents are available to call via run_subagent?

| Option | Description | Selected |
|--------|-------------|----------|
| Dynamic tool description | Rebuild run_subagent description on registry change, enumerating agent IDs + descriptions. | |
| Context injection | "Available agents" block in AiChatV2 system message via AIChatContextAssembler (AGENTS.md path). | ✓ |
| Static description only | Generic description; rely on user naming agents. | |
| You decide | Claude picks. | |

**User's choice:** Context injection
**Notes:** run_subagent description stays generic; reuses Phase 13/14 injection infra; decoupled from tool def.

**Question 2:** Does run_subagent require the exact ID as listed, or also resolve bare names by precedence?

| Option | Description | Selected |
|--------|-------------|----------|
| Exact IDs only | ID verbatim from the available-agents block (bare built-in or scoped dynamic); resolve via getById. | ✓ |
| Also resolve bare names | Additionally resolve a bare name by precedence across sources. | |
| You decide | Claude picks. | |

**User's choice:** Exact IDs only
**Notes:** No fuzzy bare-name resolution; unknown IDs return a clear error. Sharpens AGT-03 validation.

---

## /agents & diagnostics

**Question 1:** What should the /agents built-in command list for each agent?

| Option | Description | Selected |
|--------|-------------|----------|
| id+name+desc+source badge | One row: id, name, description, source badge; sorted by precedence. | ✓ |
| Full detail | Above + allowedTools count, maxToolCalls, maxRuntimeMs, status. | |
| Minimal | id + name + description only. | |
| You decide | Claude picks. | |

**User's choice:** id+name+desc+source badge
**Notes:** Mirrors slash-suggestions source badges + /status shape. Reuses Phase 13 source-badge i18n keys.

**Question 2:** Should an unknown tool name in an agent's tools: list produce a parse-time diagnostic, or stay silent until runtime?

| Option | Description | Selected |
|--------|-------------|----------|
| Parse-time warning | Non-fatal DX-01 agent-tool-invalid diagnostic; does not block registration. | ✓ |
| Runtime-only (silent) | No parse-time check; AgentToolPolicyService intersects at runtime. | |
| You decide | Claude picks. | |

**User's choice:** Parse-time warning
**Notes:** Motivated by the built-in lead-researcher's stale google_search ref that was removed by hand. Aligns with reserved DX-01 code. Accepted: late-loading tools may produce a stale (non-fatal) warning until rescan.

---

## Claude's Discretion

- **Custom-agent frontmatter schema** (the area the user declined to discuss): default author-settable fields to the PRD §7.4 example (name, description, tools, maxToolCalls, maxRuntimeMs, prompt body); system-default mode/version/status/maxContinueCalls; outputSchema authoring deferred. Researcher to confirm exact field set + validator order.
- Exact replaceSource/rank-map data structure (mirror CommandRegistry SOURCE_RANK + rebuildNameIndex with the agent rank order).
- Where the "Available agents" context block assembles.
- Diagnostic wording; test granularity (registry vs dispatch vs both).

## Deferred Ideas

- outputSchema authoring in agents/*.md (structured JSON output) — needs its own validation + trust story.
- Plugin-sourced agents (plugin:<name>:agent:) — Phase 18 (SKL-02); reserve the rank now.
- Bare-name fuzzy resolution in run_subagent — rejected for Phase 16.
- Per-capability workspace trust (agents flag) — Phase 17 (TRS-02).
- Conflict diagnostic for same-name user-vs-workspace collisions — deferred (silent shadow per D-Precedence).
