---
status: testing
phase: 16-dynamic-agents
source: [16-VERIFICATION.md]
started: 2026-07-09T11:38:04Z
updated: 2026-07-09T11:38:04Z
---

## Current Test

number: 1
name: Live-app /agents lists a user agent (SC1)
expected: |
  With a valid ~/.aifetchly/agents/lead-researcher.md present and AiFetchly
  running, /agents shows "user:agent:lead-researcher - <name>: <description>
  [user]" and the D-Discovery "Available agents" context block contains the
  same scoped id.
awaiting: user response

## Tests

### 1. Live-app /agents lists a user agent (SC1)
expected: Create ~/.aifetchly/agents/lead-researcher.md with valid frontmatter (name, description, tools allowlist, prompt body). Open AiChatV2. Run /agents. Confirm it lists "user:agent:lead-researcher" with a [user] source badge. Confirm the D-Discovery "Available agents" context block contains the scoped id.
result: [pending]

### 2. Live-AI run_subagent dispatches a dynamic agent (SC2)
expected: In AiChatV2, prompt the model to delegate a research task to the lead-researcher agent. Confirm run_subagent fires with the EXACT scoped id (user:agent:lead-researcher) copied from the Available agents block (not a fuzzy/bare id), and the agent executes with its tool allowlist intersected at runtime by AgentToolPolicyService.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
