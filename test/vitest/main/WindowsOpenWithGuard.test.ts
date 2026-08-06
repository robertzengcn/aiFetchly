/**
 * WindowsOpenWithGuard — prevent AI chat file-open regressions on Windows.
 *
 * Past failures:
 * 1. `OpenAs_RunnableDLL` — not exported by shell32.dll → missing-entry alert
 * 2. `rundll32 … OpenAs_RunDLL` — dialog appears but selected app never launches
 *    when spawned from Electron
 *
 * Correct path: `@/utils/windowsOpenWith` → PowerShell Start-Process -Verb OpenAs.
 *
 * If this test fails, do NOT reintroduce rundll32 OpenAs_*. Use
 * `openWindowsOpenWithDialog` / `buildWindowsOpenWithSpawn` instead.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative } from "path";

const SRC_ROOT = "src";
const HELPER_MODULE = "src/utils/windowsOpenWith.ts";
const AI_CHAT_IPC = "src/main-process/communication/ai-chat-ipc.ts";

/** Broken / undocumented shell32 entry points that must never be invoked. */
const BANNED_OPENAS =
  /OpenAs_RunnableDLL|shell32\.dll\s*,\s*OpenAs_RunDLL|rundll32(?:\.exe)?[\s\S]{0,80}OpenAs_RunDLL/i;

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) {
    return acc;
  }
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") {
        continue;
      }
      walkTsFiles(full, acc);
    } else if (extname(full) === ".ts") {
      acc.push(full);
    }
  }
  return acc;
}

/** Remove line and block comments so historical notes in comments are ignored. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;{}()])\/\/.*$/gm, "$1");
}

describe("WindowsOpenWithGuard", () => {
  it("never invokes rundll32 OpenAs_RunDLL / OpenAs_RunnableDLL in live src", () => {
    const files = walkTsFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(process.cwd(), file).replace(/\\/g, "/");
      const source = stripComments(readFileSync(file, "utf8"));
      if (BANNED_OPENAS.test(source)) {
        violations.push(rel);
      }
    }

    expect(
      violations,
      "Banned Windows Open With patterns found:\n" +
        violations.map((v) => `  - ${v}`).join("\n") +
        "\nUse openWindowsOpenWithDialog from src/utils/windowsOpenWith.ts instead."
    ).toEqual([]);
  });

  it("AI chat file-open routes through windowsOpenWith helper", () => {
    expect(existsSync(HELPER_MODULE)).toBe(true);
    expect(existsSync(AI_CHAT_IPC)).toBe(true);

    const ipcSource = stripComments(readFileSync(AI_CHAT_IPC, "utf8"));
    expect(ipcSource).toMatch(/openWindowsOpenWithDialog/);
    expect(ipcSource).toMatch(/@\/utils\/windowsOpenWith/);

    const helperSource = stripComments(readFileSync(HELPER_MODULE, "utf8"));
    expect(helperSource).toMatch(/Start-Process/);
    expect(helperSource).toMatch(/-Verb OpenAs/);
    expect(helperSource).toMatch(/powershell\.exe/);
    expect(helperSource).not.toMatch(/rundll32/i);
  });
});
