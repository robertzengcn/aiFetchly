import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { __setDiagnosticsDirForTests } from "@/modules/diagnostics/DiagnosticPaths";
import {
  getLastPromptedCrashId,
  setLastPromptedCrashId,
  shouldShowUncleanShutdownPrompt,
} from "@/modules/diagnostics/CrashPromptState";

describe("CrashPromptState", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crash-prompt-"));
    __setDiagnosticsDirForTests(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests("");
  });

  it("persists and reads the last prompted crash id", () => {
    expect(getLastPromptedCrashId()).toBeNull();
    setLastPromptedCrashId("crash-123");
    expect(getLastPromptedCrashId()).toBe("crash-123");
  });

  it("does not show when no unclean shutdown was detected this launch", () => {
    expect(
      shouldShowUncleanShutdownPrompt({
        detectedThisLaunch: false,
        crashId: "crash-1",
        lastPromptedCrashId: null,
      })
    ).toBe(false);
  });

  it("shows once for a newly detected unclean shutdown", () => {
    expect(
      shouldShowUncleanShutdownPrompt({
        detectedThisLaunch: true,
        crashId: "crash-1",
        lastPromptedCrashId: null,
      })
    ).toBe(true);
  });

  it("does not re-show after the same crash id was already prompted", () => {
    expect(
      shouldShowUncleanShutdownPrompt({
        detectedThisLaunch: true,
        crashId: "crash-1",
        lastPromptedCrashId: "crash-1",
      })
    ).toBe(false);
  });
});
