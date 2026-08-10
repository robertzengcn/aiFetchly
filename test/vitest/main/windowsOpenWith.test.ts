/**
 * Unit tests for Windows file open used by AI chat file chips.
 *
 * Regressions these catch:
 * - Typo export OpenAs_RunnableDLL → shell32 "missing entry" alert
 * - rundll32 / Start-Process -Verb OpenAs → app launches without the file
 */
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { describe, expect, it, vi } from "vitest";
import {
  launchDetachedProcess,
  openWindowsFile,
  openWindowsFileFromWsl,
  openWindowsOpenWithDialog,
} from "@/utils/windowsOpenWith";

describe("windowsOpenWith", () => {
  describe("openWindowsFile", () => {
    it("delegates to shell.openPath with the given Windows path", async () => {
      const openPathFn = vi.fn(async () => "");
      const result = await openWindowsFile(
        "C:\\Users\\me\\Documents\\ai-created.csv",
        openPathFn
      );
      expect(result).toBe("");
      expect(openPathFn).toHaveBeenCalledWith(
        "C:\\Users\\me\\Documents\\ai-created.csv"
      );
    });

    it("propagates shell.openPath error messages", async () => {
      const openPathFn = vi.fn(async () => "Failed to open path");
      await expect(
        openWindowsFile("D:\\missing.txt", openPathFn)
      ).resolves.toBe("Failed to open path");
    });

    it("supports UNC paths from WSL translation", async () => {
      const openPathFn = vi.fn(async () => "");
      await openWindowsFile(
        "\\\\wsl.localhost\\Ubuntu\\home\\user\\out.md",
        openPathFn
      );
      expect(openPathFn).toHaveBeenCalledWith(
        "\\\\wsl.localhost\\Ubuntu\\home\\user\\out.md"
      );
    });
  });

  describe("openWindowsOpenWithDialog alias", () => {
    it("forwards to openWindowsFile", async () => {
      const openPathFn = vi.fn(async () => "");
      await openWindowsOpenWithDialog("C:\\tmp\\note.md", openPathFn);
      expect(openPathFn).toHaveBeenCalledWith("C:\\tmp\\note.md");
    });
  });

  describe("detached Windows host launch", () => {
    function createChildProcessDouble(): ChildProcess {
      const proc = new EventEmitter() as EventEmitter & {
        unref: ReturnType<typeof vi.fn>;
      };
      proc.unref = vi.fn();
      return proc as unknown as ChildProcess;
    }

    it("opens WSL paths through the Windows default file association", async () => {
      const proc = createChildProcessDouble();
      const spawnFn = vi.fn(() => proc);
      const openPromise = openWindowsFileFromWsl(
        "\\\\wsl.localhost\\Ubuntu\\home\\user\\image.png",
        spawnFn
      );

      proc.emit("spawn");
      await openPromise;

      expect(spawnFn).toHaveBeenCalledWith(
        "rundll32.exe",
        [
          "url.dll,FileProtocolHandler",
          "\\\\wsl.localhost\\Ubuntu\\home\\user\\image.png",
        ],
        expect.objectContaining({
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        })
      );
      expect(proc.unref).toHaveBeenCalledOnce();
    });

    it("rejects when a detached opener cannot be spawned", async () => {
      const proc = createChildProcessDouble();
      const spawnFn = vi.fn(() => proc);
      const launchPromise = launchDetachedProcess(
        "missing-opener",
        ["/tmp/image.png"],
        {},
        spawnFn
      );
      const spawnError = new Error("spawn missing-opener ENOENT");

      proc.emit("error", spawnError);

      await expect(launchPromise).rejects.toBe(spawnError);
      expect(proc.unref).not.toHaveBeenCalled();
    });
  });
});
