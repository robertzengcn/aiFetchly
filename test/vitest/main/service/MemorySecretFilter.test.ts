import { describe, expect, it } from "vitest";
import { looksSecretlike } from "@/service/MemorySecretFilter";

describe("MemorySecretFilter", () => {
  it("rejects the WM-VALID-06 OpenAI project key phrase", () => {
    expect(
      looksSecretlike(
        "The API key is sk-proj-abcdefghijklmnop1234567890abcdef"
      )
    ).toBe(true);
  });

  it("rejects documented workspace-memory credential patterns", () => {
    const secretLikeSamples = [
      "api_key=sk-1234567890abcdef1234567890abcdef",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0ZXN0IjoxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "password=SuperSecret123!",
      "access token abcdef1234567890abcdef1234567890",
      "refresh-token=abcdef1234567890abcdef1234567890",
    ];

    for (const sample of secretLikeSamples) {
      expect(looksSecretlike(sample), sample).toBe(true);
    }
  });

  it("allows ordinary workspace-memory prose", () => {
    expect(
      looksSecretlike("Run yarn build before packaging the desktop app.")
    ).toBe(false);
  });
});
