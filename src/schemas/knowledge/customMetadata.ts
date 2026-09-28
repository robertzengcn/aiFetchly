import { z } from "zod";

/**
 * Fixed allowlist of custom-metadata keys accepted on a knowledge-library
 * document (PRD §8.3 / §10, technical design §6.2). This is the ONLY set of
 * custom keys the application recognizes; unknown keys are rejected by the
 * strict Zod schema below so they never reach the JSON column.
 */
export const KNOWLEDGE_CUSTOM_METADATA_KEYS = [
  "product",
  "customer",
  "campaign",
  "category",
] as const;

export type KnowledgeCustomMetadataKey =
  (typeof KNOWLEDGE_CUSTOM_METADATA_KEYS)[number];

/**
 * Strict Zod schema for the custom-metadata object. Each value is a trimmed
 * string of 1–200 characters and optional; `.strict()` rejects any key not in
 * {@link KNOWLEDGE_CUSTOM_METADATA_KEYS} (technical design §6.2). At most the
 * four allowlist keys are accepted (enforced by the fixed object shape).
 */
export const knowledgeCustomMetadataSchema = z
  .object({
    product: z.string().trim().min(1).max(200).optional(),
    customer: z.string().trim().min(1).max(200).optional(),
    campaign: z.string().trim().min(1).max(200).optional(),
    category: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

/** Inferred TypeScript type for a validated custom-metadata object. */
export type KnowledgeCustomMetadata = z.infer<
  typeof knowledgeCustomMetadataSchema
>;

/**
 * Parse and normalize a custom-metadata input. Returns `undefined` when the
 * input is empty/absent (so the column stores NULL, not `"{}"`), or throws a
 * Zod error when an unknown key is present or a value violates the length
 * rule. Call this at the upload boundary before persisting.
 */
export function normalizeCustomMetadata(
  input: unknown
): KnowledgeCustomMetadata | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  const parsed = knowledgeCustomMetadataSchema.parse(input);
  // Drop keys whose value resolved to undefined after trim/optional so the
  // serialized object only contains present keys. If nothing remains, store
  // NULL (undefined) rather than the string "{}".
  const present = Object.entries(parsed).filter(
    ([, v]) => v !== undefined
  );
  if (present.length === 0) {
    return undefined;
  }
  return Object.fromEntries(present) as KnowledgeCustomMetadata;
}

/**
 * Serialize a validated custom-metadata object for the `customMetadata` column.
 * Returns `undefined` for empty objects so the column stays NULL (technical
 * design §6.2: "Empty object stores undefined, not '{}\"').
 */
export function serializeCustomMetadata(
  input: unknown
): string | undefined {
  const normalized = normalizeCustomMetadata(input);
  if (normalized === undefined) {
    return undefined;
  }
  return JSON.stringify(normalized);
}
