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
  const ROOT_KEY = "AIFETCHLY_E2E_ROOT";
  const original = process.env[ENV_KEY];
  const originalRoot = process.env[ROOT_KEY];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
    if (originalRoot === undefined) {
      delete process.env[ROOT_KEY];
    } else {
      process.env[ROOT_KEY] = originalRoot;
    }
  });

  it("accepts a loopback http .zip URL only with BOTH E2E gate variables", () => {
    process.env[ENV_KEY] = "1";
    process.env[ROOT_KEY] = "/tmp/aifetchly-e2e/worker";
    expect(classifyUrlKind("http://127.0.0.1:3999/zips/fixture.zip")).toBe(
      "zip"
    );
    expect(classifyUrlKind("http://localhost:3999/zips/fixture.zip")).toBe(
      "zip"
    );
  });

  it("rejects the same loopback http URL without the E2E flag", () => {
    delete process.env[ENV_KEY];
    process.env[ROOT_KEY] = "/tmp/aifetchly-e2e/worker";
    expect(classifyUrlKind("http://127.0.0.1:3999/zips/fixture.zip")).toBe(
      "rejected"
    );
  });

  it("rejects the same loopback http URL with the flag but NO launcher root sentinel", () => {
    // A packaged/developer launch with a hostile AIFETCHLY_E2E=1 env var
    // alone must never activate the exception (launcher-only invariant).
    process.env[ENV_KEY] = "1";
    delete process.env[ROOT_KEY];
    expect(classifyUrlKind("http://127.0.0.1:3999/zips/fixture.zip")).toBe(
      "rejected"
    );
  });

  it("rejects non-loopback http even under the full E2E gate", () => {
    process.env[ENV_KEY] = "1";
    process.env[ROOT_KEY] = "/tmp/aifetchly-e2e/worker";
    expect(classifyUrlKind("http://evil.example.com/p.zip")).toBe("rejected");
  });

  it("rejects loopback http non-zip paths even under the full E2E gate", () => {
    process.env[ENV_KEY] = "1";
    process.env[ROOT_KEY] = "/tmp/aifetchly-e2e/worker";
    expect(classifyUrlKind("http://127.0.0.1:3999/manifest.json")).toBe(
      "rejected"
    );
  });

  it("rejects spoofed loopback-looking hosts under the full E2E gate", () => {
    process.env[ENV_KEY] = "1";
    process.env[ROOT_KEY] = "/tmp/aifetchly-e2e/worker";
    expect(
      classifyUrlKind("http://127.0.0.1.evil.com:3999/zips/fixture.zip")
    ).toBe("rejected");
    expect(classifyUrlKind("http://user@127.0.0.1:3999/zips/fixture.zip")).toBe(
      "rejected"
    );
  });
});
