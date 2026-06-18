import { describe, it, expect } from "vitest";
import { classifyUrlKind } from "@/service/pluginSources/UrlPluginFetcher";

describe("classifyUrlKind", () => {
  it("classifies .zip", () => {
    expect(classifyUrlKind("https://x.com/p.zip")).toBe("zip");
  });
  it("classifies .zip with query string", () => {
    expect(classifyUrlKind("https://x.com/p.zip?token=x")).toBe("zip");
  });
  it("classifies .git", () => {
    expect(classifyUrlKind("https://x.com/r.git")).toBe("git");
  });
  it("classifies git@", () => {
    expect(classifyUrlKind("git@github.com:o/r.git")).toBe("git");
  });
  it("classifies ssh://", () => {
    expect(classifyUrlKind("ssh://git@example.com/r.git")).toBe("git");
  });
  it("classifies github.com", () => {
    expect(classifyUrlKind("https://github.com/o/r")).toBe("github");
  });
  it("rejects http", () => {
    expect(classifyUrlKind("http://x.com/p.zip")).toBe("rejected");
  });
  it("returns unknown", () => {
    expect(classifyUrlKind("https://example.com/whatever")).toBe("unknown");
  });
  it("returns unknown for empty", () => {
    expect(classifyUrlKind("")).toBe("unknown");
  });
});
