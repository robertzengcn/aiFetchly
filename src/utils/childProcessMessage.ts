import { ProcessMessage } from "@/entityTypes/processMessage-type";

/**
 * Result of parsing a child process message.
 *
 * - `parsed`: Successfully parsed into a ProcessMessage.
 * - `error`: Could not be parsed; `reason` describes why.
 */
export type ParseChildMessageResult<T> =
  | { kind: "parsed"; data: ProcessMessage<T> }
  | { kind: "error"; reason: string; raw: unknown };

export type ParseTypedChildMessageResult<T extends { type: string }> =
  | { kind: "parsed"; data: T }
  | { kind: "error"; reason: string; raw: unknown };

/**
 * Parse a message received from an Electron utilityProcess child.
 *
 * Electron utility process messages can arrive in three formats:
 *
 * 1. **String** – the child called `parentPort.postMessage(JSON.stringify(...))`
 *    and the parent's `child.on('message')` received the raw string.
 *    Example: `'{"action":"sendEmailEnd"}'`
 *
 * 2. **Wrapped** – Electron wraps the posted string in `{ data: "..." }`.
 *    Example: `{ data: '{"action":"sendEmailEnd"}' }`
 *
 * 3. **Direct** – the structured-clone serializer delivers a parsed object.
 *    Example: `{ action: "sendEmailEnd" }`
 *
 * This function normalises all three into a `ProcessMessage<T>` or returns
 * a descriptive error so callers can log and move on.
 */
export function parseChildMessage<T>(message: unknown): ParseChildMessageResult<T> {
  // ── Format 1: raw JSON string ────────────────────────────────────────
  if (typeof message === "string") {
    try {
      const parsed: unknown = JSON.parse(message);
      if (isProcessMessage(parsed)) {
        return { kind: "parsed", data: parsed as ProcessMessage<T> };
      }
      return {
        kind: "error",
        reason: "Parsed string does not contain a valid action",
        raw: message,
      };
    } catch {
      return {
        kind: "error",
        reason: "Failed to parse string message as JSON",
        raw: message,
      };
    }
  }

  // ── Must be an object from here ──────────────────────────────────────
  if (message === null || message === undefined || typeof message !== "object") {
    return {
      kind: "error",
      reason: "Message is not a string or object",
      raw: message,
    };
  }

  const msg = message as Record<string, unknown>;

  // ── Format 3: direct object with `action` property ──────────────────
  if ("action" in msg && typeof msg.action === "string") {
    return { kind: "parsed", data: msg as unknown as ProcessMessage<T> };
  }

  // ── Format 2: wrapped in `{ data: "json-string" }` ──────────────────
  if ("data" in msg && typeof msg.data === "string" && !("action" in msg)) {
    try {
      const parsed: unknown = JSON.parse(msg.data);
      if (isProcessMessage(parsed)) {
        return { kind: "parsed", data: parsed as ProcessMessage<T> };
      }
      return {
        kind: "error",
        reason: "Wrapped data does not contain a valid action",
        raw: message,
      };
    } catch {
      return {
        kind: "error",
        reason: "Failed to parse wrapped data as JSON",
        raw: message,
      };
    }
  }

  return {
    kind: "error",
    reason: "Object has neither 'action' nor 'data' property",
    raw: message,
  };
}

export function parseTypedChildMessage<T extends { type: string }>(
  message: unknown
): ParseTypedChildMessageResult<T> {
  const parsed = parseUnknownChildPayload(message);
  if (parsed.kind === "error") {
    return parsed;
  }

  if (isTypedMessage(parsed.data)) {
    return { kind: "parsed", data: parsed.data as T };
  }

  return {
    kind: "error",
    reason: "Parsed message does not contain a valid type",
    raw: message,
  };
}

type ParseUnknownChildPayloadResult =
  | { kind: "parsed"; data: unknown }
  | { kind: "error"; reason: string; raw: unknown };

function parseUnknownChildPayload(
  message: unknown
): ParseUnknownChildPayloadResult {
  if (typeof message === "string") {
    try {
      return { kind: "parsed", data: JSON.parse(message) as unknown };
    } catch {
      return {
        kind: "error",
        reason: "Failed to parse string message as JSON",
        raw: message,
      };
    }
  }

  if (message === null || message === undefined || typeof message !== "object") {
    return {
      kind: "error",
      reason: "Message is not a string or object",
      raw: message,
    };
  }

  const msg = message as Record<string, unknown>;
  if ("data" in msg && typeof msg.data === "string" && !("type" in msg)) {
    try {
      return { kind: "parsed", data: JSON.parse(msg.data) as unknown };
    } catch {
      return {
        kind: "error",
        reason: "Failed to parse wrapped data as JSON",
        raw: message,
      };
    }
  }

  return { kind: "parsed", data: message };
}

/** Type guard: does the value look like a ProcessMessage? */
function isProcessMessage(value: unknown): value is ProcessMessage<unknown> {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }
  return "action" in value && typeof (value as Record<string, unknown>).action === "string";
}

function isTypedMessage(value: unknown): value is { type: string } {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }
  return "type" in value && typeof (value as Record<string, unknown>).type === "string";
}
