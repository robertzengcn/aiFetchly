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

export async function loadHtmlFileWithUrlFallback(
  loader: HtmlFileLoader,
  htmlPath: string
): Promise<HtmlFileLoadResult> {
  try {
    await loader.loadFile(htmlPath);
    return { method: "loadFile" };
  } catch (loadFileError: unknown) {
    if (loader.isDestroyed?.()) {
      throw loadFileError;
    }

    const fileUrl = pathToFileURL(htmlPath).toString();
    try {
      await loader.loadURL(fileUrl);
      return { method: "loadURL", fileUrl };
    } catch (loadUrlError: unknown) {
      throw new HtmlFileLoadError(
        `Failed to load HTML via loadFile and file URL: ${htmlPath}`,
        htmlPath,
        fileUrl,
        loadFileError,
        loadUrlError
      );
    }
  }
}
