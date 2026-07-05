import { describe, it, expect, vi } from "vitest";

// Mock heavy dependencies that the registry pulls in transitively, so the test
// can load skillsRegistry without a live DB / Electron / vector store.
vi.mock("@/service/ToolExecutor", () => ({
  ToolExecutor: { execute: vi.fn() },
}));
vi.mock("@/service/MCPToolService", () => ({
  MCPToolService: { getAllTools: () => [], refresh: vi.fn() },
}));

import { SkillRegistry } from "@/config/skillsRegistry";

const READ_TOOLS = [
  "list_email_inboxes",
  "fetch_unread_emails",
  "get_email_message",
  "mark_email_processed",
] as const;

describe("Email receive AI tools registration", () => {
  for (const name of READ_TOOLS) {
    it(`registers ${name} as a built-in automation tool`, () => {
      const skill = SkillRegistry.getSkill(name);
      expect(skill).not.toBeNull();
      expect(skill!.source).toBe("built-in");
      expect(skill!.tier).toBe("main");
      expect(skill!.permissionCategory).toBe("automation");
      expect(skill!.requiresConfirmation).toBe(false);
      expect(typeof skill!.execute).toBe("function");
    });
  }

  it("advertises all email receive tools to the LLM", async () => {
    const fns = await SkillRegistry.getAllToolFunctions();
    const names = new Set(fns.map((f) => (f as { name: string }).name));
    for (const name of READ_TOOLS) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("fetch_unread_emails requires email_service_id and caps limit", () => {
    const skill = SkillRegistry.getSkill("fetch_unread_emails")!;
    const props = skill.parameters.properties as Record<
      string,
      { type: string }
    >;
    expect(props.email_service_id).toBeDefined();
    expect(skill.parameters.required).toContain("email_service_id");
    expect(props.limit.default).toBe(10);
  });

  it("get_email_message requires message_id", () => {
    const skill = SkillRegistry.getSkill("get_email_message")!;
    expect(skill.parameters.required).toContain("message_id");
  });

  it("mark_email_processed requires message_id and status", () => {
    const skill = SkillRegistry.getSkill("mark_email_processed")!;
    expect(skill.parameters.required).toContain("message_id");
    expect(skill.parameters.required).toContain("status");
  });
});

describe("Email reply draft/send AI tools", () => {
  it("create_email_reply_draft does NOT require confirmation (draft only)", () => {
    const skill = SkillRegistry.getSkill("create_email_reply_draft");
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe("built-in");
    expect(skill!.permissionCategory).toBe("automation");
    expect(skill!.requiresConfirmation).toBe(false);
    expect(skill!.parameters.required).toContain("message_id");
  });

  it("send_email_reply REQUIRES confirmation (it sends email)", () => {
    const skill = SkillRegistry.getSkill("send_email_reply");
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe("built-in");
    expect(skill!.permissionCategory).toBe("automation");
    expect(skill!.requiresConfirmation).toBe(true);
    expect(skill!.parameters.required).toContain("draft_id");
  });
});
