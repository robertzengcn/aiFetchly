import { describe, it, expect } from "vitest";
import {
  validateReplyOutput,
  normalizeForValidation,
} from "@/service/emailReply/EmailReplyOutputValidator";

describe("validateReplyOutput — clean content", () => {
  it("passes a clean reply with no findings", () => {
    const r = validateReplyOutput(
      "Re: Pricing",
      "Hi, happy to help. Could you share more detail?"
    );
    expect(r.sendableAfterApproval).toBe(true);
    expect(r.findings).toHaveLength(0);
    expect(r.validatorVersion).toBeTruthy();
  });
});

describe("validateReplyOutput — leakage (block)", () => {
  it("blocks AI self-disclosure (English)", () => {
    const r = validateReplyOutput(
      "Re: x",
      "As an AI language model, I can help."
    );
    expect(r.sendableAfterApproval).toBe(false);
    expect(r.findings.some((f) => f.severity === "block")).toBe(true);
  });

  it("blocks AI self-disclosure (Chinese)", () => {
    const r = validateReplyOutput("Re: x", "作为一个人工智能，我可以帮忙。");
    expect(r.sendableAfterApproval).toBe(false);
  });

  it("blocks AI self-disclosure (Japanese)", () => {
    const r = validateReplyOutput("Re: x", "私はaiです。");
    expect(r.sendableAfterApproval).toBe(false);
  });

  it("blocks system-prompt references", () => {
    const r = validateReplyOutput(
      "Re: x",
      "Per the system instructions, here is the plan."
    );
    expect(r.findings.some((f) => f.code === "leakage_system_prompt")).toBe(
      true
    );
    expect(r.sendableAfterApproval).toBe(false);
  });

  it("blocks prompt-style section headers leaking out", () => {
    const r = validateReplyOutput(
      "Re: x",
      "SYSTEM POLICY says we should reply."
    );
    expect(r.findings.some((f) => f.code === "leakage_system_policy")).toBe(
      true
    );
  });

  it("blocks retrieval metadata leakage", () => {
    const r = validateReplyOutput(
      "Re: x",
      "According to chunk id 42 and document[3]..."
    );
    expect(
      r.findings.some((f) => f.code === "leakage_retrieval_metadata")
    ).toBe(true);
  });

  it("blocks tool/function syntax leakage", () => {
    const r = validateReplyOutput(
      "Re: x",
      "Run [tool] send_email then [function] x."
    );
    expect(r.findings.some((f) => f.code === "leakage_tool_definition")).toBe(
      true
    );
  });
});

describe("validateReplyOutput — forbidden phrases (block)", () => {
  it("blocks a default forbidden phrase", () => {
    const r = validateReplyOutput(
      "Re: x",
      "Sure, unsubscribe me from future emails."
    );
    expect(r.findings.some((f) => f.code === "forbidden_phrase")).toBe(true);
    expect(r.sendableAfterApproval).toBe(false);
  });

  it("blocks a config-supplied forbidden phrase even when obfuscated", () => {
    // "fr33 m0n3y" normalizes to "free money"
    const r = validateReplyOutput("Re: x", "Click for fr33 m0n3y now", {
      forbiddenPhrases: ["free money"],
    });
    expect(r.findings.some((f) => f.code === "forbidden_phrase")).toBe(true);
  });

  it("blocks a forbidden phrase obfuscated with hyphens (regression: hyphen stripping was dropped)", () => {
    // "f-r-e-e m-o-n-e-y" must normalize to "free money". The 2026-10-20
    // merge dropped ASCII hyphen from the strip class, silently weakening
    // the ONLY remaining block tier — this pins the documented contract
    // ("inserted punctuation ... normalized before matching").
    const r = validateReplyOutput("Re: x", "Click for f-r-e-e m-o-n-e-y now", {
      forbiddenPhrases: ["free money"],
    });
    expect(r.findings.some((f) => f.code === "forbidden_phrase")).toBe(true);
  });

  it("blocks hyphen-obfuscated default forbidden phrase", () => {
    // Phrase matching runs against the normalized form; "unsubscribe m-e"
    // must normalize to "unsubscribe me" before the phrase check.
    const r = validateReplyOutput("Re: x", "Please unsubscribe m-e now");
    expect(r.findings.some((f) => f.code === "forbidden_phrase")).toBe(true);
    expect(r.sendableAfterApproval).toBe(false);
  });
});

/**
 * The 2026-10-18 policy change (user decision): advisory findings are
 * non-blocking. Commitments, URLs, payment instructions, recipients, and
 * attachment claims are recorded as `warning` for audit and do NOT prevent
 * approval — the send tool's confirmation gesture is the human gate. Only
 * `block` findings (leakage, forbidden phrases) keep approval refused.
 */
describe("validateReplyOutput — unsupported commitments (warning)", () => {
  it("flags a refund commitment as a non-blocking warning", () => {
    const r = validateReplyOutput(
      "Re: x",
      "We will issue a full refund immediately."
    );
    const refund = r.findings.find((f) => f.code === "commitment_refund");
    expect(refund?.severity).toBe("warning");
    expect(r.sendableAfterApproval).toBe(true);
  });

  it("flags a guaranteed delivery date as a warning", () => {
    const r = validateReplyOutput("Re: x", "Guaranteed delivery by Friday.");
    const date = r.findings.find(
      (f) => f.code === "commitment_guaranteed_date"
    );
    expect(date?.severity).toBe("warning");
    expect(r.sendableAfterApproval).toBe(true);
  });

  it("flags payment instructions as a warning", () => {
    const r = validateReplyOutput(
      "Re: x",
      "Send a wire transfer to my bank account."
    );
    const payment = r.findings.find(
      (f) => f.code === "commitment_payment_instruction"
    );
    expect(payment?.severity).toBe("warning");
    expect(r.sendableAfterApproval).toBe(true);
  });

  it("flags credential references as a warning", () => {
    const r = validateReplyOutput(
      "Re: x",
      "Reset your password and send me the credentials."
    );
    const credential = r.findings.find(
      (f) => f.code === "commitment_credential"
    );
    expect(credential?.severity).toBe("warning");
    expect(r.sendableAfterApproval).toBe(true);
  });

  it("flags a legal commitment as a warning", () => {
    const r = validateReplyOutput(
      "Re: x",
      "Consult our attorney; this is solid legal advice."
    );
    const legal = r.findings.find((f) => f.code === "commitment_legal");
    expect(legal?.severity).toBe("warning");
    expect(r.sendableAfterApproval).toBe(true);
  });

  it("flags discount, guaranteed price, and account-change commitments as warnings", () => {
    const r = validateReplyOutput(
      "Re: x",
      "We can offer a discount, lock in a guaranteed price, and upgrade your account."
    );
    for (const code of [
      "commitment_discount",
      "commitment_guaranteed_price",
      "commitment_account_change",
    ]) {
      const f = r.findings.find((x) => x.code === code);
      expect(f?.severity).toBe("warning");
    }
    expect(r.sendableAfterApproval).toBe(true);
  });

  it("the reported repro — a URL is not a finding; a credential mention stays a warning", () => {
    const r = validateReplyOutput(
      "Re: Feature question",
      "See https://docs.aifetchly.com/docs/lead-generation for details — no passwords or credentials needed."
    );
    expect(r.findings.some((f) => f.code === "new_url")).toBe(false);
    const credential = r.findings.find(
      (f) => f.code === "commitment_credential"
    );
    expect(credential?.severity).toBe("warning");
    expect(r.findings.some((f) => f.severity === "block")).toBe(false);
    expect(r.sendableAfterApproval).toBe(true);
  });

  it("every advisory code returns block-or-warning severity (retired-review reintroduction guard)", () => {
    const r = validateReplyOutput(
      "Re: x",
      "We offer a refund and a discount with a guaranteed price and guaranteed delivery by Friday. " +
        "Consult our attorney. Reset your password. We will upgrade your account. " +
        "Send a wire transfer to my bank account. I opened the attachment. " +
        "See https://example.com. I'll cc the team."
    );
    for (const code of [
      "commitment_refund",
      "commitment_discount",
      "commitment_guaranteed_price",
      "commitment_guaranteed_date",
      "commitment_legal",
      "commitment_credential",
      "commitment_account_change",
      "commitment_payment_instruction",
      "attachment_inspection_claim",
      "new_recipient_directive",
    ]) {
      expect(r.findings.some((f) => f.code === code)).toBe(true);
    }
    const retiredSeverities = r.findings.filter(
      (f) => f.severity !== "block" && f.severity !== "warning"
    );
    expect(retiredSeverities).toHaveLength(0);
    expect(r.sendableAfterApproval).toBe(true);
  });
});

describe("validateReplyOutput — URLs, recipients, attachments", () => {
  it("does not flag a URL in the reply body", () => {
    const r = validateReplyOutput(
      "Re: x",
      "See https://docs.aifetchly.com/docs/lead-generation/proxy-setup for details."
    );
    expect(r.findings.some((f) => f.code === "new_url")).toBe(false);
    expect(r.findings).toHaveLength(0);
    expect(r.sendableAfterApproval).toBe(true);
  });

  it("flags a reply-all / cc directive as a warning", () => {
    const r = validateReplyOutput(
      "Re: x",
      "I'll cc the team and reply-all next time."
    );
    const recipient = r.findings.find(
      (f) => f.code === "new_recipient_directive"
    );
    expect(recipient?.severity).toBe("warning");
    expect(r.sendableAfterApproval).toBe(true);
  });

  it("flags a claim that an attachment was opened as a warning", () => {
    const r = validateReplyOutput(
      "Re: x",
      "I opened the attachment and reviewed the contract."
    );
    const attachment = r.findings.find(
      (f) => f.code === "attachment_inspection_claim"
    );
    expect(attachment?.severity).toBe("warning");
    expect(r.sendableAfterApproval).toBe(true);
  });

  it("a co-resident block finding still gates even when advisory content is present", () => {
    const r = validateReplyOutput(
      "Re: x",
      "As an AI language model, I recommend https://example.com/pricing."
    );
    expect(r.findings.some((f) => f.code === "new_url")).toBe(false);
    expect(r.findings.some((f) => f.severity === "block")).toBe(true);
    expect(r.sendableAfterApproval).toBe(false);
  });
});

describe("validateReplyOutput — obfuscation resistance", () => {
  it("normalizes leetspeak + zero-width chars before matching", () => {
    expect(normalizeForValidation("fr​ee mon3y")).toBe("free money");
    const r = validateReplyOutput("Re: x", "I am an a1", {
      forbiddenPhrases: ["i am an ai"],
    });
    expect(r.findings.some((f) => f.code === "forbidden_phrase")).toBe(true);
  });
});
