# Phase 18: Skills and Plugin Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-11
**Phase:** 18-skills-and-plugin-integration
**Areas discussed:** Skill enable model, Skill-ref hook resolution, Plugin promotion transparency

---

## Areas offered (multi-select)

| Area | Discussed? |
|------|------------|
| Workspace skills scope | declined → defaulted (D-WorkspaceSkills in CONTEXT) |
| Skill enable model | ✓ |
| Skill-ref hook resolution | ✓ |
| Plugin promotion transparency | ✓ |

---

## Skill enable model

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-register, gate at call | Discovered skill registered as a tool immediately; existing SkillPermissionService gates each call (mirrors MCP tools; matches PRD §7.5 flow). | ✓ |
| Explicit enable first | Skill not exposed until user "enables" it, then permission-gated. Safer, more friction. | |
| You decide | Claude defaults to auto-register + gate-at-call. | |

**User's choice:** Auto-register, gate at call
**Notes:** Lowest friction; SkillPermissionService is the gate, not a discovery-time opt-in. Per-skill enable/disable UI deferred.

---

## Skill-ref hook resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Resolve to invoke | `skill:<name>` hook ref fires the registered skill; non-fatal skill-registry-not-available only if not registered. Closes Phase 17's loop; matches PRD §7.6. | ✓ |
| Keep as no-op | Leave skill-registry-not-available; resolve post-v2.0. | |

**User's choice:** Resolve to invoke
**Notes:** Rewires `HookDispatcher.skillRefResult` (Phase 17 commit ff640227) from no-op to skill invocation.

---

## Plugin promotion transparency

| Option | Description | Selected |
|--------|-------------|----------|
| Plugin source badge | Promote into native registries but carry a `plugin` source badge (mirrors Phase 13 badges; SOURCE_RANK preserved). | ✓ |
| Transparent | Plugin commands/agents indistinguishable from native/user. | |

**User's choice:** Plugin source badge
**Notes:** Reuses the existing `plugin` source value in SlashCommand/AgentDefinitionView — no new badge UI, just data.

---

## Claude's Discretion

- Manifest schema fields (align to existing SkillImportService/SkillDiagnosticsService contract).
- Skill execution boundary (reuse SandboxedSkillExecutor/SkillWorkerClient).
- options.json conflict mechanism (trace pluginPaths.ts + PluginLoaderService).
- Plugin promotion timing + OpenAI tool-schema mapping.

## Deferred Ideas

- Granular per-skill enable/disable UI.
- Plugin-sourced skills + plugin-sourced hooks.
- Skill marketplace / sharing / remote install.
- Workspace skills (if worker can't carry skill dirs cleanly — researcher may defer; user-global is guaranteed).
- Granular per-capability trust approval UX.
