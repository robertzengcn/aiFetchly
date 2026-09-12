import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import type { BrowserWindow } from "electron";
import {
  createWindowStatusSink,
  resolveAboutWebsiteUrlForMain,
} from "@/main-process/communication/about-ipc";
import {
  AIFETCHLY_WEBSITE_URL,
  resolveAboutWebsiteUrl,
} from "@/config/appInfo";
import { APP_UPDATE_STATUS_EVENT } from "@/config/channellist";
import type { UpdateStatusSnapshot } from "@/main-process/updater/UpdateStatus";

/**
 * The status sink bridges AppUpdateService → renderer. These tests cover the
 * lifecycle bug (H1) where the sink must resolve the CURRENT window lazily and
 * skip a destroyed one, rather than closing over a single BrowserWindow.
 */
interface FakeWindow {
  isDestroyed(): boolean;
  webContents: { send: (channel: string, payload: unknown) => void };
}

function fakeWindow(destroyed: boolean, send: Mock): FakeWindow {
  return { isDestroyed: () => destroyed, webContents: { send } };
}

const SAMPLE: UpdateStatusSnapshot = {
  state: "checking",
  currentVersion: "1.2.3",
};

describe("createWindowStatusSink", () => {
  it("sends the snapshot on APP_UPDATE_STATUS_EVENT to a live window", () => {
    const send = vi.fn();
    const sink = createWindowStatusSink(
      () => fakeWindow(false, send) as unknown as FakeWindow & null
    );

    sink(SAMPLE);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(APP_UPDATE_STATUS_EVENT, SAMPLE);
  });

  it("skips a destroyed window instead of throwing", () => {
    const send = vi.fn();
    const sink = createWindowStatusSink(
      () => fakeWindow(true, send) as unknown as FakeWindow & null
    );

    sink(SAMPLE);

    expect(send).not.toHaveBeenCalled();
  });

  it("skips a null window (no main window yet / already closed)", () => {
    const send = vi.fn();
    const sink = createWindowStatusSink(() => null);

    sink(SAMPLE);

    expect(send).not.toHaveBeenCalled();
  });

  it("resolves the current window lazily and recovers after recreation", () => {
    // Simulate macOS close → activate: the sink was registered once with a
    // getter; the getter returns the destroyed old window first, then a fresh
    // window after recreation. The sink must deliver to the new one.
    const destroyedSend = vi.fn();
    const liveSend = vi.fn();
    let current = fakeWindow(true, destroyedSend) as unknown as BrowserWindow;
    const sink = createWindowStatusSink(() => current);

    sink(SAMPLE); // destroyed → skipped
    expect(destroyedSend).not.toHaveBeenCalled();

    current = fakeWindow(false, liveSend) as unknown as BrowserWindow; // recreated
    sink({ state: "downloading", currentVersion: "1.2.3" });

    expect(liveSend).toHaveBeenCalledTimes(1);
    expect(liveSend).toHaveBeenCalledWith(APP_UPDATE_STATUS_EVENT, {
      state: "downloading",
      currentVersion: "1.2.3",
    });
  });
});

describe("resolveAboutWebsiteUrl", () => {
  it("passes through a valid VITE_LOGIN_URL value", () => {
    expect(resolveAboutWebsiteUrl("https://example.com")).toBe(
      "https://example.com"
    );
  });

  it("strips a trailing slash", () => {
    expect(resolveAboutWebsiteUrl("https://example.com/")).toBe(
      "https://example.com"
    );
  });

  it("strips surrounding quotes from .env quirks", () => {
    expect(resolveAboutWebsiteUrl('"https://example.com"')).toBe(
      "https://example.com"
    );
  });

  it("falls back for missing / empty / sentinel values", () => {
    expect(resolveAboutWebsiteUrl(undefined)).toBe(AIFETCHLY_WEBSITE_URL);
    expect(resolveAboutWebsiteUrl("")).toBe(AIFETCHLY_WEBSITE_URL);
    expect(resolveAboutWebsiteUrl("   ")).toBe(AIFETCHLY_WEBSITE_URL);
    expect(resolveAboutWebsiteUrl("undefined")).toBe(AIFETCHLY_WEBSITE_URL);
    expect(resolveAboutWebsiteUrl("null")).toBe(AIFETCHLY_WEBSITE_URL);
  });

  it("falls back for invalid or non-http(s) URLs", () => {
    expect(resolveAboutWebsiteUrl("not-a-url")).toBe(AIFETCHLY_WEBSITE_URL);
    expect(resolveAboutWebsiteUrl("ftp://example.com")).toBe(
      AIFETCHLY_WEBSITE_URL
    );
    expect(resolveAboutWebsiteUrl(123)).toBe(AIFETCHLY_WEBSITE_URL);
  });
});

describe("resolveAboutWebsiteUrlForMain", () => {
  let saved: string | undefined;
  let hadKey: boolean;

  beforeEach(() => {
    hadKey = Object.prototype.hasOwnProperty.call(
      process.env,
      "VITE_LOGIN_URL"
    );
    saved = process.env.VITE_LOGIN_URL;
  });

  afterEach(() => {
    if (hadKey) {
      process.env.VITE_LOGIN_URL = saved as string;
    } else {
      delete process.env.VITE_LOGIN_URL;
    }
  });

  it("prefers VITE_LOGIN_URL from .env", () => {
    process.env.VITE_LOGIN_URL = "https://env-configured.example.com";
    expect(resolveAboutWebsiteUrlForMain()).toBe(
      "https://env-configured.example.com"
    );
  });

  it("falls back when VITE_LOGIN_URL is missing or invalid", () => {
    delete process.env.VITE_LOGIN_URL;
    expect(resolveAboutWebsiteUrlForMain()).toBe(AIFETCHLY_WEBSITE_URL);

    process.env.VITE_LOGIN_URL = "";
    expect(resolveAboutWebsiteUrlForMain()).toBe(AIFETCHLY_WEBSITE_URL);

    process.env.VITE_LOGIN_URL = "not-a-url";
    expect(resolveAboutWebsiteUrlForMain()).toBe(AIFETCHLY_WEBSITE_URL);
  });
});
