// src/service/AIAutoDreamJsonRepair.ts
//
// Shared JSON-repair helper for the user and workspace auto-dream services.
// When the small model returns non-empty but invalid consolidation JSON, the
// service sends ONE repair request on the same lightweight route with the
// invalid output and the required schema. Never resends the full source
// prompt unless needed. Never falls back to the normal model
// (tech-design §9.4). Secret/semantic validation failure is not repairable.
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import { openAIContentToString } from "@/api/aiChatApi";
import type {
  AIChatLightweightCompletionInput,
  AIChatLightweightCompletionResult,
} from "@/service/AIChatLightweightTypes";

/** A parsed consolidation result — the parts the repair helper needs. */
export interface AutoDreamParseLike {
  readonly ok: boolean;
}

/**
 * Attempt one same-route JSON repair of an invalid consolidation output.
 *
 * @returns the repaired parse result when the repair produced valid output,
 *          otherwise the original (still-invalid) `parsed` so the caller
 *          surfaces the parse error and fails the run without DB mutations.
 *
 * The caller is responsible for having already decided the first response was
 * non-empty-but-invalid (`!parsed.ok && raw.trim().length > 0`). Secret /
 * semantic validation failure is NOT repairable and must not reach this
 * helper.
 */
export async function attemptAutoDreamJsonRepair<P extends AutoDreamParseLike>(
  input: {
    workload: AIChatLightweightCompletionInput["workload"];
    invalidRaw: string;
    parsed: P;
    manual: boolean;
    completeLightweight: (
      input: AIChatLightweightCompletionInput
    ) => Promise<AIChatLightweightCompletionResult>;
    /** Re-parse the repair output. Receives the raw model output string. */
    parse: (raw: string) => P;
  }
): Promise<P> {
  const repairMessages: OpenAIChatMessage[] = [
    {
      role: "system",
      content:
        "Return ONLY valid JSON matching the consolidation schema. " +
        "Fix the syntax errors in the provided output.",
    },
    {
      role: "user",
      content: `Invalid output to repair:\n${input.invalidRaw.slice(0, 4000)}`,
    },
  ];
  const repairResult = await input.completeLightweight({
    workload: input.workload,
    messages: repairMessages,
    manual: input.manual,
  });
  const repairRaw = openAIContentToString(
    repairResult.response.choices?.[0]?.message?.content
  );
  const repaired = input.parse(repairRaw);
  return repaired.ok ? repaired : input.parsed;
}
