import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { SocialAccountModule } from "@/modules/socialAccountModule";

/**
 * A-FR-10: the 15-minute sign-in cooldown is per account AND SITE, and a
 * failure that must never start a cooldown (form_not_found, the challenge
 * handoff) is skipped by the credential service.
 */

describe("sign-in cooldown scope (A-FR-10)", () => {
  it("a REJECTED SAVED credential blocks account-wide until the stored value CHANGES (R08 digest binding)", async () => {
    const module = new SocialAccountModule();
    (
      module as unknown as {
        ensureConnection: () => Promise<void>;
      }
    ).ensureConnection = async () => undefined;
    const rejectedValue = "rejected-secret-v1";
    const rejectedDigest = createHash("sha256")
      .update(rejectedValue)
      .digest("hex")
      .slice(0, 16);
    const now = new Date("2026-11-14T12:00:00Z");
    const makeFixture = (
      storedPass: string | null
    ): {
      last_login_failure_at: Date;
      last_login_failure_site: number | null;
      last_login_failure_reason: string;
      pass: string | null;
    } => ({
      last_login_failure_at: new Date("2026-11-01T00:00:00Z"),
      last_login_failure_site: null,
      last_login_failure_reason: `${SocialAccountModule.WRONG_CREDENTIAL_SAVED_REASON}:${rejectedDigest}`,
      pass: storedPass,
    });
    let fixture = makeFixture(rejectedValue);
    (
      module as unknown as {
        socialAccountModel: { findRowById: (id: number) => Promise<unknown> };
      }
    ).socialAccountModel.findRowById = async () => fixture;
    // The stored credential IS the rejected value — blocked account-wide
    // no matter how long ago the rejection landed.
    expect(
      await module.isSignInCoolingDown(7, { siteId: 42, now })
    ).toBe(true);
    expect(
      await module.isSignInCoolingDown(7, { siteId: 43, now })
    ).toBe(true);
    // The credential was REPLACED — the digest no longer matches and the
    // block lifts automatically (a late rejection of the prior value
    // cannot mark the newer credential).
    fixture = makeFixture("new-secret-v2");
    expect(
      await module.isSignInCoolingDown(7, { siteId: 42, now })
    ).toBe(false);
    // A regular (non-marker) failure older than the window is NOT blocked.
    fixture = {
      last_login_failure_at: new Date("2026-11-01T00:00:00Z"),
      last_login_failure_site: 42,
      last_login_failure_reason: "form_not_submitted",
      pass: rejectedValue,
    };
    expect(
      await module.isSignInCoolingDown(7, { siteId: 42, now })
    ).toBe(false);
  });

  it("credentialReplaced lifts only the wrong-credential block (R08)", async () => {
    const module = new SocialAccountModule();
    (
      module as unknown as {
        ensureConnection: () => Promise<void>;
      }
    ).ensureConnection = async () => undefined;
    let stored = {
      last_login_failure_at: new Date("2026-11-01T00:00:00Z") as Date | null,
      last_login_failure_site: 42 as number | null,
      last_login_failure_reason:
        SocialAccountModule.WRONG_CREDENTIAL_SAVED_REASON as string | null,
    };
    let cleared = 0;
    (
      module as unknown as {
        socialAccountModel: {
          findRowById: (id: number) => Promise<unknown>;
          updateLoginFailure: (
            id: number,
            fields: Record<string, unknown>
          ) => Promise<void>;
        };
      }
    ).socialAccountModel = {
      findRowById: async () => stored,
      updateLoginFailure: async (_id, fields) => {
        cleared++;
        stored = {
          ...stored,
          last_login_failure_at:
            (fields.last_login_failure_at as Date | null) ?? null,
          last_login_failure_reason:
            (fields.last_login_failure_reason as string | null) ?? null,
        };
      },
    };
    await module.credentialReplaced(7);
    expect(cleared).toBe(1);
    // The block lifted: the failure record is cleared.
    expect(
      await module.isSignInCoolingDown(7, {
        siteId: 42,
        now: new Date("2026-11-14T12:00:00Z"),
      })
    ).toBe(false);
    // A NON-marker failure is NOT lifted by a replacement.
    stored = {
      last_login_failure_at: new Date("2026-11-01T00:00:00Z"),
      last_login_failure_site: 42,
      last_login_failure_reason: "form_not_submitted",
    };
    await module.credentialReplaced(7);
    expect(cleared).toBe(1);
  });

  it("same account, different site: no cooldown", async () => {
    const module = new SocialAccountModule();
    const fixed = new Date("2026-11-14T12:00:00Z");
    // G06: fully isolate the fixture — stub ensureConnection (no TypeORM
    // schema init; parallel workers no longer race the shared SQLite file)
    // and the row lookup through the model seam the module reads.
    (
      module as unknown as {
        ensureConnection: () => Promise<void>;
      }
    ).ensureConnection = async () => undefined;
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
