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

const PROBE_TOOL_NAME = "probe_ok";

/**
 * B04/D-AC-08: a probe VERIFIES the payload — a mere presence check
 * accepted ordinary prose for every mode. Requirements per probe:
 *   chat        → any nonempty plain completion (basic round-trip);
 *   structured  → json_schema response whose content PARSES to
 *                 {ok:true} (the schema actually held);
 *   forced tool → tool_calls[0] with the EXACT probe tool name and
 *                 arguments parsing to {ok:true}.
 */
function probePayloadOk(
  response: ChatCompletionLike,
  mode: "chat" | "structured" | "forced"
): { ok: boolean; error: string | null } {
  const message = response.choices?.[0]?.message;
  if (!message) {
    return { ok: false, error: "empty_probe_response" };
  }
  if (mode === "forced") {
    const call = message.tool_calls?.[0];
    if (!call?.function?.name) {
      return { ok: false, error: "forced_tool_missing_call" };
    }
    // The EXACT tool name — any other call is a wrong answer, not support.
    if (call.function.name !== PROBE_TOOL_NAME) {
      return { ok: false, error: "forced_tool_wrong_name" };
    }
    try {
      const args = JSON.parse(call.function.arguments ?? "") as {
        ok?: unknown;
      };
      if (args.ok !== true) {
        return { ok: false, error: "forced_tool_bad_arguments" };
      }
      return { ok: true, error: null };
    } catch {
      return { ok: false, error: "forced_tool_bad_arguments" };
    }
  }
  const content = message.content ?? "";
  if (content.length === 0) {
    return { ok: false, error: "empty_probe_response" };
  }
  if (mode === "chat") {
    // Plain chat: any content round-trips — this is the BASIC probe.
    return { ok: true, error: null };
  }
  // Structured: the schema payload must actually parse and satisfy ok:true.
  try {
    const parsed = JSON.parse(content) as { ok?: unknown };
    if (parsed.ok !== true) {
      return { ok: false, error: "structured_bad_payload" };
    }
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "structured_unparseable" };
  }
}

async function runProbe(
  complete: CompleteFn,
  build: () => Parameters<CompleteFn>[0],
  mode: "chat" | "structured" | "forced"
): Promise<{ ok: boolean; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await complete(build(), controller.signal);
    return probePayloadOk(response, mode);
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

  // 1. The chat route itself (B04: PLAIN text — a provider that supports
  //    plain text but rejects json_object must still be probeable).
  const chatProbe = await runProbe(
    complete,
    () => ({
      messages,
      ...(model ? { model } : {}),
      response_format: { type: "text" } as const,
      temperature: 0,
    }),
    "chat"
  );

  // 2. Verified JSON Schema output (payload verified against ok:true).
  const structuredProbe = chatProbe.ok
    ? await runProbe(
        complete,
        () => ({
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
        }),
        "structured"
      )
    : { ok: false, error: "chat_probe_failed" };

  // 3. Forced tool call (EXACT tool name + arguments verified).
  const forcedProbe = chatProbe.ok
    ? await runProbe(
        complete,
        () => ({
          messages,
          ...(model ? { model } : {}),
          tools: [
            {
              type: "function" as const,
              function: {
                name: PROBE_TOOL_NAME,
                description: "Report the probe result.",
                parameters: PROBE_SCHEMA,
              },
            },
          ],
          tool_choice: {
            type: "function" as const,
            function: { name: PROBE_TOOL_NAME },
          },
          temperature: 0,
        }),
        "forced"
      )
    : { ok: false, error: "chat_probe_failed" };

  return {
    chat: chatProbe.ok,
    structuredJsonSchema: structuredProbe.ok,
    forcedToolDecision: forcedProbe.ok,
    structuredError: structuredProbe.ok ? null : structuredProbe.error,
    forcedToolError: forcedProbe.ok ? null : forcedProbe.error,
  };
}
