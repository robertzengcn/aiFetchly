import { describe, expect, it } from "vitest";
import {
  ManagedBrowserLeaseService,
  accountLeaseKey,
  publicSessionLeaseKey,
} from "@/service/ManagedBrowserLeaseService";

/** PRD M-FR-06/07: session-keyed public leases, configurable limit, owners. */

describe("ManagedBrowserLeaseService (M-FR-06/07)", () => {
  it("grants parallel leases to distinct public sessions", () => {
    const service = new ManagedBrowserLeaseService(3);
    const first = service.acquire(publicSessionLeaseKey("mb_a"), {
      sessionId: "mb_a",
      ownerConversationId: "conv-1",
    });
    const second = service.acquire(publicSessionLeaseKey("mb_b"), {
      sessionId: "mb_b",
      ownerConversationId: "conv-2",
    });
    expect(first.status).toBe("granted");
    expect(second.status).toBe("granted");
  });

  it("keeps account leases exclusive per account", () => {
    const service = new ManagedBrowserLeaseService(3);
    const first = service.acquire(accountLeaseKey(101), {
      sessionId: "mb_a",
      ownerConversationId: "conv-1",
    });
    const second = service.acquire(accountLeaseKey(101), {
      sessionId: "mb_b",
      ownerConversationId: "conv-2",
    });
    expect(first.status).toBe("granted");
    expect(second).toEqual({ status: "account_in_use" });
  });

  it("enforces the configurable global limit across key kinds", () => {
    const service = new ManagedBrowserLeaseService(2);
    expect(
      service.acquire(accountLeaseKey(1), { sessionId: "mb_a", ownerConversationId: null }).status
    ).toBe("granted");
    expect(
      service.acquire(publicSessionLeaseKey("mb_b"), { sessionId: "mb_b", ownerConversationId: null }).status
    ).toBe("granted");
    expect(
      service.acquire(publicSessionLeaseKey("mb_c"), { sessionId: "mb_c", ownerConversationId: null }).status
    ).toBe("global_limit_reached");
    service.setGlobalLimit(5);
    expect(
      service.acquire(publicSessionLeaseKey("mb_c"), { sessionId: "mb_c", ownerConversationId: null }).status
    ).toBe("granted");
  });

  it("records the owning agent task and never leaks owner details on contention", () => {
    const service = new ManagedBrowserLeaseService(3);
    service.acquire(accountLeaseKey(101), {
      sessionId: "mb_a",
      ownerConversationId: "root-conv",
      ownerAgentTaskId: "agent-task-1",
    });
    const lease = service.getLease(accountLeaseKey(101));
    expect(lease?.ownerAgentTaskId).toBe("agent-task-1");
    const denied = service.acquire(accountLeaseKey(101), {
      sessionId: "mb_b",
      ownerConversationId: "other-conv",
    });
    expect(denied).toEqual({ status: "account_in_use" });
  });

  it("releases by key with session and token verification", () => {
    const service = new ManagedBrowserLeaseService(3);
    const granted = service.acquire(accountLeaseKey(7), {
      sessionId: "mb_a",
      ownerConversationId: "conv-1",
    });
    if (granted.status !== "granted") {
      throw new Error("expected grant");
    }
    expect(service.release(accountLeaseKey(7), "mb_other", granted.leaseToken)).toBe(
      "token_mismatch"
    );
    expect(service.release(accountLeaseKey(7), "mb_a", granted.leaseToken)).toBe(
      "released"
    );
    expect(service.release(accountLeaseKey(7), "mb_a", granted.leaseToken)).toBe(
      "not_held"
    );
  });

  it("finds a lease by session for supervisor cleanup", () => {
    const service = new ManagedBrowserLeaseService(3);
    service.acquire(publicSessionLeaseKey("mb_x"), {
      sessionId: "mb_x",
      ownerConversationId: null,
    });
    expect(service.findBySessionId("mb_x")?.leaseKey).toBe("public:mb_x");
    expect(service.findBySessionId("mb_missing")).toBeNull();
  });
});
