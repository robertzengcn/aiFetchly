/**
 * Renderer-only browser task control (PRD C-FR-04; technical design §18.3).
 *
 * No model tool maps to these channels: pause, take control, resume, stop,
 * return-results-now, and focus-window are USER actions. Every takeover sets
 * BOTH layers (browser → user control via the existing handoff state; agent
 * task → paused via the control gate).
 */
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

export const browserTaskPauseSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.string().min(1).max(160),
    sessionId: z.string().min(1).max(64).optional(),
  })
);

export const browserTaskResumeSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.string().min(1).max(160),
    sessionId: z.string().min(1).max(64).optional(),
    /** C-FR-07: optional steering text appended to the agent transcript. */
    instructions: z.string().max(2000).optional(),
  })
);

export const browserTaskStopSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.string().min(1).max(160),
    sessionId: z.string().min(1).max(64).optional(),
  })
);

export const browserBatchReturnNowSchema = lazySchema(() =>
  z.strictObject({
    batchId: z.string().min(1).max(160),
  })
);

export const browserTaskFocusWindowSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.string().min(1).max(160),
    sessionId: z.string().min(1).max(64),
  })
);
