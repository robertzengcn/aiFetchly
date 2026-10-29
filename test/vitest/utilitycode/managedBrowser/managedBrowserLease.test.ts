import { describe, expect, it } from "vitest";

import { ManagedBrowserLeaseService } from "@/service/ManagedBrowserLeaseService";

describe("ManagedBrowserLeaseService", () => {
  it("grants an exclusive lease and remembers it", () => {
    const svc = new ManagedBrowserLeaseService();
    const result = svc.acquire(42, {
      sessionId: "mb_alpha111",
      ownerConversationId: "conv-1",
    });
    expect(result.status).toBe("granted");
    expect(svc.isHeld(42)).toBe(true);
    expect(svc.getLease(42)?.sessionId).toBe("mb_alpha111");
  });

  it("returns the active session for a repeat from the same conversation", () => {
    const svc = new ManagedBrowserLeaseService();
    svc.acquire(42, { sessionId: "mb_alpha111", ownerConversationId: "conv-1" });
    const repeat = svc.acquire(42, {
      sessionId: "mb_beta222",
      ownerConversationId: "conv-1",
    });
    expect(repeat).toEqual({ status: "already_active", sessionId: "mb_alpha111" });
    // No second Chrome was started for the account.
    expect(svc.activeLeases()).toHaveLength(1);
  });

  it("rejects a different owner with account_in_use and no owner details", () => {
    const svc = new ManagedBrowserLeaseService();
    svc.acquire(42, { sessionId: "mb_alpha111", ownerConversationId: "conv-1" });
    const other = svc.acquire(42, {
      sessionId: "mb_beta222",
      ownerConversationId: "conv-2",
    });
    expect(other).toEqual({ status: "account_in_use" });
  });

  it("enforces the global session limit across different accounts", () => {
    const svc = new ManagedBrowserLeaseService();
    svc.acquire(1, { sessionId: "mb_alpha111", ownerConversationId: "c1" });
    const second = svc.acquire(2, { sessionId: "mb_beta222", ownerConversationId: "c2" });
    expect(second.status).toBe("global_limit_reached");
  });

  it("release requires both sessionId and the unguessable lease token", () => {
    const svc = new ManagedBrowserLeaseService();
    const granted = svc.acquire(42, {
      sessionId: "mb_alpha111",
      ownerConversationId: null,
    });
    if (granted.status !== "granted") {
      throw new Error("expected grant");
    }
    expect(svc.release(42, "mb_alpha111", "wrong-token")).toBe("token_mismatch");
    expect(svc.isHeld(42)).toBe(true);
    expect(svc.release(42, "mb_alpha111", granted.leaseToken)).toBe("released");
    expect(svc.isHeld(42)).toBe(false);
  });

  it("release is idempotent after a crash-release", () => {
    const svc = new ManagedBrowserLeaseService();
    const granted = svc.acquire(7, { sessionId: "mb_gamma333", ownerConversationId: null });
    if (granted.status !== "granted") {
      throw new Error("expected grant");
    }
    expect(svc.release(7, "mb_gamma333", granted.leaseToken)).toBe("released");
    expect(svc.release(7, "mb_gamma333", granted.leaseToken)).toBe("not_held");
    // After crash-release the account can be leased again.
    expect(
      svc.acquire(7, { sessionId: "mb_delta444", ownerConversationId: null }).status
    ).toBe("granted");
  });

  it("a lease survives after releaseAll is NOT called, and releaseAll clears everything", () => {
    const svc = new ManagedBrowserLeaseService(5);
    svc.acquire(1, { sessionId: "mb_alpha111", ownerConversationId: null });
    svc.acquire(2, { sessionId: "mb_beta222", ownerConversationId: null });
    expect(svc.activeLeases()).toHaveLength(2);
    expect(svc.releaseAll()).toBe(2);
    expect(svc.activeLeases()).toHaveLength(0);
  });
});
