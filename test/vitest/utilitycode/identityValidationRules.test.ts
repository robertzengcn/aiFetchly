import { describe, it, expect } from "vitest";
import {
  buildIdentityRules,
  requiredRule,
  emailRequiredRule,
  emailOrEmptyRule,
  noLineBreakRule,
} from "@/views/pages/emailservice/identityValidationRules";

const MSG = {
  required: "SMTP username is required",
  emailRequired: "From email is required",
  emailInvalid: "E-mail must be valid",
  noLineBreak: "Line breaks are not allowed",
};

describe("identityValidationRules (P1.1, PRD §15)", () => {
  describe("requiredRule", () => {
    it("rejects empty, null, and whitespace-only values", () => {
      expect(requiredRule(MSG.required)("")).toBe(MSG.required);
      expect(requiredRule(MSG.required)("   ")).toBe(MSG.required);
      expect(requiredRule(MSG.required)(null)).toBe(MSG.required);
      expect(requiredRule(MSG.required)(undefined)).toBe(MSG.required);
    });
    it("accepts a non-empty value", () => {
      expect(requiredRule(MSG.required)("login@example.com")).toBe(true);
    });
  });

  describe("emailRequiredRule", () => {
    it("requires a non-empty email address", () => {
      expect(emailRequiredRule(MSG.emailRequired, MSG.emailInvalid)("")).toBe(
        MSG.emailRequired,
      );
      expect(emailRequiredRule(MSG.emailRequired, MSG.emailInvalid)(null)).toBe(
        MSG.emailRequired,
      );
    });
    it("rejects a non-email string", () => {
      expect(emailRequiredRule(MSG.emailRequired, MSG.emailInvalid)("no-at-sign")).toBe(
        MSG.emailInvalid,
      );
    });
    it("accepts a valid email address", () => {
      expect(
        emailRequiredRule(MSG.emailRequired, MSG.emailInvalid)("from@example.com"),
      ).toBe(true);
    });
  });

  describe("emailOrEmptyRule (Reply-To is optional)", () => {
    it("accepts empty (Reply-To may be blank)", () => {
      expect(emailOrEmptyRule(MSG.emailInvalid)("")).toBe(true);
      expect(emailOrEmptyRule(MSG.emailInvalid)(null)).toBe(true);
      expect(emailOrEmptyRule(MSG.emailInvalid)("   ")).toBe(true);
    });
    it("rejects a non-empty invalid address", () => {
      expect(emailOrEmptyRule(MSG.emailInvalid)("bad-address")).toBe(
        MSG.emailInvalid,
      );
    });
    it("accepts a valid non-empty address", () => {
      expect(emailOrEmptyRule(MSG.emailInvalid)("replies@example.com")).toBe(true);
    });
  });

  describe("noLineBreakRule (§7.2 header-injection defense)", () => {
    it("rejects CR", () => {
      expect(noLineBreakRule(MSG.noLineBreak)("user\rname")).toBe(MSG.noLineBreak);
    });
    it("rejects LF", () => {
      expect(noLineBreakRule(MSG.noLineBreak)("user\nname")).toBe(MSG.noLineBreak);
    });
    it("rejects CRLF", () => {
      expect(noLineBreakRule(MSG.noLineBreak)("user\r\nname")).toBe(MSG.noLineBreak);
    });
    it("rejects Unicode line separator U+2028", () => {
      expect(noLineBreakRule(MSG.noLineBreak)("user\u2028name")).toBe(
        MSG.noLineBreak,
      );
    });
    it("rejects Unicode paragraph separator U+2029", () => {
      expect(noLineBreakRule(MSG.noLineBreak)("user\u2029name")).toBe(
        MSG.noLineBreak,
      );
    });
    it("accepts a value with no line breaks", () => {
      expect(noLineBreakRule(MSG.noLineBreak)("login@example.com")).toBe(true);
    });
    it("accepts empty (the guard does not fire on empty optional fields)", () => {
      expect(noLineBreakRule(MSG.noLineBreak)("")).toBe(true);
    });
  });

  describe("buildIdentityRules — field rule sets", () => {
    const rules = buildIdentityRules(MSG);

    it("SMTP username: required + no line break (not email-only)", () => {
      expect(rules.smtpUsername).toHaveLength(2);
      // A non-email login like "smtp_user" is valid (no email-only rule).
      expect(rules.smtpUsername[0]("smtp_user")).toBe(true);
      // Required fires on empty.
      expect(rules.smtpUsername[0]("")).toBe(MSG.required);
      // No-line-break fires on CR.
      expect(rules.smtpUsername[1]("user\rname")).toBe(MSG.noLineBreak);
    });

    it("From: required email + no line break", () => {
      expect(rules.from).toHaveLength(2);
      // Required fires on empty.
      expect(rules.from[0]("")).toBe(MSG.emailRequired);
      // Invalid email rejected.
      expect(rules.from[0]("not-an-email")).toBe(MSG.emailInvalid);
      // Valid email accepted.
      expect(rules.from[0]("from@example.com")).toBe(true);
      // No-line-break fires on LF.
      expect(rules.from[1]("from\n@example.com")).toBe(MSG.noLineBreak);
    });

    it("Reply-To: optional email + no line break", () => {
      expect(rules.replyTo).toHaveLength(2);
      // Empty is valid (optional field).
      expect(rules.replyTo[0]("")).toBe(true);
      // Non-empty invalid rejected.
      expect(rules.replyTo[0]("bad")).toBe(MSG.emailInvalid);
      // Valid non-empty accepted.
      expect(rules.replyTo[0]("replies@example.com")).toBe(true);
      // No-line-break fires on CRLF.
      expect(rules.replyTo[1]("replies\r\n@example.com")).toBe(MSG.noLineBreak);
    });
  });
});
