/**
 * ComputerUseSupervisor — the single authoritative task loop owner
 * (design §10, PRD D-07/D-18).
 *
 * The supervisor owns the session state machine, the desktop lease, session
 * generations, serialized input dispatch, stop/revoke semantics, and the
 * safety pre-dispatch checks. Adapters are stateless with respect to
 * authority; no plugin or adapter process can authorize input. Platform
 * backends, the stop hotkey, elevation checks, and the grounding worker are
 * injected so every rule is testable without a desktop.
 */
import { randomUUID } from "crypto";
import {
  ComputerUseError,
  type ComputerUseActionAuthorizationLike,
  type ComputerUseActionOutcome,
  type ComputerUseActionRecord,
  type ComputerUseActionRequest,
  type ComputerUseDesktopAdapter,
  type ComputerUseObservation,
  type ComputerUsePlannerMode,
  type ComputerUseResolvedTarget,
  type ComputerUseSafetyController,
  type ComputerUseSessionGeneration,
  type ComputerUseSessionState,
  type ComputerUseSessionSummary,
  type ComputerUseStopController,
  type ComputerUseWindowInfo,
  type GroundingResult,
} from "@/entityTypes/computerUseTypes";
import { ComputerUseTargetStore } from "@/service/computerUse/ComputerUseTargetStore";
import { ComputerUseLeaseService } from "@/service/computerUse/ComputerUseLeaseService";
import { ComputerUseActionAuthorization } from "@/service/computerUse/ComputerUseActionAuthorization";
import { mapNormalizedToCapture } from "@/service/computerUse/ComputerUseCoordinateTransforms";

/** Default target-handle lifetime (ms): observations go stale quickly. */
export const TARGET_TTL_MS = 10_000;

export interface ComputerUseSessionConfig {
  readonly targetWindowId: string;
  readonly plannerMode: ComputerUsePlannerMode;
  readonly groundingModelRuntimeId: string | null;
}

interface SessionRecord {
  readonly sessionId: string;
  readonly config: ComputerUseSessionConfig;
  state: ComputerUseSessionState;
  generation: ComputerUseSessionGeneration;
  targetWindow: ComputerUseWindowInfo | null;
  startedAt: number;
  updatedAt: number;
  stopHotkey: string | null;
  /** Serialized dispatch chain: one action per observation cycle. */
  dispatchChain: Promise<void>;
  /** Bounded recent action records for audit/trace. */
  readonly actionLog: ComputerUseActionRecord[];
}

export interface SupervisorDeps {
  readonly adapter: ComputerUseDesktopAdapter;
  readonly lease?: ComputerUseLeaseService;
  readonly targetStore?: ComputerUseTargetStore;
  readonly authorization?: ComputerUseActionAuthorizationLike;
  /** Stop hotkey lifecycle; registered only during a session. */
  readonly stopController?: ComputerUseStopController;
  /** Pre-dispatch safety checks (own-window, elevation, focus). */
  readonly safety?: ComputerUseSafetyController;
  /** Clock override for tests. */
  readonly now?: () => number;
}

const MAX_ACTIONS_PER_SESSION = 500;

export class ComputerUseSupervisor {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly adapter: ComputerUseDesktopAdapter;
  private readonly lease: ComputerUseLeaseService;
  private readonly targetStore: ComputerUseTargetStore;
  private readonly authorization: ComputerUseActionAuthorizationLike;
  private readonly stopController: ComputerUseStopController | undefined;
  private readonly safety: ComputerUseSafetyController | undefined;
  private readonly now: () => number;

  constructor(deps: SupervisorDeps) {
    this.adapter = deps.adapter;
    this.lease = deps.lease ?? new ComputerUseLeaseService();
    this.targetStore = deps.targetStore ?? new ComputerUseTargetStore();
    this.authorization =
      deps.authorization ?? new ComputerUseActionAuthorization();
    this.stopController = deps.stopController;
    this.safety = deps.safety;
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Start a session for an identified window: acquire the desktop lease,
   * register the stop hotkey (fail-closed), attach the adapter, and reach
   * READY with a fresh observation requirement recorded by the caller.
   */
  async startSession(
    config: ComputerUseSessionConfig,
    sessionId = `cus_${randomUUID()}`
  ): Promise<ComputerUseSessionSummary> {
    const existing = [...this.sessions.values()].find(
      (session) => session.state !== "STOPPED" && session.state !== "FAILED"
    );
    if (existing) {
      throw new ComputerUseError(
        "desktop_busy",
        "A Computer Use session is already active"
      );
    }

    this.lease.acquire(sessionId, this.now());

    let hotkey: string | null = null;
    if (this.stopController) {
      hotkey = await this.stopController.register(sessionId);
      if (hotkey === null) {
        this.lease.release(sessionId);
        throw new ComputerUseError(
          "stop_hotkey_unavailable",
          "Stop hotkey could not be registered; choose another combination"
        );
      }
    }

    let targetWindow: ComputerUseWindowInfo | null = null;
    try {
      const windows = await this.adapter.listWindows();
      targetWindow =
        windows.find((w) => w.windowId === config.targetWindowId) ?? null;
      if (!targetWindow) {
        throw new ComputerUseError(
          "unsupported_target",
          "Target window is no longer available"
        );
      }
    } catch (error) {
      this.lease.release(sessionId);
      if (this.stopController) await this.stopController.unregister(sessionId);
      throw error;
    }

    const record: SessionRecord = {
      sessionId,
      config,
      state: "READY",
      generation: 1,
      targetWindow,
      startedAt: this.now(),
      updatedAt: this.now(),
      stopHotkey: hotkey,
      dispatchChain: Promise.resolve(),
      actionLog: [],
    };
    this.sessions.set(sessionId, record);
    return this.summaryOf(record);
  }

  /** Stop a session: revoke the generation and clear queued input. */
  async stopSession(sessionId: string): Promise<ComputerUseSessionSummary> {
    const record = this.getRecord(sessionId);
    record.state = "STOPPING";
    record.updatedAt = this.now();

    // Revoke first: any dispatch that starts after this point fails the
    // generation check, and late worker results are discarded.
    this.targetStore.invalidateGeneration(record.generation);
    this.authorization.invalidateGeneration(record.generation);
    const revokedGeneration = record.generation;
    record.generation = revokedGeneration + 1;

    try {
      await this.adapter.dispose?.();
    } catch {
      /* stop must complete even when the adapter misbehaves */
    }
    if (this.stopController) await this.stopController.unregister(sessionId);
    this.lease.release(sessionId);

    record.state = "STOPPED";
    record.stopHotkey = null;
    record.updatedAt = this.now();
    return this.summaryOf(record);
  }

  /** Pause automation (human input, focus change, or user request). */
  async pauseSession(
    sessionId: string,
    reason: "user_request" | "human_input" | "focus_change" | "handoff"
  ): Promise<ComputerUseSessionSummary> {
    const record = this.getRecord(sessionId);
    if (record.state !== "READY" && record.state !== "PAUSED") {
      throw new ComputerUseError(
        "session_state_invalid",
        `Cannot pause from state ${record.state}`
      );
    }
    record.state = reason === "handoff" ? "HANDOFF" : "PAUSED";
    record.updatedAt = this.now();
    return this.summaryOf(record);
  }

  /**
   * Resume from PAUSED/HANDOFF: a fresh observation is required before any
   * input, so every target of the old generation is invalidated here.
   */
  async resumeSession(sessionId: string): Promise<ComputerUseSessionSummary> {
    const record = this.getRecord(sessionId);
    if (record.state !== "PAUSED" && record.state !== "HANDOFF") {
      throw new ComputerUseError(
        "session_state_invalid",
        `Cannot resume from state ${record.state}`
      );
    }
    this.targetStore.invalidateGeneration(record.generation);
    record.generation += 1;
    record.state = "READY";
    record.updatedAt = this.now();
    return this.summaryOf(record);
  }

  /** Observation entry point: records state and returns the adapter result. */
  async observe(
    sessionId: string
  ): Promise<ComputerUseObservation> {
    const record = this.getRecord(sessionId);
    this.assertDispatchableState(record, "observe");
    record.state = "OBSERVING";
    record.updatedAt = this.now();
    try {
      const observation = await this.adapter.observe(record.config.targetWindowId);
      // The observation is bound to the CURRENT generation by the adapter
      // contract; a stale observation (target moved, display change) is the
      // adapter's responsibility to reject before returning.
      if (observation.metadata.generation !== record.generation) {
        throw new ComputerUseError(
          "target_stale",
          "Observation was captured for a different generation"
        );
      }
      record.state = "READY";
      record.updatedAt = this.now();
      return observation;
    } catch (error) {
      record.state = "PAUSED";
      record.updatedAt = this.now();
      throw error;
    }
  }

  /**
   * Register an accessibility-resolved target. Both resolution paths return
   * the same target-handle contract (CU-VISION-02).
   */
  registerAccessibilityTarget(
    sessionId: string,
    observationId: string,
    capturePoint: { x: number; y: number },
    region: { x: number; y: number; width: number; height: number }
  ): ComputerUseResolvedTarget {
    const record = this.getRecord(sessionId);
    const now = this.now();
    const handle = this.targetStore.create({
      generation: record.generation,
      observationId,
      capturePoint,
      region,
      source: "accessibility",
      expiresAt: now + TARGET_TTL_MS,
    });
    return this.targetStore.resolve(handle, record.generation, now);
  }

  /**
   * Register a host-resolved target from a grounding result: map the top
   * candidate through the recorded transform and mint a target handle.
   * Absent/ambiguous outcomes never create a handle (CU-VISION-07).
   */
  registerGroundingTarget(
    sessionId: string,
    grounding: GroundingResult
  ): ComputerUseResolvedTarget {
    const record = this.getRecord(sessionId);
    if (grounding.generation !== record.generation) {
      throw new ComputerUseError(
        "target_stale",
        "Grounding result belongs to another generation"
      );
    }
    if (grounding.outcome !== "resolved" || grounding.candidates.length === 0) {
      throw new ComputerUseError(
        grounding.outcome === "target_ambiguous"
          ? "target_ambiguous"
          : "target_not_found",
        `Grounding outcome was ${grounding.outcome}`
      );
    }
    const top = grounding.candidates[0];
    const point = mapNormalizedToCapture(grounding.transform, top.nx, top.ny);
    const now = this.now();
    const handle = this.targetStore.create({
      generation: record.generation,
      observationId: grounding.observationId,
      capturePoint: point,
      region: {
        x: point.x - ((top.regionWidthNormalized ?? 0.02) * grounding.transform.modelWidth) / 2,
        y: point.y - ((top.regionHeightNormalized ?? 0.02) * grounding.transform.modelHeight) / 2,
        width: (top.regionWidthNormalized ?? 0.02) * grounding.transform.modelWidth,
        height: (top.regionHeightNormalized ?? 0.02) * grounding.transform.modelHeight,
      },
      source: "grounding",
      grounding,
      expiresAt: now + TARGET_TTL_MS,
    });
    return this.targetStore.resolve(handle, record.generation, now);
  }

  /**
   * Dispatch one authorized action. Serialized: one action per observation
   * cycle initially (design §10.2). The dispatch chain never rejects — errors
   * are returned as ActionOutcomes so a failed action cannot break the queue.
   */
  dispatch(
    sessionId: string,
    request: ComputerUseActionRequest,
    actionClass: ComputerUseActionRecord["actionClass"]
  ): Promise<ComputerUseActionOutcome> {
    const record = this.getRecord(sessionId);
    const outcome = record.dispatchChain.then(
      () => this.dispatchNow(record, request, actionClass),
      () => this.dispatchNow(record, request, actionClass)
    );
    // Keep the chain alive even when dispatchNow returns a failed outcome.
    record.dispatchChain = outcome.then(
      () => undefined,
      () => undefined
    );
    return outcome;
  }

  private async dispatchNow(
    record: SessionRecord,
    request: ComputerUseActionRequest,
    actionClass: ComputerUseActionRecord["actionClass"]
  ): Promise<ComputerUseActionOutcome> {
    const generationAtDispatch = record.generation;
    // Host-generated action id, used for grant binding and outcome records.
    const actionId = `act_${randomUUID()}`;

    if (record.state === "STOPPED" || record.state === "STOPPING") {
      return this.outcome(actionId, generationAtDispatch, "rejected", undefined, "session_invalid");
    }
    this.assertDispatchableState(record, "dispatch");

    let target: ComputerUseResolvedTarget;
    try {
      target = this.targetStore.resolve(
        request.targetHandle,
        record.generation,
        this.now()
      );
    } catch (error) {
      return this.failedOutcome(actionId, generationAtDispatch, error);
    }

    // Grant: mint + validate immediately before the adapter call. The action
    // id is host-generated by the authorization service; the supervisor never
    // accepts a model-supplied one.
    const grant = this.authorization.mint({
      sessionId: record.sessionId,
      generation: record.generation,
      request,
      actionClass,
      observationId: target.observationId,
      actionId,
      now: this.now(),
    });

    record.state = "AWAITING_AUTHORIZATION";
    try {
      this.authorization.validate(actionId, {
        sessionId: record.sessionId,
        generation: record.generation,
        request,
      }, this.now());
    } catch (error) {
      return this.failedOutcome(actionId, generationAtDispatch, error);
    }

    // Safety pre-checks run for every dispatch, whatever the adapter or
    // skill text says (design §10.5 / decision 13).
    if (this.safety) {
      const verdict = await this.safety.preDispatchCheck({
        sessionId: record.sessionId,
        generation: record.generation,
        request,
        target,
      });
      if (!verdict.allowed) {
        this.authorization.consume(actionId);
        return this.outcome(
          actionId,
          generationAtDispatch,
          "rejected",
          undefined,
          verdict.errorCode ?? "unsupported_target"
        );
      }
    }

    record.state = "EXECUTING";
    record.updatedAt = this.now();
    let dispatchedAt = 0;
    try {
      const result = await this.adapter.dispatchInput(request, {
        sessionId: record.sessionId,
        generation: record.generation,
        actionId,
      });
      dispatchedAt = result.dispatchedAt;
    } catch (error) {
      this.authorization.consume(actionId);
      record.state = "PAUSED";
      record.updatedAt = this.now();
      return this.failedOutcome(actionId, generationAtDispatch, error);
    }

    // Late-revocation check: a stop during adapter execution must not be
    // reported as a clean success.
    if (
      record.generation !== generationAtDispatch ||
      this.isStateStoppingOrStopped(record)
    ) {
      this.authorization.consume(actionId);
      return this.outcome(actionId, generationAtDispatch, "cancelled");
    }

    this.authorization.consume(actionId);
    record.state = "VERIFYING";
    record.updatedAt = this.now();

    let verification: ComputerUseActionOutcome["verification"];
    try {
      const verified = await this.adapter.verify?.(
        request,
        record.generation
      );
      verification =
        verified === undefined
          ? undefined
          : verified
          ? { verified: true }
          : { verified: false, reason: "post-action state not observed" };
    } catch (error) {
      verification = {
        verified: false,
        reason: error instanceof Error ? error.message : "verification error",
      };
    }

    record.state = "READY";
    record.updatedAt = this.now();
    const outcome: ComputerUseActionOutcome = {
      actionId,
      generation: generationAtDispatch,
      dispatchedAt,
      outcome: verification
        ? verification.verified
          ? "succeeded"
          : "uncertain"
        : "succeeded",
      verification,
    };
    this.appendAction(record, {
      actionId,
      sessionId: record.sessionId,
      generation: generationAtDispatch,
      request,
      actionClass,
      grantIssuedAt: grant.issuedAt,
      outcome,
    });
    return outcome;
  }

  /** Current session summaries (renderer-visible shape). */
  listSessions(): ComputerUseSessionSummary[] {
    return [...this.sessions.values()].map((record) => this.summaryOf(record));
  }

  getSummary(sessionId: string): ComputerUseSessionSummary {
    return this.summaryOf(this.getRecord(sessionId));
  }

  /** Discard late worker results whose generation is stale (design §5.6). */
  isGenerationCurrent(sessionId: string, generation: number): boolean {
    const record = this.sessions.get(sessionId);
    return record !== undefined && record.generation === generation;
  }

  /** Read state through a call so concurrent transitions defeat CFA narrowing. */
  private isStateStoppingOrStopped(record: SessionRecord): boolean {
    const state: ComputerUseSessionState = record.state;
    return state === "STOPPING" || state === "STOPPED";
  }

  private assertDispatchableState(
    record: SessionRecord,
    operation: string
  ): void {
    const dispatchable: ComputerUseSessionState[] = [
      "READY",
      "OBSERVING",
      "GROUNDING",
    ];
    if (!dispatchable.includes(record.state)) {
      throw new ComputerUseError(
        "session_state_invalid",
        `Cannot ${operation} from state ${record.state}`
      );
    }
  }

  private failedOutcome(
    actionId: string,
    generation: number,
    error: unknown
  ): ComputerUseActionOutcome {
    const code =
      error instanceof ComputerUseError ? error.code : "unknown_error";
    return {
      actionId,
      generation,
      dispatchedAt: 0,
      outcome: "failed",
      errorCode: code,
    };
  }

  private outcome(
    actionId: string,
    generation: number,
    outcome: ComputerUseActionOutcome["outcome"],
    verification?: ComputerUseActionOutcome["verification"],
    errorCode?: ComputerUseActionOutcome["errorCode"]
  ): ComputerUseActionOutcome {
    return {
      actionId,
      generation,
      dispatchedAt: 0,
      outcome,
      verification,
      errorCode,
    };
  }

  private appendAction(record: SessionRecord, entry: ComputerUseActionRecord): void {
    record.actionLog.push(entry);
    if (record.actionLog.length > MAX_ACTIONS_PER_SESSION) {
      record.actionLog.shift();
    }
  }

  private summaryOf(record: SessionRecord): ComputerUseSessionSummary {
    return {
      sessionId: record.sessionId,
      state: record.state,
      generation: record.generation,
      targetWindow: record.targetWindow,
      plannerMode: record.config.plannerMode,
      groundingModelRuntimeId: record.config.groundingModelRuntimeId,
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      stopHotkey: record.stopHotkey,
    };
  }

  private getRecord(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new ComputerUseError("session_invalid", "Unknown session");
    }
    return record;
  }
}
