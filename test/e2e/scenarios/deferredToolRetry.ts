/**
 * Deferral-retry detection for the FakeOpenAI E2E server.
 *
 * When the app's deferred tool catalog intercepts a call to an undiscovered
 * deferred tool, it loads the tool and answers the model with a tool message
 * whose content is the JSON produced by serializeToolResultContent:
 *   {"success":false,"error":"Tool \"<name>\" was deferred and has now been
 *    loaded. Retry the call with valid arguments."}
 * (src/service/AIChatQueryLoop.ts). A REAL model re-issues the call on that
 * round; the fake server must too, or tools behind the deferred catalog can
 * never be exercised end-to-end.
 *
 * The request body is inspected transiently for control flow only — never
 * stored, preserving the fake server's redaction contract (design §9.6).
 */

/** Marker phrase in the app's deferral tool-result content. */
const DEFERRAL_RETRY_MARKER = "was deferred and has now been loaded";

interface ChatMessageLike {
  readonly role?: unknown;
  readonly content?: unknown;
}

/** Content of the LAST role:"tool" message, or null when there is none. */
function lastToolMessageContent(rawBody: string): string | null {
  let parsed: { messages?: unknown };
  try {
    parsed = JSON.parse(rawBody) as { messages?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.messages)) return null;
  const messages = parsed.messages as ChatMessageLike[];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && message.role === "tool") {
      return typeof message.content === "string" ? message.content : null;
    }
  }
  return null;
}

/**
 * True when the request is the model round immediately after the app loaded a
 * deferred tool — i.e. the last tool message carries the deferral retry
 * instruction. On such a round a real model re-issues the tool call.
 */
export function isDeferralRetryRequest(rawBody: string): boolean {
  const content = lastToolMessageContent(rawBody);
  if (content === null) return false;
  let parsed: { error?: unknown };
  try {
    parsed = JSON.parse(content) as { error?: unknown };
  } catch {
    return false;
  }
  return (
    typeof parsed.error === "string" &&
    parsed.error.includes(DEFERRAL_RETRY_MARKER)
  );
}
