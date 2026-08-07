import { pathToFileURL } from "url";
import { describe, expect, it, vi } from "vitest";
import {
  HtmlFileLoadError,
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
        throw new Error("ERR_FAILED (-2)");
      }),
    };

    const result = await loadHtmlFileWithUrlFallback(loader, htmlPath);

    expect(result).toEqual({ method: "loadFile" });
    expect(loader.loadFile).toHaveBeenCalledWith(htmlPath);
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
      loadHtmlFileWithUrlFallback(loader, "/tmp/index.html")
    ).rejects.toBe(loadUrlError);
    expect(loader.loadFile).not.toHaveBeenCalled();
  });

  it("preserves both failures when loadURL and loadFile fail", async () => {
    const loadFileError = new Error("loadFile failed");
    const loadUrlError = new Error("ERR_FAILED (-2)");
    const loader = {
      loadFile: vi.fn(async () => {
        throw loadFileError;
      }),
      loadURL: vi.fn(async () => {
        throw loadUrlError;
      }),
    };

    await expect(
      loadHtmlFileWithUrlFallback(loader, "/tmp/index.html")
    ).rejects.toMatchObject({
      name: "HtmlFileLoadError",
      loadFileError,
      loadUrlError,
    } satisfies Partial<HtmlFileLoadError>);
  });
});
