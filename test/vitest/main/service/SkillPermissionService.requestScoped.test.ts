import { describe, it, expect, vi, beforeEach } from "vitest";

// D2 (review): request-scoped organization tools must ALWAYS prompt.
// A stored "Always allow" grant or a session "Allow once" grant must never
// silence a later send_email_forward / move_email_to_trash / restore_email
// call (PRD FR-12; the prompt-injection threat model).

const tokenGetValue = vi.fn((key: string) => "");
vi.mock("@/modules/token", () => ({
  Token: class {
    constructor() {
      return { getValue: tokenGetValue };
    }
  },
}));

vi.mock("@/modules/Logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SkillPermissionService } from "@/service/SkillPermissionService";
import "@/config/skillsRegistry";

beforeEach(() => {
  tokenGetValue.mockReturnValue("");
});

describe("SkillPermissionService: request_scoped_action always prompts", () => {
  it.each(["send_email_forward", "move_email_to_trash", "restore_email"])(
    "ignores a persistent 'granted' token for %s",
    (tool) => {
      tokenGetValue.mockImplementation((key: string) =>
        key === `SKILL_PERMISSION_${tool}` ? "granted" : ""
      );
      const result = SkillPermissionService.checkPermission(tool);
      expect(result.allowed).toBe(false);
      expect(result.needsPrompt).toBe(true);
    }
  );

  it("prompts even when the AI gate would otherwise pass", () => {
    tokenGetValue.mockImplementation((key: string) =>
      key === "user_ai_enabled" ? "true" : ""
    );
    const result = SkillPermissionService.checkPermission("move_email_to_trash");
    expect(result.needsPrompt).toBe(true);
  });

  it("still honors a persistent grant for an ordinary automation tool", () => {
    tokenGetValue.mockImplementation((key: string) =>
      key === "SKILL_PERMISSION_list_email_inboxes" ? "granted" : ""
    );
    const result = SkillPermissionService.checkPermission("list_email_inboxes");
    expect(result.allowed).toBe(true);
    expect(result.needsPrompt).toBe(false);
  });
});
