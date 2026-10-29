import { spawnSync } from "child_process";
import { platform } from "os";
import { readFileSync } from "fs";
import {
  launchDetachedProcess,
  openWindowsFile,
  openWindowsFileFromWsl,
} from "@/utils/windowsOpenWith";
import { AI_FILE_OPEN } from "@/config/channellist";
import {
  registerValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import { aiChatFileOpenInputSchema } from "@/schemas/ipc/aiChat";

// WSL detection is memoized — /proc/sys/kernel/osrelease only changes on
// kernel upgrade, so we read it once per process lifetime.
let _isWSLCached: boolean | undefined;

function isWSL(): boolean {
  if (_isWSLCached !== undefined) return _isWSLCached;
  if (platform() !== "linux") {
    _isWSLCached = false;
    return _isWSLCached;
  }
  try {
    const release = readFileSync(
      "/proc/sys/kernel/osrelease",
      "utf8"
    ).toLowerCase();
    _isWSLCached =
      release.includes("microsoft") || release.includes("wsl");
  } catch {
    _isWSLCached = false;
  }
  return _isWSLCached;
}

// Translate a WSL/Linux absolute path to a Windows UNC path that the
// Windows shell can open (e.g. \\wsl.localhost\<distro>\home\...).
// Returns null if the translation fails — callers fall back to xdg-open.
function wslPathToWindows(linuxPath: string): string | null {
  try {
    const result = spawnSync("wslpath", ["-w", linuxPath], {
      encoding: "utf8",
    });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}

// Open the file in an external application.
//
// Platform notes:
//  - Windows/WSL: Electron `shell.openPath` (see `@/utils/windowsOpenWith`).
//    Do NOT use rundll32 OpenAs_* or Start-Process -Verb OpenAs — those
//    either fail or launch an app without handing off the file path.
//  - macOS: AppleScript `choose application` then `open -a` so the user
//    picks which app opens the file and the path is passed correctly.
//  - Linux: `xdg-open` via spawn (shell.openPath on Linux blocks the main
//    process on system("xdg-open ...")).
async function openFileWithChooser(filePath: string): Promise<void> {
  if (platform() === "win32") {
    const errorMessage = await openWindowsFile(filePath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return;
  }

  if (platform() === "darwin") {
    // AppleScript picks the app, then `open -a` launches the file with it.
    // The file path is passed as argv[1] (not interpolated) so quotes or
    // backslashes in the path cannot break out of the AppleScript string.
    // Error number -128 is the user-cancelled case; we silently return.
    const script = [
      "on run argv",
      "  set thePath to item 1 of argv",
      "  try",
      '    set chosenApp to choose application with prompt "Choose application to open with"',
      "  on error number -128",
      "    return",
      "  end try",
      "  set appPath to POSIX path of (chosenApp as alias)",
      '  do shell script "open -a " & quoted form of appPath & " " & quoted form of thePath',
      "end run",
    ].join("\n");
    await launchDetachedProcess("osascript", ["-e", script, filePath]);
    return;
  }

  // Linux fallback: no portable "Open With" dialog exists natively.
  // On WSL, open via the Windows host default association.
  // Falls through to xdg-open on plain Linux or if path translation fails.
  if (isWSL()) {
    const winPath = wslPathToWindows(filePath);
    if (winPath) {
      await openWindowsFileFromWsl(winPath);
      return;
    }
  }

  await launchDetachedProcess("xdg-open", [filePath]);
}

/**
 * Registers the AI_FILE_OPEN handler used by chat file-operation badges
 * (v1 AiChatBox was retired in R6.2; this handler was extracted from the
 * deleted ai-chat-ipc.ts so v2's FileOperationBadge keeps working).
 */
export function registerAiFileOpenIpcHandlers(): void {
  registerValidatedHandler(
    AI_FILE_OPEN,
    aiChatFileOpenInputSchema,
    async (input) => {
      // Security: path must be absolute and contain no traversal sequences.
      // Accept POSIX (/...), Windows drive (C:\ or C:/), and UNC (\\server\...).
      if (
        !input.filePath.startsWith("/") &&
        !/^[A-Za-z]:[\\/]/.test(input.filePath) &&
        !input.filePath.startsWith("\\\\")
      ) {
        throw new Error("File path must be absolute");
      }
      if (input.filePath.includes("..")) {
        throw new Error("Path traversal not allowed");
      }
      await openFileWithChooser(input.filePath);
      return null;
    }
  );
}
