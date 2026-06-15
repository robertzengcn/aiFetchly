// src/service/AIChatErrorMapper.ts

/**
 * Map unknown errors to user-safe messages.
 * Raw server bodies, stack traces, and sensitive request details
 * are logged but never surfaced to the renderer.
 */
export function userSafeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") {
      return "Generation stopped.";
    }
    const msg = err.message || "Unknown error";
    if (/401|403/.test(msg)) {
      return "Please sign in again.";
    }
    if (/404/.test(msg)) {
      return "Selected model is not available.";
    }
    if (/503/.test(msg)) {
      return "No chat model is configured on the AI server.";
    }
    if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/i.test(msg)) {
      return "Could not connect to the AI server.";
    }
    console.error("[ai-chat-v2] unmapped error:", msg);
    return "An unexpected error occurred. Please try again.";
  }
  return "Unknown error";
}
