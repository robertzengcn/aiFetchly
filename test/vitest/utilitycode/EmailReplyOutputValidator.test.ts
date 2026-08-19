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
});

describe("validateReplyOutput — unsupported commitments (review)", () => {
  it("flags a refund commitment", () => {
    const r = validateReplyOutput(
      "Re: x",
      "We will issue a full refund immediately."
    );
    expect(r.findings.some((f) => f.code === "commitment_refund")).toBe(true);
    expect(r.sendableAfterApproval).toBe(false);
  });

  it("flags a guaranteed delivery date", () => {
    const r = validateReplyOutput("Re: x", "Guaranteed delivery by Friday.");
    expect(
      r.findings.some((f) => f.code === "commitment_guaranteed_date")
    ).toBe(true);
  });

  it("flags payment instructions", () => {
    const r = validateReplyOutput(
      "Re: x",
      "Send a wire transfer to my bank account."
    );
    expect(
      r.findings.some((f) => f.code === "commitment_payment_instruction")
    ).toBe(true);
  });

  it("flags credential references", () => {
    const r = validateReplyOutput(
      "Re: x",
      "Reset your password and send me the credentials."
    );
    expect(r.findings.some((f) => f.code === "commitment_credential")).toBe(
      true
    );
  });

  it("flags a legal commitment", () => {
    const r = validateReplyOutput(
      "Re: x",
      "Consult our attorney; this is solid legal advice."
    );
    expect(r.findings.some((f) => f.code === "commitment_legal")).toBe(true);
  });
});

describe("validateReplyOutput — URLs, recipients, attachments", () => {
  it("flags a newly introduced URL", () => {
    const r = validateReplyOutput(
      "Re: x",
      "See https://evil.example.com/promo for details."
    );
    expect(r.findings.some((f) => f.code === "new_url")).toBe(true);
    expect(r.sendableAfterApproval).toBe(false);
  });

  it("flags a reply-all / cc directive", () => {
    const r = validateReplyOutput(
      "Re: x",
      "I'll cc the team and reply-all next time."
    );
    expect(r.findings.some((f) => f.code === "new_recipient_directive")).toBe(
      true
    );
  });

  it("flags a claim that an attachment was opened", () => {
    const r = validateReplyOutput(
      "Re: x",
      "I opened the attachment and reviewed the contract."
    );
    expect(
      r.findings.some((f) => f.code === "attachment_inspection_claim")
    ).toBe(true);
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
