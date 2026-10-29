import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  TOOL_RESULT_CONFIG,
  TOOL_RESULT_POLICY_VERSION,
} from "@/config/toolResultConfig";
import type {
  ToolOutputFormat,
  ToolResultErrorCode,
} from "@/entityTypes/toolResultTypes";
import {
  FileSerializerSink,
  MemorySerializerSink,
  ToolResultSerializationError,
  serializeValue,
  type SerializationOutcome,
} from "@/service/toolResult/ToolResultSerializer";
import {
  MANIFEST_FILE_NAME,
  artifactDirectory,
  mediaTypeFor,
  pathSegmentFor,
  payloadFileName,
  storageKeyFor,
} from "@/service/toolResult/ToolResultPaths";

/**
 * Bounded, atomic, checksummed artifact storage (technical design §5.3).
 *
 * PUBLICATION PROTOCOL (deliberately tolerant of the filesystem/SQLite split —
 * they are NOT one atomic transaction):
 *
 *   1. write a TEMPORARY payload while computing byte count + SHA-256 once,
 *   2. write a bounded manifest,
 *   3. flush + fsync, and fsync the containing directory where supported,
 *   4. promote by ATOMIC RENAME within the same filesystem,
 *   5. the caller commits the registry row with the expected epoch + fence.
 *
 * A crash between (4) and (5) leaves a promoted file with a pending registry
 * row; startup reconciliation completes or quarantines it. A crash before (4)
 * leaves only a temp file, which is reclaimed after the grace period. Neither
 * case can present unreadable output as complete, because the registry — not
 * the file — is authoritative.
 *
 * The service performs NO database access; `ToolResultModule` owns all rows.
 */

/** Bounded manifest metadata written next to the payload. */
export interface ToolOutputManifest {
  readonly schemaVersion: 1;
  readonly policyVersion: string;
  readonly outputId: string;
  readonly format: ToolOutputFormat;
  readonly mediaType: string;
  readonly capturedBytes: number;
  readonly originalBytes?: number;
  readonly sha256: string;
  readonly preservation: "complete" | "partial";
  readonly sourceCompleteness: string;
  readonly writtenAt: string;
}

/** What a completed capture produced. */
export interface StoredArtifact {
  readonly outputId: string;
  readonly storageKey: string;
  readonly absolutePath: string;
  readonly capturedBytes: number;
  readonly originalBytes?: number;
  readonly sha256: string;
  readonly preservation: "complete" | "partial";
  readonly recordCount?: number;
  readonly format: ToolOutputFormat;
  readonly mediaType: string;
  /** Populated when the walk stopped early. */
  readonly failureCode?: ToolResultErrorCode;
}

/** Failure with a bounded machine code (never a raw path or payload). */
export class ToolResultStorageError extends Error {
  constructor(readonly code: ToolResultErrorCode, message: string) {
    super(message);
    this.name = "ToolResultStorageError";
  }
}

/** Injectable environment so tests never touch the real user directory. */
export interface ToolResultStorageEnvironment {
  /** App-managed root. All artifact paths are resolved beneath it. */
  readonly root: string;
  /** Cooperative yield hook invoked during long serializations. */
  readonly onYield?: () => void | Promise<void>;
}

export class ToolResultStorageService {
  private readonly root: string;
  private readonly onYield?: () => void | Promise<void>;

  constructor(env: ToolResultStorageEnvironment) {
    this.root = path.resolve(env.root);
    this.onYield = env.onYield;
  }

  /** The managed root. Exposed for tests; never sent to the model or UI. */
  getRoot(): string {
    return this.root;
  }

  /**
   * Capture a materialized value into an artifact.
   *
   * The value is walked exactly once. Small results are retained in memory so
   * the caller can inline them; anything larger streams straight to disk
   * without ever materializing the whole serialization.
   */
  async captureJson(input: {
    outputId: string;
    profileId: string;
    outputEpoch: string;
    value: unknown;
    format?: ToolOutputFormat;
    sourceCompleteness: string;
    originalBytes?: number;
  }): Promise<StoredArtifact> {
    const config = TOOL_RESULT_CONFIG;
    const format = input.format ?? "json";
    const inlineSink = new MemorySerializerSink(config.inlineMaxBytes);

    let outcome: SerializationOutcome;
    let inlineBuffer: Buffer | null = null;

    try {
      outcome = await serializeValue(input.value, inlineSink, {
        format,
        onYield: this.onYield,
      });
    } catch (error: unknown) {
      if (error instanceof ToolResultSerializationError) {
        // The operation outcome is preserved by the caller; all we report is
        // that the bytes were not serializable. A diagnostic prefix is still
        // captured when one can be produced safely (see captureText below).
        throw new ToolResultStorageError(error.code, error.message);
      }
      throw new ToolResultStorageError(
        "OUTPUT_SERIALIZATION_FAILED",
        error instanceof Error ? error.message : "unknown serialization failure"
      );
    }

    if (!inlineSink.saturated()) {
      inlineBuffer = inlineSink.toBuffer();
    } else {
      // The in-memory sink filled up, which means the payload is genuinely
      // large. Re-walk it streaming to disk. This is a second pass over the
      // source object, but the source is already materialized by the producer
      // in every supported path, so this bounds ADDITIONAL memory rather than
      // the producer's own object graph.
      return await this.streamToArtifact(input, format);
    }

    // Small enough to keep in memory: still write it durably so a restart can
    // serve the reference, but reuse the bytes we already have.
    const written = await this.writeBufferToArtifact({
      outputId: input.outputId,
      profileId: input.profileId,
      outputEpoch: input.outputEpoch,
      format,
      buffer: inlineBuffer,
      sha256: outcome.sha256,
      originalBytes: input.originalBytes,
      sourceCompleteness: input.sourceCompleteness,
      recordCount: outcome.recordCount,
    });
    return written;
  }

  /** Capture a text/log stream (shell stdout, file body, plain output). */
  async captureText(input: {
    outputId: string;
    profileId: string;
    outputEpoch: string;
    text: string;
    sourceCompleteness: string;
    originalBytes?: number;
  }): Promise<StoredArtifact> {
    const buffer = Buffer.from(input.text, "utf8");
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (buffer.byteLength <= TOOL_RESULT_CONFIG.artifactMaxBytes) {
      return await this.writeBufferToArtifact({
        outputId: input.outputId,
        profileId: input.profileId,
        outputEpoch: input.outputEpoch,
        format: "text",
        buffer,
        sha256,
        originalBytes: input.originalBytes,
        sourceCompleteness: input.sourceCompleteness,
      });
    }
    // Over the artifact cap: seal the supported prefix as PARTIAL text rather
    // than pretending the whole stream was captured.
    const capped = buffer.subarray(0, TOOL_RESULT_CONFIG.artifactMaxBytes);
    const cappedHash = createHash("sha256").update(capped).digest("hex");
    const written = await this.writeBufferToArtifact({
      outputId: input.outputId,
      profileId: input.profileId,
      outputEpoch: input.outputEpoch,
      format: "text",
      buffer: capped,
      sha256: cappedHash,
      originalBytes: input.originalBytes ?? buffer.byteLength,
      sourceCompleteness: input.sourceCompleteness,
      preservation: "partial",
      failureCode: "ARTIFACT_LIMIT_REACHED",
    });
    return written;
  }

  /**
   * Begin a streaming text capture for a source whose length is unknown up
   * front (shell stdout/stderr, a tail-followed log). Returns a handle whose
   * `appendChunk` accepts Buffer chunks as they arrive; `finalize` promotes
   * the staging file into place with a manifest and returns the descriptor.
   *
   * The sink honors {@link TOOL_RESULT_CONFIG.artifactMaxBytes} as the single
   * cap: once the artifact limit is reached further chunks are dropped and
   * the capture seals as `partial` with `failureCode: ARTIFACT_LIMIT_REACHED`
   * — the same honest-completeness contract as {@link captureText}.
   *
   * A SHA-256 is computed incrementally as chunks arrive so the manifest
   * reflects exactly the bytes that were persisted, never a re-hash of the
   * promoted file (no second full read).
   */
  async captureTextStream(input: {
    outputId: string;
    profileId: string;
    outputEpoch: string;
    sourceCompleteness: string;
  }): Promise<TextStreamCapture> {
    const dir = this.artifactDir(
      input.profileId,
      input.outputEpoch,
      input.outputId
    );
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const fileName = payloadFileName("text");
    const finalPath = path.join(dir, fileName);
    const tempPath = path.join(dir, `${fileName}.staging`);
    const handle = await fs.promises.open(tempPath, "w", 0o600);
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256");
    return new TextStreamCapture(
      handle,
      tempPath,
      finalPath,
      dir,
      hash,
      TOOL_RESULT_CONFIG.artifactMaxBytes,
      async (outcome) => {
        // Promote + manifest. Reuses the same atomic-rename + fsync pattern as
        // the buffer path so durability guarantees are identical.
        const preservation: "complete" | "partial" = outcome.truncated
          ? "partial"
          : "complete";
        const manifest: ToolOutputManifest = {
          schemaVersion: 1,
          policyVersion: TOOL_RESULT_POLICY_VERSION,
          outputId: input.outputId,
          format: "text",
          mediaType: mediaTypeFor("text"),
          capturedBytes: outcome.bytesWritten,
          originalBytes: outcome.originalBytes,
          sha256: outcome.sha256,
          preservation,
          sourceCompleteness: input.sourceCompleteness,
          writtenAt: new Date().toISOString(),
        };
        await this.writeManifest(dir, manifest);
        await this.syncDirectory(dir).catch(() => undefined);
        return {
          outputId: input.outputId,
          storageKey: this.storageKey(
            input.profileId,
            input.outputEpoch,
            input.outputId,
            "text"
          ),
          absolutePath: finalPath,
          capturedBytes: outcome.bytesWritten,
          originalBytes: outcome.originalBytes,
          sha256: outcome.sha256,
          preservation,
          format: "text",
          mediaType: mediaTypeFor("text"),
          ...(outcome.truncated
            ? { failureCode: "ARTIFACT_LIMIT_REACHED" as const }
            : {}),
        };
      }
    );
  }

  /** Stream a value straight to the artifact, never buffering it whole. */
  private async streamToArtifact(
    input: {
      outputId: string;
      profileId: string;
      outputEpoch: string;
      value: unknown;
      sourceCompleteness: string;
      originalBytes?: number;
    },
    format: ToolOutputFormat
  ): Promise<StoredArtifact> {
    const config = TOOL_RESULT_CONFIG;
    const dir = this.artifactDir(input.profileId, input.outputEpoch, input.outputId);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const fileName = payloadFileName(format);
    const finalPath = path.join(dir, fileName);
    const tempPath = path.join(dir, `${fileName}.staging`);

    const handle = await fs.promises.open(tempPath, "w", 0o600);
    let outcome: SerializationOutcome;
    try {
      const sink = new FileSerializerSink(
        async (chunk) => {
          await handle.write(chunk);
        },
        config.artifactMaxBytes
      );
      outcome = await serializeValue(input.value, sink, {
        format,
        onYield: this.onYield,
      });
      // A truncated JSON prefix is NOT valid JSON, so a cap-interrupted walk
      // is reported as partial rather than as a valid json artifact.
      await handle.sync().catch(() => undefined);
    } catch (error: unknown) {
      await handle.close().catch(() => undefined);
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
      if (error instanceof ToolResultSerializationError) {
        throw new ToolResultStorageError(error.code, error.message);
      }
      // A write failure here is usually a full disk, and reporting it as a
      // serialization problem would point the user at the wrong cause.
      throw new ToolResultStorageError(
        isDiskFull(error) ? "OUTPUT_DISK_FULL" : "OUTPUT_WRITE_FAILED",
        error instanceof Error ? error.message : "capture failed"
      );
    }
    await handle.close();

    // Promote within the same directory so the rename is atomic.
    await fs.promises.rename(tempPath, finalPath);
    await this.syncDirectory(dir).catch(() => undefined);

    const manifest: ToolOutputManifest = {
      schemaVersion: 1,
      policyVersion: TOOL_RESULT_POLICY_VERSION,
      outputId: input.outputId,
      format,
      mediaType: mediaTypeFor(format),
      capturedBytes: outcome.bytesWritten,
      originalBytes: input.originalBytes,
      sha256: outcome.sha256,
      preservation: outcome.truncated ? "partial" : "complete",
      sourceCompleteness: input.sourceCompleteness,
      writtenAt: new Date().toISOString(),
    };
    await this.writeManifest(dir, manifest);

    return {
      outputId: input.outputId,
      storageKey: this.storageKey(input.profileId, input.outputEpoch, input.outputId, format),
      absolutePath: finalPath,
      capturedBytes: outcome.bytesWritten,
      originalBytes: input.originalBytes,
      sha256: outcome.sha256,
      preservation: outcome.truncated ? "partial" : "complete",
      ...(outcome.truncated ? {} : { recordCount: outcome.recordCount }),
      format,
      mediaType: mediaTypeFor(format),
      // A capped capture holds only a prefix, so the full source length would
      // be a false record count next to the "partially saved" banner.
      ...(outcome.truncated
        ? { failureCode: "ARTIFACT_LIMIT_REACHED" as const }
        : {}),
    };
  }

  /** Write a known buffer atomically with its manifest. */
  private async writeBufferToArtifact(input: {
    outputId: string;
    profileId: string;
    outputEpoch: string;
    format: ToolOutputFormat;
    buffer: Buffer;
    sha256: string;
    originalBytes?: number;
    sourceCompleteness: string;
    recordCount?: number;
    preservation?: "complete" | "partial";
    failureCode?: ToolResultErrorCode;
  }): Promise<StoredArtifact> {
    const dir = this.artifactDir(input.profileId, input.outputEpoch, input.outputId);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const fileName = payloadFileName(input.format);
    const finalPath = path.join(dir, fileName);
    const tempPath = path.join(dir, `${fileName}.staging`);

    try {
      const handle = await fs.promises.open(tempPath, "w", 0o600);
      try {
        await handle.write(input.buffer, 0, input.buffer.byteLength, 0);
        await handle.sync().catch(() => undefined);
      } finally {
        await handle.close();
      }
      await fs.promises.rename(tempPath, finalPath);
    } catch (error: unknown) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
      const code = isDiskFull(error) ? "OUTPUT_DISK_FULL" : "OUTPUT_WRITE_FAILED";
      throw new ToolResultStorageError(
        code,
        error instanceof Error ? error.message : "write failed"
      );
    }
    await this.syncDirectory(dir).catch(() => undefined);

    const preservation = input.preservation ?? "complete";
    const manifest: ToolOutputManifest = {
      schemaVersion: 1,
      policyVersion: TOOL_RESULT_POLICY_VERSION,
      outputId: input.outputId,
      format: input.format,
      mediaType: mediaTypeFor(input.format),
      capturedBytes: input.buffer.byteLength,
      originalBytes: input.originalBytes,
      sha256: input.sha256,
      preservation,
      sourceCompleteness: input.sourceCompleteness,
      writtenAt: new Date().toISOString(),
    };
    await this.writeManifest(dir, manifest);

    return {
      outputId: input.outputId,
      storageKey: this.storageKey(input.profileId, input.outputEpoch, input.outputId, input.format),
      absolutePath: finalPath,
      capturedBytes: input.buffer.byteLength,
      originalBytes: input.originalBytes,
      sha256: input.sha256,
      preservation,
      recordCount: input.recordCount,
      format: input.format,
      mediaType: mediaTypeFor(input.format),
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    };
  }

  /** Read one bounded byte window from a committed artifact. */
  async readWindow(input: {
    storageKey: string;
    startByte: number;
    maxBytes: number;
  }): Promise<{ buffer: Buffer; totalBytes: number }> {
    const { assertReadableRegularFile } = await import(
      "@/service/toolResult/ToolResultPaths"
    );
    const real = await assertReadableRegularFile(this.root, input.storageKey);
    const stat = await fs.promises.stat(real);
    const start = Math.max(0, Math.min(input.startByte, stat.size));
    const length = Math.max(0, Math.min(input.maxBytes, stat.size - start));
    const handle = await fs.promises.open(real, "r");
    try {
      const buffer = Buffer.alloc(length);
      if (length > 0) {
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        return { buffer: buffer.subarray(0, bytesRead), totalBytes: stat.size };
      }
      return { buffer, totalBytes: stat.size };
    } finally {
      await handle.close();
    }
  }

  /** Full checksum of a committed artifact, used by integrity checks/export. */
  async checksumOf(storageKey: string): Promise<string> {
    const { assertReadableRegularFile } = await import(
      "@/service/toolResult/ToolResultPaths"
    );
    const real = await assertReadableRegularFile(this.root, storageKey);
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256");
    const stream = fs.createReadStream(real);
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
    return hash.digest("hex");
  }

  /** Read the bounded manifest for an artifact directory. */
  async readManifest(
    profileId: string,
    outputEpoch: string,
    outputId: string
  ): Promise<ToolOutputManifest | null> {
    const dir = this.artifactDir(profileId, outputEpoch, outputId);
    try {
      const raw = await fs.promises.readFile(path.join(dir, MANIFEST_FILE_NAME), "utf8");
      return JSON.parse(raw) as ToolOutputManifest;
    } catch {
      return null;
    }
  }

  /** Remove one artifact directory. Idempotent. */
  async deleteArtifact(
    profileId: string,
    outputEpoch: string,
    outputId: string
  ): Promise<void> {
    const dir = this.artifactDir(profileId, outputEpoch, outputId);
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  /** Root directory holding every artifact for a profile. */
  profileRoot(profileId: string): string {
    return path.join(
      this.root,
      "tool-results",
      pathSegmentFor(profileId)
    );
  }

  private artifactDir(
    profileId: string,
    outputEpoch: string,
    outputId: string
  ): string {
    return artifactDirectory({
      root: this.root,
      profileId,
      outputEpoch,
      outputId,
    });
  }

  private storageKey(
    profileId: string,
    outputEpoch: string,
    outputId: string,
    format: ToolOutputFormat
  ): string {
    return storageKeyFor({ profileId, outputEpoch, outputId, format });
  }

  private async writeManifest(
    dir: string,
    manifest: ToolOutputManifest
  ): Promise<void> {
    const manifestPath = path.join(dir, MANIFEST_FILE_NAME);
    const tempPath = `${manifestPath}.staging`;
    await fs.promises.writeFile(tempPath, JSON.stringify(manifest), {
      mode: 0o600,
    });
    await fs.promises.rename(tempPath, manifestPath);
  }

  /** fsync the directory so the rename is durable. Best-effort per platform. */
  private async syncDirectory(dir: string): Promise<void> {
    let handle: fs.promises.FileHandle | null = null;
    try {
      handle = await fs.promises.open(dir, "r");
      await handle.sync();
    } catch {
      // Not supported on every platform/filesystem; the rename is still atomic.
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

/** Detect an ENOSPC-style failure without leaking the path. */
function isDiskFull(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ENOSPC" || code === "EDQUOT";
}

/**
 * Outcome of finalizing a streaming text capture. Mirrors the fields the
 * manifest + descriptor need, computed incrementally during the stream so
 * `finalize` never re-reads the file.
 */
export interface TextStreamOutcome {
  readonly bytesWritten: number;
  readonly originalBytes?: number;
  readonly sha256: string;
  readonly truncated: boolean;
}

/**
 * Handle for an in-progress streaming text capture (T16). The caller appends
 * chunks as they arrive from a stream source (e.g. `child.stdout`), then calls
 * `finalize()` to atomically promote the staging file into place with its
 * manifest, or `abort()` to discard it on a failure path.
 *
 * The handle serializes writes through a single promise chain (same invariant
 * as {@link FileSerializerSink}): an unordered or still-pending write at
 * promote time would publish a corrupt artifact that passed its byte counter,
 * which the design forbids. `finalize` awaits the chain before renaming.
 */
export class TextStreamCapture {
  private bytesWritten = 0;
  private full = false;
  private pending: Promise<void> = Promise.resolve();
  private finalized = false;
  private aborted = false;
  /**
   * Set when a serialized `handle.write` rejected. Once set, no further chunks
   * are accepted and `finalize` must fail without promoting: the on-disk file
   * has a hole at the failed offset, but `bytesWritten` and the incremental
   * hash already counted the failed chunk's bytes, so the digest would not
   * match the file content. Promoting would commit a wrong sha256 to the
   * registry and silently corrupt the artifact.
   */
  private writeFailed = false;

  constructor(
    private readonly handle: fs.promises.FileHandle,
    private readonly tempPath: string,
    private readonly finalPath: string,
    private readonly dir: string,
    private readonly hash: ReturnType<
      typeof import("node:crypto").createHash
    >,
    private readonly maxBytes: number,
    private readonly commit: (outcome: TextStreamOutcome) => Promise<StoredArtifact>
  ) {}

  /** Bytes accepted so far. */
  getBytesWritten(): number {
    return this.bytesWritten;
  }

  /** True once the artifact cap was reached and further chunks are dropped. */
  isFull(): boolean {
    return this.full;
  }

  /**
   * Append a chunk. Returns false once the cap is reached (subsequent chunks
   * are dropped). Writes are serialized through `this.pending`; a write
   * rejection is captured into `writeFailed` (not swallowed) so that the next
   * `appendChunk` returns false and `finalize` throws — the artifact is never
   * promoted with a sha256 that does not match the on-disk bytes.
   */
  appendChunk(chunk: Buffer): boolean {
    if (this.full || this.aborted || this.finalized || this.writeFailed) {
      return false;
    }
    let toWrite = chunk;
    if (this.bytesWritten + chunk.byteLength > this.maxBytes) {
      toWrite = chunk.subarray(0, this.maxBytes - this.bytesWritten);
      this.full = true;
    }
    if (toWrite.byteLength === 0) {
      return false;
    }
    this.bytesWritten += toWrite.byteLength;
    this.hash.update(toWrite);
    this.pending = this.pending.then(async () => {
      // Skip the write if an earlier write in the chain already failed: the
      // capture will be discarded at finalize and must not append to a
      // corrupt file out of order.
      if (this.writeFailed) return;
      await this.handle.write(toWrite, 0, toWrite.byteLength, null);
    });
    // Record a write failure into `writeFailed` and swallow the rejection.
    // `finalize` checks `writeFailed` (set here) and refuses to promote —
    // never committing a sha256 that does not match the on-disk bytes.
    // Swallowing rather than rethrowing avoids an unhandled rejection in the
    // window between the last append and the finalize await; the flag is the
    // source of truth, not the promise's rejection state.
    this.pending = this.pending.catch(() => {
      this.writeFailed = true;
    });
    return true;
  }

  /** Await any in-flight writes so the staging file is flushed to disk. */
  async flush(): Promise<void> {
    await this.pending.catch(() => undefined);
    await this.handle.sync().catch(() => undefined);
  }

  /** Discard the staging file without promoting. Idempotent. */
  async abort(): Promise<void> {
    if (this.aborted || this.finalized) return;
    this.aborted = true;
    await this.pending.catch(() => undefined);
    await this.handle.close().catch(() => undefined);
    await fs.promises.rm(this.tempPath, { force: true }).catch(() => undefined);
  }

  /**
   * Flush, close, atomically rename the staging file into place, and write the
   * manifest. Returns the durable artifact descriptor. Idempotent: a second
   * call returns the same descriptor.
   */
  async finalize(originalBytes?: number): Promise<StoredArtifact> {
    if (this.aborted) {
      // `abort()` ran first (kill path). Promoting now would race the
      // in-flight close/rename of the staging file, so refuse — the caller
      // treats this as a failed capture and keeps the inline preview.
      throw new ToolResultStorageError(
        "OUTPUT_WRITE_FAILED",
        "stream capture aborted before finalize"
      );
    }
    if (this.finalized) {
      // Re-finalize is a no-op; the caller already has the descriptor.
      throw new ToolResultStorageError(
        "OUTPUT_WRITE_FAILED",
        "stream capture already finalized"
      );
    }
    this.finalized = true;
    // Await the write chain. `appendChunk` swallows write rejections into
    // `writeFailed` (rather than rethrowing) so this await resolves cleanly
    // even when a write failed — no unhandled rejection can escape between
    // the last append and this finalize. The `writeFailed` flag is then the
    // single source of truth for whether the on-disk file is trustworthy.
    await this.pending;
    if (this.writeFailed) {
      // The on-disk file has a hole at the failed offset but the incremental
      // hash counted the failed chunk, so the digest would not match. Discard
      // the staging file and fail the capture — never commit a wrong sha256.
      await this.handle.close().catch(() => undefined);
      await fs.promises.rm(this.tempPath, { force: true }).catch(() => undefined);
      throw new ToolResultStorageError(
        "OUTPUT_WRITE_FAILED",
        "stream capture write failed; artifact not promoted"
      );
    }
    await this.handle.sync().catch(() => undefined);
    await this.handle.close().catch(() => undefined);
    const truncated = this.full;
    const outcome: TextStreamOutcome = {
      bytesWritten: this.bytesWritten,
      originalBytes: originalBytes,
      sha256: this.hash.digest("hex"),
      truncated,
    };
    // Promote within the same directory so the rename is atomic.
    await fs.promises.rename(this.tempPath, this.finalPath);
    return await this.commit(outcome);
  }
}
