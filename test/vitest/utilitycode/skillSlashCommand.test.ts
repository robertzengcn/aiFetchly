/**
 * Tests for the /skill slash-command parser (PRD §9.5): explicit user
 * invocation parsing — name or quoted name, remainder as task text, and
 * non-matching inputs pass through untouched.
 */
import { describe, expect, it } from "vitest";
import {
  parseSkillSlashCommand,
  SKILL_SLASH_DEFAULT_TASK,
} from "@/service/slashCommands/skillSlashCommand";

describe("parseSkillSlashCommand", () => {
  it("parses a bare skill name", () => {
    const parsed = parseSkillSlashCommand("/skill video-use");
    expect(parsed.type).toBe("skill_invoke");
    if (parsed.type !== "skill_invoke") return;
    expect(parsed.name).toBe("video-use");
    expect(parsed.taskText).toBe("");
  });

  it("parses a name plus task text", () => {
    const parsed = parseSkillSlashCommand(
      "/skill video-use edit the interview footage gently"
    );
    expect(parsed.type).toBe("skill_invoke");
    if (parsed.type !== "skill_invoke") return;
    expect(parsed.name).toBe("video-use");
    expect(parsed.taskText).toBe("edit the interview footage gently");
  });

  it("supports quoted names with spaces", () => {
    const parsed = parseSkillSlashCommand(
      '/skill "release check" validate the build'
    );
    expect(parsed.type).toBe("skill_invoke");
    if (parsed.type !== "skill_invoke") return;
    expect(parsed.name).toBe("release check");
    expect(parsed.taskText).toBe("validate the build");
  });

  it("supports prompt: runtime ids", () => {
    const parsed = parseSkillSlashCommand(
      "/skill prompt:user:abc123 do the thing"
    );
    expect(parsed.type).toBe("skill_invoke");
    if (parsed.type !== "skill_invoke") return;
    expect(parsed.name).toBe("prompt:user:abc123");
  });

  it("does not match other commands or plain text", () => {
    expect(parseSkillSlashCommand("/goal finish the task").type).toBe("none");
    expect(parseSkillSlashCommand("/skills").type).toBe("none");
    expect(parseSkillSlashCommand("regular message").type).toBe("none");
    expect(parseSkillSlashCommand("/skill").type).toBe("none");
    expect(parseSkillSlashCommand("").type).toBe("none");
  });

  it("exposes a default task for name-only invocations", () => {
    expect(SKILL_SLASH_DEFAULT_TASK).toContain("skill");
  });
});
