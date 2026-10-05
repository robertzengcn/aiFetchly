/**
 * B12: structured IPC error carrying typed failure fields through the
 * validated-IPC catch boundary.
 *
 * When a service refusal (e.g. a widened {@link CreateDraftOutcome} failure)
 * needs to surface machine-readable `code` / `existing_draft_id` /
 * `next_action` / `requestCorrelationId` to the renderer, the IPC handler
 * throws this instead of `new Error(string)`. The shared
 * {@link dispatchValidated} catch duck-types the `code` property (and the
 * other snake_cased fields) off the thrown error and copies them into the
 * `CommonMessage` failure envelope additively, so the renderer / AI tool
 * branches on `code` instead of parsing the leading `[code]` bracket out of
 * `message`.
 *
 * Field semantics mirror {@link CreateDraftOutcome}'s failure side:
 *  - `code`: present ONLY for genuine {@link EmailReplyPolicyCode} refusals.
 *    Absent (do not set) for `provider_error`, AI-disabled, message-not-found,
 *    and audit-persistence failures.
 *  - `existing_draft_id`: set when a live draft already exists for the message.
 *  - `next_action`: derived from `code` via typed-code -> action derivation.
 *  - `requestCorrelationId`: the per-invocation id allocated at the service
 *    entry boundary (B11), so the renderer can correlate a failure to the
 *    audit trail for the invocation that produced it.
 *
 * The message stays human-readable and unchanged for legacy consumers.
 */
export class StructuredIpcError extends Error {
  readonly code?: string;
  readonly existing_draft_id?: number;
  readonly next_action?: string;
  readonly requestCorrelationId?: string;

  constructor(
    message: string,
    fields: {
      readonly code?: string;
      readonly existing_draft_id?: number;
      readonly next_action?: string;
      readonly requestCorrelationId?: string;
    }
  ) {
    super(message);
    this.name = "StructuredIpcError";
    this.code = fields.code;
    this.existing_draft_id = fields.existing_draft_id;
    this.next_action = fields.next_action;
    this.requestCorrelationId = fields.requestCorrelationId;
  }
}
