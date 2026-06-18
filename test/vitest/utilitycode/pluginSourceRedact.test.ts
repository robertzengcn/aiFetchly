import { describe, it, expect } from "vitest";
import {
  redactUri,
  redactMessage,
} from "@/service/pluginSources/pluginSourceRedact";

describe("pluginSourceRedact", () => {
  it("strips query string values from URIs", () => {
    expect(redactUri("https://example.com/pkg.zip?token=secret")).toBe(
      "https://example.com/pkg.zip?token=[redacted]"
    );
  });

  it("strips basic-auth userinfo", () => {
    expect(redactUri("https://user:pass@example.com/repo.git")).toBe(
      "https://[redacted]@example.com/repo.git"
    );
  });

  it("leaves plain URIs untouched", () => {
    expect(redactUri("https://example.com/repo.git")).toBe(
      "https://example.com/repo.git"
    );
  });

  it("redacts _authToken in messages", () => {
    const msg = "npm pack failed _authToken=ABC123";
    expect(redactMessage(msg)).not.toContain("ABC123");
  });

  it("redacts Authorization Bearer in messages", () => {
    const msg = "Authorization: Bearer XYZ failed";
    expect(redactMessage(msg)).not.toContain("XYZ");
  });

  it("redacts ?token= occurrences in messages", () => {
    expect(
      redactMessage("GET https://r.example.com/x?token=SECRET")
    ).not.toContain("SECRET");
  });
});
