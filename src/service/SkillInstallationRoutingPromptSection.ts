/**
 * SkillInstallationRoutingPromptSection — the single versioned source for
 * the application-owned installation routing policy (design §8.5, PRD §9.6,
 * FR-26, NFR-12).
 *
 * The full instruction is injected by AIChatContextAssembler as
 * application-owned system context — after core safety policy, before any
 * repository-authored or invoked-skill content, exactly once per turn.
 * Repository content (SKILL.md, install.md, tool results, compacted
 * summaries, plugin prompts) can never replace, weaken, or override it.
 *
 * Provider-neutral: names no Claude/Codex/OpenAI roles and no
 * provider-specific skills directories. Pure data — main-process safe.
 */

import { SKILL_ROUTING_POLICY_VERSION } from "@/service/SkillInstallIntentGuard";

/** Bumped when normative rules change; snapshot tests pin the semantics. */
export const SKILL_INSTALL_ROUTING_POLICY_VERSION = SKILL_ROUTING_POLICY_VERSION;

export const SKILL_INSTALL_TOOL_NAME = "skill_install_prepare";

export function buildSkillInstallationRoutingSection(): string {
  return `# Skill installation policy

When the user asks to install, set up, register, update, repair, or configure a
skill from a repository URL or local package:

1. Call ${SKILL_INSTALL_TOOL_NAME} with the source and the user's non-secret
   constraints.
2. Do not clone the repository using shell_execute or manually copy it with file
   tools.
3. Do not search the tool catalog for Git or filesystem tools first.
4. Continue the installation using the returned session_id and next_action.
5. Never accept API keys through chat or ordinary tool arguments. Request the
   secure credential input when the installation enters awaiting-secret.
6. Do not execute the installed skill unless the user separately asks to use it.
7. When next_action is ready, report readiness and follow the user's requested
   terminal behavior.

Use use_skill only to invoke an already installed prompt skill. It does not install, update, repair, or configure skill packages.`;
}

/** Compact capability-map reminder (design §8.5 shared source). */
export const SKILL_INSTALL_COMPACT_REMINDER =
  `Install/setup/register/update/repair a skill package: call ` +
  `${SKILL_INSTALL_TOOL_NAME} directly. It owns acquisition and activation. ` +
  `Do not use shell/file tools, do not search for Git first, and never pass secrets.`;

/** Repeated in the ${SKILL_INSTALL_TOOL_NAME} tool description. */
export const SKILL_INSTALL_TOOL_DESCRIPTION_REMINDER = SKILL_INSTALL_COMPACT_REMINDER;
