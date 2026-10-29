import { describe, expect, it, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { getToken, removeToken } from "@/views/utils/cookies";
import { useUserStore } from "@/views/store/modules/userStore";

// Hoisted mocks so we can assert on the spy handles.
const { loginMock, signoutMock, getUserInfoMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  signoutMock: vi.fn(),
  getUserInfoMock: vi.fn(),
}));

vi.mock("@/views/api/users", () => ({
  login: loginMock,
  Signout: signoutMock,
  getUserInfo: getUserInfoMock,
}));

describe("userStore (Pinia parity with former Vuex UserModule)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    removeToken();
    loginMock.mockReset();
    signoutMock.mockReset();
    getUserInfoMock.mockReset();
  });

  describe("loginCallback", () => {
    it("persists the token to the cookie + state on success", () => {
      const u = useUserStore();
      u.loginCallback({ status: true, token: "tok-123" });
      expect(u.token).toBe("tok-123");
      expect(getToken()).toBe("tok-123");
    });

    it("throws when status is false (error contract preserved)", () => {
      const u = useUserStore();
      expect(() =>
        u.loginCallback({ status: false, msg: "bad creds" })
      ).toThrow("bad creds");
    });
  });

  describe("login", () => {
    it("trims the username and sets roles on success", async () => {
      loginMock.mockResolvedValue({
        status: true,
        data: { roles: ["admin"] },
      });
      const u = useUserStore();

      await u.login({ username: " alice ", password: "pw" });

      // username is trimmed before hitting the API
      expect(loginMock).toHaveBeenCalledWith({
        username: "alice",
        password: "pw",
      });
      expect(u.roles).toEqual(["admin"]);
    });

    it("throws when the API returns status:false", async () => {
      loginMock.mockResolvedValue({ status: false, msg: "locked" });
      const u = useUserStore();
      await expect(u.login({ username: "a", password: "b" })).rejects.toThrow(
        "locked"
      );
    });
  });

  describe("getUserInfo", () => {
    it("hydrates name/email and returns the payload", async () => {
      getUserInfoMock.mockResolvedValue({
        status: true,
        data: { name: "alice", email: "a@b.com" },
      });
      const u = useUserStore();

      const info = await u.getUserInfo();

      expect(u.name).toBe("alice");
      expect(u.email).toBe("a@b.com");
      // the router guard keys off these
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.email.length).toBeGreaterThan(0);
    });

    it("throws on status:false", async () => {
      getUserInfoMock.mockResolvedValue({ status: false, msg: "expired" });
      const u = useUserStore();
      await expect(u.getUserInfo()).rejects.toThrow("expired");
    });

    it("throws when the API returns nothing", async () => {
      getUserInfoMock.mockResolvedValue(undefined);
      const u = useUserStore();
      await expect(u.getUserInfo()).rejects.toThrow("Verification failed");
    });
  });

  describe("resetToken / logout", () => {
    it("resetToken clears identity and the cookie", () => {
      const u = useUserStore();
      u.loginCallback({ status: true, token: "t" });
      u.roles = ["admin"];
      u.name = "x";

      u.resetToken();

      expect(u.token).toBe("");
      expect(u.roles).toEqual([]);
      expect(u.name).toBe("");
      expect(getToken()).toBeUndefined();
    });

    it("logout signs out and clears token + roles", async () => {
      signoutMock.mockResolvedValue(undefined);
      const u = useUserStore();
      u.loginCallback({ status: true, token: "t" });
      u.roles = ["admin"];

      await u.logout();

      expect(signoutMock).toHaveBeenCalledTimes(1);
      expect(u.token).toBe("");
      expect(u.roles).toEqual([]);
    });

    it("logout throws when no token is present", async () => {
      const u = useUserStore();
      await expect(u.logout()).rejects.toThrow("token is undefined");
    });
  });
});
