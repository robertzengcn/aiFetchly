import { beforeEach, describe, expect, it } from "vitest";
import {
  BrowserFieldValueService,
  fieldIsForbiddenToFill,
} from "@/service/browserDecision/FieldValueService";

/** N02/D-FR-20/21: trusted bindings, bounded helper, secret rejection, cache. */

describe("BrowserFieldValueService (N02)", () => {
  let service: BrowserFieldValueService;
  beforeEach(() => {
    service = new BrowserFieldValueService();
  });

  it("resolves from an unambiguous trusted binding", async () => {
    const text = await service.resolveText({
      fieldName: "Search input",
      goal: "search widgets",
      bindings: [{ field: "search", value: "widgets" }],
    });
    expect(text).toBe("widgets");
  });

  it("an ambiguous multi-match falls to the helper (or null)", async () => {
    const text = await service.resolveText({
      fieldName: "search",
      goal: "g",
      bindings: [
        { field: "search", value: "a" },
        { field: "search input", value: "b" },
      ],
    });
    expect(text).toBeNull();
  });

  it("forbidden fields (password/OTP/payment) are never filled", async () => {
    expect(fieldIsForbiddenToFill("Password")).toBe(true);
    expect(fieldIsForbiddenToFill("2FA code")).toBe(true);
    expect(fieldIsForbiddenToFill("CVV")).toBe(true);
    expect(fieldIsForbiddenToFill("Search query")).toBe(false);
    // Even with a trusted binding, a forbidden field returns null.
    const text = await service.resolveText({
      fieldName: "Password",
      goal: "g",
      bindings: [{ field: "password", value: "hunter2" }],
    });
    expect(text).toBeNull();
  });

  it("D-FR-20: a secret-shaped helper value is rejected and never cached", async () => {
    let helperCalls = 0;
    const text = await service.resolveText({
      fieldName: "api key",
      goal: "g",
      bindings: [],
      helper: async () => {
        helperCalls++;
        return "sk-abcdefghijklmnopqrst";
      },
    });
    expect(helperCalls).toBe(1);
    expect(text).toBeNull();
    // A second call calls the helper again — the rejected value was NOT cached.
    await service.resolveText({
      fieldName: "api key",
      goal: "g",
      bindings: [],
      helper: async () => {
        helperCalls++;
        return "clean value";
      },
    });
    expect(helperCalls).toBe(2);
  });

  it("D-FR-21: a cached helper hit requires the identical input", async () => {
    let helperCalls = 0;
    const makeInput = (goal: string, field: string) => ({
      fieldName: field,
      goal,
      bindings: [],
      helper: async () => {
        helperCalls++;
        return `value for ${field}`;
      },
    });
    await service.resolveText(makeInput("g1", "search"));
    await service.resolveText(makeInput("g1", "search"));
    expect(helperCalls).toBe(1); // cache hit on identical input
    await service.resolveText(makeInput("g2", "search"));
    expect(helperCalls).toBe(2); // different goal → different key
  });

  it("D-FR-21: invalidate() clears the field's cache after an unknown effect", async () => {
    let helperCalls = 0;
    const input = {
      fieldName: "search",
      goal: "g",
      bindings: [],
      helper: async () => {
        helperCalls++;
        return "v";
      },
    };
    await service.resolveText(input);
    expect(helperCalls).toBe(1);
    service.invalidate("search");
    await service.resolveText(input);
    expect(helperCalls).toBe(2);
  });
});
