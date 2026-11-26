import { describe, expect, it } from "vitest";
import {
  ChatCompletionDecisionClient,
  type ChatDecisionCapabilities,
} from "@/service/browserDecision/DecisionClients";
import { probeChatDecisionCapabilities } from "@/service/browserDecision/ChatCapabilityProbe";
import type { BrowserDecisionInput } from "@/entityTypes/browserDecisionTypes";

/**
 * R01/D-FR-18: the chat output mode is NEGOTIATED — verified JSON Schema
 * first, forced tool call second, then the legacy json_object/text pair.
 * Capabilities come from the settings probe; a mode never probed true is
 * never attempted.
 */

const baseInput: BrowserDecisionInput = {
  schema_version: 1,
  request_id: "req_1",
  task_id: "task_1",
  step_id: "step_1",
  observation_id: "obs_1",
  page_revision: 2,
  goal: "open search",
  subgoal: null,
  constraints: [],
  completion_criteria: [],
  url: "https://www.example.test/",
  title: "Example",
  candidates: [],
  recent_actions: [],
  allowed_operations: ["CLICK", "DONE", "ESCALATE"],
  deadline_ms: 3_000,
};

const decidedJson = JSON.stringify({
  status: "decided",
  action: {
    operation: "CLICK",
    target_id: "e_1",
    option_id: null,
    key: null,
    url: null,
    text: null,
  },
  uncertainty: { source: "unavailable", confidence: null },
});

const caps: ChatDecisionCapabilities = {
  structuredJsonSchema: true,
  forcedToolDecision: true,
};

describe("ChatCompletionDecisionClient output negotiation (R01/D-FR-18)", () => {
  it("attempt 1 uses verified json_schema when the probe reported it", async () => {
    const seen: Array<unknown> = [];
    const client = new ChatCompletionDecisionClient(
      async (request) => {
        seen.push(request.response_format);
        return {
          choices: [{ message: { content: decidedJson } }],
        };
      },
      undefined,
      undefined,
      caps
    );
    const decision = await client.decide(baseInput, new AbortController().signal);
    expect(decision.status).toBe("decided");
    expect(seen[0]).toMatchObject({
      type: "json_schema",
      json_schema: { name: "browser_decision" },
    });
  });

  it("attempt 2 falls back to a FORCED TOOL CALL and parses its arguments", async () => {
    const formats: Array<unknown> = [];
    let calls = 0;
    const client = new ChatCompletionDecisionClient(
      async (request) => {
        calls++;
        formats.push(request.response_format);
        if (calls === 1) {
          throw new Error("json_schema unsupported");
        }
        expect(request.tool_choice).toMatchObject({
          type: "function",
          function: { name: "propose_browser_decision" },
        });
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { name: "propose_browser_decision", arguments: decidedJson } },
                ],
              },
            },
          ],
        };
      },
      undefined,
      undefined,
      caps
    );
    const decision = await client.decide(baseInput, new AbortController().signal);
    expect(decision.status).toBe("decided");
    expect(calls).toBe(2);
    // The ladder: schema first, forced tool second (no response_format
    // needed for the tool call beyond the fallback).
    expect(formats[1]).toMatchObject({ type: "text" });
  });

  it("a TOOL-ONLY provider starts with the forced tool (B04 best-mode ladder)", async () => {
    const formats: Array<unknown> = [];
    const toolsSeen: Array<unknown> = [];
    let calls = 0;
    const client = new ChatCompletionDecisionClient(
      async (request) => {
        calls++;
        formats.push(request.response_format);
        toolsSeen.push(request.tools ?? null);
        if (calls === 1) {
          // Attempt 1 = forced tool (json_object may be unsupported).
          return {
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "propose_browser_decision",
                        arguments: decidedJson,
                      },
                    },
                  ],
                },
              },
            ],
          };
        }
        return { choices: [{ message: { content: decidedJson } }] };
      },
      undefined,
      undefined,
      { structuredJsonSchema: false, forcedToolDecision: true }
    );
    const decision = await client.decide(baseInput, new AbortController().signal);
    expect(decision.status).toBe("decided");
    // The ladder STARTED with the forced tool — no json_object attempt
    // happened before it (the old code always led with json_object).
    expect(toolsSeen[0]).not.toBeNull();
    expect(formats[0]).toMatchObject({ type: "text" });
    expect(calls).toBe(1);
  });

  it("plain content in FORCED-tool mode is an attempt failure, not a decision (B04)", async () => {
    let calls = 0;
    const client = new ChatCompletionDecisionClient(
      async (request) => {
        calls++;
        if (request.tool_choice) {
          // The provider answered with prose instead of the tool call.
          return { choices: [{ message: { content: "I cannot use tools" } }] };
        }
        return { choices: [{ message: { content: decidedJson } }] };
      },
      undefined,
      undefined,
      { structuredJsonSchema: false, forcedToolDecision: true }
    );
    const decision = await client.decide(baseInput, new AbortController().signal);
    // Attempt 2 (json_object) succeeds — the tool-mode prose never acted.
    expect(decision.status).toBe("decided");
    expect(calls).toBe(2);
  });

  it("a mode never probed true is never attempted (legacy ladder preserved)", async () => {
    const formats: Array<unknown> = [];
    const toolsSeen: Array<unknown> = [];
    const client = new ChatCompletionDecisionClient(
      async (request) => {
        formats.push(request.response_format);
        toolsSeen.push(request.tools);
        return {
          choices: [{ message: { content: decidedJson } }],
        };
      }
      // No capabilities passed — conservative defaults.
    );
    const decision = await client.decide(baseInput, new AbortController().signal);
    expect(decision.status).toBe("decided");
    expect(formats[0]).toMatchObject({ type: "json_object" });
    expect(toolsSeen[0]).toBeUndefined();
    // Reported capabilities stay honest.
    const capsNow = await client.getCapabilities(new AbortController().signal);
    expect(capsNow.supportsStructuredJsonSchema).toBe(false);
    expect(capsNow.supportsForcedToolDecision).toBe(false);
  });

  it("reports probed capabilities through getCapabilities", async () => {
    const client = new ChatCompletionDecisionClient(
      async () => ({ choices: [{ message: { content: decidedJson } }] }),
      undefined,
      undefined,
      caps
    );
    const capsNow = await client.getCapabilities(new AbortController().signal);
    expect(capsNow.supportsStructuredJsonSchema).toBe(true);
    expect(capsNow.supportsForcedToolDecision).toBe(true);
  });

  it("a rate-limited first attempt waits longer than a parse failure (M-FR-10)", async () => {
    let calls = 0;
    const started = Date.now();
    const client = new ChatCompletionDecisionClient(
      async () => {
        calls++;
        if (calls === 1) {
          throw new Error("HTTP 429 too many requests: slow down");
        }
        return { choices: [{ message: { content: decidedJson } }] };
      }
    );
    await client.decide(baseInput, new AbortController().signal);
    // The 429 backoff is 5s (vs 1s for other failures) — bounded, and the
    // retry still lands inside the 2-attempt ceiling.
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_500);
    expect(calls).toBe(2);
  }, 15_000);
});

describe("probeChatDecisionCapabilities (R01/PRD §7)", () => {
  it("reports the three capabilities separately", async () => {
    const requests: Array<unknown> = [];
    const result = await probeChatDecisionCapabilities(async (request) => {
      requests.push(request.response_format ?? request.tool_choice);
      if (request.tool_choice) {
        // The forced probe answers through the EXACT tool.
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "probe_ok",
                      arguments: '{"ok": true}',
                    },
                  },
                ],
              },
            },
          ],
        };
      }
      return { choices: [{ message: { content: '{"ok": true}' } }] };
    });
    expect(result).toMatchObject({
      chat: true,
      structuredJsonSchema: true,
      forcedToolDecision: true,
    });
    // Three probes ran in order: plain text, json_schema, forced tool
    // (B04: the chat probe is PLAIN — a text-only provider is probeable).
    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({ type: "text" });
    expect(requests[1]).toMatchObject({ type: "json_schema" });
    expect(requests[2]).toMatchObject({
      type: "function",
      function: { name: "probe_ok" },
    });
  });

  // B04/D-AC-08: ordinary PROSE must not certify a mode — the payload
  // must actually parse and satisfy the probe contract.
  it("prose replies do NOT certify structured or forced modes", async () => {
    const result = await probeChatDecisionCapabilities(async () => ({
      choices: [{ message: { content: "Sure, I support everything!" } }],
    }));
    expect(result.chat).toBe(true);
    expect(result.structuredJsonSchema).toBe(false);
    expect(result.structuredError).toBe("structured_unparseable");
    expect(result.forcedToolDecision).toBe(false);
  });

  it("a forced call with the WRONG tool name does not certify forced mode", async () => {
    const result = await probeChatDecisionCapabilities(async (request) => {
      if (request.tool_choice) {
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { name: "other_tool", arguments: '{"ok":true}' } },
                ],
              },
            },
          ],
        };
      }
      return { choices: [{ message: { content: '{"ok": true}' } }] };
    });
    expect(result.chat).toBe(true);
    expect(result.forcedToolDecision).toBe(false);
    expect(result.forcedToolError).toBe("forced_tool_wrong_name");
  });

  it("a structured payload with ok:false does not certify structured mode", async () => {
    const result = await probeChatDecisionCapabilities(async (request) => {
      if (
        request.response_format &&
        "json_schema" in (request.response_format as object)
      ) {
        return { choices: [{ message: { content: '{"ok": false}' } }] };
      }
      return { choices: [{ message: { content: '{"ok": true}' } }] };
    });
    expect(result.structuredJsonSchema).toBe(false);
    expect(result.structuredError).toBe("structured_bad_payload");
  });

  it("a failed chat probe skips the other probes and reports their failures", async () => {
    let calls = 0;
    const result = await probeChatDecisionCapabilities(async () => {
      calls++;
      throw new Error("endpoint down");
    });
    expect(calls).toBe(1);
    expect(result.chat).toBe(false);
    expect(result.structuredJsonSchema).toBe(false);
    expect(result.forcedToolDecision).toBe(false);
    expect(result.structuredError).toBe("chat_probe_failed");
  });

  it("a structured-only failure is reported with its reason, chat still passes", async () => {
    let calls = 0;
    const result = await probeChatDecisionCapabilities(async (request) => {
      calls++;
      if (
        request.response_format &&
        "json_schema" in (request.response_format as object)
      ) {
        throw new Error("json_schema rejected");
      }
      if (request.tool_choice) {
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { name: "probe_ok", arguments: '{"ok": true}' } },
                ],
              },
            },
          ],
        };
      }
      return { choices: [{ message: { content: '{"ok": true}' } }] };
    });
    expect(result.chat).toBe(true);
    expect(result.structuredJsonSchema).toBe(false);
    expect(result.structuredError).toBe("json_schema rejected");
    expect(result.forcedToolDecision).toBe(true);
    expect(calls).toBe(3);
  });
});
