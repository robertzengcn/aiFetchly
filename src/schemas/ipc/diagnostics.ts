'use strict';
import { z } from 'zod';
import { lazySchema } from '@/utils/lazySchema';

/**
 * Renderer → Main payload for an uncaught error or unhandled promise rejection
 * in the renderer process. Sent via the `diagnostics:renderer-error` channel.
 */
export const rendererErrorPayloadSchema = lazySchema(() =>
  z.strictObject({
    message: z.string().min(1).max(8 * 1024),
    stack: z.string().max(16 * 1024).optional(),
    feature: z.string().max(128).optional(),
    level: z.enum(['warn', 'error']).optional(),
    fatal: z.boolean().optional(),
  }),
);
export type RendererErrorPayload = z.infer<
  ReturnType<typeof rendererErrorPayloadSchema>
>;

/**
 * Input for `diagnostics:upload-report`. `crashId` selects the local crash
 * record to upload; `includeNativeDump` (optional) attaches the native crash
 * dump if one was captured for this crash.
 */
export const uploadReportInputSchema = lazySchema(() =>
  z.strictObject({
    crashId: z.string().min(1).max(64),
    includeNativeDump: z.boolean().optional(),
  }),
);
export type UploadReportInput = z.infer<
  ReturnType<typeof uploadReportInputSchema>
>;

/**
 * Input for `diagnostics:set-debug`. Enables/disables verbose debug capture
 * (extra breadcrumbs, stack frames, etc.) for a bounded time window.
 */
export const setDebugInputSchema = lazySchema(() =>
  z.strictObject({ enabled: z.boolean() }),
);
export type SetDebugInput = z.infer<ReturnType<typeof setDebugInputSchema>>;
