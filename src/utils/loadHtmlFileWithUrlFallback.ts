import { pathToFileURL } from "url";

export interface HtmlFileLoader {
  loadFile(filePath: string): Promise<void>;
  loadURL(url: string): Promise<void>;
  isDestroyed?: () => boolean;
}

export interface HtmlFileLoadResult {
  method: "loadFile" | "loadURL";
  fileUrl?: string;
  attempts: number;
}

export interface LoadHtmlFileOptions {
  /**
   * Total attempts including the first try. Defaults to 3 so a brief
   * antivirus / installer file lock can clear without failing startup.
   */
  maxAttempts?: number;
  /** Delay before attempt 2 (ms). Later attempts use exponential backoff. */
  initialRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class HtmlFileLoadError extends Error {
  constructor(
    message: string,
    readonly filePath: string,
    readonly fileUrl: string,
    readonly loadFileError: unknown,
    readonly loadUrlError: unknown,
    readonly attempts: number
  ) {
    super(message);
    this.name = "HtmlFileLoadError";
  }
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 250;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error ?? "");
}

function messageLooksTransient(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("err_failed") ||
    normalized.includes("err_aborted") ||
    normalized.includes("err_access_denied") ||
    normalized.includes("ebusy") ||
    normalized.includes("eacces") ||
    normalized.includes("eperm") ||
    /\(\s*-2\s*\)/.test(normalized)
  );
}

/**
 * Chromium/Electron load failures that are often temporary on Windows when
 * Defender, an installer, or a previous process briefly holds app.asar.
 */
export function isTransientHtmlLoadError(error: unknown): boolean {
  if (messageLooksTransient(errorMessage(error))) {
    return true;
  }
  if (error instanceof HtmlFileLoadError) {
    return (
      messageLooksTransient(errorMessage(error.loadUrlError)) ||
      messageLooksTransient(errorMessage(error.loadFileError))
    );
  }
  return false;
}

async function loadOnce(
  loader: HtmlFileLoader,
  htmlPath: string
): Promise<HtmlFileLoadResult> {
  const fileUrl = pathToFileURL(htmlPath).toString();
  try {
    await loader.loadURL(fileUrl);
    return { method: "loadURL", fileUrl, attempts: 1 };
  } catch (loadUrlError: unknown) {
    if (loader.isDestroyed?.()) {
      throw loadUrlError;
    }

    try {
      await loader.loadFile(htmlPath);
      return { method: "loadFile", attempts: 1 };
    } catch (loadFileError: unknown) {
      throw new HtmlFileLoadError(
        `Failed to load HTML via file URL and loadFile: ${htmlPath}`,
        htmlPath,
        fileUrl,
        loadFileError,
        loadUrlError,
        1
      );
    }
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
 * form FIRST and only fall back to `loadFile` if the clean URL fails.
 *
 * Transient `ERR_FAILED` / access errors are retried with short backoff so a
 * brief antivirus lock or leftover file handle does not hard-fail startup.
 */
export async function loadHtmlFileWithUrlFallback(
  loader: HtmlFileLoader,
  htmlPath: string,
  options: LoadHtmlFileOptions = {}
): Promise<HtmlFileLoadResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const initialRetryDelayMs =
    options.initialRetryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await loadOnce(loader, htmlPath);
      return { ...result, attempts: attempt };
    } catch (error: unknown) {
      lastError = error;
      if (loader.isDestroyed?.()) {
        throw error;
      }
      const canRetry = attempt < maxAttempts && isTransientHtmlLoadError(error);
      if (!canRetry) {
        if (error instanceof HtmlFileLoadError) {
          throw new HtmlFileLoadError(
            error.message,
            error.filePath,
            error.fileUrl,
            error.loadFileError,
            error.loadUrlError,
            attempt
          );
        }
        throw error;
      }

      const delayMs = initialRetryDelayMs * 2 ** (attempt - 1);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
