// src/service/AIChatErrorSentinels.ts
//
// Pure, dependency-free constants for the AI Chat error → user-facing message
// mapping. Split out of {@link ./AIChatErrorMapper} so the renderer can import
// these sentinel strings WITHOUT dragging `@/modules/Logger` (which pulls
// `node:module.createRequire`) into the browser bundle — that externalized
// Node import crashes the Vite-served page on startup (ERR_ABORTED loading
// http://localhost:5173/).
//
// Rule: this module MUST stay free of any Node-only or main-process-only
// import (no `@/modules/Logger`, no `electron`, no `node:*`). It contains
// only string constants. The main-process {@link AIChatErrorMapper} re-exports
// these for backwards compatibility with existing importers.

/**
 * Sentinel returned by {@link AIChatErrorMapper.userSafeError} when the AI
 * server reports HTTP 402 / "Payment Required" — i.e. the user's subscription
 * token quota is exhausted. The renderer detects this and shows a translated,
 * actionable recharge prompt instead of the raw sentinel.
 */
export const QUOTA_EXHAUSTED_SENTINEL = "QUOTA_EXHAUSTED";

/**
 * Sentinel returned by {@link AIChatErrorMapper.userSafeError} when the AI
 * server reports the user's auth/session has expired (HTTP 401). The renderer
 * detects this and prompts re-login instead of surfacing the raw sentinel.
 */
export const AUTH_EXPIRED_SENTINEL = "AUTH_EXPIRED";

/**
 * Sentinel returned by {@link AIChatErrorMapper.userSafeError} when a chat
 * image edit fails because no image-to-image (edit-capable) model is
 * configured on the AI server. The renderer maps this to a translated,
 * actionable "configure an edit-capable model" message.
 */
export const IMAGE_EDIT_UNAVAILABLE_SENTINEL = "IMAGE_EDIT_UNAVAILABLE";

/**
 * Sentinel returned by {@link AIChatErrorMapper.userSafeError} when the AI
 * provider rejected or failed an image edit operation (distinct from invalid
 * local references). The renderer maps this to a translated retry/inspect-
 * provider message.
 */
export const IMAGE_EDIT_PROVIDER_FAILED_SENTINEL = "IMAGE_EDIT_PROVIDER_FAILED";

/** Stable machine-readable error codes for chat image-edit failures. */
export type ImageEditErrorCode =
  | "image_edit_unavailable"
  | "image_edit_provider_failed";
