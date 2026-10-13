/**
 * Deterministic plan-continuation identity (capability-parity design
 * AD-007 / audit T2-D6).
 *
 * A plan transition's continuation turn must be idempotent across renderer
 * reloads, replayed decision responses, and user double-clicks: the same
 * (planId, version, decision) triple always derives the SAME
 * `clientRequestId`, so the coordinator's request cache (idle path) and the
 * pending model's unique index (busy path) collapse replays into the one
 * accepted job.
 *
 *   plan-cont-<first 48 hex chars of SHA-256(planId + ":" + version + ":" + decision)>
 *
 * Pure + renderer-safe (Web Crypto); the digest is hex so the id matches the
 * strict `[a-zA-Z0-9-_]` clientRequestId charset at 58 characters.
 */

const PLAN_CONT_PREFIX = "plan-cont-";
const DIGEST_HEX_CHARS = 48;

export type PlanContinuationDecision =
  | "approve-plan"
  | "reject-plan"
  | "request-plan-changes";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function planContinuationRequestId(
  planId: string,
  version: number,
  decision: PlanContinuationDecision
): Promise<string> {
  const digest = await sha256Hex(`${planId}:${version}:${decision}`);
  return `${PLAN_CONT_PREFIX}${digest.slice(0, DIGEST_HEX_CHARS)}`;
}
