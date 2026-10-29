import type { ZodTypeAny } from "zod";

/**
 * WS-4 R4.6 — canonical worker-message contract foundation.
 *
 * Convention (the target all workers migrate toward):
 *  - Every worker ↔ main message is a Zod `discriminatedUnion("type", [...])`
 *    (see `./contactExtraction.ts` and `./localEmbedding.ts` for the pattern).
 *  - The `type` field is the single discriminator.
 *  - Each worker has TWO schemas: inbound (main → worker) and outbound
 *    (worker → main), both validated with `safeParse` at the receiving boundary
 *    so a malformed payload is DROPPED with a warning, never crashed on.
 *
 * This module centralizes that safeParse-and-drop behavior so every worker
 * boundary does it identically (the R4.6 acceptance: "All worker inbound
 * messages pass through a Zod safeParse; malformed messages are dropped").
 *
 * Migration status (R4.6): contact-extraction + localEmbedding are on Zod.
 * The remaining workers use the hand-written interfaces in
 * `src/modules/interface/{IPCMessage,IPCMessageProtocol,BackgroundProcessMessages}.ts`
 * and a mix of `process.send` / `parentPort` transports — they migrate
 * incrementally per `docs/ws-4-worker-contract-migration.md`.
 */

/**
 * Normalized result of parsing a worker message: either the typed payload, or
 * an error message describing why the message was rejected.
 */
export type WorkerMessageParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Validate a raw worker/main message against a Zod schema. Never throws — a
 * malformed message resolves to `{ success: false, error }` so the caller can
 * log + drop it rather than crashing the process.
 *
 * @param raw    The untrusted message (from `process.on('message')` /
 *               `parentPort.on('message')` / `worker.on('message')`).
 * @param schema A resolved Zod schema (e.g. `myWorkerInboundSchema()`).
 */
export function parseWorkerMessage<T>(
  raw: unknown,
  schema: ZodTypeAny
): WorkerMessageParseResult<T> {
  const result = schema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data as T };
  }
  return { success: false, error: result.error.message };
}

/**
 * Convenience: parse + return the typed data, or `null` if malformed.
 * Use when the caller only needs the value (it logs the drop separately).
 */
export function parseWorkerMessageOrNull<T>(
  raw: unknown,
  schema: ZodTypeAny
): T | null {
  const result = parseWorkerMessage<T>(raw, schema);
  return result.success ? result.data : null;
}
