import "reflect-metadata";
import * as crypto from "node:crypto";
import { z } from "zod/v4";
import { TOOL_RESULT_POLICY_VERSION } from "@/config/toolResultConfig";
import type {
  ToolResultCursorDecodeResult,
  ToolResultCursorMode,
  ToolResultCursorPayload,
} from "@/entityTypes/toolResultTypes";

/**
 * Versioned, AUTHENTICATED opaque cursor codec (technical design §8.4).
 *
 * A cursor is NOT an authorization credential. It is an integrity-checked
 * continuation token: it lets a reader resume exactly where it stopped across
 * page boundaries, restart, and the next turn, but every use is still
 * authorized against the live owner/grant/epoch in `ToolResultModule`. Cursor
 * integrity SUPPLEMENTS authorization; it never replaces it.
 *
 * Because the payload is base64url rather than encrypted, a caller can read it.
 * That is acceptable because it carries only ids, offsets, and a query digest -
 * never source text - and the authorization check is what actually protects
 * the content. A tampered cursor fails the signature check and is rejected
 * WITHOUT reading any content.
 */

const CURSOR_VERSION = 1;

const cursorPayloadSchema = z.object({
  v: z.literal(CURSOR_VERSION),
  outputId: z.string().max(64),
  revision: z.number().int().min(1).max(1000),
  mode: z.enum(["read", "search"]),
  // Bounded: an unbounded offset would let a cursor past EOF return an empty
  // page that still claims the whole output was read.
  position: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  queryDigest: z.string().max(64).optional(),
  lastMatchEnd: z.number().int().min(0).optional(),
  policyVersion: z.string().max(64),
});

/**
 * HMAC key. A caller that does not inject one gets an ephemeral key, which is
 * correct for a single process lifetime and makes rotation explicit: pass a
 * persisted app-managed key to keep cursors valid across restarts.
 */
let activeKey: Buffer = crypto.randomBytes(32);

/** Install a persistent app-managed key so cursors survive a restart. */
export function setToolResultCursorKey(key: Buffer): void {
  if (key.length < 16) {
    throw new Error("tool-result cursor key must be at least 16 bytes");
  }
  activeKey = key;
}

/** Derive a stable key from an app-managed secret. */
export function deriveToolResultCursorKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", activeKey).update(payload).digest("base64url");
}

/** Digest a literal search query so a cursor is bound to the query it resumed. */
export function digestSearchQuery(query: string): string {
  return crypto.createHash("sha256").update(query, "utf8").digest("hex").slice(0, 32);
}

/** Build a signed cursor for a read or search continuation. */
export function encodeToolResultCursor(input: {
  readonly outputId: string;
  readonly revision: number;
  readonly mode: ToolResultCursorMode;
  readonly position: number;
  readonly queryDigest?: string;
  readonly lastMatchEnd?: number;
}): string {
  const payload: ToolResultCursorPayload = {
    v: CURSOR_VERSION,
    outputId: input.outputId,
    revision: input.revision,
    mode: input.mode,
    position: input.position,
    ...(input.queryDigest ? { queryDigest: input.queryDigest } : {}),
    ...(input.lastMatchEnd !== undefined
      ? { lastMatchEnd: input.lastMatchEnd }
      : {}),
    policyVersion: TOOL_RESULT_POLICY_VERSION,
  };
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/**
 * Decode and authenticate a cursor.
 *
 * Validation is strict and happens BEFORE any content read: signature, schema,
 * numeric ranges, version, and the caller's expected output/mode. A rejected
 * cursor leaves the caller free to restart from the beginning using a valid
 * output id, which is always permitted.
 */
export function decodeToolResultCursor(
  raw: unknown,
  expected: {
    readonly outputId: string;
    readonly mode: ToolResultCursorMode;
    readonly revision?: number;
    readonly queryDigest?: string;
  }
): ToolResultCursorDecodeResult {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) {
    return { ok: false, code: "INVALID_OUTPUT_CURSOR" };
  }
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return { ok: false, code: "INVALID_OUTPUT_CURSOR" };
  const body = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);

  // Constant-time comparison; a timing oracle here would leak the MAC.
  const expectedSignature = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: "INVALID_OUTPUT_CURSOR" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, code: "INVALID_OUTPUT_CURSOR" };
  }
  const result = cursorPayloadSchema.safeParse(parsed);
  if (!result.success) return { ok: false, code: "INVALID_OUTPUT_CURSOR" };
  const payload = result.data;

  if (payload.outputId !== expected.outputId) {
    return { ok: false, code: "INVALID_OUTPUT_CURSOR" };
  }
  // A search cursor is not a read cursor: using one as the other would let a
  // caller skip content it never examined.
  if (payload.mode !== expected.mode) {
    return { ok: false, code: "INVALID_OUTPUT_CURSOR" };
  }
  if (expected.revision !== undefined && payload.revision !== expected.revision) {
    return { ok: false, code: "INVALID_OUTPUT_CURSOR" };
  }
  if (
    expected.queryDigest !== undefined &&
    payload.queryDigest !== expected.queryDigest
  ) {
    return { ok: false, code: "INVALID_OUTPUT_CURSOR" };
  }
  return { ok: true, payload };
}
