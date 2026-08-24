/**
 * PromptSkillTokenBudgetService — model-aware instruction sizing
 * (design §10.7, PRD §14.3).
 *
 * Replaces the legacy fixed 8,000-character cap with token-aware selection:
 *   1. `full` when the complete normalized body fits the per-skill and
 *      aggregate active-skill budgets;
 *   2. `section-selected` when it does not — deterministic, heading-aware
 *      selection that ALWAYS keeps the opening contract plus workflow and
 *      safety/constraint sections, preserves whole fenced code blocks, and
 *      lists what was omitted so the model can `skill_resource_read` it;
 *   3. `metadata-only` when even the essential block cannot fit — ask for
 *      compaction instead of silently dropping policy.
 */

import type {
  PromptSkillBudgetDecision,
  PromptSkillSection,
} from "@/entityTypes/promptSkillTypes";

/** Rough token estimate: ~4 chars per token for markdown-ish text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split markdown into sections on ATX headings (## …), preserving whole
 * fenced code blocks — a fence is never split even when it contains lines
 * starting with '#'. Content before the first heading is the preamble
 * ("opening contract") section.
 */
export function splitMarkdownSections(markdown: string): PromptSkillSection[] {
  const lines = markdown.split("\n");
  const sections: PromptSkillSection[] = [];
  let currentHeading = "";
  let current: string[] = [];
  let inFence = false;

  const flush = (): void => {
    const content = current.join("\n").trim();
    if (content !== "" || currentHeading !== "") {
      sections.push({ heading: currentHeading, content });
    }
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    const headingMatch = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[2].trim();
      current = [];
      continue;
    }
    current.push(line);
  }
  flush();
  return sections;
}

const ESSENTIAL_HEADING_RE =
  /(overview|summary|contract|purpose|usage|how to use|workflow|instructions?|steps?|safety|constraint|requirement|important|warning|caution|rule|policy|guard)/i;

/** Deterministic essential-section classifier. */
export function isEssentialSection(section: PromptSkillSection): boolean {
  if (section.heading === "") return true; // preamble = opening contract
  return ESSENTIAL_HEADING_RE.test(section.heading);
}

export interface TokenBudgetInput {
  readonly normalizedBody: string;
  readonly availableTokens: number;
  readonly perSkillMaxTokens: number;
  readonly invocationArguments?: string;
}

export class PromptSkillTokenBudgetService {
  decide(input: TokenBudgetInput): PromptSkillBudgetDecision {
    const { normalizedBody, availableTokens, perSkillMaxTokens } = input;
    const bodyTokens = estimateTokens(normalizedBody);
    const budget = Math.min(availableTokens, perSkillMaxTokens);

    if (bodyTokens <= budget) {
      return {
        mode: "full",
        availableTokens: budget,
        selectedSections: [],
        omittedSections: [],
        estimatedTokens: bodyTokens,
        resourceReadRequired: false,
      };
    }

    // Section-aware selection.
    const sections = splitMarkdownSections(normalizedBody);
    const argumentKeywords = (input.invocationArguments ?? "")
      .toLowerCase()
      .split(/[^a-z0-9_-]+/)
      .filter((w) => w.length >= 3);

    const scored = sections.map((section, index) => ({
      section,
      index,
      essential: isEssentialSection(section),
      matchesArguments:
        argumentKeywords.length > 0 &&
        argumentKeywords.some(
          (kw) =>
            section.heading.toLowerCase().includes(kw) ||
            section.content.toLowerCase().includes(kw)
        ),
    }));

    // Selection order: essentials first (document order), then
    // argument-matching sections, then remaining in document order.
    const order: number[] = [
      ...scored.filter((s) => s.essential).map((s) => s.index),
      ...scored
        .filter((s) => !s.essential && s.matchesArguments)
        .map((s) => s.index),
      ...scored
        .filter((s) => !s.essential && !s.matchesArguments)
        .map((s) => s.index),
    ];

    const selected: number[] = [];
    let usedTokens = 0;
    const truncationNoticeTokens = 60; // reserved for the omission notice
    const effectiveBudget = Math.max(0, budget - truncationNoticeTokens);

    for (const index of order) {
      const sectionTokens = estimateTokens(sections[index].content);
      if (usedTokens + sectionTokens <= effectiveBudget) {
        selected.push(index);
        usedTokens += sectionTokens;
      }
      // Sections that do not fit are skipped whole — never sliced mid-block.
    }

    const selectedSet = new Set(selected);
    const essentialIncluded = scored
      .filter((s) => s.essential)
      .every((s) => selectedSet.has(s.index));

    if (!essentialIncluded && selected.length === 0) {
      // Even the essential block cannot fit.
      return {
        mode: "metadata-only",
        availableTokens: budget,
        selectedSections: [],
        omittedSections: sections.map((s) => s.heading),
        estimatedTokens: 0,
        resourceReadRequired: true,
      };
    }

    return {
      mode: "section-selected",
      availableTokens: budget,
      selectedSections: selected
        .sort((a, b) => a - b)
        .map((i) => sections[i].heading),
      omittedSections: sections
        .map((s) => s.heading)
        .filter((_, i) => !selectedSet.has(i)),
      estimatedTokens: usedTokens,
      resourceReadRequired: true,
    };
  }

  /**
   * Render the selected sections back to markdown in document order, with an
   * explicit omission notice instructing `skill_resource_read` usage.
   */
  renderSelected(
    normalizedBody: string,
    decision: PromptSkillBudgetDecision
  ): string {
    if (decision.mode === "full") return normalizedBody;
    const sections = splitMarkdownSections(normalizedBody);
    const selectedHeadings = new Set(decision.selectedSections);
    const parts: string[] = [];
    for (const s of sections) {
      if (!selectedHeadings.has(s.heading)) continue;
      parts.push(
        s.heading !== "" ? `## ${s.heading}\n\n${s.content}` : s.content
      );
    }
    const omitted = decision.omittedSections.filter((h) => h !== "");
    const notice =
      omitted.length > 0
        ? `\n\n---\n[Sections omitted for context budget: ${omitted
            .map((h) => `## ${h}`)
            .join(
              "; "
            )} — use skill_resource_read to load a section when needed.]`
        : "";
    return `${parts.join("\n\n")}${notice}`;
  }
}
