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
    expect(utf8ByteLength(messages[1].content) + utf8ByteLength(messages[0].content)).toBe(
      budget.bytes
    );
    // Decoding the payload must never throw (boundary-safe clip).
    const payload = JSON.parse(
      messages[1].content.replace(
        "Conversation excerpt (untrusted data):\n",
        ""
      )
    ) as { user_request: string };
    expect(payload.user_request.length).toBeGreaterThan(0);
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
