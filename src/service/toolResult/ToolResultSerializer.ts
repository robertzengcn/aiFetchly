import "reflect-metadata";
import * as crypto from "node:crypto";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import type { ToolOutputFormat, ToolResultErrorCode } from "@/entityTypes/toolResultTypes";

/**
 * Single-pass, bounded, yielding serializer for a materialized tool result
 * (technical design §6.1).
 *
 * Design constraints this exists to satisfy:
 *
 *  - NEVER `JSON.stringify` a large object repeatedly to discover whether it
 *    is too large. One walk produces the bytes, the byte count, and the
 *    SHA-256 together.
 *  - NEVER invoke arbitrary producer `toJSON()` methods or getters. Only
 *    plain objects, arrays, and primitives are read; anything else is a typed
 *    serialization error rather than a surprise side effect.
 *  - NEVER grow an unbounded buffer. The sink spills to a file once the
 *    inline allowance is exceeded, and traversal yields after a bounded
 *    amount of emitted work so the main-process event loop is not stalled.
 *  - Cycles, BigInt, unsupported prototypes, and excessive depth are REJECTED
 *    with a bounded code instead of being silently coerced, so a caller can
 *    report the real reason the output was not preserved.
 *
 * The cap is a stream limit, not a parse limit: when the artifact cap is hit
 * the captured prefix is sealed as `partial` text rather than being labelled
 * valid JSON, because a truncated JSON prefix is not valid JSON.
 */

/** Where serialized bytes go. Implementations must not buffer without bound. */
export interface SerializerSink {
  /** Append a chunk. Returns false once the sink refuses further writes. */
  write(chunk: Buffer): boolean;
  /**
   * Await any in-flight asynchronous writes. Sinks that write synchronously
   * omit this. The emitter calls it at every yield point so a queued write is
   * never still pending when the payload is renamed into place.
   */
  drain?(): Promise<void>;
  /** Bytes accepted so far. */
  bytesWritten(): number;
  /** True when the sink stopped accepting bytes (cap reached). */
  saturated(): boolean;
}

/** In-memory sink, used while output still fits the inline allowance. */
export class MemorySerializerSink implements SerializerSink {
  private chunks: Buffer[] = [];
  private total = 0;
  private full = false;

  constructor(private readonly maxBytes: number) {}

  write(chunk: Buffer): boolean {
    if (this.full) return false;
    if (this.total + chunk.byteLength > this.maxBytes) {
      this.full = true;
      return false;
    }
    this.chunks.push(chunk);
    this.total += chunk.byteLength;
    return true;
  }

  bytesWritten(): number {
    return this.total;
  }

  saturated(): boolean {
    return this.full;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.total);
  }
}

/** A serialization failure carrying a bounded machine code. */
export class ToolResultSerializationError extends Error {
  constructor(readonly code: ToolResultErrorCode, message: string) {
    super(message);
    this.name = "ToolResultSerializationError";
  }
}

/** Outcome of one serialization run. */
export interface SerializationOutcome {
  readonly bytesWritten: number;
  readonly sha256: string;
  /** True when the artifact cap stopped the walk mid-stream. */
  readonly truncated: boolean;
  /** Node/primitive count, useful as a cheap record-count proxy. */
  readonly valueCount: number;
  /** Present when the top-level value was an array. */
  readonly recordCount?: number;
}

/**
 * Sink that streams straight to a file handle, never buffering the payload.
 *
 * Writes are SERIALIZED through a single promise chain rather than fired in
 * parallel: an unordered or still-pending write at rename time would publish a
 * corrupt artifact that passed its byte counter, which is precisely the
 * "present unreadable output as complete" failure the design forbids.
 */
export class FileSerializerSink implements SerializerSink {
  private total = 0;
  private full = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly writeChunk: (chunk: Buffer) => Promise<void>,
    private readonly maxBytes: number
  ) {}

  write(chunk: Buffer): boolean {
    if (this.full) return false;
    if (this.total + chunk.byteLength > this.maxBytes) {
      this.full = true;
      return false;
    }
    this.total += chunk.byteLength;
    // A rejection here must not become an unhandled rejection when the walk
    // aborts before the next flush; drain() rethrows it for the caller.
    this.pending = this.pending.then(() => this.writeChunk(chunk));
    this.pending.catch(() => undefined);
    return true;
  }

  async drain(): Promise<void> {
    await this.pending;
  }

  bytesWritten(): number {
    return this.total;
  }

  saturated(): boolean {
    return this.full;
  }
}

/** Internal buffered emitter: batches small writes into fewer syscalls. */
class BufferedEmitter {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private hash = crypto.createHash("sha256");
  private total = 0;
  private stopped = false;

  constructor(
    private readonly sink: SerializerSink,
    private readonly maxDepth: number,
    private readonly yieldBytes: number,
    private readonly yieldMs: number,
    private readonly onYield?: () => void | Promise<void>
  ) {}

  get totalBytes(): number {
    return this.total;
  }

  get stoppedEarly(): boolean {
    return this.stopped;
  }

  digest(): string {
    return this.hash.copy().digest("hex");
  }

  async emit(text: string): Promise<void> {
    if (this.stopped) return;
    const buf = Buffer.from(text, "utf8");
    if (!this.sink.write(buf)) {
      this.stopped = true;
      await this.flush();
      return;
    }
    this.hash.update(buf);
    this.total += buf.byteLength;
    this.pending.push(buf);
    this.pendingBytes += buf.byteLength;
    if (this.pendingBytes >= this.yieldBytes) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.pending.length > 0) {
      if (this.onYield && this.pendingBytes >= this.yieldBytes) {
        // Cooperative yield so a multi-MiB walk does not monopolize the
        // main-process event loop (NFR-05).
        await this.onYield();
      }
    }
    // ALWAYS drain the sink, including on the final flush: a queued file write
    // that is still pending at rename time would publish a truncated artifact
    // whose byte counter already looked correct.
    await this.sink.drain?.();
    this.pending = [];
    this.pendingBytes = 0;
  }
}

/** Tracks object identity on the current path to detect cycles. */
class CycleGuard {
  private readonly stack = new Set<object>();

  enter(node: object): boolean {
    if (this.stack.has(node)) return false;
    this.stack.add(node);
    return true;
  }

  exit(node: object): void {
    this.stack.delete(node);
  }
}

/**
 * Serialize a JSON-compatible value, yielding periodically.
 *
 * `undefined` object properties are OMITTED (standard JSON semantics); an
 * `undefined` ARRAY element becomes `null`, which is what `JSON.stringify`
 * does and what keeps array shape stable for consumers.
 */
export async function serializeValue(
  value: unknown,
  sink: SerializerSink,
  options: {
    readonly format: ToolOutputFormat;
    readonly onYield?: () => void | Promise<void>;
    readonly maxDepth?: number;
    readonly yieldBytes?: number;
    readonly yieldMs?: number;
  }
): Promise<SerializationOutcome> {
  const config = TOOL_RESULT_CONFIG;
  const emitter = new BufferedEmitter(
    sink,
    options.maxDepth ?? config.maxJsonDepth,
    options.yieldBytes ?? config.serializerYieldBytes,
    options.yieldMs ?? config.serializerYieldMs,
    options.onYield
  );
  const guard = new CycleGuard();
  let valueCount = 0;
  const topLevelIsArray = Array.isArray(value);

  const writeString = (raw: string): string => JSON.stringify(raw);

  const walk = async (node: unknown, depth: number): Promise<void> => {
    if (emitter.stoppedEarly) return;
    valueCount += 1;
    if (depth > (options.maxDepth ?? config.maxJsonDepth)) {
      throw new ToolResultSerializationError(
        "OUTPUT_SERIALIZATION_FAILED",
        `nesting deeper than ${options.maxDepth ?? config.maxJsonDepth}`
      );
    }
    if (node === null) {
      await emitter.emit("null");
      return;
    }
    switch (typeof node) {
      case "string":
        await emitter.emit(writeString(node));
        return;
      case "boolean":
        await emitter.emit(node ? "true" : "false");
        return;
      case "number":
        if (!Number.isFinite(node)) {
          throw new ToolResultSerializationError(
            "OUTPUT_SERIALIZATION_FAILED",
            "non-finite number"
          );
        }
        await emitter.emit(String(node));
        return;
      case "bigint":
        throw new ToolResultSerializationError(
          "OUTPUT_SERIALIZATION_FAILED",
          "bigint is not representable in JSON"
        );
      case "function":
      case "symbol":
        throw new ToolResultSerializationError(
          "OUTPUT_SERIALIZATION_FAILED",
          `${typeof node} is not representable in JSON`
        );
      case "undefined":
        await emitter.emit("null");
        return;
      default:
        break;
    }

    const obj = node as object;
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null && !Array.isArray(obj)) {
      throw new ToolResultSerializationError(
        "OUTPUT_SERIALIZATION_FAILED",
        "unsupported object prototype"
      );
    }
    if (!guard.enter(obj)) {
      throw new ToolResultSerializationError(
        "OUTPUT_SERIALIZATION_FAILED",
        "circular reference"
      );
    }
    try {
      if (Array.isArray(obj)) {
        await emitter.emit("[");
        for (let i = 0; i < obj.length; i += 1) {
          if (i > 0) await emitter.emit(",");
          if (emitter.stoppedEarly) break;
          await walk(obj[i], depth + 1);
        }
        await emitter.emit("]");
        return;
      }
      const keys = Object.keys(obj as Record<string, unknown>);
      await emitter.emit("{");
      let written = 0;
      for (const key of keys) {
        // Inspect the property descriptor BEFORE reading the value: reading
        // first would invoke a producer getter, which is exactly the arbitrary
        // side effect this walker must never trigger.
        const descriptor = Object.getOwnPropertyDescriptor(obj, key);
        if (descriptor && !("value" in descriptor)) {
          throw new ToolResultSerializationError(
            "OUTPUT_SERIALIZATION_FAILED",
            "accessor properties are not serialized"
          );
        }
        const value = descriptor ? descriptor.value : (obj as Record<string, unknown>)[key];
        // JSON.stringify omits undefined-valued properties; match that.
        if (value === undefined) continue;
        if (written > 0) await emitter.emit(",");
        await emitter.emit(`${writeString(key)}:`);
        await walk(value, depth + 1);
        written += 1;
        if (emitter.stoppedEarly) break;
      }
      await emitter.emit("}");
    } finally {
      guard.exit(obj);
    }
  };

  await walk(value, 0);
  await emitter.flush();

  return {
    bytesWritten: emitter.totalBytes,
    sha256: emitter.digest(),
    truncated: emitter.stoppedEarly,
    valueCount,
    recordCount: topLevelIsArray
      ? Array.isArray(value)
        ? value.length
        : undefined
      : undefined,
  };
}
