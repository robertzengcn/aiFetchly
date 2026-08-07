/**
 * UrlExtractionCollector
 *
 * Encapsulates the "gather per-URL extraction results and settle the promise"
 * logic for the AI `extract_contact_info` tool flow. Extracted from
 * contactExtraction-ipc.ts so the settlement semantics — especially the
 * timeout behavior — are unit-testable without spawning the worker process.
 *
 * Why this exists (root cause fix):
 *   The worker processes URLs sequentially through Puppeteer, so a multi-URL
 *   batch (>= ASYNC_URL_THRESHOLD = 8) can legitimately run longer than the
 *   5-minute ceiling. Previously the deadline REJECTED the promise, throwing
 *   away every result the worker had already collected and surfacing an opaque
 *   `Contact extraction timed out after 5 minutes` error to the model.
 *   Now, when the deadline fires with a PARTIAL set of results, the collector
 *   RESOLVES with what it has (timedOut: true). Only a zero-result deadline
 *   rejects.
 */

/** A single URL's extraction outcome (no DB write — AI tool flow). */
export interface UrlContactExtractionResult {
  url: string;
  success: boolean;
  data?: {
    emails?: string[];
    phones?: string[];
    address?: string | null;
    socialLinks?: string[] | null;
  };
  error?: string;
}

/**
 * Final outcome of an `extractContactFromUrls` call.
 *
 * `timedOut: true` means the deadline fired before every URL reported — the
 * caller should treat `results` as a partial set and surface that to the model
 * rather than as a hard failure. `expectedTotal` is the number of URLs the
 * caller asked for; `results.length` is how many actually completed.
 */
export interface UrlContactExtractionOutcome {
  results: UrlContactExtractionResult[];
  expectedTotal: number;
  timedOut: boolean;
}

export interface UrlExtractionCollectorOptions {
  /** Number of URLs we expect a result for. */
  readonly total: number;
  /** Deadline in milliseconds. */
  readonly timeoutMs: number;
  /**
   * Optional side-effect callback invoked after each result is added. The IPC
   * layer uses this to forward progress events and register partial snapshots
   * (the sync-path timeout recovery reads the snapshot if the outer 240s
   * ceiling fires before this collector settles). `accumulated` is a defensive
   * copy of every result collected so far. Kept out of the collector's core
   * settlement logic so that logic stays dependency-free and unit-testable.
   */
  readonly onResult?: (
    result: UrlContactExtractionResult,
    accumulated: UrlContactExtractionResult[],
    collected: number,
    expected: number
  ) => void;
}

export class UrlExtractionCollector {
  private readonly results: UrlContactExtractionResult[] = [];
  private readonly timeoutId: ReturnType<typeof setTimeout>;
  private settled = false;

  // Assigned synchronously inside the Promise executor below. Declared with
  // definite assignment (`!`) because TS cannot see through the executor
  // closure, and non-readonly because the assignment lives in that closure.
  private resolveRef!: (outcome: UrlContactExtractionOutcome) => void;
  private rejectRef!: (error: Error) => void;

  /** Promise that settles when all results arrive, the deadline fires, or the worker is unavailable. */
  readonly promise: Promise<UrlContactExtractionOutcome>;

  constructor(private readonly opts: UrlExtractionCollectorOptions) {
    this.promise = new Promise<UrlContactExtractionOutcome>(
      (resolve, reject) => {
        this.resolveRef = resolve;
        this.rejectRef = reject;
      }
    );
    this.timeoutId = setTimeout(() => this.handleTimeout(), opts.timeoutMs);
  }

  /**
   * Record a per-URL result. Returns true when this result completes the batch
   * (i.e. the promise has settled as resolved). Late results after settlement
   * are ignored and return false.
   */
  addResult(result: UrlContactExtractionResult): boolean {
    if (this.settled) {
      return false;
    }
    this.results.push(result);
    this.opts.onResult?.(
      result,
      [...this.results],
      this.results.length,
      this.opts.total
    );

    if (this.results.length >= this.opts.total) {
      this.resolve({
        results: [...this.results],
        expectedTotal: this.opts.total,
        timedOut: false,
      });
      return true;
    }
    return false;
  }

  /**
   * Reject the promise (used when the worker is unavailable). No-op after
   * settlement.
   */
  rejectWithError(error: Error): void {
    this.reject(error);
  }

  /** Clear the deadline timer without settling. Used during cleanup. */
  dispose(): void {
    if (this.settled) {
      return;
    }
    clearTimeout(this.timeoutId);
  }

  private handleTimeout(): void {
    if (this.settled) {
      return;
    }
    // Root-cause fix: keep partial results instead of discarding them.
    if (this.results.length > 0) {
      this.resolve({
        results: [...this.results],
        expectedTotal: this.opts.total,
        timedOut: true,
      });
    } else {
      this.reject(
        new Error(
          `Contact extraction timed out after ${Math.round(
            this.opts.timeoutMs / 60_000
          )} minutes`
        )
      );
    }
  }

  private resolve(outcome: UrlContactExtractionOutcome): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    clearTimeout(this.timeoutId);
    this.resolveRef(outcome);
  }

  private reject(error: Error): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    clearTimeout(this.timeoutId);
    this.rejectRef(error);
  }
}
