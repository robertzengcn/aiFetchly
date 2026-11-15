/**
 * BrowserFieldValueService (N02/D-FR-20/21; technical design §8.3).
 *
 * Resolves FILL text for a chosen field from TRUSTED plan state only when
 * the mapping is unambiguous; otherwise calls a small bounded field-text
 * helper with the goal, chosen field, relevant context, and bounded recent
 * actions. Never automates password/OTP/payment/CAPTCHA entry — login walls
 * go to the credential service as a runner step (A-FR-14).
 *
 * D-FR-21: a cached helper result survives ONLY when every helper input is
 * identical AND no mutation of that field has run since; unknown execution
 * effect invalidates automatic replay. Cache keys carry the full input.
 */
import { rejectSecretShaped } from "@/entityTypes/skillInstallationTypes";

export interface FieldBinding {
  readonly field: string;
  readonly value: string;
}

export interface FieldResolutionInput {
  /** The chosen field's observed name (accessible name / label fragment). */
  readonly fieldName: string;
  readonly goal: string;
  /** Trusted plan bindings established once at planning. */
  readonly bindings: readonly FieldBinding[];
  /** Bounded recent-action context for the helper call. */
  readonly recentContext?: readonly string[];
  /** The helper call (selected-provider; bounded; may be absent in tests). */
  readonly helper?: (input: {
    readonly goal: string;
    readonly field: string;
    readonly context: readonly string[];
  }) => Promise<string | null>;
}

const HELPER_VALUE_MAX_CHARS = 2_000;

/** Names that must NEVER be filled through this path (A-FR-14/§8.3). */
const FORBIDDEN_FIELD_PATTERNS: readonly RegExp[] = [
  /password/i,
  /passwort/i,
  /contrase/i,
  /mot[_ ]?de[_ ]?passe/i,
  /\botp\b/i,
  /one[_ -]?time/i,
  /2fa/i,
  /verification[_ ]?code/i,
  /captcha/i,
  /card[_ ]?number/i,
  /cvv/i,
  /cvc/i,
  /security[_ ]?code/i,
  /ssn/i,
];

export function fieldIsForbiddenToFill(fieldName: string): boolean {
  return FORBIDDEN_FIELD_PATTERNS.some((pattern) =>
    pattern.test(fieldName.trim())
  );
}

export class BrowserFieldValueService {
  /**
   * D-FR-21: cache keyed by the FULL helper input (goal+field+context) —
   * a hit requires every input identical. Cleared whenever a mutation of
   * the field ran with unknown effect (the runner calls invalidate()).
   */
  private cache = new Map<
    string,
    { value: string; invalidated: boolean }
  >();

  private static cacheKey(input: FieldResolutionInput): string {
    return JSON.stringify({
      goal: input.goal,
      field: input.fieldName,
      context: input.recentContext ?? [],
    });
  }

  /** D-FR-21: unknown execution effect on this field invalidates replay. */
  public invalidate(fieldName: string): void {
    for (const [key, entry] of [...this.cache.entries()]) {
      // Invalidate every cached entry for this field (any goal/context —
      // a mutated field's page state can no longer prove the old value).
      if (
        key.includes(JSON.stringify(fieldName).slice(1, -1)) ||
        entry.invalidated
      ) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Resolve the text to type into `fieldName`. Returns null when nothing
   * trustworthy applies (the model may then FILL with its own goal-derived
   * text, or ESCALATE).
   */
  public async resolveText(
    input: FieldResolutionInput
  ): Promise<string | null> {
    const fieldName = input.fieldName.trim();
    if (fieldName.length === 0) {
      return null;
    }
    // §8.3/A-FR-14: password/OTP/payment/CAPTCHA fields are NEVER filled
    // through this path — the credential service owns those.
    if (fieldIsForbiddenToFill(fieldName)) {
      return null;
    }
    // 1. Unambiguous trusted binding: exactly one binding whose field key
    //    matches the observed name (case-insensitive containment, both
    //    directions) — ambiguous multi-matches fall to the helper.
    const matches = input.bindings.filter((binding) => {
      const a = binding.field.toLowerCase();
      const b = fieldName.toLowerCase();
      return b.includes(a) || a.includes(b);
    });
    if (matches.length === 1) {
      return matches[0]!.value;
    }
    // 2. Bounded helper call with a full-input cache (D-FR-21).
    if (!input.helper) {
      return null;
    }
    const key = BrowserFieldValueService.cacheKey(input);
    const cached = this.cache.get(key);
    if (cached && !cached.invalidated) {
      return cached.value;
    }
    const raw = await input.helper({
      goal: input.goal.slice(0, 2_000),
      field: fieldName.slice(0, 200),
      context: (input.recentContext ?? []).slice(0, 6),
    });
    if (raw == null || raw.length === 0 || raw.length > HELPER_VALUE_MAX_CHARS) {
      return null;
    }
    // D-FR-20: the helper's text is rejected when secret-shaped — never
    // typed, never cached.
    const problems = rejectSecretShaped(raw, ["helper", fieldName]);
    if (problems.length > 0) {
      return null;
    }
    this.cache.set(key, { value: raw, invalidated: false });
    return raw;
  }
}

let defaultService: BrowserFieldValueService | null = null;

export function getDefaultBrowserFieldValueService(): BrowserFieldValueService {
  if (!defaultService) {
    defaultService = new BrowserFieldValueService();
  }
  return defaultService;
}

/** Test seam. */
export function setDefaultBrowserFieldValueServiceForTest(
  service: BrowserFieldValueService | null
): void {
  defaultService = service;
}
