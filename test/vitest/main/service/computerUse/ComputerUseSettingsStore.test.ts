// test/vitest/main/service/computerUse/ComputerUseSettingsStore.test.ts
//
// Audit A21: settings writes must persist and round-trip — the previous
// in-memory store discarded every write while reporting success.
import { describe, it, expect, vi } from "vitest";

const tokenMock = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    token: {
      getValue: (key: string) => values.get(key) ?? "",
      setValue: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  };
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(key: string): string {
      return tokenMock.token.getValue(key);
    }
    setValue(key: string, value: string): void {
      tokenMock.token.setValue(key, value);
    }
  },
}));

import { TokenComputerUseSettingsStore } from "@/service/computerUse/ComputerUseSettingsStore";
import { DEFAULT_COMPUTER_USE_SETTINGS } from "@/entityTypes/computerUseTypes";

describe("TokenComputerUseSettingsStore (audit A21)", () => {
  it("persists writes and round-trips them on the next read", () => {
    tokenMock.values.clear();
    const store = new TokenComputerUseSettingsStore();
    expect(store.read()).toEqual(DEFAULT_COMPUTER_USE_SETTINGS);

    const next = {
      ...DEFAULT_COMPUTER_USE_SETTINGS,
      visualPlannerEnabled: true,
      debugRetentionDays: 30,
    };
    store.write(next);
    expect(store.read()).toEqual(next); // NOT defaults — the A21 repro
  });

  it("falls back to defaults on a corrupted blob", () => {
    tokenMock.values.set("COMPUTER_USE_SETTINGS", "{not json");
    const store = new TokenComputerUseSettingsStore();
    expect(store.read()).toEqual(DEFAULT_COMPUTER_USE_SETTINGS);
  });

  it("repairs an invalid stored hotkey instead of wedging sessions", () => {
    tokenMock.values.set(
      "COMPUTER_USE_SETTINGS",
      JSON.stringify({
        ...DEFAULT_COMPUTER_USE_SETTINGS,
        stopHotkey: "Ctrl+S", // one modifier: invalid
      })
    );
    const store = new TokenComputerUseSettingsStore();
    expect(store.read().stopHotkey).toBe(DEFAULT_COMPUTER_USE_SETTINGS.stopHotkey);
  });

  it("rejects invalid writes instead of persisting a poison blob", () => {
    tokenMock.values.clear();
    const store = new TokenComputerUseSettingsStore();
    expect(() =>
      store.write({
        ...DEFAULT_COMPUTER_USE_SETTINGS,
        debugRetentionDays: 9999,
      })
    ).toThrow();
    expect(tokenMock.values.has("COMPUTER_USE_SETTINGS")).toBe(false);
  });
});
