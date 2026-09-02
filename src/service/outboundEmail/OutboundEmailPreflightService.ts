import { OutboundEmailEnvelopeHasher } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type { BatchEnvelopeEntry } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type { OutboundEmailDraftEntity } from "@/entity/OutboundEmailDraft.entity";
import type { OutboundEmailDraftRevisionEntity } from "@/entity/OutboundEmailDraftRevision.entity";
import type {
  OutboundEmailPreflightFinding,
  OutboundEmailPreflightResult,
} from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * The minimal view of a draft the preflight needs: identity, recipient, and
 * the current revision pointer. This keeps the service a pure validator over
 * already-loaded rows — it loads nothing from the database itself, so it is
 * trivially testable and has no worker-process database access.
 */
export interface PreflightDraftView {
  readonly draft: Pick<
    OutboundEmailDraftEntity,
    "id" | "batchId" | "recipientAddress" | "currentRevisionId" | "revisionNumber"
  >;
  readonly revision: OutboundEmailDraftRevisionEntity | null;
}

/** A single recipient's preflight input: its draft view, recomputed envelope, and stored content hash. */
export interface PreflightEntry {
  readonly view: PreflightDraftView;
  readonly envelope: BatchEnvelopeEntry | null;
  /** The hash currently stored on the draft/revision. Null when no revision exists. */
  readonly storedHash: string | null;
}

/** Implementation safety limits (technical design §10.2). */
export const OUTBOUND_EMAIL_BATCH_LIMITS = {
  maxRecipients: 100,
  maxHtmlBodyChars: 50_000,
  maxTextBodyChars: 50_000,
  maxPayloadBytes: 5 * 1024 * 1024,
} as const;

const POLICY_VERSION = "outbound-policy-v1";
const VALIDATION_VERSION = "outbound-validation-v1";

// RFC-5322-adjacent email pattern: non-empty local part, @, a domain with a dot.
// Preflight is a coarse guard; precise deliverability is the provider's job.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Complete-batch preflight for the intent-aware outbound-email pipeline
 * (technical design §12). Validates every current revision before any
 * authorization is created. The operation is all-or-nothing: any blocking
 * finding prevents authorization and returns structured findings.
 *
 * Phase 2.3 implements the deterministic, dependency-free subset of the §12
 * checks: non-empty + size limits, exactly-one-current-revision, valid + unique
 * recipient addresses, non-empty subject/bodies, and envelope/batch hash
 * recomputation. Suppression-list, service-credential, legal-footer,
 * personalization-evidence, knowledge-source, template-variable, and
 * policy-version checks are layered in by composing services in later phases;
 * the shape of `OutboundEmailPreflightFinding` is already stable for them.
 */
export class OutboundEmailPreflightService {
  run(entries: ReadonlyArray<PreflightEntry>): OutboundEmailPreflightResult {
    const findings: OutboundEmailPreflightFinding[] = [];

    // §12.1 — batch non-empty.
    if (entries.length === 0) {
      findings.push({
        recipientAddress: null,
        code: "batch_empty",
        message: "Batch has no drafts.",
        severity: "block",
      });
      // Nothing else to validate; return early with no batch hash.
      return this.failed(findings);
    }

    // §10.2 — recipient-count limit.
    if (entries.length > OUTBOUND_EMAIL_BATCH_LIMITS.maxRecipients) {
      findings.push({
        recipientAddress: null,
        code: "batch_limit_exceeded",
        message: `Batch exceeds the ${OUTBOUND_EMAIL_BATCH_LIMITS.maxRecipients}-recipient limit.`,
        severity: "block",
      });
    }

    const seenAddresses = new Set<string>();
    let payloadBytes = 0;

    for (const entry of entries) {
      const { draft, revision } = entry.view;
      const address = draft.recipientAddress ?? "";

      // §12.2 — exactly one current revision per recipient.
      if (!revision) {
        findings.push({
          recipientAddress: address || null,
          code: "missing_current_revision",
          message: "Draft has no current revision.",
          severity: "block",
        });
        continue;
      }

      // §12.3 — valid + unique recipient address.
      if (!EMAIL_PATTERN.test(address)) {
        findings.push({
          recipientAddress: address || null,
          code: "invalid_recipient_address",
          message: `Recipient address is not a valid email: ${address}`,
          severity: "block",
        });
      }
      const normalized = address.trim().toLowerCase();
      if (seenAddresses.has(normalized)) {
        findings.push({
          recipientAddress: address || null,
          code: "duplicate_recipient_address",
          message: `Duplicate recipient address: ${address}`,
          severity: "block",
        });
      }
      seenAddresses.add(normalized);

      // §12.7 — non-empty subject/bodies.
      if (!revision.subject || revision.subject.trim().length === 0) {
        findings.push({
          recipientAddress: address || null,
          code: "empty_subject",
          message: "Subject is empty.",
          severity: "block",
        });
      }
      if (!revision.bodyText || revision.bodyText.trim().length === 0) {
        findings.push({
          recipientAddress: address || null,
          code: "empty_body_text",
          message: "Text body is empty.",
          severity: "block",
        });
      }

      // §10.2 — body length limits.
      if (
        revision.bodyHtml !== null &&
        revision.bodyHtml.length > OUTBOUND_EMAIL_BATCH_LIMITS.maxHtmlBodyChars
      ) {
        findings.push({
          recipientAddress: address || null,
          code: "batch_limit_exceeded",
          message: `HTML body exceeds ${OUTBOUND_EMAIL_BATCH_LIMITS.maxHtmlBodyChars} characters.`,
          severity: "block",
        });
      }
      if (
        revision.bodyText.length > OUTBOUND_EMAIL_BATCH_LIMITS.maxTextBodyChars
      ) {
        findings.push({
          recipientAddress: address || null,
          code: "batch_limit_exceeded",
          message: `Text body exceeds ${OUTBOUND_EMAIL_BATCH_LIMITS.maxTextBodyChars} characters.`,
          severity: "block",
        });
      }

      // §12.13 — envelope hash recomputation.
      if (entry.envelope) {
        const recomputed = OutboundEmailEnvelopeHasher.hashEnvelope(
          entry.envelope
        );
        if (entry.storedHash && recomputed !== entry.storedHash) {
          findings.push({
            recipientAddress: address || null,
            code: "envelope_hash_mismatch",
            message: "Recomputed envelope hash differs from the stored hash.",
            severity: "block",
          });
        }
        payloadBytes += Buffer.byteLength(
          JSON.stringify(entry.envelope),
          "utf8"
        );
      }
    }

    // §10.2 — total payload limit.
    if (payloadBytes > OUTBOUND_EMAIL_BATCH_LIMITS.maxPayloadBytes) {
      findings.push({
        recipientAddress: null,
        code: "batch_limit_exceeded",
        message: `Serialized worker payload exceeds ${
          OUTBOUND_EMAIL_BATCH_LIMITS.maxPayloadBytes
        } bytes.`,
        severity: "block",
      });
    }

    const blocking = findings.filter((f) => f.severity === "block");
    if (blocking.length > 0) {
      return this.failed(findings);
    }

    // Happy path: compute the batch hash from the (validated) envelopes.
    const envelopes = entries
      .map((e) => e.envelope)
      .filter((x): x is BatchEnvelopeEntry => x !== null);
    const batchHash =
      envelopes.length === 0
        ? null
        : OutboundEmailEnvelopeHasher.hashBatch(envelopes);

    return {
      passed: true,
      batchHash,
      policyVersion: POLICY_VERSION,
      validationVersion: VALIDATION_VERSION,
      findings: [],
    };
  }

  private failed(
    findings: OutboundEmailPreflightFinding[]
  ): OutboundEmailPreflightResult {
    return {
      passed: false,
      batchHash: null,
      policyVersion: POLICY_VERSION,
      validationVersion: VALIDATION_VERSION,
      findings,
    };
  }
}