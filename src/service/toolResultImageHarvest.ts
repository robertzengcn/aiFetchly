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
  const maybe = toolResult?.result?.outputImages;
  if (!Array.isArray(maybe)) return [];
  const out: OpenAIChatImage[] = [];
  for (const img of maybe) {
    if (img && typeof img === "object") {
      out.push(img as OpenAIChatImage);
    }
  }
  return out;
}
