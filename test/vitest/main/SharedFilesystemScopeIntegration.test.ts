/**
 * Shared-scope integration test — the Phase-1 exit criterion of the
 * natural-language-skill-installation rollout plan:
 *
 *   "shell and file tools resolve identical workspace roots in every
 *    platform test" and "a shell-created workspace file is immediately
 *    readable by file tools and neither can escape" (design §22 Phase 1).
 *
 * This reproduces the motivating video-use failure: a shell command cloned a
 * repository outside the roots file tools could inspect, so the model looped
 * forever between clone/list/read.
 */
import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { executeShellCommand } from "@/service/ShellToolService";
import { ToolExecutor } from "@/service/ToolExecutor";

const WORKSPACE_ROOT = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("node:path") as typeof import("node:path");
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "shared-scope-"))
  );
});

const CONVERSATION_ID = "shared-scope-conv";

vi.mock("@/modules/WorkspaceModule", () => {
  const getActiveWorkspace = vi
    .fn()
    .mockImplementation(async (conversationId: string) =>
      conversationId === "shared-scope-conv"
        ? {
            id: 99,
            conversationId,
            rootPath: WORKSPACE_ROOT,
            approvalState: "approved",
          }
        : null
    );
  return {
    WorkspaceModule: vi.fn().mockImplementation(() => ({
      getActiveWorkspace,
    })),
  };
});

describe("shared conversation filesystem scope (shell ↔ file tools)", () => {
  it("a file created by shell_execute is immediately readable by file_read", async () => {
    const shellResult = await executeShellCommand(
      {
        command:
          process.platform === "win32"
            ? "echo shared-scope-sentinel > shell-created.txt"
            : "echo 'shared-scope-sentinel' > shell-created.txt",
      },
      CONVERSATION_ID
    );
    expect(shellResult.success).toBe(true);
    expect(shellResult.validatedCwd).toBe(WORKSPACE_ROOT);

    // The file tools must see the exact file the shell tool just created —
    // no cross-tool root mismatch.
    const read = (await ToolExecutor.execute(
      "file_read",
      { path: "shell-created.txt" },
      CONVERSATION_ID
    )) as Record<string, unknown>;
    expect(read.error).toBeUndefined();
    expect(String(read.content)).toContain("shared-scope-sentinel");
  }, 30_000);

  it("file tools reject a path the shell guard also rejects (identical roots)", async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    try {
      fs.writeFileSync(path.join(outsideDir, "x.txt"), "outside");
      const read = (await ToolExecutor.execute(
        "file_read",
        { path: path.join(outsideDir, "x.txt") },
        CONVERSATION_ID
      )) as Record<string, unknown>;
      expect(read.success === false || read.error).toBeTruthy();

      const shell = await executeShellCommand(
        { command: "pwd", cwd: outsideDir },
        CONVERSATION_ID
      );
      expect(shell.success).toBe(false);
      expect(shell.error).toContain("outside allowed workspace roots");
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails closed with workspace-required when no workspace is approved", async () => {
    const shell = await executeShellCommand(
      { command: "pwd" },
      "conversation-without-workspace"
    );
    expect(shell.success).toBe(false);
    expect(shell.error).toContain("No approved workspace");

    const read = (await ToolExecutor.execute(
      "file_read",
      { path: "anything.txt" },
      "conversation-without-workspace"
    )) as Record<string, unknown>;
    expect(read.success).toBe(false);
    expect(String(read.error)).toContain("No approved workspace");
  }, 30_000);
});
