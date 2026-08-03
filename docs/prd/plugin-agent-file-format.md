# Plugin Agent File Format

This document describes how a plugin ships **subagents** — Markdown agent
definition files parsed into `AgentDefinition` records and consumed by the
existing aiFetchly agent runtime.

- PRD: `docs/prd/plugin-subagent-management-prd.md`
- Technical design: `docs/prd/plugin-subagent-management-technical-design.md`
- Implementation plan: `docs/prd/plugin-subagent-management-plan.md`

## 1. Declaring agents in a manifest

### Native aiFetchly manifest (`.aifetchly-plugin/plugin.json`)

Add an optional `agents` array of plugin-relative paths (files or directories):

```json
{
  "name": "lead-pack",
  "version": "1.0.0",
  "description": "Lead workflow helpers",
  "skills": ["skills/research/manifest.json"],
  "agents": ["agents/researcher.md", "extra-agents/verifier.md"]
}
```

A plugin may ship **only agents** (no skills / MCP servers) — the "at least one
of skills, mcpServers, or agents" rule accepts agent-only plugins.

### Claude-compatible manifest (`.claude-plugin/plugin.json`)

`agents` accepts several forms:

```json
{ "agents": true }                       // scan the default agents/ directory
{ "agents": "agents/reviewer.md" }       // a single path
{ "agents": ["agents/a.md", "extra/b.md"] } // multiple paths
{ "agents": { "reviewer": {}, "verifier": { "source": "extra/v.md" } } } // map
```

- `true` → scans `agents/` recursively for `.md` files.
- Object-map keys default to `agents/<key>.md`; a `source` string overrides the
  path. Inline `content` is **not** supported (file imports only) and is
  rejected with `agent-unsupported-field`.
- If `agents` is absent but an `agents/` directory exists, it is auto-detected.

## 2. Agent Markdown file

A Markdown file with YAML frontmatter and a Markdown body. The body becomes the
agent's `systemPrompt`.

```markdown
---
name: reviewer
description: Reviews campaign drafts for accuracy, tone, and compliance.
tools: [knowledge_library_search]
model: gpt-5-mini
mode: verifier
maxTurns: 8
color: blue
---

You are a campaign review specialist.

Rules:
1. Check every factual claim against provided source-backed findings.
2. Do not write new campaign copy unless asked.
3. Return JSON with risk level, findings, and recommendations.
```

### Required frontmatter

- `name` — non-empty; sanitized to `/^[a-z0-9][a-z0-9_-]*$/`. A bad/empty name
  is a hard error (the file is rejected, not silently renamed).
- `description` — non-empty.

The Markdown body must be non-empty.

### Optional supported frontmatter

| Field | Maps to | Notes |
| --- | --- | --- |
| `tools` | `allowedTools` | string array |
| `skills` | `allowedTools` | unioned with `tools` |
| `model` | `defaultModel` | string |
| `mode` | `mode` | `coordinator`/`specialist`/`verifier`/`formatter`; default `specialist` |
| `maxTurns` | `maxContinueCalls` | integer |
| `maxToolCalls` | `maxToolCalls` | integer |
| `maxRuntimeMs` | `maxRuntimeMs` | integer |
| `outputSchema` | `outputSchema` | object only |
| `color` / `background` / `effort` | `manifest.*` | stored for diagnostics only |

### Forbidden / ignored fields

These are **ignored** and surfaced as recoverable `agent-unsupported-field`
warnings in diagnostics. They never affect runtime:

- `permissionMode`
- `hooks`
- `mcpServers`
- `alwaysAllow`
- `disallowedTools`
- `mcp`
- `servers`

This preserves aiFetchly's security posture: a plugin agent cannot escalate
privileges, register hooks, or spawn MCP servers from its frontmatter. Tool
access is still narrowed at runtime by `AgentToolPolicyService`.

## 3. Agent ID generation

- Plugin agents: `<plugin-name>:<agent-name>`.
- Nested directories become deeper namespaces:
  `<plugin-name>:<nested-dir>:<agent-name>`. The frontmatter `name` is always
  the final segment.
- IDs must be unique within a plugin (duplicate IDs fail import).

Example: `agents/review/security.md` with `name: strict` under plugin
`lead-pack` → `lead-pack:review:strict`.

Manual agents created in the UI use `user:<slug>` and cannot collide with
built-in or plugin agent IDs.

## 4. Import behavior

- Agent import **never executes plugin code** — it only reads JSON/Markdown,
  parses frontmatter, copies files, and persists database rows.
- Every declared path is resolved relative to the plugin root; paths escaping
  the plugin directory (`../`) are rejected with `agent-path-invalid`.
- Invalid declared agents (missing `name`/`description`, empty body, bad path,
  duplicate ID) **fail the whole import atomically** — no partial rows remain.
- Warnings (forbidden/unknown fields) do **not** fail import; the plugin stays
  `healthy` and warnings appear in Diagnostics.

## 5. Enablement

- Plugin agents are enabled by default when the plugin is enabled.
- Disabling the plugin hides all its agents from the runtime catalog (the
  per-agent enabled state is preserved and restored on re-enable).
- Disabling a single agent hides only that agent.
- Built-in agents cannot be deleted; plugin agents are read-only except for
  enable/disable (uninstall the plugin to remove them); manual agents can be
  edited, toggled, and deleted.

## 6. Runtime

Plugin-installed subagents are definitions, not separate processes. They are
invoked by the existing `AgentRuntime`. The active runtime catalog includes
only agents that are `active` **and** `healthy` **and** (for plugin agents)
owned by an enabled plugin.

---

## Release notes

- **New capability:** plugins may now ship subagents via an `agents/` directory
  or an `agents` manifest declaration. Previously, Claude-compatible plugins'
  `agents` fields were carried opaquely and never installed.
- **Behavior change for Claude plugins:** a Claude-compatible plugin with an
  `agents` declaration (or an `agents/` directory) will now install those
  subagents as **active capabilities** where they were previously ignored.
  Users who relied on `agents` being inert should disable the unwanted agents
  from System Settings → Subagents or the plugin's Subagents tab.
- **New UI:** System Settings → Subagents lists built-in, plugin-installed, and
  manually created agents; plugin detail panels gain a Subagents tab.
- **Agent-only plugins** (no skills / MCP servers) are now valid.
