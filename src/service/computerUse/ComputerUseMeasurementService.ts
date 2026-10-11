/**
 * Computer Use measurement harness (design §10.5.5, CU-SESSION-13).
 *
 * Records the PRD §8 provisional-target metrics with one monotonic clock:
 * stop acknowledgment, last input after stop, stop completion, observation
 * latency, warm grounding latency, and worker cold start. Percentiles are
 * computed over recorded samples; the hard gate ("no input after stop
 * acknowledgment") is asserted by comparing dispatch timestamps with the
 * revocation timestamp, both captured through this service.
 */
import type {
  ComputerUseMeasurement,
  ComputerUseMetricName,
} from "@/entityTypes/computerUseTypes";

/** Clock seam; must be monotonic within a session's lifetime. */
export type MonotonicClock = () => number;

export interface MeasurementSample {
  readonly metric: ComputerUseMetricName;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly sessionId: string;
}

export class ComputerUseMeasurementService {
  private readonly clock: MonotonicClock;
  private readonly samples = new Map<ComputerUseMetricName, MeasurementSample[]>();
  /** Revocation timestamps per session (stop-ack anchor). */
  private readonly stopAcknowledgedAt = new Map<string, number>();
  /** Last dispatch timestamp per session. */
  private readonly lastDispatchAt = new Map<string, number>();

  constructor(clock: MonotonicClock = () => Date.now()) {
    this.clock = clock;
  }

  /** Begin a timed measurement; call `.end()` on the returned handle. */
  begin(metric: ComputerUseMetricName, sessionId: string): { end: () => number } {
    const startedAt = this.clock();
    let ended = false;
    return {
      end: () => {
        if (ended) return -1;
        ended = true;
        const endedAt = this.clock();
        const sample: MeasurementSample = {
          metric,
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          sessionId,
        };
        this.recordSample(sample);
        return sample.durationMs;
      },
    };
  }

  /** Record a span whose endpoints were captured elsewhere. */
  recordSpan(
    metric: ComputerUseMetricName,
    sessionId: string,
    startedAt: number,
    endedAt: number
  ): void {
    this.recordSample({
      metric,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      sessionId,
    });
  }

  /** Anchor: the stop was acknowledged (generation revoked) at `at`. */
  markStopAcknowledged(sessionId: string, at: number = this.clock()): void {
    this.stopAcknowledgedAt.set(sessionId, at);
  }

  /** Anchor: input was dispatched at `at` (adapter-reported monotonic ts). */
  markDispatch(sessionId: string, at: number = this.clock()): void {
    const previous = this.lastDispatchAt.get(sessionId);
    if (previous === undefined || at > previous) {
      this.lastDispatchAt.set(sessionId, at);
    }
  }

  /**
   * The PRD hard gate: no input dispatched after stop acknowledgment.
   * Violations are surfaced with the delta for the run report.
   */
  stopGateViolations(sessionId: string): Array<{ dispatchedAfterMs: number }> {
    const acknowledged = this.stopAcknowledgedAt.get(sessionId);
    if (acknowledged === undefined) return [];
    const last = this.lastDispatchAt.get(sessionId);
    if (last === undefined || last <= acknowledged) return [];
    return [{ dispatchedAfterMs: last - acknowledged }];
  }

  /** Percentile helper (nearest-rank). */
  static percentile(values: readonly number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.min(
      sorted.length,
      Math.max(1, Math.ceil((p / 100) * sorted.length))
    );
    return sorted[rank - 1];
  }

  /** Aggregated snapshot: p50/p95/max per metric. */
  snapshot(): Record<
    ComputerUseMetricName,
    { count: number; p50: number | null; p95: number | null; max: number | null }
  > {
    const out = {} as Record<
      ComputerUseMetricName,
      { count: number; p50: number | null; p95: number | null; max: number | null }
    >;
    for (const [metric, samples] of this.samples) {
      const durations = samples.map((s) => s.durationMs);
      out[metric] = {
        count: samples.length,
        p50: ComputerUseMeasurementService.percentile(durations, 50),
        p95: ComputerUseMeasurementService.percentile(durations, 95),
        max: durations.length ? Math.max(...durations) : null,
      };
    }
    return out;
  }

  /** Measurements in the renderer-safe record shape (no paths/secrets). */
  listMeasurements(): ComputerUseMeasurement[] {
    const out: ComputerUseMeasurement[] = [];
    for (const samples of this.samples.values()) {
      for (const sample of samples) {
        out.push({
          metric: sample.metric,
          sessionId: sample.sessionId,
          startedAt: sample.startedAt,
          endedAt: sample.endedAt,
          durationMs: sample.durationMs,
        });
      }
    }
    return out;
  }

  reset(): void {
    this.samples.clear();
    this.stopAcknowledgedAt.clear();
    this.lastDispatchAt.clear();
  }

  private recordSample(sample: SampleInput): void {
    const list = this.samples.get(sample.metric) ?? [];
    list.push(sample);
    this.samples.set(sample.metric, list);
  }
}

interface SampleInput {
  readonly metric: ComputerUseMetricName;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly sessionId: string;
}
