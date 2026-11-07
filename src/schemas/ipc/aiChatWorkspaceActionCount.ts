import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Zod schema for the renderer-originated workspace action counter (R8 §2,
 * design §18.1 / PRD §20).
 *
 * Counters carry labels only — never content. The capability must match the
 * shared main-process enum exactly; action/outcome are bounded enum-like
 * lowercase snake tokens (≤40 chars). `z.strictObject` rejects unknown keys
 * so a renderer bug cannot smuggle prompts or payloads into metrics.
 */

const BOUNDED_TOKEN = /^[a-z0-9_]{1,40}$/;

/** Mirrors AIChatWorkspaceActionCapability in AIChatQueueCounters.ts. */
export const AI_CHAT_WORKSPACE_ACTION_CAPABILITIES = [
  "workspace",
  "permission",
  "plan",
  "voice",
  "image",
  "report",
  "outbound",
] as const;

export const aiChatWorkspaceActionCountSchema = lazySchema(() =>
  z.strictObject({
    capability: z.enum(AI_CHAT_WORKSPACE_ACTION_CAPABILITIES),
    action: z.string().regex(BOUNDED_TOKEN),
    outcome: z.string().regex(BOUNDED_TOKEN),
  })
);
