/**
 * PromptSkillCatalogPresenter — bounded model-facing metadata catalog
 * (design §10.3, PRD §9.5/§14, NFR-09).
 *
 * Renders the available prompt-skill list the model sees each turn:
 *   - name + bounded description + disambiguating scope label only —
 *     NEVER instruction bodies (uninvoked skills must not consume context);
 *   - a total catalog token budget; when exceeded, descriptions are
 *     shortened deterministically (never solved by injecting bodies);
 *   - `user-invocable`/`disable-model-invocation` surface as visibility
 *     hints so the model knows which skills it may auto-select.
 */

import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";
import type {
  AvailablePromptSkill,
  PromptSkillResolutionContext,
} from "@/entityTypes/promptSkillTypes";

/** Total budget for the catalog block, in ~4-chars-per-token estimates. */
export const PROMPT_SKILL_CATALOG_MAX_TOKENS = 600;
const DESCRIPTION_MAX_CHARS = 160;
const SHORTENED_DESCRIPTION_CHARS = 60;

export function buildPromptSkillCatalogBlock(
  context: PromptSkillResolutionContext
): string {
  const skills = getDefaultPromptSkillCatalog().list(context);
  if (skills.length === 0) return "";

  const lines: string[] = [];
  let used = 0;
  const header =
    "Available prompt skills (invoke with use_skill by name or runtime id):";
  used += estimate(header);

  for (const skill of skills) {
    const line = renderLine(skill, DESCRIPTION_MAX_CHARS);
    const cost = estimate(line);
    if (used + cost > PROMPT_SKILL_CATALOG_MAX_TOKENS) {
      // Deterministic shortening first; drop entirely only past the cap.
      const shortened = renderLine(skill, SHORTENED_DESCRIPTION_CHARS);
      const shortCost = estimate(shortened);
      if (used + shortCost <= PROMPT_SKILL_CATALOG_MAX_TOKENS) {
        lines.push(shortened);
        used += shortCost;
        continue;
      }
      break;
    }
    lines.push(line);
    used += cost;
  }

  if (lines.length === 0) return "";
  const omitted = skills.length - lines.length;
  const tail =
    omitted > 0
      ? `\n(${omitted} more skill(s) omitted for context budget)`
      : "";
  return `${header}\n${lines.join("\n")}${tail}`;
}

function renderLine(
  skill: AvailablePromptSkill,
  maxDescription: number
): string {
  const description =
    skill.description.length > maxDescription
      ? `${skill.description.slice(0, maxDescription - 1)}…`
      : skill.description;
  const visibility = skill.modelInvocable
    ? skill.userInvocable
      ? ""
      : " (explicit user invocation only)"
    : " (model selection disabled)";
  return `- ${skill.name} — ${description} [${skill.sourceLabel}${visibility}]`;
}

function estimate(text: string): number {
  return Math.ceil(text.length / 4);
}
