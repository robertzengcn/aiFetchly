/**
 * PromptSkillToolNarrowing — FR-13/NFR-11 capability narrowing for invoked
 * prompt skills: a skill's frontmatter `allowed-tools` may REDUCE the tools
 * presented to the model for the rest of the conversation. It can never
 * widen them, and it can never remove the application-mandated core
 * (installer tools, catalog discovery, use_skill itself, and the
 * skill-resource tools the invoked instructions rely on).
 */

/** Application-mandated core: never narrowed away (design §9.7/§14.5). */
export const SKILL_NARROWING_CORE_TOOLS: ReadonlySet<string> = new Set([
  "tool_catalog_search",
  "use_skill",
  "skill_resource_list",
  "skill_resource_read",
  "skill_resource_execute",
  "skill_install_prepare",
  "skill_install_approve",
  "skill_install_status",
  "skill_install_cancel",
  "skill_install_update",
  "skill_install_repair",
  "skill_install_retry",
]);

/**
 * Intersect the `allowedTools` declared by the conversation's ACTIVE skill
 * invocations.
 *
 *  - no invocation declares a list → null (no narrowing);
 *  - multiple invocations declare lists → the INTERSECTION (a tool must be
 *    allowed by EVERY active skill to stay exposed);
 *  - an empty declared list narrows to the core only.
 *
 * Frontmatter names accept the bare tool name (`file_read`) and the
 * Claude-style mcp__Server__tool form is preserved verbatim.
 */
export function intersectSkillToolAllowlists(
  invocations: readonly {
    readonly runtimeId: string;
    readonly allowedTools?: readonly string[];
  }[]
): Set<string> | null {
  let allowlist: Set<string> | null = null;
  for (const invocation of invocations) {
    const declared = invocation.allowedTools;
    if (!declared || declared.length === 0) continue;
    const declaredSet = new Set(
      declared
        .map((name: string) => name.trim())
        .filter((name: string) => name.length > 0)
    );
    if (allowlist === null) {
      allowlist = declaredSet;
    } else {
      const kept: string[] = [];
      for (const name of allowlist) {
        if (declaredSet.has(name)) kept.push(name);
      }
      allowlist = new Set(kept);
    }
  }
  return allowlist;
}

/** Apply an allowlist to candidate tool names — core tools always survive. */
export function applySkillToolNarrowing(
  candidates: readonly string[],
  allowlist: Set<string> | null
): readonly string[] {
  if (allowlist === null) return candidates;
  return candidates.filter(
    (name) => SKILL_NARROWING_CORE_TOOLS.has(name) || allowlist.has(name)
  );
}
