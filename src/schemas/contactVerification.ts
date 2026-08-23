/**
 * Contact Verification — external LLM-facing Zod input schema (design §7.3).
 *
 * This is the SNAKE_CASE contract consumed at the AI tool boundary. It parses
 * untrusted model input into a stable shape, then the adapter in
 * `ContactVerificationAiTools` maps it to the internal camelCase
 * `ContactVerificationRequest` consumed by the runtime-neutral service.
 *
 * Import rule (CLAUDE.md): Zod v4 via `zod/v4`. Derive TS types with
 * `z.infer` rather than hand-writing interfaces that mirror the schema.
 */
import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";

// ---------------------------------------------------------------------------
// Country evidence source enum (design §7.3)
// ---------------------------------------------------------------------------

export const countryEvidenceSourceSchema = z.enum([
  "explicit_user",
  "structured_contact",
  "same_block_address",
  "same_block_heading",
  "same_block_text",
  "page_level",
  "site_domain",
  "headquarters",
  "campaign_country",
  "user_locale",
  "unknown",
]);

export type CountryEvidenceSourceInput = z.infer<typeof countryEvidenceSourceSchema>;

// ---------------------------------------------------------------------------
// Input schema (design §7.3)
// ---------------------------------------------------------------------------

const countryEvidenceItemSchema = z.strictObject({
  country: z
    .string()
    .length(2, "country must be an ISO 3166-1 alpha-2 code")
    .transform((c) => c.toUpperCase()),
  source: countryEvidenceSourceSchema,
  evidence_text: z.string().max(240).optional(),
});

const contextSchema = z.strictObject({
  nearby_text: z.string().max(1500).optional(),
  address: z.string().max(1000).optional(),
  country_evidence: z.array(countryEvidenceItemSchema).max(8).default([]),
});

const contactGroupSchema = z.strictObject({
  source_url: z.string().url().max(2048).optional(),
  emails: z.array(z.string().min(1).max(320)).max(50).default([]),
  phones: z.array(z.string().min(1).max(128)).max(50).default([]),
  context: contextSchema.optional(),
});

export const contactVerificationInputSchema = lazySchema(() =>
  z
    .strictObject({
      contacts: z.array(contactGroupSchema).min(1).max(25),
    })
    // Post-schema refinement (design §7.3): each group must carry at least
    // one contact value; the whole call is bounded on total values.
    .refine(
      (data) =>
        data.contacts.every((g) => g.emails.length + g.phones.length >= 1),
      { message: "each contact group must contain at least one email or phone" }
    )
    .refine(
      (data) => {
        const total = data.contacts.reduce(
          (sum, g) => sum + g.emails.length + g.phones.length,
          0
        );
        return total <= 100;
      },
      { message: "at most 100 email and phone values combined per call" }
    )
);

export type ContactVerificationInput = z.infer<
  ReturnType<typeof contactVerificationInputSchema>
>;

// ---------------------------------------------------------------------------
// LLM-facing JSON Schema parameters (for skillsRegistry / aiTools.config)
// ---------------------------------------------------------------------------

/**
 * JSON-Schema-shaped `parameters` for the `verify_contact_info` tool, kept
 * here so the two registration surfaces (skillsRegistry + aiTools.config)
 * cannot drift (design §7.1). Mirrors the Zod contract above.
 */
export const CONTACT_VERIFICATION_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    contacts: {
      type: "array",
      minItems: 1,
      maxItems: 25,
      description:
        "One or more contact groups. Each group shares a source URL and contact-block context.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source_url: {
            type: "string",
            format: "uri",
            maxLength: 2048,
            description: "Optional source URL for an extracted contact.",
          },
          emails: {
            type: "array",
            maxItems: 50,
            items: { type: "string", minLength: 1, maxLength: 320 },
            description: "Email addresses to verify (may be empty if phones given).",
          },
          phones: {
            type: "array",
            maxItems: 50,
            items: { type: "string", minLength: 1, maxLength: 128 },
            description: "Phone numbers to verify (may be empty if emails given).",
          },
          context: {
            type: "object",
            additionalProperties: false,
            properties: {
              nearby_text: {
                type: "string",
                maxLength: 1500,
                description: "Nearby text from the same contact block.",
              },
              address: {
                type: "string",
                maxLength: 1000,
                description: "Postal address in the same contact block.",
              },
              country_evidence: {
                type: "array",
                maxItems: 8,
                description:
                  "Country inferences for the phones in this block, each with its source. Omit when uncertain.",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    country: {
                      type: "string",
                      pattern: "^[A-Za-z]{2}$",
                      description: "ISO 3166-1 alpha-2 country code.",
                    },
                    source: {
                      type: "string",
                      enum: [
                        "explicit_user",
                        "structured_contact",
                        "same_block_address",
                        "same_block_heading",
                        "same_block_text",
                        "page_level",
                        "site_domain",
                        "headquarters",
                        "campaign_country",
                        "user_locale",
                        "unknown",
                      ],
                    },
                    evidence_text: { type: "string", maxLength: 240 },
                  },
                  required: ["country", "source"],
                },
              },
            },
          },
        },
      },
    },
  },
  required: ["contacts"],
} as const;

/**
 * The full LLM-facing tool description (PRD §10.1, design §7.2). Both
 * registration surfaces import this single constant.
 */
export const CONTACT_VERIFICATION_TOOL_DESCRIPTION: string =
  "Validate and normalize email addresses and phone numbers using free, local " +
  "Standard-depth checks.\n\n" +
  "For emails, check syntax, placeholder patterns, disposable domains, DNS " +
  "resolution, and mail-routing records. For phone numbers, check extraction " +
  "noise, international or national formatting, numbering-plan metadata, and " +
  "country evidence associated with the same contact block.\n\n" +
  "Call this tool immediately after any tool, including extract_contact_info, " +
  "returns one or more previously unverified email addresses or phone numbers. " +
  "Run verification before presenting, exporting, saving, or using those " +
  "contacts as verified data. Pass original values, source URLs, and nearby " +
  "contact context.\n\n" +
  "Do not use the website domain, company headquarters, campaign country, user " +
  "locale, or an unrelated office address as authoritative country evidence. If " +
  "a national phone number lacks strong same-block country evidence, preserve " +
  "the original number and classify its region as ambiguous.\n\n" +
  "This tool does not confirm mailbox existence, phone-line activity, ownership, " +
  "deliverability, reachability, or marketing consent. Do not claim that it does. " +
  "Do not re-verify contacts that already contain a completed verification result " +
  "unless the user requests it or the prior result is stale or temporary.";
