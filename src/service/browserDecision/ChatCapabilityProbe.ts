/**
 * Chat decision capability probe (R01/D-FR-18; PRD §7).
 *
 * The settings connection test runs THREE separate probes so the panel can
 * report them independently (PRD §7: "A passing /models or chat test does
 * not certify native decisions"):
 *   1. chat        — a minimal plain completion round-trips.
 *   2. structured  — a minimal response_format=json_schema request is
 *                    accepted (verified output).
 *   3. forced tool — a minimal tool_choice-forced request is accepted.
 *
 * Each probe is ONE bounded request (10s deadline) and each failure is
 * reported, never thrown — the panel shows per-capability verdicts. The
 * probed flags persist on decisionRoute.chatCapabilities so the decision
 * client negotiates only modes the endpoint actually supports.
 */
import type { ChatCompletionLike } from "@/service/browserDecision/DecisionClients";

export interface ChatDecisionProbeResult {
  /** A minimal completion round-trips (the chat route itself). */
  readonly chat: boolean;
  /** response_format=json_schema is accepted (verified output). */
  readonly structuredJsonSchema: boolean;
  /** A forced tool call (tool_choice) is accepted. */
  readonly forcedToolDecision: boolean;
  /** Safe failure reasons per probe (null when that probe passed). */
  readonly structuredError: string | null;
  readonly forcedToolError: string | null;
}

const PROBE_TIMEOUT_MS = 10_000;

type CompleteFn = (
  request: {
    messages: ReadonlyArray<{ role: string; content: string }>;
    model?: string;
    response_format?:
      | { type: "json_object" | "text" }
      | {
          type: "json_schema";
          json_schema: {
            name: string;
            strict?: boolean;
            schema: Record<string, unknown>;
          };
        };
    tools?: ReadonlyArray<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>;
    tool_choice?: { type: "function"; function: { name: string } };
    temperature?: number;
  },
  signal: AbortSignal
) => Promise<ChatCompletionLike>;

const PROBE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

/** Run one bounded probe request; return whether it round-tripped. */
async function runProbe(
  complete: CompleteFn,
  build: () => Parameters<CompleteFn>[0]
): Promise<{ ok: boolean; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await complete(build(), controller.signal);
    const hasAnswer =
      (response.choices?.[0]?.message?.content ?? "").length > 0 ||
      (response.choices?.[0]?.message?.tool_calls?.length ?? 0) > 0;
    return { ok: hasAnswer, error: hasAnswer ? null : "empty_probe_response" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe the user's chat endpoint for the decision output modes. `complete`
 * is the SAME completion seam the decision client uses (settings panel and
 * runner share one transport).
 */
export async function probeChatDecisionCapabilities(
  complete: CompleteFn,
  model?: string
): Promise<ChatDecisionProbeResult> {
  const messages = [
    {
      role: "system",
      content: "You are a capability probe. Reply with the JSON object {\"ok\": true}.",
    },
    { role: "user", content: "Probe: reply {\"ok\": true}." },
  ] as const;

  // 1. The chat route itself (plain completion).
  const chatProbe = await runProbe(complete, () => ({
    messages,
    ...(model ? { model } : {}),
    response_format: { type: "json_object" } as const,
    temperature: 0,
  }));

  // 2. Verified JSON Schema output.
  const structuredProbe = chatProbe.ok
    ? await runProbe(complete, () => ({
        messages,
        ...(model ? { model } : {}),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "probe",
            strict: false,
            schema: PROBE_SCHEMA,
          },
        },
        temperature: 0,
      }))
    : { ok: false, error: "chat_probe_failed" };

  // 3. Forced tool call.
  const forcedProbe = chatProbe.ok
    ? await runProbe(complete, () => ({
        messages,
        ...(model ? { model } : {}),
        tools: [
          {
            type: "function" as const,
            function: {
              name: "probe_ok",
              description: "Report the probe result.",
              parameters: PROBE_SCHEMA,
            },
          },
        ],
        tool_choice: { type: "function" as const, function: { name: "probe_ok" } },
        temperature: 0,
      }))
    : { ok: false, error: "chat_probe_failed" };

  return {
    chat: chatProbe.ok,
    structuredJsonSchema: structuredProbe.ok,
    forcedToolDecision: forcedProbe.ok,
    structuredError: structuredProbe.ok ? null : structuredProbe.error,
    forcedToolError: forcedProbe.ok ? null : forcedProbe.error,
  };
}
