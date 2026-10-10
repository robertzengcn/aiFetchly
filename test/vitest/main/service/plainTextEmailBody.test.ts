import { describe, expect, it } from "vitest";
import { SkillRegistry } from "@/config/skillsRegistry";
import {
  coerceOutboundEmailBodyToPlainText,
  resolveInlineOutboundBody,
} from "@/service/outboundEmail/plainTextEmailBody";

describe("coerceOutboundEmailBodyToPlainText", () => {
  it("keeps real plain text, including line breaks and bare links", () => {
    const body = "Hello,\n\nSee <https://example.com> for details.";
    expect(coerceOutboundEmailBodyToPlainText(body)).toBe(body);
  });

  it("reduces HTML markup to readable text", () => {
    const plain = coerceOutboundEmailBodyToPlainText(
      "<p>Hello <strong>there</strong></p>"
    );
    expect(plain).not.toMatch(/<[^>]+>/);
    expect(plain).toContain("Hello");
    expect(plain).toContain("there");
  });
});

describe("resolveInlineOutboundBody", () => {
  it("prefers email_content over a legacy HTML argument", () => {
    expect(
      resolveInlineOutboundBody({
        email_content: "Plain message",
        email_html_content: "<p>HTML</p>",
      })
    ).toBe("Plain message");
  });

  it("coerces a legacy HTML-only body to text", () => {
    expect(
      resolveInlineOutboundBody({
        email_html_content: "<p>This is a test email sent from aiFetchly.</p>",
      })
    ).toBe("This is a test email sent from aiFetchly.");
  });
});

describe("outbound email tool contract", () => {
  it("asks start_email_send_task for plain text, not an HTML body field", () => {
    const skill = SkillRegistry.getSkill("start_email_send_task");
    expect(skill).toBeDefined();
    const properties = skill!.parameters.properties as Record<
      string,
      { description?: string }
    >;
    expect(properties.email_content?.description?.toLowerCase()).toContain(
      "plain-text"
    );
    expect(properties.email_content?.description?.toLowerCase()).toContain(
      "html"
    );
    expect(properties.email_html_content).toBeUndefined();
    expect(skill!.description).not.toContain("email_html_content");
    expect(skill!.description.toLowerCase()).toContain("plain text");
  });

  it("asks draft_outbound_email_batch for the same plain-text body", () => {
    const skill = SkillRegistry.getSkill("draft_outbound_email_batch");
    expect(skill).toBeDefined();
    const properties = skill!.parameters.properties as Record<string, unknown>;
    expect(properties.email_content).toBeDefined();
    expect(properties.email_html_content).toBeUndefined();
    expect(skill!.description.toLowerCase()).toContain("plain text");
    expect(skill!.description).not.toContain("email_html_content");
  });
});
