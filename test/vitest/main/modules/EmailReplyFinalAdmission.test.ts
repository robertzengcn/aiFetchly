import { describe, expect, it } from "vitest";

// C01/N04: pure unit coverage for the final-admission verdict — torn
// snapshots are constructed literally (no DB), pinning that positive
// evidence ANYWHERE in the snapshot refuses, including a newer positive
// copy of the seed row itself (the old code skipped same-id cluster rows
// and admitted SMTP on the stale seed copy).
//
// The delivery service module has main-process imports; importing the pure
// function follows the existing precedent of the delivery suites, which
// construct the real service.
import {
  evaluateFinalSendAdmission,
  type FinalSendAdmissionSnapshot,
} from "@/service/emailReply/EmailReplyDeliveryService";

const T = 2_000_000_000_000;

function seed(
  over: Partial<NonNullable<FinalSendAdmissionSnapshot["seedMessage"]>> = {}
): NonNullable<FinalSendAdmissionSnapshot["seedMessage"]> {
  return {
    id: 7,
    replyDetectedAt: null,
    replyStatus: "not_started",
    replyNegativeCheckAt: new Date(T),
    replyNegativeContextHash: "ctx-real",
    replyNegativeOwnerExpiresAt: new Date(T + 60_000),
    ...over,
  };
}

function row(
  id: number,
  over: Partial<{ replyDetectedAt: Date | null; replyStatus: string | null }> = {}
): { id: number; replyDetectedAt: Date | null; replyStatus: string | null } {
  return { id, replyDetectedAt: null, replyStatus: "not_started", ...over };
}

function snapshot(
  over: Partial<FinalSendAdmissionSnapshot> = {}
): FinalSendAdmissionSnapshot {
  return {
    attempt: { status: "submitted" },
    seedMessage: seed(),
    clusterRows: [row(7)],
    ...over,
  };
}

describe("evaluateFinalSendAdmission (C01/N04)", () => {
  it("admits a coherent fresh snapshot", () => {
    expect(evaluateFinalSendAdmission(snapshot(), "fence", T + 1_000)).toEqual({
      kind: "admit",
    });
    expect(evaluateFinalSendAdmission(snapshot(), "gate", T + 1_000)).toEqual({
      kind: "admit",
    });
  });

  it("refuses a torn snapshot: stale seed copy plus a positive same-id cluster row (C01)", () => {
    // The demonstrated hole: the snapshot transaction returned an old
    // non-positive seed row while the cluster query returned a NEWER
    // positive copy of the SAME seed. The verdict must refuse on the
    // positive copy, never admit on the stale seed.
    const verdict = evaluateFinalSendAdmission(
      snapshot({
        seedMessage: seed(),
        clusterRows: [
          row(7, { replyDetectedAt: new Date(T + 500) }),
        ],
      }),
      "fence",
      T + 1_000
    );
    expect(verdict).toEqual({
      kind: "refuse",
      code: "already_replied",
      reason:
        "Handoff fence found positive reply evidence on the message before SMTP",
    });
  });

  it("refuses a seed-positive row even when the cluster copy is clean", () => {
    const verdict = evaluateFinalSendAdmission(
      snapshot({
        seedMessage: seed({ replyDetectedAt: new Date(T) }),
        clusterRows: [row(7)],
      }),
      "gate",
      T + 1_000
    );
    expect(verdict.kind).toBe("refuse");
    if (verdict.kind === "refuse") {
      expect(verdict.code).toBe("already_replied");
      expect(verdict.reason).toContain("on the message before SMTP");
    }
  });

  it("refuses a positive sibling with the equivalent-message reason", () => {
    const verdict = evaluateFinalSendAdmission(
      snapshot({
        seedMessage: seed(),
        clusterRows: [row(7), row(9, { replyDetectedAt: new Date(T) })],
      }),
      "fence",
      T + 1_000
    );
    expect(verdict.kind).toBe("refuse");
    if (verdict.kind === "refuse") {
      expect(verdict.code).toBe("already_replied");
      expect(verdict.reason).toContain("on an equivalent message before SMTP");
    }
  });

  it("refuses a sent seed/sibling the same way", () => {
    const verdict = evaluateFinalSendAdmission(
      snapshot({
        seedMessage: seed({ replyStatus: "sent" }),
        clusterRows: [row(7, { replyStatus: "sent" })],
      }),
      "fence",
      T + 1_000
    );
    expect(verdict.kind).toBe("refuse");
    if (verdict.kind === "refuse") expect(verdict.code).toBe("already_replied");
  });

  it("returns stale (never admit) for pending/missing context, expired owner, or old age", () => {
    const staleCases: Array<Partial<NonNullable<FinalSendAdmissionSnapshot["seedMessage"]>>> = [
      // Staged but unconfirmed marker with a live owner.
      { replyNegativeContextHash: "PROBE_PENDING" },
      // Missing context.
      { replyNegativeContextHash: null },
      // Expired owner.
      { replyNegativeOwnerExpiresAt: new Date(T - 1) },
    ];
    for (const patch of staleCases) {
      expect(
        evaluateFinalSendAdmission(
          snapshot({ seedMessage: seed(patch) }),
          "fence",
          T + 1_000
        ).kind
      ).toBe("stale");
    }
    // Age past the 5s window with an otherwise perfect row.
    expect(
      evaluateFinalSendAdmission(snapshot(), "fence", T + 5_001).kind
    ).toBe("stale");
    // Exactly at the window: still admit.
    expect(
      evaluateFinalSendAdmission(snapshot(), "fence", T + 5_000).kind
    ).toBe("admit");
    // Incomplete cluster is never permission.
    expect(
      evaluateFinalSendAdmission(
        snapshot({ clusterRows: null }),
        "fence",
        T + 1_000
      ).kind
    ).toBe("stale");
  });

  it("maps attempt states to the stable refusal codes", () => {
    const cases: Array<[string | null, string]> = [
      ["sent", "already_replied"],
      ["delivery_unknown", "delivery_unknown"],
      ["failed", "reply_state_conflict"],
      ["claimed", "ADMIT"],
      ["submitted", "ADMIT"],
    ];
    for (const [status, expected] of cases) {
      const verdict = evaluateFinalSendAdmission(
        snapshot({ attempt: status === null ? null : { status } }),
        "fence",
        T + 1_000
      );
      if (expected === "ADMIT") {
        expect(verdict.kind).toBe("admit");
      } else {
        expect(verdict.kind).toBe("refuse");
        if (verdict.kind === "refuse") expect(verdict.code).toBe(expected);
      }
    }
    // Missing attempt and missing seed refuse distinctly.
    expect(
      evaluateFinalSendAdmission(snapshot({ attempt: null }), "gate", T).kind
    ).toBe("refuse");
    const missingSeed = evaluateFinalSendAdmission(
      snapshot({ seedMessage: null }),
      "gate",
      T
    );
    expect(missingSeed).toEqual({
      kind: "refuse",
      code: "probe_failed",
      reason: "Post-claim gate: original message not found before SMTP",
    });
  });
});
