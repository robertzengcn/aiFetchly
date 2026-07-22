"use strict";
/**
 * Dev Browser Bridge wire schemas (Zod v4).
 *
 * Every payload that crosses the bridge boundary is validated with Zod before
 * it is trusted (CLAUDE.md Zod v4 mandate; technical design §12 control #6).
 * Schemas live here so both the main-process bridge and its tests share one
 * source of truth.
 *
 * The HTTP response shape mirrors the existing IPC `{ status, msg, data }`
 * contract (CommonMessage) plus a `requestId` correlation field.
 */
import { z } from "zod/v4";

/** POST /__aifetchly_dev_bridge/invoke request body. */
export const BridgeInvokeRequestSchema = z.object({
  channel: z.string().min(1).max(128),
  data: z.unknown().optional(),
  requestId: z.string().min(1).max(256),
});
export type BridgeInvokeRequest = z.infer<typeof BridgeInvokeRequestSchema>;

/** Canonical invoke response (mirrors CommonMessage + requestId). */
export const BridgeInvokeResponseSchema = z.object({
  status: z.boolean(),
  msg: z.string(),
  data: z.unknown().nullable(),
  requestId: z.string(),
});
export type BridgeInvokeResponse = z.infer<typeof BridgeInvokeResponseSchema>;

/**
 * WebSocket client->server message: subscribe to / unsubscribe from an event
 * channel. `subscriptionId` is client-chosen so a single channel can be
 * subscribed multiple times with distinct callbacks (mirrors
 * ipcRenderer.on semantics).
 */
export const BridgeClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    channel: z.string().min(1).max(128),
    subscriptionId: z.string().min(1).max(128),
  }),
  z.object({
    type: z.literal("unsubscribe"),
    subscriptionId: z.string().min(1).max(128),
  }),
]);
export type BridgeClientEvent = z.infer<typeof BridgeClientEventSchema>;

/** Server->browser event delivered over the WebSocket. */
export const BridgeServerEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("event"),
    channel: z.string(),
    subscriptionId: z.string(),
    payload: z.unknown(),
  }),
  z.object({
    type: z.literal("error"),
    subscriptionId: z.string().optional(),
    msg: z.string(),
  }),
]);
export type BridgeServerEvent = z.infer<typeof BridgeServerEventSchema>;

/**
 * GET /__aifetchly_dev_bridge/config response — delivers the per-session token
 * to the renderer. The endpoint is origin-validated; no static token is ever
 * committed (technical design §11).
 */
export const BridgeConfigResponseSchema = z.object({
  baseUrl: z.string(),
  token: z.string(),
  allowedOrigin: z.string(),
});
export type BridgeConfigResponse = z.infer<typeof BridgeConfigResponseSchema>;
