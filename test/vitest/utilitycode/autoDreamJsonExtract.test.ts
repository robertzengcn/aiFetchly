import { describe, expect, it } from "vitest";
import { extractJsonObject } from "@/service/autoDreamJsonExtract";

describe("extractJsonObject", () => {
  it("returns empty string for blank input", () => {
    expect(extractJsonObject("   ")).toBe("");
  });

  it("returns a bare JSON object unchanged", () => {
    const raw = '{"create":[],"update":[],"archive":[]}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("extracts a fenced json block after a reasoning preamble", () => {
    const inner = '{"create":[],"update":[],"archive":[]}';
    const raw = `thinking about the sources...\n\`\`\`json\n${inner}\n\`\`\`\n`;
    expect(extractJsonObject(raw)).toBe(inner);
  });

  it("extracts the first-to-last brace object when prose wraps JSON", () => {
    const inner = '{"create":[],"update":[],"archive":[]}';
    expect(extractJsonObject(`Sure.\n${inner}\nDone.`)).toBe(inner);
  });
});
