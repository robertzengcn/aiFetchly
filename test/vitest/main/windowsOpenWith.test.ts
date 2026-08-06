/**
 * Unit tests for Windows Open With launcher used by AI chat file chips.
 *
 * Regressions these catch:
 * - Typo export OpenAs_RunnableDLL → shell32 "missing entry" alert
 * - rundll32 OpenAs_RunDLL → dialog shows but selected app never launches
 */
import { describe, expect, it, vi } from "vitest";
import type { ChildProcess, SpawnOptions } from "child_process";
import {
  buildWindowsOpenWithSpawn,
  escapePowerShellSingleQuoted,
  openWindowsOpenWithDialog,
} from "@/utils/windowsOpenWith";

describe("windowsOpenWith", () => {
  describe("escapePowerShellSingleQuoted", () => {
    it("wraps a simple path in single quotes", () => {
      expect(escapePowerShellSingleQuoted("C:\\Users\\a\\file.txt")).toBe(
        "'C:\\Users\\a\\file.txt'"
      );
    });

    it("doubles embedded single quotes for PowerShell LiteralPath safety", () => {
      expect(escapePowerShellSingleQuoted("C:\\O'Brien\\report.txt")).toBe(
        "'C:\\O''Brien\\report.txt'"
      );
    });

    it("handles UNC paths from WSL translation", () => {
      expect(
        escapePowerShellSingleQuoted(
          "\\\\wsl.localhost\\Ubuntu\\home\\user\\out.md"
        )
      ).toBe("'\\\\wsl.localhost\\Ubuntu\\home\\user\\out.md'");
    });
  });

  describe("buildWindowsOpenWithSpawn", () => {
    it("uses powershell Start-Process -Verb OpenAs (not rundll32)", () => {
      const invocation = buildWindowsOpenWithSpawn(
        "C:\\Users\\me\\Documents\\ai-created.csv"
      );

      expect(invocation.command).toBe("powershell.exe");
      expect(invocation.args).toEqual([
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        "Start-Process -LiteralPath 'C:\\Users\\me\\Documents\\ai-created.csv' -Verb OpenAs",
      ]);
      expect(invocation.options).toMatchObject({
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
    });

    it("never references the non-existent OpenAs_RunnableDLL export", () => {
      const invocation = buildWindowsOpenWithSpawn("D:\\x.txt");
      const serialized = JSON.stringify(invocation);
      expect(serialized).not.toMatch(/OpenAs_RunnableDLL/i);
      expect(serialized).not.toMatch(/OpenAs_RunDLL/i);
      expect(serialized).not.toMatch(/rundll32/i);
      expect(serialized).not.toMatch(/shell32\.dll/i);
    });

    it("escapes quotes inside the -Command LiteralPath argument", () => {
      const invocation = buildWindowsOpenWithSpawn("C:\\a'b\\c.txt");
      const commandArg = invocation.args[invocation.args.length - 1];
      expect(commandArg).toBe(
        "Start-Process -LiteralPath 'C:\\a''b\\c.txt' -Verb OpenAs"
      );
    });
  });

  describe("openWindowsOpenWithDialog", () => {
    it("spawns the built invocation and unrefs the child", () => {
      const unref = vi.fn();
      const spawnFn = vi.fn(
        (
          _command: string,
          _args: ReadonlyArray<string>,
          _options: SpawnOptions
        ): ChildProcess => ({ unref } as unknown as ChildProcess)
      );

      openWindowsOpenWithDialog("C:\\tmp\\note.md", spawnFn);

      expect(spawnFn).toHaveBeenCalledTimes(1);
      const [command, args, options] = spawnFn.mock.calls[0];
      expect(command).toBe("powershell.exe");
      expect(args).toContain(
        "Start-Process -LiteralPath 'C:\\tmp\\note.md' -Verb OpenAs"
      );
      expect(options).toMatchObject({
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      expect(unref).toHaveBeenCalledTimes(1);
    });
  });
});
