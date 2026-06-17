"use strict";
import { describe, expect, test, vi, beforeEach } from "vitest";

type RemoteUserInfo = {
  id: number;
  name: string;
  email: string;
  roles: string[] | null;
  plans?: Array<{
    planName: string;
    planId?: string;
    status: string;
    startDate?: string;
    endDate?: string;
    currency?: string;
    billingPeriod?: string;
  }>;
};

const mockState = vi.hoisted(() => ({
  userInfo: null as RemoteUserInfo | null,
}));

const mockTokenSetValue = vi.hoisted(() =>
  vi.fn<[string, string], void>()
);
const mockTokenGetValue = vi.hoisted(() =>
  vi.fn<[string], string>().mockReturnValue("")
);

vi.mock("electron", () => ({
  app: {
    getName: vi.fn().mockReturnValue("aiFetchly"),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock("@/modules/remotesource", () => ({
  RemoteSource: vi.fn().mockImplementation(() => ({
    GetUserInfo: vi
      .fn()
      .mockImplementation(() => Promise.resolve(mockState.userInfo)),
  })),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: mockTokenGetValue,
    setValue: mockTokenSetValue,
  })),
}));

vi.mock("@/modules/lib/function", () => ({
  getUserpath: vi.fn((email: string) => `/tmp/aiFetchly/${email}`),
  getApplogspath: vi.fn((email: string) => `/tmp/aiFetchly/${email}/logs`),
  checkAndCreatePath: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/config/SqliteDb", () => ({
  SqliteDb: {
    getInstance: vi.fn().mockReturnValue({
      connection: {
        isInitialized: true,
        initialize: vi.fn().mockResolvedValue(undefined),
      },
    }),
  },
}));

vi.mock("@/modules/Logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { UserController } from "@/controller/UserController";
import { USER_AI_ENABLED } from "@/config/usersetting";

describe("UserController", () => {
  beforeEach(() => {
    mockState.userInfo = null;
    mockTokenSetValue.mockClear();
    mockTokenGetValue.mockClear();
    mockTokenGetValue.mockReturnValue("");
  });

  test("should be defined", () => {
    expect(UserController).toBeDefined();
  });

  test("enables AI for active Go monthly subscription returned by user info API", async () => {
    mockState.userInfo = {
      id: 4,
      name: "joetest4@test.com",
      email: "joetest4@test.com",
      roles: null,
      plans: [
        {
          planName: "aifetch-go-monthly",
          planId: "BASE",
          status: "active",
          startDate: "2026-06-16T09:17:34Z",
          endDate: "0001-01-01T00:00:00Z",
          currency: "USD",
          billingPeriod: "MONTHLY",
        },
      ],
    };

    const userController = new UserController();

    await userController.updateUserInfo();

    expect(mockTokenSetValue).toHaveBeenCalledWith(USER_AI_ENABLED, "true");
  });

  test("enables AI for active Pro subscription returned by user info API", async () => {
    mockState.userInfo = {
      id: 5,
      name: "pro@test.com",
      email: "pro@test.com",
      roles: null,
      plans: [
        {
          planName: "aifetch-pro-monthly",
          planId: "ADVANCED",
          status: "active",
          startDate: "2026-06-16T09:17:34Z",
          endDate: "0001-01-01T00:00:00Z",
          currency: "USD",
          billingPeriod: "MONTHLY",
        },
      ],
    };

    const userController = new UserController();

    await userController.updateUserInfo();

    expect(mockTokenSetValue).toHaveBeenCalledWith(USER_AI_ENABLED, "true");
  });
});
