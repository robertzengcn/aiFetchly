# DEBUG REPORT: Subagent Uses Exhausted Server Default Model

Date: 2026-07-21

## Symptom

Running `caveman:cavecrew-investigator` from AiFetchly chat failed with:

```text
AI server returned finish_reason=error
```

The parent chat was using `deepseek-v4-flash`.

## Root Cause

Docker logs from `aifetchly-aiserver` showed repeated upstream failures for `qwen3.7-plus`:

```text
OpenAI streaming API error 403 ... insufficient_quota
```

The parent chat request used `deepseek-v4-flash`, but `run_subagent` did not pass the parent model into `AgentRuntime`. After the previous Claude-agent compatibility fix removed the unsupported `haiku` alias, the child agent request had no model, so the AI server selected its default active model, `qwen3.7-plus`. That default model's upstream quota is exhausted.

## Fix

Added `model?: string` to `SkillExecutionContext`, populated it from `AIChatQueryLoop` for both async and synchronous tool execution paths, and forwarded it from `run_subagent` into `RunAgentRequest`.

This keeps child subagent runs on the same selected model as the parent chat unless the agent explicitly defines a supported model.

## Evidence

Docker runtime evidence:

```text
aifetchly-aiserver -> qwen3.7-plus -> 403 insufficient_quota
```

Regression tests:

```text
yarn vitest run --config vite.main.config.mjs test/vitest/main/service/runSubagentTool.test.ts test/vitest/main/service/AIChatQueryLoopAsyncPoll.test.ts test/vitest/main/service/AgentRuntime.test.ts
yarn vitest run --config vite.main.config.mjs test/vitest/main/service/AIChatQueryLoop.test.ts
```

All passed.

## Status

DONE
