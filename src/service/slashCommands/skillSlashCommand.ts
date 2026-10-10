/**
 * `/skill <name> [task]` slash-command parser (PRD §9.5).
 *
 * An explicit user action and automatic model selection must resolve
 * through the SAME catalog + invocation service. The renderer parses this
 * shape, invokes the prompt skill explicitly (invocationSource "explicit"),
 * and sends the remaining task text as the model message — the assembler's
 * invoked-skill reattachment then delivers the hidden instruction block.
 *
 * Pure function — renderer-safe.
 */

export interface SkillSlashCommand {
  readonly type: "skill_invoke";
  /** Skill name or prompt: runtime id. */
  readonly name: string;
  /** Remaining text after the name — the task to run under the skill. */
  readonly taskText: string;
}

export type ParsedSkillSlash = SkillSlashCommand | { readonly type: "none" };

export function parseSkillSlashCommand(text: string): ParsedSkillSlash {
  const trimmed = (text ?? "").trim();
  if (!/^\/skill(?:\s|$)/.test(trimmed)) {
    return { type: "none" };
  }
  const rest = trimmed.replace(/^\/skill(?:\s+|$)/, "").trim();
  if (rest === "") {
    return { type: "none" };
  }
  // Name = first token (or a quoted name), task = the remainder.
  const quoted = /^"([^"]+)"\s*(.*)$/.exec(rest);
  if (quoted) {
    return {
      type: "skill_invoke",
      name: quoted[1],
      taskText: quoted[2].trim(),
    };
  }
  const [name, ...taskParts] = rest.split(/\s+/);
  return {
    type: "skill_invoke",
    name,
    taskText: taskParts.join(" ").trim(),
  };
}

/** Default model message when the user invokes a skill without a task. */
export const SKILL_SLASH_DEFAULT_TASK =
  "Follow the invoked skill's instructions for the current request.";
