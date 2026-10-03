/**
 * ShellCaptureService — spool shell stdout/stderr through the bounded
 * preserved-output artifact store (T16 / design §9.3).
 *
 * `ShellToolService.runShell` previously accumulated stdout/stderr as
 * in-memory strings capped at `SHELL_STDOUT_MAX_CHARS` (256 KiB) / stderr at
 * 200 KiB, and `BackgroundShellRegistry.detain` re-buffered at 200 KB. Both
 * bypassed `ToolResultStorageService`, so shell output never reached the
 * bounded artifact boundary and was lost on restart.
 *
 * This service owns the claim → stream → commit lifecycle for a single shell
 * execution, so the shell tool itself stays focused on process orchestration.
 *
 * Lifecycle:
 *   1. `ShellCapture.create()` + `attach(child)` — register data listeners
 *      SYNCHRONOUSLY so no early chunks are lost. `begin()` (the async DB
 *      claim + stream open) runs in the background; chunks buffer in
 *      `pendingChunks` until the stream is ready, then drain in arrival order.
 *   2. `appendStdout()`/`appendStderr()` — forward Buffer chunks as they
 *      arrive. Both streams are merged into ONE artifact (stderr after
 *      stdout, delimited) so a single `output_id` references the full combined
 *      output. A bounded inline preview is accumulated synchronously from the
 *      head of stdout for renderer display.
 *   3. `finalize()` — await the background claim, flush, promote the staging
 *      file, commit the artifact row, settle the reservation, and return the
 *      `ShellToolResultRef`. Internally awaits `begin()` so the close handler
 *      never races an in-flight claim.
 *   4. `abort()` — discard the staging file + mark the output failed on any
 *      error path (spawn failure, kill). Idempotent and safe to call before
 *      `begin()` completes.
 *   5. `detach(child)` — remove this capture's stdout/stderr listeners on
 *      foreground→background handoff, so the registry's own listeners take
 *      over the SAME artifact sink without double-appending.
 *
 * The cap is the single `TOOL_RESULT_CONFIG.artifactMaxBytes` (64 MiB), not
 * the legacy per-stream char caps. Honest completeness: a stream that hits
 * the cap seals as `preservation: "partial"`.
 */
import type { ChildProcess } from "child_process";
import { StringDecoder } from "node:string_decoder";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import { isToolOutputCaptureEnabled } from "@/config/featureFlags";
import { ToolResultModule } from "@/modules/ToolResultModule";
import {
  ToolResultStorageService,
  TextStreamCapture,
} from "@/service/toolResult/ToolResultStorageService";
import { getToolResultStorageRoot } from "@/service/toolResult/toolResultRoot";
import type { ShellToolResultRef } from "@/entityTypes/shellTypes";

/** Bounded inline preview kept for the renderer (first N KiB of stdout). */
const SHELL_PREVIEW_MAX_BYTES = 4 * 1024;

/** Maximum bytes of stdout/stderr retained inline for the legacy fields. */
const SHELL_INLINE_STDOUT_MAX = 256 * 1024;
const SHELL_INLINE_STDERR_MAX = 64 * 1024;

/** Input for {@link ShellCapture.create}. */
export interface ShellCaptureBeginInput {
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly executionId: string;
}

/** Whether the shell-capture path is active for this process. */
export function isShellCaptureEnabled(): boolean {
  return isToolOutputCaptureEnabled();
}

/** The minimal handle the background registry needs to continue a capture. */
export interface ShellCaptureHandle {
  readonly appendStdout: (chunk: Buffer) => void;
  readonly appendStderr: (chunk: Buffer) => void;
  readonly finalize: () => Promise<ShellToolResultRef | null>;
  readonly abort: () => Promise<void>;
  readonly getInlineStdout: () => string;
  readonly getInlineStderr: () => string;
  readonly getStdoutTruncated: () => boolean;
  readonly getStderrTruncated: () => boolean;
}

/** A chunk buffered before the async claim completes. */
interface PendingChunk {
  readonly buf: Buffer;
  readonly isStderr: boolean;
}

/**
 * Owns one shell execution's preserved-output lifecycle. Constructed per
 * `runShell` call when capture is enabled; `null` otherwise (the legacy
 * in-memory path runs unchanged).
 */
export class ShellCapture implements ShellCaptureHandle {
  private readonly module: ToolResultModule;
  private readonly storage: ToolResultStorageService;
  private stream: TextStreamCapture | null = null;
  private outputId: string | null = null;
  private leaseFence: string | null = null;
  private reservationId: string | null = null;
  private pendingChunks: PendingChunk[] = [];
  private stderrHeaderWritten = false;
  private stdoutInline = "";
  private stderrInline = "";
  private stdoutTruncated = false;
  private stderrTruncated = false;
  private stdoutBytes = 0;
  private stderrBytes = 0;
  /**
   * StringDecoders buffer trailing incomplete multibyte sequences across
   * chunks so a sequence split across two chunks does not emit U+FFFD. The
   * raw `chunk.toString("utf-8")` per chunk would corrupt CJK/emoji output
   * at boundaries; the decoder emits completed characters and holds the
   * partial tail until the next chunk completes it. Shared across chunks for
   * the lifetime of the capture.
   */
  private readonly stdoutDecoder = new StringDecoder("utf8");
  private readonly stderrDecoder = new StringDecoder("utf8");
  private beginFailed = false;
  private beginPromise: Promise<boolean> | null = null;
  private readonly conversationId: string;
  private readonly toolCallId: string;
  private readonly toolName: string;
  private readonly executionId: string;
  private readonly stdoutListener = (b: Buffer): void => this.appendStdout(b);
  private readonly stderrListener = (b: Buffer): void => this.appendStderr(b);

  private constructor(input: ShellCaptureBeginInput) {
    this.module = new ToolResultModule();
    this.storage = new ToolResultStorageService({
      root: getToolResultStorageRoot(),
    });
    this.conversationId = input.conversationId;
    this.toolCallId = input.toolCallId;
    this.toolName = input.toolName;
    this.executionId = input.executionId;
  }

  /**
   * Construct a capture. Listeners are NOT attached yet — call `attach(child)`
   * synchronously after this, then `startBegin()` to kick off the async claim.
   */
  static create(input: ShellCaptureBeginInput): ShellCapture {
    return new ShellCapture(input);
  }

  /**
   * Synchronously attach data listeners to the child's stdout/stderr. Chunks
   * buffer in {@link pendingChunks} until {@link begin} completes, so no early
   * output is lost while the DB claim is in flight.
   */
  attach(child: ChildProcess): void {
    child.stdout?.on("data", this.stdoutListener);
    child.stderr?.on("data", this.stderrListener);
  }

  /**
   * Remove this capture's stdout/stderr listeners (foreground→background
   * handoff). Only the capture's OWN listeners are removed; the registry then
   * attaches its own listeners that continue the SAME artifact sink via the
   * handle methods.
   */
  detach(child: ChildProcess): void {
    child.stdout?.off("data", this.stdoutListener);
    child.stderr?.off("data", this.stderrListener);
  }

  /**
   * Kick off the async claim + stream open. Chunks received before this
   * completes buffer in {@link pendingChunks} and drain in arrival order once
   * the stream is ready. Safe to call once; subsequent calls return the same
   * promise.
   */
  startBegin(): void {
    if (this.beginPromise) return;
    this.beginPromise = this.begin();
  }

  /** Await the background claim so `finalize`/`abort` never race it. */
  awaitBegin(): Promise<boolean> {
    return this.beginPromise ?? Promise.resolve(false);
  }

  private async begin(): Promise<boolean> {
    try {
      const epoch = await this.module.currentEpoch(
        "default",
        this.conversationId
      );
      const claim = await this.module.claimOutput({
        profileId: "default",
        conversationId: this.conversationId,
        outputEpoch: epoch,
        executionId: this.executionId,
        toolCallId: this.toolCallId,
        toolName: this.toolName,
        streamKey: "shell",
        format: "text",
        mediaType: "text/plain; charset=utf-8",
        sourceCompleteness: "complete",
      });
      if (claim.kind !== "claimed") {
        // Rejected (quota/epoch) or conflict — degrade gracefully to inline.
        this.beginFailed = true;
        this.pendingChunks = [];
        return false;
      }
      this.outputId = claim.outputId;
      this.leaseFence = claim.leaseFence;
      this.reservationId = claim.reservationId;
      this.stream = await this.storage.captureTextStream({
        outputId: claim.outputId,
        profileId: "default",
        outputEpoch: epoch,
        sourceCompleteness: "complete",
      });
      this.drainPending();
      return true;
    } catch {
      // A capture-setup failure must never break the shell command itself.
      this.beginFailed = true;
      this.pendingChunks = [];
      await this.releaseReservationSafe();
      return false;
    }
  }

  private drainPending(): void {
    for (const { buf, isStderr } of this.pendingChunks) {
      if (isStderr) this.writeStderrToStream(buf);
      else this.writeStdoutToStream(buf);
    }
    this.pendingChunks = [];
  }

  /** Forward a stdout chunk. Updates inline preview + truncation flag. */
  appendStdout(chunk: Buffer): void {
    if (this.beginFailed) return;
    // Inline preview always updates synchronously so the renderer can show
    // output even while the claim is still being opened.
    this.stdoutBytes += chunk.byteLength;
    if (this.stdoutInline.length < SHELL_INLINE_STDOUT_MAX) {
      const room = SHELL_INLINE_STDOUT_MAX - this.stdoutInline.length;
      // Decode through StringDecoder so a multibyte sequence split across
      // chunks does not emit U+FFFD; the decoder holds the partial tail and
      // emits the completed character once the next chunk completes it.
      const decoded = this.stdoutDecoder.write(chunk).slice(0, room);
      this.stdoutInline += decoded;
      if (this.stdoutInline.length >= SHELL_INLINE_STDOUT_MAX) {
        this.stdoutTruncated = true;
      }
    } else {
      // Even when the preview is full, drain the decoder so its internal
      // partial-sequence buffer does not grow unbounded across the stream.
      this.stdoutDecoder.write(chunk);
    }
    if (this.stream) {
      this.writeStdoutToStream(chunk);
    } else {
      this.pendingChunks.push({ buf: chunk, isStderr: false });
    }
  }

  /** Forward a stderr chunk. Updates inline copy + truncation flag. */
  appendStderr(chunk: Buffer): void {
    if (this.beginFailed) return;
    this.stderrBytes += chunk.byteLength;
    if (this.stderrInline.length < SHELL_INLINE_STDERR_MAX) {
      const room = SHELL_INLINE_STDERR_MAX - this.stderrInline.length;
      const decoded = this.stderrDecoder.write(chunk).slice(0, room);
      this.stderrInline += decoded;
      if (this.stderrInline.length >= SHELL_INLINE_STDERR_MAX) {
        this.stderrTruncated = true;
      }
    } else {
      this.stderrDecoder.write(chunk);
    }
    if (this.stream) {
      this.writeStderrToStream(chunk);
    } else {
      this.pendingChunks.push({ buf: chunk, isStderr: true });
    }
  }

  private writeStdoutToStream(chunk: Buffer): void {
    if (!this.stream) return;
    this.stream.appendChunk(chunk);
  }

  private writeStderrToStream(chunk: Buffer): void {
    if (!this.stream) return;
    // stderr is written to the SAME artifact, after stdout, delimited so a
    // reader can split them. The delimiter is a stable marker the viewer can
    // recognize; it is NOT part of stdout. Only inserted once, at the first
    // stderr write, and only when stdout actually produced bytes.
    if (!this.stderrHeaderWritten && this.stream.getBytesWritten() > 0) {
      this.stream.appendChunk(Buffer.from("\n\n--- stderr ---\n", "utf-8"));
      this.stderrHeaderWritten = true;
    }
    this.stream.appendChunk(chunk);
  }

  /** True when the artifact cap was reached (further chunks dropped). */
  isStreamFull(): boolean {
    return this.stream?.isFull() ?? false;
  }

  /** The inline stdout preview (bounded). */
  getInlineStdout(): string {
    return this.stdoutInline;
  }

  /** The inline stderr preview (bounded). */
  getInlineStderr(): string {
    return this.stderrInline;
  }

  getStdoutTruncated(): boolean {
    return this.stdoutTruncated || this.isStreamFull();
  }

  getStderrTruncated(): boolean {
    return this.stderrTruncated;
  }

  /**
   * Flush, promote the staging file, commit the artifact row, settle quota,
   * and return the reference the shell result carries. Awaits the background
   * claim first so the close handler never races an in-flight `begin()`. On
   * any failure the artifact is marked failed and `null` is returned (the
   * caller keeps the inline preview, never an unbounded body).
   */
  async finalize(): Promise<ShellToolResultRef | null> {
    await this.awaitBegin();
    if (
      this.beginFailed ||
      !this.stream ||
      !this.outputId ||
      !this.leaseFence ||
      !this.reservationId
    ) {
      return null;
    }
    try {
      const totalStreamBytes = this.stream.getBytesWritten();
      const stored = await this.stream.finalize(totalStreamBytes);
      const committed = await this.module.commitOutput({
        outputId: this.outputId,
        leaseFence: this.leaseFence,
        storageKey: stored.storageKey,
        capturedBytes: stored.capturedBytes,
        originalBytes: stored.originalBytes,
        sha256: stored.sha256,
        preservation: stored.preservation,
        sourceCompleteness: "complete",
        receiptJson: "{}",
      });
      if (!committed) {
        await this.module.markOutputFailed(
          this.outputId,
          "OUTPUT_PUBLICATION_FAILED"
        );
        await this.settleReservationSafe(0);
        return null;
      }
      await this.settleReservationSafe(stored.capturedBytes);
      return {
        output_id: this.outputId,
        captured_bytes: stored.capturedBytes,
        original_bytes: stored.originalBytes,
        preservation: stored.preservation,
        stdout_truncated: this.getStdoutTruncated(),
        stderr_truncated: this.getStderrTruncated(),
        preview: this.stdoutInline.slice(0, SHELL_PREVIEW_MAX_BYTES),
      };
    } catch {
      // stream.finalize throws if aborted (kill path) or already finalized.
      await this.module
        .markOutputFailed(this.outputId, "OUTPUT_WRITE_FAILED")
        .catch(() => undefined);
      await this.settleReservationSafe(0);
      return null;
    }
  }

  /** Discard the staging file + mark failed (spawn error / abort path). */
  async abort(): Promise<void> {
    await this.awaitBegin();
    if (this.stream) {
      await this.stream.abort().catch(() => undefined);
    }
    if (this.outputId) {
      await this.module
        .markOutputFailed(this.outputId, "OUTPUT_WRITE_FAILED")
        .catch(() => undefined);
    }
    await this.settleReservationSafe(0);
  }

  private async settleReservationSafe(usedBytes: number): Promise<void> {
    if (!this.reservationId) return;
    try {
      await this.module.settleReservation(this.reservationId, usedBytes);
    } catch {
      // Best-effort: a settlement failure must not mask the original result.
    }
  }

  private async releaseReservationSafe(): Promise<void> {
    await this.settleReservationSafe(0);
  }
}

/**
 * Synchronously attach capture listeners to a spawned child and kick off the
 * async claim. Returns the capture handle (or null when capture is disabled
 * or no conversationId is available). The caller MUST call `finalize()` on
 * close or `abort()` on a spawn error; on foreground→background handoff,
 * call `detach(child)` and pass the handle to the registry.
 */
export function attachShellCapture(
  child: ChildProcess,
  input: ShellCaptureBeginInput
): ShellCapture | null {
  if (!isShellCaptureEnabled()) return null;
  if (!input.conversationId) return null;
  const capture = ShellCapture.create(input);
  capture.attach(child);
  capture.startBegin();
  return capture;
}

/** Re-exported for tests so they can construct a storage rooted at tmp. */
export { TOOL_RESULT_CONFIG as SHELL_CAPTURE_LIMITS };
