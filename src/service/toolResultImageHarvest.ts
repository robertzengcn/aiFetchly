// src/service/toolResultImageHarvest.ts
// Extracts generated/edited image descriptors that a tool result carries in
// `result.outputImages` — e.g. a run_subagent batch worker's persisted edited
// images. Pure + side-effect-free so the chat loop can call it per tool call
// and accumulate the results into the turn's image set (FR-4), which the
// engine then persists and renders like any other generated image. Kept in its
// own module so the unit test does not pull the heavy chat-loop import graph.
import type { OpenAIChatImage } from "@/api/aiChatApi";

/**
 * Read the `outputImages` descriptors off a tool result. Returns an empty
 * array when the tool result has no well-formed `outputImages` array, so it is
 * safe to call for every tool result (non-batch tools contribute nothing).
 */
export function extractToolResultImages(toolResult: {
  result?: Record<string, unknown>;
}): OpenAIChatImage[] {
  // outputImages can sit at two depths:
  //   - result.outputImages — foreground/sync tools, where `result` IS the
  //     tool's payload directly.
  //   - result.result.outputImages — async tools (e.g. run_subagent). Their
  //     execute() returns a bare SkillExecutionResult { success, result: {...} }
  //     that lacks tool_call_id/tool_name/execution_time_ms, so
  //     isToolExecutionResultLike returns false and pollAsyncJobToCompletion
  //     wraps the whole SkillExecutionResult under a SECOND `result` envelope
  //     (AIChatQueryLoop.ts ~line 2032). Reading only result.outputImages
  //     silently drops every async tool's images.
  const outer = toolResult?.result;
  const candidates: unknown[] = [outer?.outputImages];
  const inner = outer?.result;
  if (inner && typeof inner === "object") {
    candidates.push((inner as Record<string, unknown>).outputImages);
  }
  const maybe = candidates.find((c): c is unknown[] => Array.isArray(c));
  if (!maybe) return [];
  const out: OpenAIChatImage[] = [];
  for (const img of maybe) {
    // Trust-boundary shape check: accept only objects that look like an image
    // descriptor (carry at least one string locator). Rejects arbitrary
    // objects/arrays that would otherwise be cast unchecked into the turn's
    // image set. Rendering's isAllowedImageUrl still gates which URLs display.
    if (img && typeof img === "object" && isImageDescriptorLike(img)) {
      out.push(img as OpenAIChatImage);
    }
  }
  return out;
}

function isImageDescriptorLike(value: object): boolean {
  const record = value as Record<string, unknown>;
  return (
    typeof record.url === "string" ||
    typeof record.b64_json === "string" ||
    typeof record.local_path === "string"
  );
}
