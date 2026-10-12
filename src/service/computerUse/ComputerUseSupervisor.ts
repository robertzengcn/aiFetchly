/**
 * ComputerUseSupervisor — the single authoritative task loop owner
 * (design §10, PRD D-07/D-18).
 *
 * The supervisor owns the session state machine, the desktop lease, session
 * generations, serialized input dispatch, stop/revoke semantics, and the
 * safety pre-dispatch checks. Adapters are stateless with respect to
 * authority; no plugin or adapter process can authorize input.
 *
 * Audit fixes (docs/prd/computer-use-aifetchly-audit-todo-2026-10-12.md):
 *  A01 dispatch revalidates generation/state after EVERY await boundary;
 *  A02 stop is terminal per generation — late continuations cannot revive a
 *     stopped session, and pause accepts active work;
 *  A03 consequential/confirmation-required classes need a current-task
 *     approval from the host-owned ComputerUseTaskAuthority;
 *  A04 handles are session/observation-bound, points must match the host
 *     target, and each observation serves at most one dispatch;
 *  A05 safety + stop hotkey are mandatory; a pre-start safety gate runs
 *     before the lease is kept;
 *  A06 stop cleanup is deadline-bounded and failure-tolerant;
 *  A08 absent verification reports uncertain, every branch restores state,
 *     and every attempt is appended to the action log.
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
import {
  ComputerUseActionAuthorization,
  hashActionRequest,
} from "@/service/computerUse/ComputerUseActionAuthorization";
import {
  ComputerUseTaskAuthority,
  type TaskApprovalRequest,
} from "@/service/computerUse/ComputerUseTaskAuthority";
import { mapNormalizedToCapture } from "@/service/computerUse/ComputerUseCoordinateTransforms";

/** Default target-handle lifetime (ms): observations go stale quickly. */
export const TARGET_TTL_MS = 10_000;

/** Deadline for adapter disposal during stop (audit A06: bounded cleanup). */
export const STOP_DISPOSE_TIMEOUT_MS = 2_000;

/** Tolerance (px) between a request point and the host-resolved target. */
const TARGET_POINT_TOLERANCE_PX = 1.0;

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
  /** Observation currency (audit A04): only the latest observation resolves. */
  currentObservationId: string | null;
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
  readonly stopController: ComputerUseStopController;
  /** Pre-dispatch safety checks (own-window, elevation, focus). Mandatory. */
  readonly safety: ComputerUseSafetyController;
  /** Current-task approval registry (audit A03). Defaults to a fresh one. */
  readonly taskAuthority?: ComputerUseTaskAuthority;
  /**
   * Tests construct supervisors without release-critical controls; the
   * production composition root must not set this flag (audit A05).
   */
  readonly allowWithoutSafetyControls?: boolean;
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
  private readonly stopController: ComputerUseStopController;
  private readonly safety: ComputerUseSafetyController;
  private readonly taskAuthority: ComputerUseTaskAuthority;
  private readonly now: () => number;

  constructor(deps: SupervisorDeps) {
    if (!deps.allowWithoutSafetyControls && (!deps.safety || !deps.stopController)) {
      throw new ComputerUseError(
        "session_state_invalid",
        "Computer Use requires safety controls and a stop hotkey controller in production"
      );
    }
    this.adapter = deps.adapter;
    this.lease = deps.lease ?? new ComputerUseLeaseService();
    this.targetStore = deps.targetStore ?? new ComputerUseTargetStore();
    this.authorization =
      deps.authorization ?? new ComputerUseActionAuthorization();
    this.stopController = deps.stopController;
    this.safety = deps.safety;
    this.taskAuthority =
      deps.taskAuthority ?? new ComputerUseTaskAuthority();
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Start a session for an identified window: run the pre-start safety gate
   * (host elevation, own-window target — audit A05), acquire the desktop
   * lease, register the stop hotkey (fail-closed), and reach READY.
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

    const windows = await this.adapter.listWindows();
    const targetWindow =
      windows.find((w) => w.windowId === config.targetWindowId) ?? null;
    if (!targetWindow) {
      throw new ComputerUseError(
        "unsupported_target",
        "Target window is no longer available"
      );
    }

    // Pre-start safety gate runs BEFORE the lease is kept so a rejection
    // cannot leak ownership (audit A05).
    const startVerdict = await this.safety
      .preStartCheck(targetWindow)
      .catch((error: unknown) => ({
        allowed: false as const,
        errorCode: "unknown_error" as const,
        reason: error instanceof Error ? error.message : String(error),
      }));
    if (!startVerdict.allowed) {
      throw new ComputerUseError(
        startVerdict.errorCode ?? "unsupported_target",
        startVerdict.reason ?? "Session start was refused by safety controls"
      );
    }

    this.lease.acquire(sessionId, this.now());

    let hotkey: string | null = null;
    try {
      hotkey = await this.stopController.register(sessionId);
    } catch (error) {
      // register() throwing (not just returning null) must not leak the
      // lease (audit A06).
      this.lease.release(sessionId);
      throw error;
    }
    if (hotkey === null) {
      this.lease.release(sessionId);
      throw new ComputerUseError(
        "stop_hotkey_unavailable",
        "Stop hotkey could not be registered; choose another combination"
      );
    }

    const record: SessionRecord = {
      sessionId,
      config,
      state: "READY",
      generation: 1,
      targetWindow,
      currentObservationId: null,
      startedAt: this.now(),
      updatedAt: this.now(),
      stopHotkey: hotkey,
      dispatchChain: Promise.resolve(),
      actionLog: [],
    };
    this.sessions.set(sessionId, record);
    return this.summaryOf(record);
  }

  /**
   * Stop a session: revoke the generation and clear queued input. Stop is
   * terminal for the revoked generation — no late continuation can revive
   * the session (audit A02). Cleanup is deadline-bounded (audit A06).
   */
  async stopSession(sessionId: string): Promise<ComputerUseSessionSummary> {
    const record = this.getRecord(sessionId);
    const revokedGeneration = record.generation;
    record.state = "STOPPING";
    record.updatedAt = this.now();

    // Revoke first: any dispatch that starts after this point fails the
    // generation check, and late worker results are discarded.
    this.targetStore.invalidateGeneration(revokedGeneration);
    this.authorization.invalidateGeneration(revokedGeneration);
    this.taskAuthority.invalidateGeneration(sessionId, revokedGeneration);
    record.generation = revokedGeneration + 1;
    record.currentObservationId = null;

    try {
      // Bounded disposal: a hung adapter cannot stall stop past the budget
      // (audit A06); the process-tree escalation is the adapter's owner.
      await this.raceDeadline(
        this.adapter.dispose?.() ?? Promise.resolve(),
        STOP_DISPOSE_TIMEOUT_MS
      );
    } catch {
      /* stop must complete even when the adapter misbehaves */
    }
    try {
      await this.stopController.unregister(sessionId);
    } catch {
      /* hotkey unregister failure must not block lease release */
    }
    this.lease.release(sessionId);

    record.state = "STOPPED";
    record.stopHotkey = null;
    record.updatedAt = this.now();
    return this.summaryOf(record);
  }

  /**
   * Pause automation (human input, focus change, or user request). Accepts
   * every ACTIVE state (audit A02): pausing during observation, dispatch,
   * or verification must not throw. In-flight work finishes, but its
   * continuation will not resurrect READY.
   */
  async pauseSession(
    sessionId: string,
    reason: "user_request" | "human_input" | "focus_change" | "handoff"
  ): Promise<ComputerUseSessionSummary> {
    const record = this.getRecord(sessionId);
    const state: ComputerUseSessionState = record.state;
    if (state === "STOPPING" || state === "STOPPED" || state === "FAILED") {
      throw new ComputerUseError(
        "session_state_invalid",
        `Cannot pause from state ${state}`
      );
    }
    if (state === "PAUSED" && reason !== "handoff") {
      record.updatedAt = this.now();
      return this.summaryOf(record);
    }
    if (state === "HANDOFF" && reason === "handoff") {
      record.updatedAt = this.now();
      return this.summaryOf(record);
    }
    // Invalidate current-observation authority: post-pause dispatches need
    // a fresh observation (resume bumps the generation for that).
    if (record.currentObservationId) {
      this.targetStore.invalidateObservation(record.currentObservationId);
    }
    this.authorization.invalidateGeneration(record.generation);
    record.state = reason === "handoff" ? "HANDOFF" : "PAUSED";
    record.updatedAt = this.now();
    return this.summaryOf(record);
  }

  /**
   * Resume from PAUSED/HANDOFF: a fresh observation is required before any
   * input, so every target and approval of the old generation is
   * invalidated here (audit A02/A04).
   */
  async resumeSession(sessionId: string): Promise<ComputerUseSessionSummary> {
    const record = this.getRecord(sessionId);
    const state: ComputerUseSessionState = record.state;
    if (state !== "PAUSED" && state !== "HANDOFF") {
      throw new ComputerUseError(
        "session_state_invalid",
        `Cannot resume from state ${state}`
      );
    }
    this.targetStore.invalidateGeneration(record.generation);
    this.authorization.invalidateGeneration(record.generation);
    this.taskAuthority.invalidateGeneration(sessionId, record.generation);
    record.generation += 1;
    record.currentObservationId = null;
    record.state = "READY";
    record.updatedAt = this.now();
    return this.summaryOf(record);
  }

  /** Mint a current-task approval (approval-UI path, audit A03). */
  approveTask(request: TaskApprovalRequest): ReturnType<ComputerUseTaskAuthority["grant"]> {
    const record = this.getRecord(request.sessionId);
    return this.taskAuthority.grant({
      ...request,
      generation: request.generation ?? record.generation,
    });
  }

  /** Observation entry point: records state and returns the adapter result. */
  async observe(sessionId: string): Promise<ComputerUseObservation> {
    const record = this.getRecord(sessionId);
    this.assertDispatchableState(record, "observe");
    const generationAtObserve = record.generation;
    record.state = "OBSERVING";
    record.updatedAt = this.now();
    let observation: ComputerUseObservation;
    try {
      observation = await this.adapter.observe(record.config.targetWindowId);
    } catch (error) {
      // A stop during observation must not resurrect PAUSED (audit A02):
      // only mutate state when this generation still owns the session.
      if (this.isGenerationOwned(record, generationAtObserve)) {
        record.state = "PAUSED";
        record.updatedAt = this.now();
      }
      throw error;
    }
    if (
      observation.metadata.generation !== record.generation ||
      !this.isGenerationOwned(record, generationAtObserve)
    ) {
      // Stale adapter result after a stop/resume: discard, never revive.
      throw new ComputerUseError(
        "target_stale",
        "Observation was captured for a different generation"
      );
    }
    // New observation supersedes the previous one (audit A04).
    if (record.currentObservationId) {
      this.targetStore.invalidateObservation(record.currentObservationId);
    }
    record.currentObservationId = observation.metadata.observationId;
    if (record.state === "OBSERVING") {
      record.state = "READY";
    }
    record.updatedAt = this.now();
    return observation;
  }

  /**
   * Register an accessibility-resolved target. Both resolution paths return
   * the same target-handle contract (CU-VISION-02). The observation must be
   * the session's CURRENT one and the point must be finite and inside the
   * target window (audit A04).
   */
  registerAccessibilityTarget(
    sessionId: string,
    observationId: string,
    capturePoint: { x: number; y: number },
    region: { x: number; y: number; width: number; height: number }
  ): ComputerUseResolvedTarget {
    const record = this.getRecord(sessionId);
    this.assertObservationCurrent(record, observationId);
    this.assertPointInWindow(record, capturePoint);
    this.assertRegionFinite(region);
    const now = this.now();
    const handle = this.targetStore.create({
      sessionId: record.sessionId,
      generation: record.generation,
      observationId,
      capturePoint,
      region,
      source: "accessibility",
      expiresAt: now + TARGET_TTL_MS,
    });
    return this.targetStore.resolve(
      handle,
      { sessionId: record.sessionId, generation: record.generation },
      now
    );
  }

  /**
   * Register a host-resolved target from a grounding result: map the top
   * candidate through the recorded transform and mint a target handle.
   * Absent/ambiguous outcomes never create a handle (CU-VISION-07). The
   * region is mapped back to CAPTURE pixels through the inverse transform
   * (audit A12 region mapping).
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
    this.assertObservationCurrent(record, grounding.observationId);
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
    // Map normalized region extents back to capture pixels (inverse of the
    // per-axis resize; §11.2): width_capture = wNorm * modelWidth / scaleX.
    const regionWidthCapture =
      ((top.regionWidthNormalized ?? 0.02) * grounding.transform.modelWidth) /
      grounding.transform.scaleX;
    const regionHeightCapture =
      ((top.regionHeightNormalized ?? 0.02) * grounding.transform.modelHeight) /
      grounding.transform.scaleY;
    const region = {
      x: point.x - regionWidthCapture / 2,
      y: point.y - regionHeightCapture / 2,
      width: regionWidthCapture,
      height: regionHeightCapture,
    };
    this.assertPointInWindow(record, point);
    this.assertRegionFinite(region);
    const now = this.now();
    const handle = this.targetStore.create({
      sessionId: record.sessionId,
      generation: record.generation,
      observationId: grounding.observationId,
      capturePoint: point,
      region,
      source: "grounding",
      grounding,
      expiresAt: now + TARGET_TTL_MS,
    });
    return this.targetStore.resolve(
      handle,
      { sessionId: record.sessionId, generation: record.generation },
      now
    );
  }

  /**
   * Dispatch one authorized action. Serialized: one action per observation
   * cycle (design §10.2; audit A04 enforces exactly one). The dispatch
   * chain never rejects — errors are returned as ActionOutcomes so a failed
   * action cannot break the queue.
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
    const appendLog = (
      outcome: ComputerUseActionOutcome,
      grantIssuedAt: number
    ): void => {
      this.appendAction(record, {
        actionId,
        sessionId: record.sessionId,
        generation: generationAtDispatch,
        request,
        actionClass,
        grantIssuedAt,
        outcome,
      });
    };

    // Guard 1: entry.
    if (this.isRevoked(record, generationAtDispatch)) {
      const outcome = this.outcome(actionId, generationAtDispatch, "rejected", undefined, "session_invalid");
      appendLog(outcome, 0);
      return outcome;
    }
    try {
      this.assertDispatchableState(record, "dispatch");
    } catch (error) {
      const outcome = this.failedOutcome(actionId, generationAtDispatch, error);
      appendLog(outcome, 0);
      return outcome;
    }
    const stateBeforeDispatch: ComputerUseSessionState = record.state;

    // Observation currency: the request must carry the session's CURRENT
    // observation (audit A04).
    if (
      !record.currentObservationId ||
      request.observationId !== record.currentObservationId
    ) {
      const outcome = this.outcome(
        actionId,
        generationAtDispatch,
        "rejected",
        undefined,
        "target_stale"
      );
      appendLog(outcome, 0);
      return outcome;
    }

    let target: ComputerUseResolvedTarget;
    try {
      target = this.targetStore.resolve(
        request.targetHandle,
        { sessionId: record.sessionId, generation: record.generation },
        this.now()
      );
      if (target.observationId !== request.observationId) {
        throw new ComputerUseError(
          "target_stale",
          "Target handle belongs to a different observation"
        );
      }
      // Executor coordinates derive ONLY from the host target (audit A04):
      // a caller-supplied point must match it.
      if (request.point) {
        const dx = Math.abs(request.point.x - target.capturePoint.x);
        const dy = Math.abs(request.point.y - target.capturePoint.y);
        if (
          !Number.isFinite(dx) ||
          !Number.isFinite(dy) ||
          dx > TARGET_POINT_TOLERANCE_PX ||
          dy > TARGET_POINT_TOLERANCE_PX
        ) {
          throw new ComputerUseError(
            "coordinates_invalid",
            "Request point does not match the host-resolved target"
          );
        }
      }
    } catch (error) {
      const outcome = this.failedOutcome(actionId, generationAtDispatch, error);
      appendLog(outcome, 0);
      return outcome;
    }

    // Task authority (audit A03): consequential / confirmation-required
    // classes need a current-task approval — deny by default.
    try {
      this.taskAuthority.assertDispatchAllowed({
        sessionId: record.sessionId,
        generation: record.generation,
        actionClass,
        requestHash: hashOf(request),
        now: this.now(),
      });
    } catch (error) {
      const outcome = this.failedOutcome(actionId, generationAtDispatch, error);
      appendLog(outcome, 0);
      return outcome;
    }

    // Grant: mint + validate immediately before the adapter call. The action
    // id is host-generated by the authorization service; the supervisor never
    // accepts a model-supplied one.
    let grantIssuedAt = 0;
    let grant: ReturnType<ComputerUseActionAuthorizationLike["mint"]> | null =
      null;
    record.state = "AWAITING_AUTHORIZATION";
    try {
      grant = this.authorization.mint({
        sessionId: record.sessionId,
        generation: record.generation,
        request,
        actionClass,
        observationId: target.observationId,
        actionId,
        now: this.now(),
      });
      grantIssuedAt = grant.issuedAt;
      this.authorization.validate(
        actionId,
        {
          sessionId: record.sessionId,
          generation: record.generation,
          request,
        },
        this.now()
      );
    } catch (error) {
      this.restoreDispatchableState(record, stateBeforeDispatch);
      const outcome = this.failedOutcome(actionId, generationAtDispatch, error);
      appendLog(outcome, grantIssuedAt);
      return outcome;
    }

    // Safety pre-checks run for every dispatch, whatever the adapter or
    // skill text says (design §10.5 / decision 13).
    try {
      const verdict = await this.safety.preDispatchCheck({
        sessionId: record.sessionId,
        generation: record.generation,
        request,
        target,
      });
      if (!verdict.allowed) {
        this.authorization.consume(actionId);
        this.restoreDispatchableState(record, stateBeforeDispatch);
        const outcome = this.outcome(
          actionId,
          generationAtDispatch,
          "rejected",
          undefined,
          verdict.errorCode ?? "unsupported_target"
        );
        appendLog(outcome, grantIssuedAt);
        return outcome;
      }
    } catch (error) {
      this.authorization.consume(actionId);
      this.restoreDispatchableState(record, stateBeforeDispatch);
      const outcome = this.failedOutcome(actionId, generationAtDispatch, error);
      appendLog(outcome, grantIssuedAt);
      return outcome;
    }

    // Guard 2 (audit A01): a stop/pause during the awaited safety check must
    // prevent input entirely — revalidate before touching the adapter.
    if (this.isRevoked(record, generationAtDispatch)) {
      this.authorization.consume(actionId);
      const outcome = this.outcome(actionId, generationAtDispatch, "cancelled");
      appendLog(outcome, grantIssuedAt);
      return outcome;
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
      this.invalidateObservationTargets(record);
      this.restoreDispatchableState(record, stateBeforeDispatch, "PAUSED");
      const outcome = this.failedOutcome(actionId, generationAtDispatch, error);
      appendLog(outcome, grantIssuedAt);
      return outcome;
    }

    this.authorization.consume(actionId);
    // One action per observation (audit A04): the handle dies here.
    this.invalidateObservationTargets(record);

    // Guard 3: late-revocation — a stop during adapter execution must not be
    // reported as a clean success, and must not resurrect READY.
    if (this.isRevoked(record, generationAtDispatch)) {
      const outcome = this.outcome(actionId, generationAtDispatch, "cancelled");
      appendLog(outcome, grantIssuedAt);
      return outcome;
    }

    record.state = "VERIFYING";
    record.updatedAt = this.now();

    let verification: ComputerUseActionOutcome["verification"];
    let verifierThrew = false;
    if (this.adapter.verify) {
      try {
        const verified = await this.adapter.verify(
          request,
          record.generation
        );
        verification = verified
          ? { verified: true }
          : { verified: false, reason: "post-action state not observed" };
      } catch (error) {
        verifierThrew = true;
        verification = {
          verified: false,
          reason: error instanceof Error ? error.message : "verification error",
        };
      }
    } else {
      // Audit A08: successful input injection alone is NEVER task
      // completion — without a verifier the outcome is uncertain.
      verification = {
        verified: false,
        reason: "no post-action verifier is configured",
      };
    }

    // Guard 4 (audit A02): a stop/pause during verification must not revive
    // the session; only the state this dispatch still owns transitions.
    if (this.isRevoked(record, generationAtDispatch) || record.state !== "VERIFYING") {
      const outcome = this.outcome(
        actionId,
        generationAtDispatch,
        "cancelled"
      );
      appendLog(outcome, grantIssuedAt);
      return outcome;
    }

    record.state = "READY";
    record.updatedAt = this.now();
    const outcome: ComputerUseActionOutcome = {
      actionId,
      generation: generationAtDispatch,
      dispatchedAt,
      outcome: verification.verified
        ? "succeeded"
        : verifierThrew
        ? "failed"
        : "uncertain",
      verification,
    };
    appendLog(outcome, grantIssuedAt);
    return outcome;
  }

  /** Current session summaries (renderer-visible shape). */
  listSessions(): ComputerUseSessionSummary[] {
    return [...this.sessions.values()].map((record) => this.summaryOf(record));
  }

  getSummary(sessionId: string): ComputerUseSessionSummary {
    return this.summaryOf(this.getRecord(sessionId));
  }

  /** Recent action records (bounded; audit/trace surface). */
  listActions(sessionId: string): ComputerUseActionRecord[] {
    return [...this.getRecord(sessionId).actionLog];
  }

  /** Discard late worker results whose generation is stale (design §5.6). */
  isGenerationCurrent(sessionId: string, generation: number): boolean {
    const record = this.sessions.get(sessionId);
    return record !== undefined && record.generation === generation;
  }

  // ---- audit-fix helpers ----

  /** True when a stop/pause revoked the dispatch's generation (audit A01). */
  private isRevoked(
    record: SessionRecord,
    generationAtDispatch: ComputerUseSessionGeneration
  ): boolean {
    return (
      record.generation !== generationAtDispatch ||
      this.isStateStoppingOrStopped(record)
    );
  }

  /** True when this generation still owns the session (no stop/resume). */
  private isGenerationOwned(
    record: SessionRecord,
    generation: ComputerUseSessionGeneration
  ): boolean {
    return record.generation === generation && !this.isStateStoppingOrStopped(record);
  }

  /** Restore the pre-dispatch state on early exits (audit A08 wedged states). */
  private restoreDispatchableState(
    record: SessionRecord,
    stateBeforeDispatch: ComputerUseSessionState,
    onInputError?: ComputerUseSessionState
  ): void {
    // Only when the session was not stopped/paused meanwhile and this
    // dispatch still owns the intermediate state it set.
    const state: ComputerUseSessionState = record.state;
    if (state !== "AWAITING_AUTHORIZATION") return;
    if (this.isStateStoppingOrStopped(record)) return;
    record.state =
      onInputError ??
      (stateBeforeDispatch === "AWAITING_AUTHORIZATION"
        ? "READY"
        : stateBeforeDispatch);
    record.updatedAt = this.now();
  }

  private invalidateObservationTargets(record: SessionRecord): void {
    if (record.currentObservationId) {
      this.targetStore.invalidateObservation(record.currentObservationId);
    }
  }

  private assertObservationCurrent(
    record: SessionRecord,
    observationId: string
  ): void {
    if (record.currentObservationId !== observationId) {
      throw new ComputerUseError(
        "target_stale",
        "Observation is not the session's current observation"
      );
    }
  }

  private assertPointInWindow(
    record: SessionRecord,
    point: { x: number; y: number }
  ): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new ComputerUseError(
        "coordinates_invalid",
        "Target point must be finite"
      );
    }
    const bounds = record.targetWindow?.bounds;
    if (!bounds) return; // no window geometry recorded; skip bounds check
    if (
      point.x < bounds.x ||
      point.y < bounds.y ||
      point.x > bounds.x + bounds.width ||
      point.y > bounds.y + bounds.height
    ) {
      throw new ComputerUseError(
        "coordinates_invalid",
        "Target point lies outside the target window bounds"
      );
    }
  }

  private assertRegionFinite(region: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): void {
    if (
      !Number.isFinite(region.x) ||
      !Number.isFinite(region.y) ||
      !Number.isFinite(region.width) ||
      !Number.isFinite(region.height) ||
      region.width < 0 ||
      region.height < 0
    ) {
      throw new ComputerUseError(
        "coordinates_invalid",
        "Target region must be finite and non-negative"
      );
    }
  }

  private async raceDeadline<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
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

/** Canonical request hash for task-authority checks (shared helper). */
function hashOf(request: ComputerUseActionRequest): string {
  // Reuse the authorization's canonical hashing so approval and grant bind
  // to the identical identity.
  return hashActionRequest(request);
}
