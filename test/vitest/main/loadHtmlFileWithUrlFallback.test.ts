import { pathToFileURL } from "url";
import { describe, expect, it, vi } from "vitest";
import {
  HtmlFileLoadError,
  isTransientHtmlLoadError,
  loadHtmlFileWithUrlFallback,
} from "@/utils/loadHtmlFileWithUrlFallback";

describe("loadHtmlFileWithUrlFallback", () => {
  it("uses an encoded file URL as the primary load path", async () => {
    const htmlPath = "/tmp/app.asar/.vite/renderer/main_window/index.html";
    const loader = {
      loadFile: vi.fn(async () => undefined),
      loadURL: vi.fn(async () => undefined),
    };

    const result = await loadHtmlFileWithUrlFallback(loader, htmlPath);

    expect(result).toEqual({
      method: "loadURL",
      fileUrl: pathToFileURL(htmlPath).toString(),
      attempts: 1,
    });
    expect(loader.loadURL).toHaveBeenCalledWith(
      pathToFileURL(htmlPath).toString()
    );
    expect(loader.loadFile).not.toHaveBeenCalled();
  });

  it("falls back to loadFile when the file URL load fails", async () => {
    const htmlPath = "/tmp/app.asar/.vite/renderer/main_window/index.html";
    const loader = {
      loadFile: vi.fn(async () => undefined),
      loadURL: vi.fn(async () => {
        throw new Error("blocked permanently");
      }),
    };

    const result = await loadHtmlFileWithUrlFallback(loader, htmlPath, {
      maxAttempts: 1,
    });

    expect(result).toEqual({ method: "loadFile", attempts: 1 });
    expect(loader.loadFile).toHaveBeenCalledWith(htmlPath);
  });

  it("retries transient ERR_FAILED loads with backoff", async () => {
    const htmlPath = "/tmp/app.asar/.vite/renderer/main_window/index.html";
    const sleep = vi.fn(async () => undefined);
    const loader = {
      loadFile: vi.fn(async () => {
        throw new Error("loadFile failed");
      }),
      loadURL: vi
        .fn()
        .mockRejectedValueOnce(new Error("ERR_FAILED (-2)"))
        .mockRejectedValueOnce(new Error("ERR_FAILED (-2)"))
        .mockResolvedValueOnce(undefined),
    };

    const result = await loadHtmlFileWithUrlFallback(loader, htmlPath, {
      maxAttempts: 3,
      initialRetryDelayMs: 10,
      sleep,
    });

    expect(result).toEqual({
      method: "loadURL",
      fileUrl: pathToFileURL(htmlPath).toString(),
      attempts: 3,
    });
    expect(loader.loadURL).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it("treats nested HtmlFileLoadError causes as transient", () => {
    const error = new HtmlFileLoadError(
      "Failed to load HTML via file URL and loadFile: /tmp/index.html",
      "/tmp/index.html",
      "file:///tmp/index.html",
      new Error("loadFile failed"),
      new Error("ERR_FAILED (-2)"),
      1
    );
    expect(isTransientHtmlLoadError(error)).toBe(true);
  });

  it("does not fall back after the window has been destroyed", async () => {
    const loadUrlError = new Error("Object has been destroyed");
    const loader = {
      isDestroyed: () => true,
      loadFile: vi.fn(async () => undefined),
      loadURL: vi.fn(async () => {
        throw loadUrlError;
      }),
    };

    await expect(
      loadHtmlFileWithUrlFallback(loader, "/tmp/index.html", {
        maxAttempts: 1,
      })
    ).rejects.toBe(loadUrlError);
    expect(loader.loadFile).not.toHaveBeenCalled();
  });

  it("preserves both failures when loadURL and loadFile fail", async () => {
    const loadFileError = new Error("loadFile failed");
    const loadUrlError = new Error("blocked permanently");
    const loader = {
      loadFile: vi.fn(async () => {
        throw loadFileError;
      }),
      loadURL: vi.fn(async () => {
        throw loadUrlError;
      }),
    };

    await expect(
      loadHtmlFileWithUrlFallback(loader, "/tmp/index.html", {
        maxAttempts: 1,
      })
    ).rejects.toMatchObject({
      name: "HtmlFileLoadError",
      loadFileError,
      loadUrlError,
      attempts: 1,
    } satisfies Partial<HtmlFileLoadError>);
  });
});
