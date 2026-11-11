import { describe, expect, it } from "vitest";
import { isSubstantiveRequest } from "@/service/aiChatTitle/AIChatTitleEligibility";

describe("isSubstantiveRequest", () => {
  it.each([
    ["Can you find dentists in Sydney and help me prepare an outreach email?"],
    ["summarize this csv"], // brief command
    ["帮我找悉尼的牙医"], // short CJK request
    ["翻译这份报告成英文"],
    ["busca dentistas en sídney"],
    ["rédige un email de prospection"],
    ["erstelle einen entwurf für eine e-mail"],
    ["シドニーの歯医者を探して"],
    ["Find leads. Then draft email. Mixed intent 123"], // mixed content
    ["  请帮我准备 外联邮件  \n thanks in advance "], // substantive despite trailing thanks
  ])("accepts substantive request %s", (text) => {
    expect(isSubstantiveRequest(text)).toBe(true);
  });

  it.each([
    [""],
    ["   "],
    ["\n\t"],
    ["!!!"],
    ["。。。"],
    ["😀😀"], // emoji-only
    ["hi"],
    ["Hi!"],
    [" HI "],
    ["hello there"],
    ["thanks"],
    ["Thank you."],
    ["ok"],
    ["okay"],
    ["你好"],
    ["你好！"],
    ["好的"],
    ["谢谢"],
    ["请帮忙"],
    ["hola"],
    ["gracias"],
    ["buenos días"],
    ["bonjour"],
    ["merci"],
    ["d'accord"],
    ["hallo"],
    ["danke"],
    ["guten morgen"],
    ["こんにちは"],
    ["ありがとう"],
    ["お願いします"],
    ["よろしくお願いします"],
  ])("rejects non-substantive input %s", (text) => {
    expect(isSubstantiveRequest(text)).toBe(false);
  });

  it("does not use an English word-count minimum", () => {
    // Two-character Chinese request is meaningful.
    expect(isSubstantiveRequest("翻译")).toBe(true);
  });
});
