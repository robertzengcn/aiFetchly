/**
 * Semantic approval fingerprint (PRD D-FR-27; technical design §11.2).
 *
 * The legacy `computeProgramDigest` hashed the raw actions JSON, which
 * contains random `e_<n>` references — every reobservation changed every
 * reference and therefore the digest, making approve-then-reobserve loop
 * forever. The semantic fingerprint binds the approval to what the user
 * actually approved:
 *
 *   operation, target role/name, value DIGEST (never the value),
 *   key/option id, and the site's registrable domain.
 *
 * The observation id / page revision are recorded with the approval for
 * auditing but deliberately NOT part of the match key: a reobservation on
 * the same page resolves to the same semantic action and consumes the
 * approval once; any semantic change requests a new approval.
 */
import * as crypto from "node:crypto";

export interface SemanticActionDescriptor {
  readonly operation: string;
  readonly role: string | null;
  readonly name: string | null;
  /** Form/label context descriptor, when available. */
  readonly context: string | null;
  /** sha256 hex of the fill value — never the value itself. */
  readonly valueDigest: string | null;
  readonly key: string | null;
  readonly optionId: string | null;
}

/**
 * F13: the fingerprint binds the WHOLE program semantics — including
 * the if/repeat STRUCTURE (condition, discriminator, iteration cap),
 * not just the flattened leaf list. A flat action and a repeated or
 * conditional one must never collide.
 */
export type SemanticActionNode =
  | { readonly kind: "leaf"; readonly descriptor: SemanticActionDescriptor }
  | {
      readonly kind: "if";
      readonly condition: string;
      /** Semantic target (role/name) or a digest of url/text — never raw page text. */
      readonly conditionTarget: string | null;
      readonly then: readonly SemanticActionNode[];
      readonly else: readonly SemanticActionNode[];
    }
  | {
      readonly kind: "repeat";
      readonly condition: string;
      readonly conditionTarget: string | null;
      readonly maxIterations: number;
      readonly body: readonly SemanticActionNode[];
    };

export interface ApprovalFingerprintInput {
  readonly actions: readonly SemanticActionNode[];
  readonly siteRegistrableDomain: string | null;
}

/** Digest a secret-shaped fill value without exposing it. */
export function digestSecretValue(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function computeApprovalFingerprint(
  input: ApprovalFingerprintInput
): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        actions: input.actions,
        site: input.siteRegistrableDomain,
      }),
      "utf8"
    )
    .digest("hex");
}
