# Phase 4 (Commands & Agents) — Deferral Rationale

**Status:** Deferred indefinitely
**Date:** 2026-07-03
**Scope:** Claude plugin `commands/`, `agents/` component types

## Summary

Phase 4 of the Claude Plugin Compatibility PRD covers plugin-contributed
**slash commands** and **subagents**. After investigation, both are
infeasible without first building consumers that don't exist in AiFetchly
today. This document records what was investigated, what's missing, and
the work that would be required to enable Phase 4.

## Investigation Findings

### Slash Commands

**No slash-command surface exists in AiChatV2.**

The chat composer (`src/views/components/aiChatV2/AiChatV2Composer.vue`)
emits raw text via `@send`. `AiChatV2.vue` receives this in `onSend`
(line 1407) and passes it directly to the AI chat system without
interpreting `/foo`-style prefixes. There is no `commandRegistry`,
`slashCommand`, or `commandDispatch` pattern anywhere in the renderer.

Enabling plugin commands would require building from scratch:
1. A command parser in the composer (detect `/`-prefixed input).
2. A command registry that aggregates built-in + plugin-contributed commands.
3. A dispatch path that runs the command and returns its output to the chat.
4. A permission model (commands can do anything — same risk profile as skills).
5. UI for command autocomplete/discovery.

This is a substantial feature on its own; bolting it onto plugin compat
is not appropriate. Slash commands should be designed as a first-class
AiChatV2 feature, after which plugin-contributed commands become a thin
addition.

### Subagents

**The `run_subagent` tool exists but the agent registry is hard-coded
to built-ins.**

- `src/service/agentTools/runSubagentTool.ts` defines the tool (line 109).
- `AgentRuntimeRegistry.getRuntime().runSync()` executes agents (line 147).
- `src/service/AgentDefinitionRegistry.ts` only returns built-in agents:
  ```typescript
  getById(id: string): AgentDefinitionView | null {
    const found = BUILT_INS.find((d) => d.id === id);
    return found ? { ...found } : null;
  }
  ```

Enabling plugin agents would require:
1. Extending `AgentDefinitionRegistry` to support dynamic agent registration.
2. Modifying `runSubagentTool.ts` to accept plugin agent IDs.
3. Loading plugin agent definitions from `agents/*.md` files (markdown
   with frontmatter — same shape as skills but different semantics).
4. Validation of plugin agent definitions (security: agents can dispatch
   further tools; trust model needs review).
5. Lifecycle: register on plugin enable, unregister on disable/uninstall.

This is a smaller lift than slash commands but still non-trivial. The
subagent dispatch path is also relatively new code with its own design
constraints; piling plugin support on top before the runtime matures
risks rework.

## Recommended Prerequisites

Before Phase 4 is reactivated:

1. **Slash commands**: ship a first-class AiChatV2 slash-command system
   with at least 3 built-in commands. Then add a plugin-contributed
   command hook.
2. **Subagents**: let the existing `run_subagent` tool stabilize through
   a few real use cases. Then extend `AgentDefinitionRegistry` to accept
   plugin-contributed agents.

## What Ships Without Phase 4

Claude plugins installed in AiFetchly today will have their `commands/`
and `agents/` declarations **carried opaquely** through the manifest
adapter (see `ClaudePluginAdapter.ts` — these fields land in
`adapted.opaque`). They survive round-trip and won't break the install,
but the runtime ignores them. Plugin authors can still ship skills, MCP
servers, and hooks; commands and agents silently no-op until Phase 4
ships.

This matches Claude Code's own model where unsupported component types
in a manifest are ignored rather than rejected.
