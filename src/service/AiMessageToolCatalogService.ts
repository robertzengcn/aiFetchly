import { SkillRegistry } from "@/config/skillsRegistry";
import { describeBuiltInToolForSchedule } from "@/service/ScheduledAiToolPolicy";
import type { SchedulableAiToolSummary } from "@/entityTypes/aiMessageTaskTypes";

/**
 * Returns built-in tools annotated with schedulability metadata
 * for the AI message task creation UI.
 */
export function listSchedulableBuiltInTools(): SchedulableAiToolSummary[] {
  const builtIns = SkillRegistry.listBuiltInSkillDefinitions();
  return builtIns.map((skill) => describeBuiltInToolForSchedule(skill));
}
