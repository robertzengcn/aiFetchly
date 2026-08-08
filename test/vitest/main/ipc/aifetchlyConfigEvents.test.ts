/**
 * aifetchlyConfigEvents — the shared AIFETCHLY_CONFIG_CHANGED broadcaster used
 * by plugin/skill lifecycle handlers to live-refresh renderer slash suggestions
 * (PRD Problem 2). Verifies JSON-stringified payload, multi-window broadcast,
 * and the destroyed-window / null guards.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mutable window list so the electron mock factory (hoisted above
// imports) can read it before module evaluation reaches the const below.
const state = vi.hoisted(() => ({ windows: [] as unknown[] }));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => state.windows,
  },
}));

import { AIFETCHLY_CONFIG_CHANGED } from "@/config/channellist";
import {
  broadcastAifetchlyConfigChanged,
  emitAifetchlyConfigChangedTo,
} from "@/main-process/communication/aifetchlyConfigEvents";

interface FakeWindow {
  webContents: {
    send: ReturnType<typeof vi.fn>;
    isDestroyed: () => boolean;
  };
}

function makeWindow(destroyed = false): FakeWindow {
  return {
    webContents: {
      send: vi.fn(),
      isDestroyed: () => destroyed,
    },
  };
}

describe("aifetchlyConfigEvents", () => {
  beforeEach(() => {
    state.windows = [];
  });

  it("broadcasts a JSON-stringified payload to every live window", () => {
    const a = makeWindow();
    const b = makeWindow();
    state.windows = [a, b];

    broadcastAifetchlyConfigChanged({ source: "plugin" });

    const expected = JSON.stringify({ source: "plugin" });
    expect(a.webContents.send).toHaveBeenCalledWith(
      AIFETCHLY_CONFIG_CHANGED,
      expected
    );
    expect(b.webContents.send).toHaveBeenCalledWith(
      AIFETCHLY_CONFIG_CHANGED,
      expected
    );
  });

  it("skips destroyed windows", () => {
    const live = makeWindow();
    const dead = makeWindow(true);
    state.windows = [live, dead];

    broadcastAifetchlyConfigChanged({ source: "plugin" });

    expect(live.webContents.send).toHaveBeenCalledTimes(1);
    expect(dead.webContents.send).not.toHaveBeenCalled();
  });

  it("emitAifetchlyConfigChangedTo is a no-op on null/undefined window", () => {
    expect(() =>
      emitAifetchlyConfigChangedTo(null, { source: "plugin" })
    ).not.toThrow();
    expect(() =>
      emitAifetchlyConfigChangedTo(undefined, { source: "plugin" })
    ).not.toThrow();
  });
});
