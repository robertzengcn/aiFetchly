/**
 * Shell stdout/stderr spooling through ToolResultStorageService (T16 / §9.3).
 *
 * Boundary test for the rewired `ShellToolService.runShell` capture path. The
 * design's claims under test:
 *
 *  - a stdout larger than the legacy 256 KiB inline cap is captured IN FULL
 *    to a preserved artifact (verify via `storage.readWindow` of the full
 *    body), and the inline `stdout` field is bounded to the preview ceiling;
 *  - `stdout_truncated` is honest — true when the stream exceeded the inline
 *    preview, even though the artifact captured it completely;
 *  - the result carries a `tool_result_ref` whose `output_id` resolves via
 *    `authorizeAccess` (public Module API) and whose `preservation` is
 *    `complete` for a sub-cap stream;
 *  - stderr is merged into the SAME artifact, delimited after stdout;
 *  - foreground→background handoff continues the SAME artifact: after
 *    `detain`, the registry's poll snapshot exposes a `tool_result_ref` for
 *    the SAME `output_id` the foreground opened, and the full body is
 *    readable after the child exits;
 *  - when no `toolCallId` is supplied (legacy caller), capture is skipped
 *    and the inline path runs unchanged.
 *
 * Capture is forced on by mocking `@/config/featureFlags`; the storage root
 * is mocked to a tmp dir. A real `ToolResultModule` (tmp SQLite) backs the
 * claim/commit lifecycle so `authorizeAccess` works end-to-end.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

// Force the capture path ON for this suite. The storage root is redirected to
// a tmp dir below so no real Electron userData path is touched.
vi.mock("@/config/featureFlags", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/config/featureFlags")>();
  return {
    ...original,
    isToolOutputCaptureEnabled: () => true,
  };
});

let tmpDir: string;
let storageRoot: string;

vi.mock("@/service/toolResult/toolResultRoot", () => ({
  getToolResultStorageRoot: () => storageRoot,
}));

import { executeShellCommand } from "@/service/ShellToolService";
import { ToolResultModule } from "@/modules/ToolResultModule";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import { getDefaultBackgroundShellRegistry } from "@/service/BackgroundShellRegistry";

/** The inline stdout preview ceiling (must match ShellCaptureService). */
const INLINE_STDOUT_MAX = 256 * 1024;

beforeEach(() => {
  tmpDir = path.join(
    os.tmpdir(),
    `aifetchly-shell-spool-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(tmpDir, { recursive: true });
  storageRoot = path.join(tmpDir, "artifacts");
  fs.mkdirSync(storageRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Run a real shell command via `executeShellCommand` with capture on, and
 * return the result + a storage handle rooted at the same tmp dir + the
 * conversationId/toolCallId used, for verification.
 */
async function runCaptured(
  command: string,
  opts: { conversationId?: string; toolCallId?: string; timeoutMs?: number } = {}
): Promise<{
  result: Awaited<ReturnType<typeof executeShellCommand>>;
  storage: ToolResultStorageService;
  module: ToolResultModule;
  conversationId: string;
  toolCallId: string;
}> {
  const conversationId =
    opts.conversationId ?? `conv-${crypto.randomBytes(4).toString("hex")}`;
  const toolCallId =
    opts.toolCallId ?? `call-${crypto.randomBytes(4).toString("hex")}`;
  const result = await executeShellCommand(
    { command, shell: "bash", timeout_ms: opts.timeoutMs ?? 30000 },
    conversationId,
    toolCallId
  );
  const storage = new ToolResultStorageService({ root: storageRoot });
  const module = new ToolResultModule();
  return { result, storage, module, conversationId, toolCallId };
}

/**
 * Authorize as the owner conversation and read the full artifact body via the
 * public `ToolResultStorageService.readWindow` API. The `authorizeAccess`
 * result carries the output row (with `storageKey`) on `ok: true`.
 */
async function readFullArtifact(
  module: ToolResultModule,
  storage: ToolResultStorageService,
  outputId: string,
  conversationId: string,
  startByte = 0,
  maxBytes = 8 * 1024 * 1024
): Promise<{ body: string; totalBytes: number; storageKey: string }> {
  // Shell captures claim output without an ownerAgentId, so the owner path
  // matches when the caller also omits agentId (both default to "").
  const decision = await module.authorizeAccess({
    outputId,
    profileId: "default",
    conversationId,
  });
  if (!decision.ok) {
    throw new Error(`authorizeAccess denied: ${decision.code}`);
  }
  const output = decision.output;
  if (!output.storageKey) {
    throw new Error("committed output has no storageKey");
  }
  const win = await storage.readWindow({
    storageKey: output.storageKey,
    startByte,
    maxBytes,
  });
  return {
    body: win.buffer.toString("utf-8"),
    totalBytes: win.totalBytes,
    storageKey: output.storageKey,
  };
}

describe("shell spooling — oversized stdout captured to artifact", () => {
  it("captures a >256 KiB stdout to an artifact and reports an honest inline preview + truncation", async () => {
    // Emit ~400 KiB of stdout — well past the 256 KiB inline ceiling but far
    // under the 64 MiB artifact cap, so preservation must be `complete`.
    const kib = 400;
    const command = `yes 'abcdefghij' | head -c ${kib * 1024}`;
    const { result, storage, module, conversationId } = await runCaptured(
      command
    );

    expect(result.success).toBe(true);
    expect(result.tool_result_ref).toBeDefined();
    const ref = result.tool_result_ref!;
    expect(ref.preservation).toBe("complete");
    // The inline stdout preview must be bounded — NOT the full 400 KiB.
    expect(result.stdout.length).toBeLessThanOrEqual(INLINE_STDOUT_MAX);
    // stdout_truncated is honest: the stream exceeded the inline ceiling even
    // though the artifact captured it completely.
    expect(result.stdout_truncated).toBe(true);

    // The owner conversation can authorize + read the FULL body from the
    // artifact via readWindow — the part that was dropped from the inline
    // preview. This is the core recovery guarantee.
    const { body, totalBytes } = await readFullArtifact(
      module,
      storage,
      ref.output_id,
      conversationId,
      0,
      ref.captured_bytes
    );
    expect(totalBytes).toBe(ref.captured_bytes);
    expect(ref.captured_bytes).toBe(kib * 1024);
    // The captured stream starts with the repeated pattern.
    expect(body.startsWith("abcdefghij")).toBe(true);
  });
});

describe("shell spooling — small stdout is complete and untruncated", () => {
  it("captures a small stdout with preservation complete and stdout_truncated false", async () => {
    const command = "echo 'hello shell spool'";
    const { result, storage, module, conversationId } = await runCaptured(
      command
    );

    expect(result.success).toBe(true);
    expect(result.tool_result_ref).toBeDefined();
    const ref = result.tool_result_ref!;
    expect(ref.preservation).toBe("complete");
    expect(result.stdout_truncated).toBe(false);
    expect(result.stdout).toContain("hello shell spool");

    // The artifact holds exactly the echoed line (plus newline).
    const { body } = await readFullArtifact(
      module,
      storage,
      ref.output_id,
      conversationId
    );
    expect(body.trim()).toBe("hello shell spool");
  });
});

describe("shell spooling — stderr is merged into the same artifact", () => {
  it("writes stderr after stdout under the same output_id, delimited", async () => {
    const command =
      "echo 'stdout line'; echo 'stderr line' 1>&2; echo 'more stdout'";
    const { result, storage, module, conversationId } = await runCaptured(
      command
    );

    expect(result.success).toBe(true);
    const ref = result.tool_result_ref!;
    expect(ref.preservation).toBe("complete");

    const { body } = await readFullArtifact(
      module,
      storage,
      ref.output_id,
      conversationId
    );
    // stdout content appears before the stderr delimiter, stderr after.
    expect(body).toContain("stdout line");
    expect(body).toContain("more stdout");
    expect(body).toContain("--- stderr ---");
    expect(body).toContain("stderr line");
    const stderrIdx = body.indexOf("--- stderr ---");
    const stdoutIdx = body.indexOf("stdout line");
    expect(stderrIdx).toBeGreaterThan(stdoutIdx);
  });
});

describe("shell spooling — foreground→background handoff continues the SAME artifact", () => {
  it("detains a timed-out shell under the same output_id the foreground opened", async () => {
    // A command that runs longer than the timeout AND produces more than the
    // inline ceiling: forces auto-background mid-stream. The capture handle
    // is detached from the foreground and handed to the registry, which
    // continues appending to the SAME artifact sink.
    const kib = 400;
    const command = `yes 'handoff-line' | head -c ${kib * 1024}; sleep 2`;
    const conversationId = `bg-${crypto.randomBytes(4).toString("hex")}`;
    const toolCallId = `bgcall-${crypto.randomBytes(4).toString("hex")}`;
    // 1000ms is the zod minimum; autoBackground default true → a command that
    // runs ~2s is detained at the timeout instead of killed.
    const { result, storage, module } = await runCaptured(command, {
      conversationId,
      toolCallId,
      timeoutMs: 1000,
    });

    // The foreground result reports backgrounding.
    expect(result.backgrounded).toBe(true);
    expect(result.shell_id).toBeDefined();
    // No tool_result_ref on the foreground result — the artifact is still
    // being written; the registry finalizes it on close and surfaces the ref
    // via poll(). The foreground inline preview is still bounded.
    expect(result.tool_result_ref).toBeUndefined();
    expect(result.stdout.length).toBeLessThanOrEqual(INLINE_STDOUT_MAX);

    const shellId = result.shell_id!;
    const reg = getDefaultBackgroundShellRegistry();

    // Wait for the backgrounded child to finish and the registry to finalize
    // the capture (best-effort bounded wait).
    const deadline = Date.now() + 15000;
    let snapshot: ReturnType<typeof reg.poll> | undefined;
    while (Date.now() < deadline) {
      snapshot = reg.poll(shellId);
      if (snapshot && snapshot.tool_result_ref) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(snapshot).toBeDefined();
    expect(snapshot!.tool_result_ref).toBeDefined();
    const ref = snapshot!.tool_result_ref!;
    expect(ref.preservation).toBe("complete");
    // Same artifact the foreground opened: the full 400 KiB was captured
    // despite the mid-stream handoff.
    expect(ref.captured_bytes).toBe(kib * 1024);

    // The owner can read the full body from the artifact after the
    // backgrounded child finished.
    const { body, totalBytes } = await readFullArtifact(
      module,
      storage,
      ref.output_id,
      conversationId
    );
    expect(totalBytes).toBe(kib * 1024);
    expect(body.startsWith("handoff-line")).toBe(true);
  });
});

describe("shell spooling — capture disabled falls back to inline", () => {
  it("returns no tool_result_ref when no toolCallId is supplied (legacy caller)", async () => {
    // When `executeShellCommand` is called without a toolCallId, capture is
    // not attached and the legacy inline path runs. This is the contract
    // production callers fall back to when invoked outside a tool-call flow.
    const result = await executeShellCommand(
      { command: "echo 'no capture'", shell: "bash", timeout_ms: 30000 },
      "conv-uncaptured"
      // no toolCallId → capture skipped
    );
    expect(result.success).toBe(true);
    expect(result.tool_result_ref).toBeUndefined();
    expect(result.stdout).toContain("no capture");
  });
});
