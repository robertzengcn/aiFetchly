import { describe, expect, it } from "vitest";
import * as fs from "fs";
import { trayLabelsForLocale, TRAY_LOCALE_CODES } from "@/main-process/lifecycle/TrayLocale";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

/**
 * Contract tests for the application-lifecycle IPC surface:
 *  1. Preload whitelist completeness — the known trap in this repo is a
 *     renderer invoke that silently no-ops when its channel is missing from
 *     src/preload.ts (see project memory). Every lifecycle channel must be
 *     present in the invoke whitelist, and both main→renderer events in ALL
 *     THREE event lists (receive / removeListener / removeAllListeners).
 *  2. TrayLocale value parity — the main-process label table must carry the
 *     SAME values as the renderer `applicationLifecycle` namespace for the
 *     three shared keys, in every supported language (drift check).
 */

// Relative path matches the existing preloadInvokeAllowlist test (vitest
// runs with the project root as cwd).
const PRELOAD_SRC = fs.readFileSync("src/preload.ts", "utf8");

const INVOKE_CHANNELS = [
  "APPLICATION_LIFECYCLE_GET_STATE",
  "APPLICATION_CLOSE_CHOICE_ACK",
  "APPLICATION_CLOSE_CHOICE_SUBMIT",
] as const;

const EVENT_CHANNELS = [
  "APPLICATION_CLOSE_CHOICE_REQUEST",
  "APPLICATION_LIFECYCLE_STATE_CHANGED",
] as const;

/** Slice the preload source from a method marker to the next method. */
function methodBody(marker: string, endMarker: string): string {
  const idx = PRELOAD_SRC.indexOf(marker);
  expect(idx).toBeGreaterThan(-1);
  const end = PRELOAD_SRC.indexOf(endMarker, idx);
  return PRELOAD_SRC.slice(idx, end > idx ? end : undefined);
}

describe("applicationLifecycle preload whitelist", () => {
  it("allowlists every lifecycle invoke channel", () => {
    const invokeSrc = methodBody("invoke:", "sendBinary:");
    for (const channel of INVOKE_CHANNELS) {
      expect(invokeSrc, `${channel} missing from invoke whitelist`).toContain(
        channel
      );
    }
  });

  it("allowlists both events in the receive list", () => {
    const receiveSrc = methodBody(
      "receive: (channel",
      "removeListener: (channel"
    );
    for (const channel of EVENT_CHANNELS) {
      expect(receiveSrc, `${channel} missing from receive list`).toContain(
        channel
      );
    }
  });

  it("allowlists both events in the removeListener list", () => {
    const removeSrc = methodBody(
      "removeListener: (channel",
      "removeAllListeners: (channel"
    );
    for (const channel of EVENT_CHANNELS) {
      expect(
        removeSrc,
        `${channel} missing from removeListener list`
      ).toContain(channel);
    }
  });

  it("allowlists both events in the removeAllListeners list", () => {
    const removeAllSrc = methodBody(
      "removeAllListeners: (channel",
      "getPathForFile"
    );
    for (const channel of EVENT_CHANNELS) {
      expect(
        removeAllSrc,
        `${channel} missing from removeAllListeners list`
      ).toContain(channel);
    }
  });
});

describe("TrayLocale value parity with renderer lang files", () => {
  const LOCALE_MESSAGES: Record<string, Record<string, unknown>> = {
    en: en as unknown as Record<string, unknown>,
    zh: zh as unknown as Record<string, unknown>,
    es: es as unknown as Record<string, unknown>,
    fr: fr as unknown as Record<string, unknown>,
    de: de as unknown as Record<string, unknown>,
    ja: ja as unknown as Record<string, unknown>,
  };

  it("matches trayOpen/trayExit/trayTooltip values in every language", () => {
    expect(TRAY_LOCALE_CODES.sort()).toEqual(
      ["de", "en", "es", "fr", "ja", "zh"].sort()
    );
    for (const code of TRAY_LOCALE_CODES) {
      const renderer = (LOCALE_MESSAGES[code]?.applicationLifecycle ??
        {}) as Record<string, unknown>;
      const tray = trayLabelsForLocale(code);
      expect(tray.open, `${code}.trayOpen drift`).toBe(renderer.trayOpen);
      expect(tray.exit, `${code}.trayExit drift`).toBe(renderer.trayExit);
      expect(tray.tooltip, `${code}.trayTooltip drift`).toBe(
        renderer.trayTooltip
      );
    }
  });
});
