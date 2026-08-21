/**
 * ContactVerificationAiTools — the AI-facing boundary for `verify_contact_info`
 * (design §7, §8, §14).
 *
 * Responsibilities (in order):
 *  1. AI enable gate FIRST (CLAUDE.md mandatory rule) — before parsing
 *     arguments or doing any work.
 *  2. Zod-parse the snake_case LLM input against
 *     `contactVerificationInputSchema`.
 *  3. Map snake_case input -> internal camelCase `ContactVerificationRequest`.
 *  4. Call `ContactVerificationService.verify()` with the execution context's
 *     AbortSignal + a progress mapper.
 *  5. Convert the internal camelCase result -> the PRD's snake_case JSON
 *     contract (FR-12).
 *
 * This layer owns the AI gate; the shared deterministic service does NOT
 * import `Token` (so the worker can import it). The worker composes the
 * service directly; this file is the model-facing entry point only.
 */
import { ZodError } from "zod/v4";
import { isAiEnabled } from "@/service/AiFeatureGate";
import {
  contactVerificationInputSchema,
  type ContactVerificationInput,
} from "@/schemas/contactVerification";
import { ContactVerificationService } from "@/service/contact-verification/ContactVerificationService";
import { mapVerificationPhaseToEmitPhase } from "@/config/contactVerification";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

/**
 * Minimal context the verifier needs from its caller. Both
 * `SkillExecutionContext` (registry `execute`) and `ModuleExecutionContext`
 * (ToolExecutor route) satisfy this — the verifier only touches the abort
 * signal, the progress sink, and the tool-call id.
 */
export type ContactVerificationToolContext = Pick<
  SkillExecutionContext,
  "signal" | "emitProgress" | "toolCallId"
>;
import type {
  ContactVerificationGroup,
  ContactVerificationRequest,
  CountryEvidence,
  CountryEvidenceSource,
} from "@/entityTypes/contactVerificationTypes";

// ---------------------------------------------------------------------------
// Public result shape (snake_case, PRD FR-12)
// ---------------------------------------------------------------------------

export interface ContactVerificationAiResult {
  readonly success: boolean;
  readonly error?: string;
  readonly result?: Record<string, unknown>;
}

/** Build a structured failure payload. */
function toolError(error: string): ContactVerificationAiResult {
  return { success: false, error };
}

// ---------------------------------------------------------------------------
// Input mapping (snake_case -> internal camelCase)
// ---------------------------------------------------------------------------

function mapInputToRequest(
  input: ContactVerificationInput
): ContactVerificationRequest {
  return {
    contacts: input.contacts.map((c): ContactVerificationGroup => {
      const evidence: CountryEvidence[] = (
        c.context?.country_evidence ?? []
      ).map((e) => ({
        country: e.country,
        source: e.source as CountryEvidenceSource,
        evidenceText: e.evidence_text,
      }));
      return {
        sourceUrl: c.source_url,
        emails: c.emails,
        phones: c.phones,
        context:
          c.context || evidence.length > 0
            ? {
                nearbyText: c.context?.nearby_text,
                address: c.context?.address,
                countryEvidence: evidence,
              }
            : undefined,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Progress mapping (internal verification phase -> emitProgress phase)
// ---------------------------------------------------------------------------

/**
 * Build a progress emitter that maps the internal verification phase onto the
 * fixed SkillExecutionContext.emitProgress phase enum and carries the precise
 * phase in the message string (design §12.4).
 */
function makeProgressEmitter(
  context: ContactVerificationToolContext | undefined
):
  | ((e: {
      phase: import("@/entityTypes/contactVerificationTypes").ContactVerificationPhase;
      message: string;
      partialCount?: number | null;
      expectedCount?: number | null;
      progress?: number | null;
    }) => void)
  | undefined {
  if (!context?.emitProgress) return undefined;
  return (e) => {
    context.emitProgress?.({
      phase: mapVerificationPhaseToEmitPhase(e.phase),
      message: e.message,
      partialCount: e.partialCount ?? null,
      expectedCount: e.expectedCount ?? null,
      progress: e.progress ?? null,
    });
  };
}

// ---------------------------------------------------------------------------
// Result mapping (internal camelCase -> snake_case PRD contract, §8)
// ---------------------------------------------------------------------------

/** Internal result type alias for the mapping helpers. */
type InternalResult = Awaited<ReturnType<ContactVerificationService["verify"]>>;

function mapResultToSnakeCase(result: InternalResult): Record<string, unknown> {
  return {
    success: result.success,
    verification_depth: result.verificationDepth,
    verification_performed: result.verificationPerformed,
    partial: result.partial,
    limitations: [...result.limitations],
    summary: {
      input_emails: result.summary.inputEmails,
      input_phones: result.summary.inputPhones,
      unique_emails: result.summary.uniqueEmails,
      unique_phones: result.summary.uniquePhones,
      likely_valid: result.summary.likelyValid,
      needs_review: result.summary.needsReview,
      invalid: result.summary.invalid,
      unknown: result.summary.unknown,
    },
    contacts: result.contacts.map((g) => ({
      source_url: g.sourceUrl,
      emails: g.emails.map(mapEmailResult),
      phones: g.phones.map(mapPhoneResult),
    })),
    data_versions: {
      rules: result.dataVersions.rules,
      disposable_domains: result.dataVersions.disposableDomains,
      phone_metadata: result.dataVersions.phoneMetadata,
    },
  };
}

function mapEmailResult(
  e: InternalResult["contacts"][number]["emails"][number]
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    original: e.original,
    status: e.status,
    checks: {
      syntax_valid: e.checks.syntaxValid,
      placeholder: e.checks.placeholder,
      disposable_domain: e.checks.disposableDomain,
      suspicious_local_part: e.checks.suspiciousLocalPart,
      role_based: e.checks.roleBased,
      domain_resolves: e.checks.domainResolves,
      mail_routing: e.checks.mailRouting,
    },
    reasons: [...e.reasons],
    checked_at: e.checkedAt,
    rules_version: e.rulesVersion,
  };
  if (e.normalized !== undefined) out.normalized = e.normalized;
  return out;
}

function mapPhoneResult(
  p: InternalResult["contacts"][number]["phones"][number]
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    original: p.original,
    status: p.status,
    reasons: [...p.reasons],
    checked_at: p.checkedAt,
    rules_version: p.rulesVersion,
  };
  if (p.normalized !== undefined) out.normalized = p.normalized;
  if (p.extension !== undefined) out.extension = p.extension;
  if (p.country !== undefined) out.country = p.country;
  if (p.countryConfidence !== undefined)
    out.country_confidence = p.countryConfidence;
  if (p.countryEvidence !== undefined) out.country_evidence = p.countryEvidence;
  if (p.numberType !== undefined) out.number_type = p.numberType;
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * `verify_contact_info` AI tool entry. Called by both the SkillRegistry
 * `execute` and the ToolExecutor compatibility route (design §14.4 — one
 * shared function so behavior cannot diverge).
 *
 * AI gate runs BEFORE Zod parsing (CLAUDE.md mandatory rule).
 */
export async function verifyContactInfoForAi(
  args: Record<string, unknown>,
  context?: ContactVerificationToolContext
): Promise<ContactVerificationAiResult> {
  // 1. AI gate — first, before any parsing or work.
  if (!isAiEnabled()) {
    return toolError("AI features are not enabled on this plan.");
  }

  // 2. Zod parse.
  let parsed: ContactVerificationInput;
  try {
    const result = contactVerificationInputSchema().safeParse(args);
    if (!result.success) {
      return toolError(`Invalid input: ${formatZodError(result.error)}`);
    }
    parsed = result.data;
  } catch (err) {
    return toolError(
      `Invalid input: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 3. Map + 4. verify.
  const request = mapInputToRequest(parsed);
  const service = new ContactVerificationService();
  try {
    const internal = await service.verify(request, {
      signal: context?.signal,
      emitProgress: makeProgressEmitter(context) as never,
    });
    // 5. Convert to snake_case PRD contract.
    return { success: true, result: mapResultToSnakeCase(internal) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Strip absolute filesystem paths / raw contact values before surfacing.
    return toolError(sanitizeReason(message));
  }
}

/** Format a Zod v4 error into a concise message. */
function formatZodError(error: ZodError): string {
  const issues =
    (error as { issues?: { message: string; path?: unknown }[] }).issues ?? [];
  if (issues.length === 0) return error.message;
  return issues.map((i) => i.message).join("; ");
}

/**
 * Strip absolute filesystem paths and bracketed contact-like tokens from an
 * inner error message before it reaches the model (PRD §12, design §17.2).
 * URLs are preserved.
 */
function sanitizeReason(message: string): string {
  return message
    .replace(/(^|[\s('"])(\/[^\s'"<>)]+|[A-Za-z]:\\[^\s'"<>)]+)/g, "$1[path]")
    .replace(/\s+/g, " ")
    .trim();
}
