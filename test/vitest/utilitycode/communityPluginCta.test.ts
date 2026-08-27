import { describe, expect, test } from "vitest";

import {
  ctaFor,
  entryUnavailable,
  isSessionExpiredMessage,
} from "@/views/utils/communityPluginCta";
import type { PluginCommunityEntry } from "@/entityTypes/communityPluginTypes";

function makeEntry(
  status: PluginCommunityEntry["access"]["status"],
  installMode: PluginCommunityEntry["access"]["installMode"] = "direct",
  installed = false
): PluginCommunityEntry {
  return {
    slug: "x",
    name: "x",
    displayName: "X",
    description: "",
    access: { status, installMode },
    installed,
  };
}

describe("ctaFor — the Hub access decision drives the affordance", () => {
  test("allowed + direct + not installed → install", () => {
    expect(ctaFor(makeEntry("allowed"))).toBe("install");
  });

  test("allowed + direct + installed → installed (disabled button)", () => {
    expect(ctaFor(makeEntry("allowed", "direct", true))).toBe("installed");
  });

  test("allowed + ticket → preview (Stage 1: not installable)", () => {
    expect(ctaFor(makeEntry("allowed", "ticket"))).toBe("preview");
  });

  test("subscription_required → upgrade", () => {
    expect(ctaFor(makeEntry("subscription_required", "ticket"))).toBe("upgrade");
    expect(ctaFor(makeEntry("subscription_required", "direct"))).toBe("upgrade");
  });

  test("login_required → signin", () => {
    expect(ctaFor(makeEntry("login_required"))).toBe("signin");
  });

  test("forbidden / unavailable → none", () => {
    expect(ctaFor(makeEntry("forbidden"))).toBe("none");
    expect(ctaFor(makeEntry("unavailable"))).toBe("none");
  });
});

describe("entryUnavailable — greyed-out rows", () => {
  test("only forbidden and unavailable are greyed out", () => {
    expect(entryUnavailable(makeEntry("forbidden"))).toBe(true);
    expect(entryUnavailable(makeEntry("unavailable"))).toBe(true);
    expect(entryUnavailable(makeEntry("allowed"))).toBe(false);
    expect(entryUnavailable(makeEntry("subscription_required"))).toBe(false);
  });
});

describe("isSessionExpiredMessage — auth-shaped failure detection", () => {
  test("matches the phrasings HttpClient throws", () => {
    expect(
      isSessionExpiredMessage(
        "Authentication failed after token refresh retry (HTTP 401/403)."
      )
    ).toBe(true);
    expect(isSessionExpiredMessage("Token refresh failed")).toBe(true);
    expect(
      isSessionExpiredMessage(
        "Authentication failed: refresh token unavailable (HTTP 401)."
      )
    ).toBe(true);
    expect(isSessionExpiredMessage("HTTP 401: unauthorized")).toBe(true);
  });

  test("non-auth failures fall through to the generic error state", () => {
    expect(isSessionExpiredMessage("Plugin Hub catalog is invalid")).toBe(
      false
    );
    expect(isSessionExpiredMessage("fetch failed")).toBe(false);
    expect(isSessionExpiredMessage(null)).toBe(false);
    expect(isSessionExpiredMessage("")).toBe(false);
  });
});
