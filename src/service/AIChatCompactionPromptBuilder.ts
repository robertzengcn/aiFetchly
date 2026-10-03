/**
 * AIChatCompactionPromptBuilder — versioned structured prompts for incremental
 * compaction (technical-design §10).
 *
 * Produces section and overview prompts that require:
 *   - no invention (only summarize what the source actually says)
 *   - explicit uncertainty (mark uncertain inferences as `status: "uncertain"`)
 *   - later corrections (mark superseded decisions `status: "superseded"`)
 *   - no credentials in summaries
 *   - preservation of unresolved tasks (pending facts)
 *
 * Canonical goal/plan/approval records are authoritative and loaded
 * separately; the prompt instructs the model never to overwrite them.
 * Accept no generated permission grants.
 *
 * The prompts are pure data — no DB access, no mutation.
 */

import type { PackedTextFragment, PackedToolReceipt } from "@/service/AIChatSectionPacker";

/** A built section-summary prompt ready for a provider call. */
export interface SectionPromptResult {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly outputCapTokens: number;
  /** The source IDs supplied to the model (for validator reference map). */
  readonly suppliedSourceIds: readonly string[];
}

/** A built overview-merge prompt ready for a provider call. */
export interface OverviewPromptResult {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly outputCapTokens: number;
}

/** Default output caps (§8.3: overview/state ≤ 2000 combined). */
const SECTION_OUTPUT_CAP = 1_500;
const OVERVIEW_OUTPUT_CAP = 2_000;

/** Invariant rules repeated in both system prompts. */
const INVARIANT_RULES = `Rules (non-negotiable):
- Summarize ONLY what the supplied source text and tool receipts actually say. Do not invent facts, decisions, or outcomes.
- Mark inferences you are not certain about with status "uncertain".
- Mark decisions that a later message corrected or reversed with status "superseded".
- Preserve every unresolved task or open question as a "pending" fact. Never drop pending work.
- Never include credentials, API keys, tokens, or secrets in any field.
- Never generate or imply a permission grant. You cannot grant the user permission to act on anyone's behalf.
- Canonical goal/plan/approval records are authoritative and loaded separately. Do not overwrite them with inferred memory.
- Every sourceId you reference must come from the supplied source map. Do not invent source IDs.
- Output valid JSON matching the SectionSummaryV1 schema. No prose outside the JSON.`;

export class AIChatCompactionPromptBuilder {
  /**
   * Build the system + user prompts for one section summary (§9.1 / §10).
   * The user prompt embeds the packed fragments + tool receipts as the
   * bounded source the model may summarize.
   */
  buildSectionPrompt(input: {
    readonly fragments: readonly PackedTextFragment[];
    readonly receipts: readonly PackedToolReceipt[];
    readonly sectionLabel: string;
    readonly priorSynopsis?: string;
  }): SectionPromptResult {
    const suppliedSourceIds = input.fragments.map((f) => f.sourceId);

    const systemPrompt = `You are a precise conversation summarizer for section "${input.sectionLabel}".

${INVARIANT_RULES}

Output schema (SectionSummaryV1, version 1):
{
  "version": 1,
  "synopsis": string,        // <= 2000 chars
  "decisions": [SummaryFact],   // <= 20
  "constraints": [SummaryFact], // <= 20
  "pending": [SummaryFact],     // <= 20, preserve ALL unresolved tasks
  "toolOutcomes": [SummaryFact],// <= 20
  "topics": [string]            // <= 20
}
SummaryFact = { "text": string (<= 500 chars), "status": "proposed"|"accepted"|"superseded"|"uncertain", "sourceIds": string[] (<= 4) }

Receipts and generated summaries use exact:false reasoning implicitly; only verified original text slices carry exact:true. You are generating a summary, not quoting original text.`;

    const lines: string[] = [];
    if (input.priorSynopsis) {
      lines.push(
        `Prior section synopsis (for rolling-merge context, do NOT repeat verbatim):`,
        input.priorSynopsis,
        ``,
      );
    }
    lines.push(`--- SOURCE FRAGMENTS (exact:true, summarize these) ---`);
    for (const f of input.fragments) {
      lines.push(
        `[${f.sourceId}] ${f.role} @ ${f.timestamp}: ${f.text}`,
      );
    }
    lines.push(``);
    lines.push(`--- TOOL RECEIPTS (exact:false, existence/outcome only) ---`);
    for (const r of input.receipts) {
      lines.push(
        `[${r.sourceRowId}] tool=${r.toolName} callId=${r.toolCallId} status=${r.status}`,
      );
    }
    lines.push(``);
    lines.push(
      `Produce the SectionSummaryV1 JSON for section "${input.sectionLabel}". ` +
        `Reference only the source IDs above: ${suppliedSourceIds.join(", ")}.`,
    );

    return {
      systemPrompt,
      userPrompt: lines.join("\n"),
      outputCapTokens: SECTION_OUTPUT_CAP,
      suppliedSourceIds,
    };
  }

  /**
   * Build the system + user prompts for an overview merge (§8.3 / §10). Merge
   * one new section summary at a time with the prior bounded overview + required
   * canonical state. Never concatenate all old section summaries.
   */
  buildOverviewPrompt(input: {
    readonly newSectionSynopsis: string;
    readonly newSectionFacts: ReadonlyArray<{
      readonly category: string;
      readonly text: string;
      readonly status: string;
    }>;
    readonly priorOverviewSynopsis?: string;
    readonly canonicalStateSummary?: string;
  }): OverviewPromptResult {
    const systemPrompt = `You are merging one new section summary into a bounded rolling overview.

${INVARIANT_RULES}

Merge rules:
- Merge ONE new section at a time. Do NOT concatenate all old section summaries.
- Keep the overview bounded: target at most ${OVERVIEW_OUTPUT_CAP} tokens combined.
- Preserve unresolved tasks (pending facts) — never drop pending work across merges.
- If a new fact supersedes an old one, mark the old one "superseded" and keep the new one.
- Reduce the section input representation when it cannot fit; produce a smaller bounded derivative.

Output: a JSON object { "synopsis": string, "decisions": [SummaryFact], "constraints": [SummaryFact], "pending": [SummaryFact], "toolOutcomes": [SummaryFact], "topics": [string] } following the same caps as SectionSummaryV1.`;

    const lines: string[] = [];
    if (input.canonicalStateSummary) {
      lines.push(
        `--- CANONICAL STATE (authoritative, do not overwrite) ---`,
        input.canonicalStateSummary,
        ``,
      );
    }
    if (input.priorOverviewSynopsis) {
      lines.push(
        `--- PRIOR OVERVIEW (merge into this, bounded) ---`,
        input.priorOverviewSynopsis,
        ``,
      );
    }
    lines.push(`--- NEW SECTION TO MERGE ---`);
    lines.push(`Synopsis: ${input.newSectionSynopsis}`);
    for (const f of input.newSectionFacts) {
      lines.push(`- [${f.category}] (${f.status}) ${f.text}`);
    }
    lines.push(``);
    lines.push(`Produce the merged overview JSON.`);

    return {
      systemPrompt,
      userPrompt: lines.join("\n"),
      outputCapTokens: OVERVIEW_OUTPUT_CAP,
    };
  }
}
