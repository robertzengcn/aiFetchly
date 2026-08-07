import { pathToFileURL } from "url";
import { describe, expect, it, vi } from "vitest";
import {
  HtmlFileLoadError,
  loadHtmlFileWithUrlFallback,
} from "@/utils/loadHtmlFileWithUrlFallback";

describe("loadHtmlFileWithUrlFallback", () => {
  it("uses loadFile when it succeeds", async () => {
    const loader = {
      loadFile: vi.fn(async () => undefined),
      loadURL: vi.fn(async () => undefined),
    };

    const result = await loadHtmlFileWithUrlFallback(
      loader,
      "/tmp/app.asar/.vite/renderer/main_window/index.html"
    );

    expect(result).toEqual({ method: "loadFile" });
    expect(loader.loadURL).not.toHaveBeenCalled();
  });

  it("falls back to an encoded file URL when loadFile fails", async () => {
    const htmlPath = "/tmp/app.asar/.vite/renderer/main_window/index.html";
    const loader = {
      loadFile: vi.fn(async () => {
        throw new Error("ERR_FAILED (-2)");
      }),
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
  });

  it("does not fall back after the window has been destroyed", async () => {
    const loadFileError = new Error("Object has been destroyed");
    const loader = {
      isDestroyed: () => true,
      loadFile: vi.fn(async () => {
        throw loadFileError;
      }),
      loadURL: vi.fn(async () => undefined),
    };

    await expect(
      loadHtmlFileWithUrlFallback(loader, "/tmp/index.html")
    ).rejects.toBe(loadFileError);
    expect(loader.loadURL).not.toHaveBeenCalled();
  });

  it("preserves both failures when loadFile and loadURL fail", async () => {
    const loadFileError = new Error("ERR_FAILED (-2)");
    const loadUrlError = new Error("blocked");
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
