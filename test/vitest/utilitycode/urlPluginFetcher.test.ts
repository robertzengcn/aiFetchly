import { describe, it, expect, afterEach } from "vitest";
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

describe("classifyUrlKind E2E loopback exception", () => {
  const ENV_KEY = "AIFETCHLY_E2E";
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it("accepts a loopback http .zip URL only under AIFETCHLY_E2E=1", () => {
    process.env[ENV_KEY] = "1";
    expect(classifyUrlKind("http://127.0.0.1:3999/zips/fixture.zip")).toBe(
      "zip"
    );
    expect(classifyUrlKind("http://localhost:3999/zips/fixture.zip")).toBe(
      "zip"
    );
  });

  it("rejects the same loopback http URL without the E2E flag", () => {
    delete process.env[ENV_KEY];
    expect(classifyUrlKind("http://127.0.0.1:3999/zips/fixture.zip")).toBe(
      "rejected"
    );
  });

  it("rejects non-loopback http even under AIFETCHLY_E2E=1", () => {
    process.env[ENV_KEY] = "1";
    expect(classifyUrlKind("http://evil.example.com/p.zip")).toBe("rejected");
  });

  it("rejects loopback http non-zip paths even under AIFETCHLY_E2E=1", () => {
    process.env[ENV_KEY] = "1";
    expect(classifyUrlKind("http://127.0.0.1:3999/manifest.json")).toBe(
      "rejected"
    );
  });

  it("rejects spoofed loopback-looking hosts under AIFETCHLY_E2E=1", () => {
    process.env[ENV_KEY] = "1";
    expect(
      classifyUrlKind("http://127.0.0.1.evil.com:3999/zips/fixture.zip")
    ).toBe("rejected");
    expect(classifyUrlKind("http://user@127.0.0.1:3999/zips/fixture.zip")).toBe(
      "rejected"
    );
  });
});
