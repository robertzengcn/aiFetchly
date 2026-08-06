/**
 * Unit tests for Windows file open used by AI chat file chips.
 *
 * Regressions these catch:
 * - Typo export OpenAs_RunnableDLL → shell32 "missing entry" alert
 * - rundll32 / Start-Process -Verb OpenAs → app launches without the file
 */
import { describe, expect, it, vi } from "vitest";
import {
  openWindowsFile,
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
});
