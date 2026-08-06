import { describe, expect, it, vi } from "vitest";

const mockUserSignout = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/modules/user", () => ({
  User: vi.fn().mockImplementation(() => ({
    Signout: mockUserSignout,
  })),
}));

import { redirectToLoginOnAuthExpired } from "@/service/AIChatAuthExpiredHandler";

describe("AIChatAuthExpiredHandler", () => {
  it("signs the user out when hosted AI auth expires", async () => {
    mockUserSignout.mockClear();
    await redirectToLoginOnAuthExpired(new Error("HTTP 403 Forbidden"));
    expect(mockUserSignout).toHaveBeenCalledTimes(1);
  });

  it("does not sign out for non-auth errors", async () => {
    mockUserSignout.mockClear();
    await redirectToLoginOnAuthExpired(new Error("Server returned 500"));
    expect(mockUserSignout).not.toHaveBeenCalled();
  });
});
