import { pathToFileURL } from "url";

export interface HtmlFileLoader {
  loadFile(filePath: string): Promise<void>;
  loadURL(url: string): Promise<void>;
  isDestroyed?: () => boolean;
}

export interface HtmlFileLoadResult {
  method: "loadFile" | "loadURL";
  fileUrl?: string;
}

export class HtmlFileLoadError extends Error {
  constructor(
    message: string,
    readonly filePath: string,
    readonly fileUrl: string,
    readonly loadFileError: unknown,
    readonly loadUrlError: unknown
  ) {
    super(message);
    this.name = "HtmlFileLoadError";
  }
}

/**
 * Load a packaged renderer HTML file into an Electron window.
 *
 * On Windows, `BrowserWindow.loadFile(path)` can hand Chromium a file URL that
 * still contains backslashes (e.g. `file:///E:\app\app.asar\...index.html`).
 * Chromium's URL parser rejects that form with `ERR_FAILED (-2)` even though
 * the file exists inside the asar. `pathToFileURL()` always produces a
 * forward-slash, percent-encoded URL that Chromium accepts, so we attempt that
 * form FIRST and only fall back to `loadFile` if the clean URL fails. Trying
 * the reliable form first also avoids leaving the webContents in a failed load
 * state from a rejected first attempt.
 */
export async function loadHtmlFileWithUrlFallback(
  loader: HtmlFileLoader,
  htmlPath: string
): Promise<HtmlFileLoadResult> {
  const fileUrl = pathToFileURL(htmlPath).toString();
  try {
    await loader.loadURL(fileUrl);
    return { method: "loadURL", fileUrl };
  } catch (loadUrlError: unknown) {
    if (loader.isDestroyed?.()) {
      throw loadUrlError;
    }

    try {
      await loader.loadFile(htmlPath);
      return { method: "loadFile" };
    } catch (loadFileError: unknown) {
      throw new HtmlFileLoadError(
        `Failed to load HTML via file URL and loadFile: ${htmlPath}`,
        htmlPath,
        fileUrl,
        loadFileError,
        loadUrlError
      );
    }
  }
}
