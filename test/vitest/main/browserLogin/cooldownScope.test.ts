import { describe, expect, it } from "vitest";
import { SocialAccountModule } from "@/modules/socialAccountModule";

/**
 * A-FR-10: the 15-minute sign-in cooldown is per account AND SITE, and a
 * failure that must never start a cooldown (form_not_found, the challenge
 * handoff) is skipped by the credential service.
 */

describe("sign-in cooldown scope (A-FR-10)", () => {
  it("same account, different site: no cooldown", async () => {
    const module = new SocialAccountModule();
    const fixed = new Date("2026-11-14T12:00:00Z");
    // Fake the row lookup through the model seam the module reads.
    (
      module as unknown as {
        socialAccountModel: { findRowById: (id: number) => Promise<unknown> };
      }
    ).socialAccountModel.findRowById = async () => ({
      last_login_failure_at: fixed,
      last_login_failure_site: 42,
    });
    // A failure recorded on site 42:
    const cooling = await module.isSignInCoolingDown(7, {
      siteId: 42,
      now: new Date(fixed.getTime() + 60_000),
    });
    expect(cooling).toBe(true);
    // …never cools down site 43.
    const otherSite = await module.isSignInCoolingDown(7, {
      siteId: 43,
      now: new Date(fixed.getTime() + 60_000),
    });
    expect(otherSite).toBe(false);
    // A failure with NO site cools every site (legacy rows).
    (
      module as unknown as {
        socialAccountModel: { findRowById: (id: number) => Promise<unknown> };
      }
    ).socialAccountModel.findRowById = async () => ({
      last_login_failure_at: fixed,
      last_login_failure_site: null,
    });
    const legacy = await module.isSignInCoolingDown(7, {
      siteId: 43,
      now: new Date(fixed.getTime() + 60_000),
    });
    expect(legacy).toBe(true);
    // Outside the window: not cooling.
    const expired = await module.isSignInCoolingDown(7, {
      siteId: 43,
      now: new Date(fixed.getTime() + 16 * 60_000),
    });
    expect(expired).toBe(false);
  });
});
