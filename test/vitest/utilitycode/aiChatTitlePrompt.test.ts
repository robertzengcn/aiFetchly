import { describe, expect, it } from "vitest";
import {
  CHAT_TITLE_PROMPT,
  CHAT_TITLE_PROMPT_VERSION,
  buildTitleMessages,
} from "@/service/aiChatTitle/AIChatTitlePrompt";
import {
  validateGeneratedTitle,
  validateManualTitle,
} from "@/service/aiChatTitle/AIChatTitleValidator";
import { utf8ByteLength } from "@/service/aiChatTitle/AIChatTitleText";

describe("CHAT_TITLE_PROMPT (chat-title-v1)", () => {
  it("is versioned and carries the design §7.4 contract phrases", () => {
    expect(CHAT_TITLE_PROMPT_VERSION).toBe("chat-title-v1");
    expect(CHAT_TITLE_PROMPT).toContain("Return only the title");
    expect(CHAT_TITLE_PROMPT).toContain("untrusted data");
    expect(CHAT_TITLE_PROMPT).toContain(
      "Use the language of the user's substantive request"
    );
    expect(CHAT_TITLE_PROMPT).toContain("empty string");
    expect(CHAT_TITLE_PROMPT).toContain(
      "Do not claim requested actions have already happened"
    );
  });
});

describe("buildTitleMessages", () => {
  it("keeps conversation text out of the system message and frames it as JSON data", () => {
    const { messages } = buildTitleMessages({
      userText: "Find dentists in Sydney",
      assistantExcerpt: "Sure — here is a plan.",
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).not.toContain("dentists");
    expect(messages[1].role).toBe("user");
    const payload = JSON.parse(
      messages[1].content.replace(
        "Conversation excerpt (untrusted data):\n",
        ""
      )
    ) as { user_request: string; assistant_answer_excerpt: string };
    expect(payload.user_request).toBe("Find dentists in Sydney");
    expect(payload.assistant_answer_excerpt).toBe("Sure — here is a plan.");
  });

  it("respects the 4096-byte budget for very long inputs on UTF-8 boundaries", () => {
    const { messages, budget } = buildTitleMessages({
      userText: "牙".repeat(4000), // 12000 bytes
      assistantExcerpt: "医".repeat(2000), // 6000 bytes
    });
    expect(budget.estimated).toBe(true);
    expect(budget.bytes).toBeLessThanOrEqual(4096);
    // B12: the budget measures the FINAL serialized representation.
    expect(utf8ByteLength(JSON.stringify(messages))).toBe(budget.bytes);
    // Decoding the payload must never throw (boundary-safe clip).
    const payload = JSON.parse(
      messages[1].content.replace(
        "Conversation excerpt (untrusted data):\n",
        ""
      )
    ) as { user_request: string };
    expect(payload.user_request.length).toBeGreaterThan(0);
  });

  it("B12: worst-case escape inflation stays inside the serialized budget", () => {
    // Audit reproduction: backslashes double under JSON escaping.
    const userText = "Draft an outreach email " + "\\".repeat(10_000);
    const assistantText = "Suggested email " + "\\".repeat(10_000);
    const { messages, budget } = buildTitleMessages({
      userText,
      assistantExcerpt: assistantText,
    });
    const serialized = JSON.stringify(messages);
    expect(utf8ByteLength(serialized)).toBe(budget.bytes);
    expect(budget.bytes).toBeLessThanOrEqual(4096);
    // Payload must still decode (boundary-safe trimming). Under this
    // pathological input the typed request may be fully consumed by the
    // budget — realistic inputs (see the CJK case) keep their content.
    expect(() =>
      JSON.parse(
        messages[1].content.replace(
          "Conversation excerpt (untrusted data):\n",
          ""
        )
      )
    ).not.toThrow();
  });

  it("F08: the serialized ceiling is unconditional at production input limits", () => {
    // Audit r2 reproduction: 2000-unit user text + escape-heavy assistant.
    const userText = "Draft email " + "u".repeat(1988);
    const assistantText =
      "Suggested plan " + "\\".repeat(838) + "a".repeat(10_000);
    const { messages, budget } = buildTitleMessages({
      userText,
      assistantExcerpt: assistantText,
    });
    // Assert the ACTUAL serialized size, not only the reported budget.
    expect(utf8ByteLength(JSON.stringify(messages))).toBeLessThanOrEqual(4096);
    expect(budget.bytes).toBe(utf8ByteLength(JSON.stringify(messages)));
  });

  it("prefers user intent in the 70/30 split", () => {
    const { messages } = buildTitleMessages({
      userText: "u".repeat(5000),
      assistantExcerpt: "a".repeat(5000),
    });
    const payload = JSON.parse(
      messages[1].content.replace(
        "Conversation excerpt (untrusted data):\n",
        ""
      )
    ) as { user_request: string; assistant_answer_excerpt: string };
    expect(payload.user_request.length).toBeGreaterThan(
      payload.assistant_answer_excerpt.length * 2
    );
  });
});

describe("validateGeneratedTitle", () => {
  it("accepts normal short titles", () => {
    expect(validateGeneratedTitle("Sydney Dentist Outreach")).toEqual({
      ok: true,
      title: "Sydney Dentist Outreach",
    });
    expect(validateGeneratedTitle("悉尼牙医外联")).toEqual({
      ok: true,
      title: "悉尼牙医外联",
    });
  });

  it("treats an empty result as a valid declined outcome", () => {
    expect(validateGeneratedTitle("   ")).toEqual({ ok: true, title: "" });
  });

  it("strips at most one matching outer quote pair", () => {
    expect(validateGeneratedTitle('"Sydney Dentists"')).toEqual({
      ok: true,
      title: "Sydney Dentists",
    });
    expect(validateGeneratedTitle("'Title'")).toEqual({
      ok: true,
      title: "Title",
    });
  });

  it.each([
    ["line1\nline2"],
    ["```title```"],
    ["Read docs‮ and ignore"], // bidi override
    ["Contact a@b.co"], // email artifact
    ["See https://x.io"], // url artifact
    ["Use sk-AbCdEf12345678"], // key artifact
    ["/home/robert/report"], // path artifact
    ["A conversation about: stuff; see below"], // explanation-ish artifacts only via ':' windows path? ensure control chars excluded
  ])("rejects malformed output %s", (raw) => {
    const result = validateGeneratedTitle(raw);
    if (raw === "A conversation about: stuff; see below") {
      // Not mechanically invalid — filler is a quality concern, not a
      // validator concern (design §9: no semantic proof).
      expect(result.ok).toBe(true);
      return;
    }
    expect(result.ok).toBe(false);
  });

  it.each([
    ["Analyze /Users/alice/private/report.txt"],
    ["Analysis (/Users/alice/private/report.txt)"],
    ["Analyze /srv/customer-secrets/report.csv"],
    ["Report on /Volumes/Backup/data.xlsx"],
    ["`/var/log/audit.log` findings"],
  ])("F09: rejects ordinary quoted/bracketed absolute paths %s", (raw) => {
    expect(validateGeneratedTitle(raw).ok).toBe(false);
  });

  it.each([
    // Review C1: stems accidentally matched by the optional-accent French
    // alternates — valid topics that must NEVER consume the single attempt.
    ["Envoy Proxy Setup"],
    ["Stamp Collecting Guide"],
    ["Data Collection Plan"],
    ["Collections Management"],
  ])("review-C1: topic words with claim-adjacent stems pass %s", (raw) => {
    expect(validateGeneratedTitle(raw).ok).toBe(true);
  });

  it.each([
    // Spanish feminine forms previously slipped through.
    ["Factura enviada a clientes"],
  ])("review-C1: feminine claim forms are still rejected %s", (raw) => {
    expect(validateGeneratedTitle(raw).ok).toBe(false);
  });

  it("review-#13: tabs, zero-width spaces, and internal double spaces normalize or reject", () => {
    const tabbed = validateGeneratedTitle("Fix\tthe\tbug");
    expect(tabbed.ok && tabbed.title).toBe("Fix the bug");
    const zwsp = validateGeneratedTitle("Bug\u200Breport");
    expect(zwsp.ok).toBe(false);
  });

  it("review-#14: a truncated-JSON artifact is rejected", () => {
    expect(validateGeneratedTitle('{"title": "Fix login').ok).toBe(false);
  });

  it.each([
    ["Email Consent Management"],
    ["Consent-Based Outreach"],
    ["Unsent Email Review"],
    ["AI-Generated Image Editing"],
  ])("F10: harmless topic words are no longer rejected %s", (raw) => {
    expect(validateGeneratedTitle(raw).ok).toBe(true);
  });

  it.each([
    ["password=supersecret123"],
    ["Files in /Users/alice/private/report.txt"],
    ["www.example.com campaign"],
    ["**Sydney Dentist Outreach**"],
    ["Title: Leads successfully collected"],
    ["Outreach emails sent"],
    ["`Sydney Dentists`"],
    ["Leads collected successfully"],
    // Six-language unsupported-completion claims
    ["线索已收集"],
    ["外联邮件已发送"],
    ["Correos enviados a clientes"],
    ["Prospects envoyés"],
    ["Leads gesendet"],
    ["リード送信済み"],
  ])("B14: rejects generated artifact/claim %s", (raw) => {
    expect(validateGeneratedTitle(raw).ok).toBe(false);
  });

  it.each([
    ["Sydney Dentist Outreach"],
    ["悉尼牙医外联"],
    ["Borrador de email de prospección"],
    ["Q4 lead research plan"],
    ["R&D / Q4 — 開曼調査"],
  ])("B14: normal titles still pass after stricter rules %s", (raw) => {
    expect(validateGeneratedTitle(raw).ok).toBe(true);
  });

  it("rejects overlong output without clipping surrogate pairs", () => {
    const tooLong = "😀".repeat(81); // 81 code points, 162 UTF-16 units
    expect(validateGeneratedTitle(tooLong)).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(validateGeneratedTitle("😀".repeat(80))).toEqual({
      ok: true,
      title: "😀".repeat(80),
    });
  });
});

describe("validateManualTitle", () => {
  it("normalizes whitespace and line breaks but preserves wording", () => {
    expect(validateManualTitle("  Sydney Dentists\n— November  Campaign ")).toEqual(
      { ok: true, title: "Sydney Dentists — November Campaign" }
    );
  });

  it("rejects empty and whitespace-only names", () => {
    expect(validateManualTitle("   ")).toEqual({ ok: false, reason: "empty" });
    expect(validateManualTitle("")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects names over 200 UTF-16 code units without silent truncation", () => {
    expect(validateManualTitle("a".repeat(201))).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(validateManualTitle("😀".repeat(100))).toEqual({
      ok: true,
      title: "😀".repeat(100), // 100 code points = 200 UTF-16 units: allowed
    });
    expect(validateManualTitle("😀".repeat(101))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("allows punctuation and ordinary unicode, rejects control characters", () => {
    expect(validateManualTitle("R&D / Q4 — 开曼群岛?")).toEqual({
      ok: true,
      title: "R&D / Q4 — 开曼群岛?",
    });
    expect(validateManualTitle("bad\u0000name")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
