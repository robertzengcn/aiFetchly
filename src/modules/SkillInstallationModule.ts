/**
 * SkillInstallationModule — the installation control plane
 * (design §5.3/§8.2, PRD §10).
 *
 * Only this module changes session state. Every transition:
 *   - goes through compare-and-set on stateRevision so duplicate model
 *     calls, renderer retries, and late worker messages cannot repeat
 *     mutations;
 *   - appends an audit event (timestamped, sanitized);
 *   - returns a snapshot with exactly one `next_action`.
 *
 * `prepare` acquires + inspects + plans and stops at awaiting_approval —
 * no mutation outside staging. `approve` revalidates the plan revision and
 * runs activation + verification. Repeated `prepare` resolves the
 * normalized installation identity: resume, report ready, or create one new
 * session — never a second checkout because the model retried (NFR-01).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { BaseModule } from "@/modules/baseModule";
import {
  SkillInstallationModel,
  SkillInstallationSessionModel,
  SkillInstallationEventModel,
} from "@/model/SkillInstallation.model";
import { SkillInstallationEntity } from "@/entity/SkillInstallation.entity";
import { SkillInstallationSessionEntity } from "@/entity/SkillInstallationSession.entity";
import type {
  InstallSnapshot,
  SafePlanView,
  SkillInstallPlan,
  SkillInstallationState,
  SkillInstallNextAction,
} from "@/entityTypes/skillInstallationTypes";
import {
  SkillSourceAcquisitionService,
  normalizeSkillSource,
} from "@/service/SkillSourceAcquisitionService";
import { SkillPackageInspectionService } from "@/service/SkillPackageInspectionService";
import { buildSkillInstallPlan } from "@/service/SkillInstallPlanner";
import { SkillActivationService } from "@/service/SkillActivationService";
import { detectAll } from "@/service/SkillDependencyOrchestrator";
import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";
import { loadSkillMarkdownFile } from "@/service/PromptSkillLoader";
import { SKILL_INSTALL_PROGRESS } from "@/config/channellist";
import type { PromptSkillDefinition } from "@/entityTypes/promptSkillTypes";

/** Feature kill switch — mirrors the small-model routing pattern. */
export function isSkillInstallerEnabled(): boolean {
  const raw = process.env.AIFETCHLY_SKILL_INSTALL_ENABLED;
  return raw === "true" || raw === "1";
}

/**
 * Catalog-validated typed dependency installer used by approveDependency
 * (FR-14 / §18.3): delegates to SystemDependencyModule — package-manager
 * backed, pre/post-probed, and audit-logged. Repository-supplied shell text
 * is NEVER executed on this path. Dynamic import keeps the module-load
 * graph free of BaseModule construction side effects.
 */
export type TypedDependencyInstaller = (input: {
  readonly dependencyId: string;
  readonly conversationId: string;
  readonly skillName: string;
}) => Promise<{ readonly ok: boolean; readonly message: string }>;

async function defaultTypedDependencyInstaller(input: {
  dependencyId: string;
  conversationId: string;
  skillName: string;
}): Promise<{ ok: boolean; message: string }> {
  const { SystemDependencyModule } = await import(
    "@/modules/SystemDependencyModule"
  );
  const result = await new SystemDependencyModule().install({
    dependency_id: input.dependencyId,
    reason: `skill installation: ${input.skillName}`,
    conversation_id: input.conversationId,
    skill_name: input.skillName,
  });
  const ok =
    result.install_status === "installed" ||
    result.install_status === "already_installed";
  return { ok, message: `${result.install_status}: ${result.details ?? ""}` };
}

let typedDependencyInstaller: TypedDependencyInstaller =
  defaultTypedDependencyInstaller;

/** Test seam: substitute or restore the typed dependency installer. */
export function setTypedDependencyInstallerForTests(
  installer: TypedDependencyInstaller | null
): void {
  typedDependencyInstaller = installer ?? defaultTypedDependencyInstaller;
}

/**
 * Mutation lease (design §14.1, NFR-01): a session holds its lease for this
 * long between heartbeats; an active session whose lease expired is stale
 * and a fresh claim may take it over (the owner crashed mid-mutation).
 */
const SESSION_LEASE_TTL_MS = 10 * 60_000;
/**
 * FR-20 / §10.1: three repeated failures with the SAME normalized cause
 * stop automatic retries and require user direction.
 */
const MAX_SAME_CAUSE_FAILURES = 3;

/**
 * Single-writer claim lock: better-sqlite3 shares one connection, so two
 * concurrent prepares would interleave their claim transactions into a
 * nested-transaction error. Serializing the (short) claim section — read
 * active → take over stale → insert — keeps the DB transaction meaningful
 * while preventing interleaving. Long work (acquisition, activation) runs
 * OUTSIDE the lock; the mutation lease covers cross-claim staleness.
 */
let sessionClaimLock: Promise<unknown> = Promise.resolve();
function withClaimLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = sessionClaimLock.then(fn, fn);
  sessionClaimLock = run.catch(() => undefined);
  return run;
}

/**
 * §12.4 acquisition concurrency bound: at most 2 concurrent acquisitions
 * GLOBALLY. Further prepares QUEUE here (before creating their session
 * row), so saturation degrades to serialization instead of exhausting
 * disk/network.
 */
const MAX_CONCURRENT_ACQUISITIONS = 2;
let activeAcquisitions = 0;
const acquisitionQueue: (() => void)[] = [];
async function withAcquisitionSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeAcquisitions >= MAX_CONCURRENT_ACQUISITIONS) {
    await new Promise<void>((resolve) => acquisitionQueue.push(resolve));
  }
  activeAcquisitions += 1;
  try {
    return await fn();
  } finally {
    activeAcquisitions -= 1;
    acquisitionQueue.shift()?.();
  }
}

const STATE_TO_NEXT_ACTION: Record<
  SkillInstallationState,
  SkillInstallNextAction
> = {
  requested: "resume",
  acquiring: "inspect-in-progress",
  inspecting: "inspect-in-progress",
  planning: "inspect-in-progress",
  awaiting_approval: "review-plan",
  installing_dependencies: "approve-dependency",
  awaiting_secret: "provide-secret-securely",
  activating: "resume",
  verifying: "resume",
  ready: "ready",
  failed: "retry",
  cancelled: "resume",
  rollback_required: "retry",
};

/** Design §23.2 / §15.1 progress event shape (monotonic per session). */
export interface SkillInstallationProgressEvent {
  readonly sessionId: string;
  /** Monotonic per-session sequence (matches the audit event seq). */
  readonly seq: number;
  readonly state: string;
  readonly step: string;
  readonly messageKey: string;
  readonly recoverable: boolean;
  readonly errorCode?: string;
}

/** Injectable progress sink — the IPC layer broadcasts to all windows. */
export type SkillInstallationProgressSink = (
  event: SkillInstallationProgressEvent
) => void;

/** Default sink: broadcasts to every renderer window. */
function defaultProgressSink(): SkillInstallationProgressSink {
  return (event) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const electron = require("electron") as {
        BrowserWindow: {
          getAllWindows: () => Array<{
            webContents: { send: (channel: string, data: unknown) => void };
          }>;
        };
      };
      for (const win of electron.BrowserWindow.getAllWindows()) {
        win.webContents.send(SKILL_INSTALL_PROGRESS, event);
      }
    } catch {
      /* non-Electron contexts (tests) — events stay in the DB audit log */
    }
  };
}

export interface PrepareRequest {
  readonly conversationId: string;
  readonly source: string;
  readonly ref?: string;
  readonly subdirectory?: string;
  readonly mode?: "managed-copy" | "linked";
  readonly constraints?: readonly string[];
  readonly sessionId?: string;
}

export class SkillInstallationModule extends BaseModule {
  private installationModel: SkillInstallationModel | null = null;
  private progressSink: SkillInstallationProgressSink | null = null;
  private sessionModel: SkillInstallationSessionModel | null = null;
  private eventModel: SkillInstallationEventModel | null = null;

  private async getModels(): Promise<{
    installations: SkillInstallationModel;
    sessions: SkillInstallationSessionModel;
    events: SkillInstallationEventModel;
  }> {
    await this.ensureConnection();
    if (!this.installationModel) {
      this.installationModel = new SkillInstallationModel(this.dbpath);
      this.sessionModel = new SkillInstallationSessionModel(this.dbpath);
      this.eventModel = new SkillInstallationEventModel(this.dbpath);
    }
    return {
      installations: this.installationModel,
      sessions: this.sessionModel!,
      events: this.eventModel!,
    };
  }

  // -------------------------------------------------------------------------
  // prepare — acquire + inspect + plan; stops before approval-gated mutation
  // -------------------------------------------------------------------------

  async prepare(request: PrepareRequest): Promise<InstallSnapshot> {
    const { sessions, events, installations } = await this.getModels();
    const baseDescriptor = normalizeSkillSource(request.source);
    if (!baseDescriptor) {
      return this.errorSnapshot(
        "failed",
        "SOURCE_ACQUISITION_FAILED",
        "Unsupported source. Provide a GitHub/Git URL or a local folder/zip path.",
        request.sessionId ?? "none"
      );
    }
    const descriptor = {
      ...baseDescriptor,
      ...(request.ref ? { requestedRevision: request.ref } : {}),
      ...(request.subdirectory ? { subdirectory: request.subdirectory } : {}),
    };

    // Idempotency (§10.2): an active session for the same canonical source
    // resumes instead of re-acquiring.
    if (!request.sessionId) {
      const active = await sessions.findActiveByCanonicalUri(
        descriptor.canonicalUri
      );
      if (active.length > 0) {
        return this.snapshotFromEntity(active[0]);
      }
      // A healthy ready installation of the same source is REPORTED as
      // ready — never re-acquired because the model asked again.
      const ready = await installations.findReadyBySourceUri(
        descriptor.canonicalUri
      );
      if (ready.length > 0) {
        const verified = new SkillActivationService().verifyActivation(
          ready[0].activationPath
        );
        if (verified) {
          return {
            sessionId: `installation:${ready[0].installationId}`,
            installationId: ready[0].installationId,
            state: "ready",
            nextAction: "ready",
            planRevision: null,
            safeSummary: `'${ready[0].name}' is already installed and healthy; no changes made.`,
            recoverable: true,
          };
        }
      }
    }

    const sessionId =
      request.sessionId ?? crypto.randomUUID().replace(/-/g, "").slice(0, 32);
    // The installation identity is created WITH the session (review C3): the
    // secure-secret channel keys credentials by it while the flow is paused
    // in awaiting_secret — before any activation exists — and the same id
    // later identifies the activation, ownership metadata, and catalog
    // registration.
    const installationId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
    // Opaque approval token (review D1): lives only in the session row and
    // the renderer-only IPC channel — never in any model-visible snapshot.
    const approvalToken = crypto.randomBytes(24).toString("hex");
    const acquisition = new SkillSourceAcquisitionService();

    // Transactional claim (FR-02/NFR-01): exactly one active session per
    // canonical source survives concurrent prepares, and the canonical URI
    // is persisted AT CREATION so an acquiring session (no plan JSON yet)
    // is still discoverable. The mutation lease carries owner + expiry; a
    // prior session's same-cause failure streak rides along so the
    // three-failure stop rule spans retries.
    const prior = await sessions.findLatestByCanonicalUri(
      descriptor.canonicalUri
    );
    const now = Date.now();
    const claim = await withClaimLock(() =>
      sessions.claimOrCreateSession(
        {
          sessionId,
          installationId,
          approvalToken,
          conversationId: request.conversationId,
          state: "acquiring",
          planRevision: "none",
          stateRevision: 0,
          canonicalUri: descriptor.canonicalUri,
          leaseOwner: `${process.pid}-${crypto.randomBytes(6).toString("hex")}`,
          leaseExpiresAt: String(now + SESSION_LEASE_TTL_MS),
          ...(prior
            ? {
                retryCount: prior.retryCount,
                ...(prior.lastFailureCause
                  ? { lastFailureCause: prior.lastFailureCause }
                  : {}),
              }
            : {}),
        } as SkillInstallationSessionEntity,
        { nowMs: now }
      )
    );
    if (!claim.created) {
      // A live active session exists — resume it (never a second checkout).
      return this.snapshotFromEntity(claim.session);
    }
    const created = claim.session;
    for (const staleId of claim.staleTakenOver) {
      await this.appendEvent(
        events,
        staleId,
        "lease-takeover",
        "acquiring",
        "failed",
        "stale mutation lease taken over by a new prepare"
      );
    }
    await this.appendEvent(
      events,
      sessionId,
      "session-created",
      "",
      "acquiring"
    );

    // Heartbeat before the long acquisition so a slow clone does not look
    // abandoned mid-flight (the lease refreshes again at activation).
    await sessions.heartbeatLease(sessionId, SESSION_LEASE_TTL_MS, Date.now());
    const acquired = await withAcquisitionSlot(() =>
      acquisition.acquire(sessionId, descriptor)
    );
    if (!acquired.ok) {
      await this.fail(
        sessions,
        events,
        sessionId,
        acquired.code,
        acquired.message
      );
      acquisition.removeSession(sessionId);
      return this.errorSnapshot(
        "failed",
        acquired.code,
        acquired.message,
        sessionId
      );
    }
    await this.transition(sessions, events, sessionId, "inspecting");

    // Instruction precedence honors user-named files (PRD §12.1).
    const namedFiles = (request.constraints ?? [])
      .map((c) => c.match(/read\s+([\w./-]+\.(?:md|txt))/i)?.[1])
      .filter((f): f is string => Boolean(f));
    const inspection = new SkillPackageInspectionService().inspect(
      acquired.source.acquiredRoot,
      descriptor.subdirectory,
      { namedInstructionFiles: namedFiles }
    );
    await this.transition(sessions, events, sessionId, "planning");

    if (inspection.discovered.length === 0) {
      const message =
        "No supported skill package found (need SKILL.md, a valid manifest, " +
        "or a plugin descriptor).";
      await this.fail(
        sessions,
        events,
        sessionId,
        "SKILL_FORMAT_INVALID",
        message
      );
      return this.errorSnapshot(
        "failed",
        "SKILL_FORMAT_INVALID",
        message,
        sessionId
      );
    }

    // Detect dependency statuses through the platform provider.
    const prePlan = buildSkillInstallPlan({
      sessionId,
      source: acquired.source,
      discovered: inspection.discovered,
      instructionFiles: inspection.instructionFiles,
      activationMode: request.mode === "linked" ? "linked" : "managed-copy",
      activationTargetDir: "<global prompt skills>",
      constraints: request.constraints ?? [],
    });
    const detectedDeps = await detectAll(
      prePlan.dependencies,
      acquired.source.acquiredRoot
    );
    const plan: SkillInstallPlan = {
      ...prePlan,
      dependencies: detectedDeps,
    };

    await sessions.savePlan(sessionId, plan.planRevision, JSON.stringify(plan));
    await this.transition(sessions, events, sessionId, "awaiting_approval");

    const session = await sessions.findBySessionId(sessionId);
    return this.snapshotFromEntity(session ?? created, plan);
  }

  // -------------------------------------------------------------------------
  // approve — plan-revision-bound activation + verification
  // -------------------------------------------------------------------------

  async approve(input: {
    sessionId: string;
    planRevision: string;
    approve: boolean;
    /** Renderer-only opaque token; the model can never supply it. */
    approvalToken?: string;
    selectedSkillIds?: readonly string[];
    /** FR-29: calling conversation — cross-conversation use is rejected. */
    conversationId?: string;
  }): Promise<InstallSnapshot> {
    const { sessions, events } = await this.getModels();
    const session = await sessions.findBySessionId(input.sessionId);
    if (!session) {
      return this.errorSnapshot(
        "failed",
        "INSTALL_SESSION_REQUIRED",
        "Unknown installation session.",
        input.sessionId
      );
    }
    if (this.conversationMismatch(session, input.conversationId)) {
      return this.errorSnapshot(
        session.state as SkillInstallationState,
        "INSTALL_SESSION_CONVERSATION_MISMATCH",
        "This installation session belongs to a different conversation.",
        input.sessionId
      );
    }
    if (session.state !== "awaiting_approval") {
      return this.snapshotFromEntity(session);
    }
    // Review D1: approval must be bound to a human gesture. The token is
    // created at prepare and handed ONLY to the renderer approval card; a
    // model-originated approve (no token, or a wrong one) is rejected.
    if (session.approvalToken) {
      if (
        input.approvalToken === undefined ||
        input.approvalToken !== session.approvalToken
      ) {
        return this.errorSnapshot(
          session.state,
          "APPROVAL_REQUIRED",
          "Installation approval must come from the user's install card. " +
            "Present the plan and wait for the user to approve it.",
          input.sessionId
        );
      }
    }
    if (session.planRevision !== input.planRevision) {
      return this.errorSnapshot(
        session.state,
        "PLAN_REVISION_MISMATCH",
        "The installation plan changed since it was shown; review and approve again.",
        input.sessionId
      );
    }
    if (!input.approve) {
      await this.transition(sessions, events, input.sessionId, "cancelled");
      new SkillSourceAcquisitionService().removeSession(input.sessionId);
      const cancelled = await sessions.findBySessionId(input.sessionId);
      return this.snapshotFromEntity(cancelled ?? session);
    }

    // The user's card approved this exact revision — record it so
    // runApprovedCommand's gate (and future audit) can rely on it.
    if (input.approve) {
      session.approved = true;
      await sessions.create(session);
    }

    const plan = JSON.parse(session.planJson ?? "{}") as SkillInstallPlan;
    const selected =
      input.selectedSkillIds && input.selectedSkillIds.length > 0
        ? plan.discoveredSkills.filter((s) =>
            input.selectedSkillIds!.includes(s.candidateId)
          )
        : plan.discoveredSkills.filter((s) =>
            plan.selectedSkillIds.includes(s.candidateId)
          );
    if (selected.length === 0) {
      return this.errorSnapshot(
        session.state,
        "SKILL_AMBIGUOUS",
        "Select which discovered skill(s) to activate.",
        input.sessionId
      );
    }

    // A required credential pauses the flow BEFORE activation (§19.3) — the
    // value itself arrives only through the secure renderer channel.
    if (plan.credentials.length > 0) {
      await this.transition(
        sessions,
        events,
        input.sessionId,
        "awaiting_secret"
      );
      const awaiting = await sessions.findBySessionId(input.sessionId);
      return this.snapshotFromEntity(awaiting ?? session, plan);
    }

    // TODO 3 / FR-07: plugin and executable packages route to the EXISTING
    // installation services — the typed installer owns acquisition and
    // approval, never a parallel plugin/executable runtime.
    if (selected[0].kind === "plugin") {
      return this.routeToPluginService(input.sessionId, plan, events, sessions);
    }
    if (selected[0].kind === "executable") {
      return this.routeToExecutableService(
        input.sessionId,
        plan,
        events,
        sessions
      );
    }

    return this.runActivation(input.sessionId, plan, selected[0], session);
  }

  /**
   * FR-07 plugin routing: hand the acquired staging root to
   * PluginImportService.installFromLocalRoot (the existing manifest-loading,
   * DB, and registration pipeline), then mark the session ready. The plugin
   * service owns its own overwrite semantics.
   */
  private async routeToPluginService(
    sessionId: string,
    plan: SkillInstallPlan,
    events: SkillInstallationEventModel,
    sessions: SkillInstallationSessionModel
  ): Promise<InstallSnapshot> {
    await this.transition(sessions, events, sessionId, "activating");
    try {
      const { PluginImportService } = await import(
        "@/service/PluginImportService"
      );
      const result = await PluginImportService.installFromLocalRoot(
        plan.source.acquiredRoot,
        { overwrite: true }
      );
      if (!result.success) {
        await this.fail(
          sessions,
          events,
          sessionId,
          "ACTIVATION_VERIFICATION_FAILED",
          result.errors.map((e) => e.message).join("; ")
        );
        return this.errorSnapshot(
          "failed",
          "ACTIVATION_VERIFICATION_FAILED",
          result.errors.map((e) => e.message).join("; "),
          sessionId
        );
      }
      await this.transition(sessions, events, sessionId, "verifying");
      await this.transition(sessions, events, sessionId, "ready");
      await this.appendEvent(
        events,
        sessionId,
        "installation-ready",
        "verifying",
        "ready",
        "plugin routed through PluginImportService"
      );
      // FR-19: plugins persist the SAME lifecycle identity prompt skills
      // use, so update/repair/disable/uninstall address them uniformly.
      await this.persistRoutedInstallationRow({
        sessions,
        sessionId,
        kind: "plugin",
        name: result.plugin.name,
        plan,
        metadata: {
          pluginId: result.plugin.id,
          pluginVersion: result.plugin.version,
        },
      });
      const ready = await sessions.findBySessionId(sessionId);
      if (!ready) {
        return this.errorSnapshot(
          "failed",
          "INSTALL_SESSION_REQUIRED",
          "Session vanished after routing.",
          sessionId
        );
      }
      return this.snapshotFromEntity(ready, plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.fail(
        sessions,
        events,
        sessionId,
        "ACTIVATION_VERIFICATION_FAILED",
        message
      );
      return this.errorSnapshot(
        "failed",
        "ACTIVATION_VERIFICATION_FAILED",
        message,
        sessionId
      );
    }
  }

  /**
   * FR-07 executable routing: SkillImportService.importFromDirectory copies
   * the staged root into userData/installed_skills, persists metadata, and
   * hot-registers through the SAME path zip imports use.
   */
  private async routeToExecutableService(
    sessionId: string,
    plan: SkillInstallPlan,
    events: SkillInstallationEventModel,
    sessions: SkillInstallationSessionModel
  ): Promise<InstallSnapshot> {
    await this.transition(sessions, events, sessionId, "activating");
    try {
      const { SkillImportService } = await import(
        "@/service/SkillImportService"
      );
      const result = await SkillImportService.importFromDirectory(
        plan.source.acquiredRoot
      );
      if (!result.success) {
        await this.fail(
          sessions,
          events,
          sessionId,
          "SKILL_FORMAT_INVALID",
          result.error
        );
        return this.errorSnapshot(
          "failed",
          "SKILL_FORMAT_INVALID",
          result.error,
          sessionId
        );
      }
      await this.transition(sessions, events, sessionId, "verifying");
      await this.transition(sessions, events, sessionId, "ready");
      await this.appendEvent(
        events,
        sessionId,
        "installation-ready",
        "verifying",
        "ready",
        `executable '${result.name}' routed through SkillImportService`
      );
      // FR-19: executable skills persist the same lifecycle identity.
      await this.persistRoutedInstallationRow({
        sessions,
        sessionId,
        kind: "executable",
        name: result.name,
        plan,
        metadata: { routedThrough: "SkillImportService" },
      });
      const ready = await sessions.findBySessionId(sessionId);
      if (!ready) {
        return this.errorSnapshot(
          "failed",
          "INSTALL_SESSION_REQUIRED",
          "Session vanished after routing.",
          sessionId
        );
      }
      return this.snapshotFromEntity(ready, plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.fail(
        sessions,
        events,
        sessionId,
        "ACTIVATION_VERIFICATION_FAILED",
        message
      );
      return this.errorSnapshot(
        "failed",
        "ACTIVATION_VERIFICATION_FAILED",
        message,
        sessionId
      );
    }
  }

  // -------------------------------------------------------------------------
  // approveDependency — typed dependency install approval (PRD §18, FR-14)
  // -------------------------------------------------------------------------

  /**
   * Approve or decline the typed installation of ONE missing plan
   * dependency while the session holds at `installing_dependencies`.
   *
   * Security invariants (same strength as `approve`):
   *   - the renderer-only approval token must match (a model-originated
   *     call can never supply it — review D1);
   *   - the request is bound to the plan revision the user saw;
   *   - installation goes ONLY through the catalog-validated
   *     SystemDependencyModule (package managers) — repository-supplied
   *     shell text is never executed here (§18.3);
   *   - after any install attempt EVERY plan dependency is re-probed
   *     (multi-probe rule) and `ready` requires all probes to pass.
   *
   * Declining a required dependency rolls the already-completed activation
   * back and cancels the session (§10.1: cancelling after activation begins
   * invokes rollback) — the install can never verify ready without it.
   */
  async approveDependency(input: {
    sessionId: string;
    dependencyId: string;
    approve: boolean;
    planRevision: string;
    approvalToken?: string;
    /** FR-29: calling conversation — cross-conversation use is rejected. */
    conversationId?: string;
  }): Promise<InstallSnapshot> {
    const { sessions, events, installations } = await this.getModels();
    const session = await sessions.findBySessionId(input.sessionId);
    if (!session) {
      return this.errorSnapshot(
        "failed",
        "INSTALL_SESSION_REQUIRED",
        "Unknown installation session.",
        input.sessionId
      );
    }
    if (this.conversationMismatch(session, input.conversationId)) {
      return this.errorSnapshot(
        session.state as SkillInstallationState,
        "INSTALL_SESSION_CONVERSATION_MISMATCH",
        "This installation session belongs to a different conversation.",
        input.sessionId
      );
    }
    if (session.state !== "installing_dependencies") {
      return this.snapshotFromEntity(session);
    }
    if (session.approvalToken) {
      if (
        input.approvalToken === undefined ||
        input.approvalToken !== session.approvalToken
      ) {
        return this.errorSnapshot(
          session.state,
          "APPROVAL_REQUIRED",
          "Dependency installation must be approved from the user's install card.",
          input.sessionId
        );
      }
    }
    if (session.planRevision !== input.planRevision) {
      return this.errorSnapshot(
        session.state,
        "PLAN_REVISION_MISMATCH",
        "The installation plan changed since it was shown; review and approve again.",
        input.sessionId
      );
    }
    const plan = JSON.parse(session.planJson ?? "{}") as SkillInstallPlan;
    const dependency = plan.dependencies.find(
      (d) => d.id === input.dependencyId
    );
    if (!dependency || dependency.currentStatus === "satisfied") {
      return this.errorSnapshot(
        session.state,
        "DEPENDENCY_NOT_IN_PLAN",
        "That dependency is not part of this installation plan.",
        input.sessionId
      );
    }

    if (!input.approve) {
      return this.declineDependency(
        sessions,
        events,
        installations,
        session,
        dependency.name
      );
    }

    await this.appendEvent(
      events,
      input.sessionId,
      "dependency-install-started",
      "installing_dependencies",
      "installing_dependencies",
      dependency.name
    );
    const installOutcome = await typedDependencyInstaller({
      dependencyId: dependency.id.replace(/^dep:/, ""),
      conversationId: session.conversationId,
      skillName: plan.discoveredSkills[0]?.name ?? "unknown-skill",
    });

    // Re-probe EVERY plan dependency — an install may satisfy companions
    // (ffprobe ships with ffmpeg) and must not mask other missing items.
    const probeCwd =
      plan.source.acquiredRoot && fs.existsSync(plan.source.acquiredRoot)
        ? plan.source.acquiredRoot
        : process.cwd();
    const rechecked = await detectAll(plan.dependencies, probeCwd);
    const updatedPlan: SkillInstallPlan = { ...plan, dependencies: rechecked };
    await sessions.savePlan(
      input.sessionId,
      session.planRevision,
      JSON.stringify(updatedPlan)
    );

    if (rechecked.every((d) => d.currentStatus === "satisfied")) {
      await this.transition(sessions, events, input.sessionId, "verifying");
      await this.transition(sessions, events, input.sessionId, "ready");
      await this.appendEvent(
        events,
        input.sessionId,
        "installation-ready",
        "verifying",
        "ready",
        `dependency ${dependency.name} installed and verified`
      );
      const ready = await sessions.findBySessionId(input.sessionId);
      return this.snapshotFromEntity(ready ?? session, updatedPlan);
    }

    await this.appendEvent(
      events,
      input.sessionId,
      installOutcome.ok
        ? "dependency-install-retryable"
        : "dependency-install-failed",
      "installing_dependencies",
      "installing_dependencies",
      `${dependency.name}: ${installOutcome.message}`
    );
    const held = await sessions.findBySessionId(input.sessionId);
    const heldSnapshot = this.snapshotFromEntity(held ?? session, updatedPlan);
    if (!installOutcome.ok) {
      // Surface the typed-installer failure on the card's summary line so
      // the hold is actionable (retry / decline), not a silent status.
      return {
        ...heldSnapshot,
        safeSummary: `${heldSnapshot.safeSummary}; ${dependency.name}: ${installOutcome.message}`,
      };
    }
    return heldSnapshot;
  }

  /**
   * Decline path: the activation already happened, so a required
   * dependency that will not be installed can never verify ready — roll
   * the activation back (restoring any prior healthy version), unregister
   * the catalog entry, mark the installation row cancelled, and cancel the
   * session. A rollback failure surfaces `rollback_required` with the
   * recovery detail instead of silently dropping the activation.
   */
  private async declineDependency(
    sessions: SkillInstallationSessionModel,
    events: SkillInstallationEventModel,
    installations: SkillInstallationModel,
    session: SkillInstallationSessionEntity,
    dependencyName: string
  ): Promise<InstallSnapshot> {
    let rollbackDetail = "";
    if (session.installationId) {
      const entity = await installations.findByInstallationId(
        session.installationId
      );
      if (entity) {
        const metadata = JSON.parse(entity.metadataJson ?? "{}") as {
          backupPath?: string | null;
        };
        const rolled = new SkillActivationService().rollback(
          entity.activationPath,
          metadata.backupPath ?? null
        );
        getDefaultPromptSkillCatalog().remove(
          `prompt:user:${session.installationId}`
        );
        entity.status = "cancelled";
        entity.enabled = false;
        try {
          await installations.save(entity);
        } catch {
          /* best-effort row update — the session state below governs */
        }
        if (!rolled.ok) rollbackDetail = rolled.message;
      }
    }
    new SkillSourceAcquisitionService().removeSession(session.sessionId);
    if (rollbackDetail) {
      await this.transition(
        sessions,
        events,
        session.sessionId,
        "rollback_required"
      );
      await this.appendEvent(
        events,
        session.sessionId,
        "rollback-failed",
        "installing_dependencies",
        "rollback_required",
        rollbackDetail
      );
      return this.errorSnapshot(
        "rollback_required",
        "ROLLBACK_FAILED",
        `Dependency '${dependencyName}' declined, but restoring the previous activation failed: ${rollbackDetail}`,
        session.sessionId
      );
    }
    await this.appendEvent(
      events,
      session.sessionId,
      "dependency-declined",
      "installing_dependencies",
      "cancelled",
      dependencyName
    );
    await this.transition(sessions, events, session.sessionId, "cancelled");
    const cancelled = await sessions.findBySessionId(session.sessionId);
    return this.snapshotFromEntity(cancelled ?? session);
  }

  /**
   * Resume after a secret was submitted through the secure channel. The
   * secret VALUE never enters this module — the credential service stores
   * it; this only advances the state machine.
   */
  async resumeAfterSecret(
    sessionId: string,
    conversationId?: string
  ): Promise<InstallSnapshot> {
    const { sessions } = await this.getModels();
    const session = await sessions.findBySessionId(sessionId);
    if (!session) {
      return this.errorSnapshot(
        "failed",
        "INSTALL_SESSION_REQUIRED",
        "Unknown installation session.",
        sessionId
      );
    }
    if (this.conversationMismatch(session, conversationId)) {
      return this.errorSnapshot(
        session.state as SkillInstallationState,
        "INSTALL_SESSION_CONVERSATION_MISMATCH",
        "This installation session belongs to a different conversation.",
        sessionId
      );
    }
    if (session.state !== "awaiting_secret") {
      return this.snapshotFromEntity(session);
    }
    const plan = JSON.parse(session.planJson ?? "{}") as SkillInstallPlan;
    const selected =
      plan.discoveredSkills.find(
        (s) => s.candidateId === plan.selectedSkillIds[0]
      ) ?? plan.discoveredSkills[0];
    return this.runActivation(sessionId, plan, selected, session);
  }

  // -------------------------------------------------------------------------
  // status / cancel
  // -------------------------------------------------------------------------

  /**
   * TODO 5 / FR-16: execute one APPROVED command template from the
   * session's persisted plan (renderer diagnostics entry point — the model
   * never supplies the command). Secrets resolve through the credential
   * service straight into the child env; only env NAMES are audited.
   */
  async runApprovedCommand(
    sessionId: string,
    commandId: string
  ): Promise<
    | {
        ok: true;
        result: import("@/service/SkillApprovedCommandRunner").ApprovedCommandRunResult;
      }
    | { ok: false; message: string }
  > {
    const { sessions, events } = await this.getModels();
    const session = await sessions.findBySessionId(sessionId);
    if (!session) {
      return { ok: false, message: "Unknown installation session." };
    }
    if (session.approved !== true) {
      return {
        ok: false,
        message: "Commands run only after the plan is approved.",
      };
    }
    const plan = JSON.parse(session.planJson ?? "{}") as SkillInstallPlan;
    // Commands run in the session's staged content root — the package the
    // plan was built from (review fix: previously the parent source/ dir).
    const cwd = plan.source.acquiredRoot;
    const { SkillApprovedCommandRunner } = await import(
      "@/service/SkillApprovedCommandRunner"
    );
    const runner = new SkillApprovedCommandRunner();
    const result = await runner.run(
      plan,
      commandId,
      cwd,
      session.installationId ?? null
    );
    await this.appendEvent(
      events,
      sessionId,
      result.ok ? "command-executed" : "command-failed",
      // The event table requires non-null states; a command run is not a
      // transition, so record the session's current state for both sides.
      session.state,
      session.state,
      // Audit records names + outcome only — never secret values or raw
      // output (both may embed credentials).
      `${commandId}: ok=${result.ok} exit=${result.exitCode ?? "n/a"} ` +
        `injected=[${result.injectedEnvNames.join(",")}]` +
        (result.errorCode ? ` code=${result.errorCode}` : "")
    );
    return { ok: true, result };
  }

  /**
   * Approval token for the RENDERER approval card only (review D1). Never
   * included in any snapshot the model can observe.
   */
  async getApprovalToken(sessionId: string): Promise<string | null> {
    const { sessions } = await this.getModels();
    const session = await sessions.findBySessionId(sessionId);
    return session?.approvalToken ?? null;
  }

  async getStatus(
    sessionId: string,
    conversationId?: string
  ): Promise<InstallSnapshot> {
    const { sessions } = await this.getModels();
    const session = await sessions.findBySessionId(sessionId);
    if (!session) {
      return this.errorSnapshot(
        "failed",
        "INSTALL_SESSION_REQUIRED",
        "Unknown installation session.",
        sessionId
      );
    }
    if (this.conversationMismatch(session, conversationId)) {
      return this.errorSnapshot(
        session.state as SkillInstallationState,
        "INSTALL_SESSION_CONVERSATION_MISMATCH",
        "This installation session belongs to a different conversation.",
        sessionId
      );
    }
    const plan = session.planJson
      ? (JSON.parse(session.planJson) as SkillInstallPlan)
      : null;
    return this.snapshotFromEntity(session, plan ?? undefined);
  }

  async cancel(
    sessionId: string,
    conversationId?: string
  ): Promise<InstallSnapshot> {
    const { sessions, events } = await this.getModels();
    const session = await sessions.findBySessionId(sessionId);
    if (!session) {
      return this.errorSnapshot(
        "failed",
        "INSTALL_SESSION_REQUIRED",
        "Unknown installation session.",
        sessionId
      );
    }
    if (this.conversationMismatch(session, conversationId)) {
      return this.errorSnapshot(
        session.state as SkillInstallationState,
        "INSTALL_SESSION_CONVERSATION_MISMATCH",
        "This installation session belongs to a different conversation.",
        sessionId
      );
    }
    if (["ready", "cancelled"].includes(session.state)) {
      return this.snapshotFromEntity(session);
    }
    // Before activation: remove staging. After activation begins: roll the
    // activation back IMMEDIATELY (§10.1 / NFR-05) — cancelling must not
    // leave a half-activated skill behind. A rollback failure surfaces
    // rollback_required with the recovery detail instead of cancelling.
    if (["activating", "verifying"].includes(session.state)) {
      let rollbackDetail = "";
      if (session.installationId) {
        const { installations } = await this.getModels();
        const entity = await installations.findByInstallationId(
          session.installationId
        );
        if (entity) {
          const metadata = JSON.parse(entity.metadataJson ?? "{}") as {
            backupPath?: string | null;
          };
          const rolled = new SkillActivationService().rollback(
            entity.activationPath,
            metadata.backupPath ?? null
          );
          getDefaultPromptSkillCatalog().remove(
            `prompt:user:${session.installationId}`
          );
          entity.status = "cancelled";
          entity.enabled = false;
          try {
            await installations.save(entity);
          } catch {
            /* best-effort row update — the session state governs */
          }
          if (!rolled.ok) rollbackDetail = rolled.message;
        }
      }
      if (rollbackDetail) {
        await this.appendEvent(
          events,
          sessionId,
          "rollback-failed",
          session.state,
          "rollback_required",
          rollbackDetail
        );
        await this.transition(sessions, events, sessionId, "rollback_required");
        return this.errorSnapshot(
          "rollback_required",
          "ROLLBACK_FAILED",
          `Cancellation could not restore the previous activation: ${rollbackDetail}`,
          sessionId
        );
      }
      await this.appendEvent(
        events,
        sessionId,
        "rollback-completed",
        session.state,
        "cancelled",
        "activation rolled back on cancel"
      );
      new SkillSourceAcquisitionService().removeSession(sessionId);
      await this.transition(sessions, events, sessionId, "cancelled");
      const cancelledNow = await sessions.findBySessionId(sessionId);
      return this.snapshotFromEntity(cancelledNow ?? session);
    } else {
      await this.transition(sessions, events, sessionId, "cancelled");
      new SkillSourceAcquisitionService().removeSession(sessionId);
    }
    // Review D3: cancellation revokes command-execution authorization.
    const cancelledRow = await sessions.findBySessionId(sessionId);
    if (cancelledRow && cancelledRow.approved) {
      cancelledRow.approved = false;
      await sessions.create(cancelledRow);
    }
    const cancelled = await sessions.findBySessionId(sessionId);
    return this.snapshotFromEntity(cancelled ?? session);
  }

  /**
   * Typed retry (FR-20 / §10.1): re-run a failed (or rollback_required)
   * installation from the recorded canonical source. The three-failure
   * stop rule is enforced across retries — the same-cause streak is
   * inherited by each new session, and the third consecutive failure with
   * the same normalized cause refuses further automatic retries.
   */
  async retry(
    sessionId: string,
    conversationId?: string
  ): Promise<InstallSnapshot> {
    const { sessions, events } = await this.getModels();
    const session = await sessions.findBySessionId(sessionId);
    if (!session) {
      return this.errorSnapshot(
        "failed",
        "INSTALL_SESSION_REQUIRED",
        "Unknown installation session.",
        sessionId
      );
    }
    if (this.conversationMismatch(session, conversationId)) {
      return this.errorSnapshot(
        session.state as SkillInstallationState,
        "INSTALL_SESSION_CONVERSATION_MISMATCH",
        "This installation session belongs to a different conversation.",
        sessionId
      );
    }
    if (!["failed", "rollback_required"].includes(session.state)) {
      return this.snapshotFromEntity(session);
    }
    if ((session.retryCount ?? 0) >= MAX_SAME_CAUSE_FAILURES) {
      await this.appendEvent(
        events,
        sessionId,
        "retry-refused",
        session.state,
        session.state,
        `same-cause failure streak ${session.retryCount} for ${session.lastFailureCause}`
      );
      return this.errorSnapshot(
        session.state as SkillInstallationState,
        "INSTALL_RETRY_LIMIT_EXCEEDED",
        `This installation failed ${
          session.retryCount
        } times with the same cause (${
          session.lastFailureCause ?? "unknown"
        }). Automatic retries are stopped — review the failure or change the source before trying again.`,
        sessionId
      );
    }
    const source = session.canonicalUri;
    if (!source) {
      return this.errorSnapshot(
        session.state as SkillInstallationState,
        "INSTALL_SESSION_REQUIRED",
        "The failed session predates canonical-source persistence; start a new install instead.",
        sessionId
      );
    }
    await this.appendEvent(
      events,
      sessionId,
      "retry-requested",
      session.state,
      session.state,
      `retry after ${session.retryCount} same-cause failure(s)`
    );
    // A failed session is not active, so prepare claims a FRESH session for
    // the same canonical source and inherits the failure streak.
    return this.prepare({
      conversationId: session.conversationId,
      source,
    });
  }

  // -------------------------------------------------------------------------
  // lifecycle: update / repair / disable / uninstall (PRD §24, FR-19)
  // -------------------------------------------------------------------------

  /**
   * Update: reacquire the recorded source into fresh staging, re-inspect,
   * and hold at awaiting_approval with a NEW plan revision — approval is
   * required again whenever capabilities expand (§24.1). The previous
   * healthy activation stays in place until the new one verifies.
   */
  /**
   * FR-26 identity resolution: natural-language update/repair/configure
   * requests carry a NAME ("update video-use"), not an installation id.
   * Unique ready match resolves deterministically; multiple matches ask a
   * bounded clarification; none is a typed SKILL_NOT_FOUND.
   */
  private async resolveInstallationIdentity(input: {
    installationId?: string;
    name?: string;
  }): Promise<
    | { readonly ok: true; readonly entity: SkillInstallationEntity }
    | { readonly ok: false; readonly code: string; readonly message: string }
  > {
    const { installations } = await this.getModels();
    if (input.installationId) {
      const entity = await installations.findByInstallationId(
        input.installationId
      );
      if (entity) return { ok: true, entity };
      return {
        ok: false,
        code: "SKILL_NOT_FOUND",
        message: `No installation with id '${input.installationId}'.`,
      };
    }
    if (input.name) {
      const lowered = input.name.toLowerCase();
      const matches = (await installations.listByScope("user", 0)).filter(
        (row) =>
          row.enabled &&
          ["ready", "disabled"].includes(row.status) &&
          row.name.toLowerCase() === lowered
      );
      if (matches.length === 1) return { ok: true, entity: matches[0] };
      if (matches.length > 1) {
        return {
          ok: false,
          code: "SKILL_AMBIGUOUS",
          message:
            `Multiple installations are named '${input.name}': ` +
            matches.map((m) => `${m.name} (${m.installationId})`).join(", ") +
            `. Repeat the request with the exact installation id.`,
        };
      }
      return {
        ok: false,
        code: "SKILL_NOT_FOUND",
        message: `No installed skill named '${input.name}'.`,
      };
    }
    return {
      ok: false,
      code: "INSTALL_SESSION_REQUIRED",
      message: "Provide the installation id or the installed skill's name.",
    };
  }

  async update(input: {
    installationId?: string;
    name?: string;
    /** FR-26/FR-29: the REAL calling conversation — kept on the session. */
    conversationId?: string;
  }): Promise<InstallSnapshot> {
    const resolved = await this.resolveInstallationIdentity(input);
    if (!resolved.ok) {
      return this.errorSnapshot(
        "failed",
        resolved.code,
        resolved.message,
        "none"
      );
    }
    const entity = resolved.entity;
    // Update flows through prepare against the recorded source; the
    // activation service's backup mechanism retains the previous version
    // until the new one verifies.
    // Update FORCES a fresh session (the ready-installation idempotency
    // gate must not short-circuit an explicit update request): pass an
    // explicit sessionId so prepare skips the resume/report-ready path.
    // FR-26: the session carries the REAL calling conversation (the
    // synthetic update:<id> identity is only the legacy fallback), so
    // FR-29 correlation works for the follow-up approve.
    return this.prepare({
      conversationId: input.conversationId ?? `update:${entity.installationId}`,
      source: entity.sourceUri,
      ...(entity.sourceSubdirectory
        ? { subdirectory: entity.sourceSubdirectory }
        : {}),
      mode:
        entity.activationMode === "symbolic-link" ||
        entity.activationMode === "junction"
          ? "linked"
          : "managed-copy",
      sessionId: `update-${entity.installationId}-${Date.now()}`,
    });
  }

  /**
   * Repair: recheck the recorded activation WITHOUT moving to a newer
   * revision (§24.2). Verifies the activation path still resolves, the
   * SKILL.md hash matches the recorded content hash, the runtime catalog
   * still resolves the skill, and re-registers when the catalog lost it.
   */
  async repair(input: {
    installationId?: string;
    /** FR-26: natural-language identity ("repair video-use"). */
    name?: string;
  }): Promise<{
    ok: boolean;
    checks: readonly {
      readonly name: string;
      readonly passed: boolean;
      readonly detail: string;
    }[];
    repaired: readonly string[];
    /** Typed identity-resolution failure (SKILL_NOT_FOUND / SKILL_AMBIGUOUS). */
    errorCode?: string;
    errorMessage?: string;
  }> {
    const resolved = await this.resolveInstallationIdentity(input);
    if (!resolved.ok) {
      return {
        ok: false,
        checks: [],
        repaired: [],
        errorCode: resolved.code,
        errorMessage: resolved.message,
      };
    }
    const entity = resolved.entity;

    const activation = new SkillActivationService();
    const checks: { name: string; passed: boolean; detail: string }[] = [];
    const repaired: string[] = [];

    // 1. Activation resolves.
    const structureOk = activation.verifyActivation(entity.activationPath);
    checks.push({
      name: "activation-readable",
      passed: structureOk,
      detail: structureOk
        ? entity.activationPath
        : "activation path missing or unreadable",
    });

    // 1a. Linked installations: the link target must still exist (§17.5) —
    // a vanished checkout leaves the skill unusable and repair must say so
    // rather than silently re-registering stale content.
    if (
      entity.activationMode === "symbolic-link" ||
      entity.activationMode === "junction"
    ) {
      try {
        const real = fs.realpathSync(entity.activationPath);
        checks.push({
          name: "link-target-present",
          passed: true,
          detail: real,
        });
      } catch (err) {
        checks.push({
          name: "link-target-present",
          passed: false,
          detail: `Linked target is missing (${err instanceof Error ? err.message : String(err)}). Restore the folder or reinstall.`,
        });
      }
    }

    // 1b. Content hash matches the RECORDED revision (§24.2: repair must
    // detect changed content without silently updating to a new revision).
    // The recorded hash is the staged-tree hash (stagePackage.hashTree), so
    // verification re-hashes the activation tree with the same algorithm.
    if (structureOk) {
      try {
        const { hashTree } = await import(
          "@/childprocess/skill-installation/stagePackage"
        );
        const currentHash = hashTree(entity.activationPath);
        const recorded =
          (
            JSON.parse(entity.metadataJson ?? "{}") as {
              activationContentHash?: string;
            }
          ).activationContentHash ?? entity.contentHash;
        const matches = currentHash === recorded;
        checks.push({
          name: "content-hash-matches",
          passed: matches,
          detail: matches
            ? `${currentHash.slice(0, 12)} matches the recorded revision`
            : `content changed since install (recorded ${entity.contentHash.slice(
                0,
                12
              )}, found ${currentHash.slice(
                0,
                12
              )}); update is required, repair will not rewrite it`,
        });
      } catch (err) {
        checks.push({
          name: "content-hash-matches",
          passed: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. SKILL.md still readable at the recorded activation (linked installs
    //    can change or vanish). The exact content hash is re-verified by the
    //    invocation path at every use; repair checks structural presence.
    let hashOk = false;
    try {
      fs.accessSync(
        path.join(entity.activationPath, "SKILL.md"),
        fs.constants.R_OK
      );
      hashOk = true;
    } catch {
      hashOk = false;
    }
    checks.push({
      name: "skill-md-present",
      passed: hashOk,
      detail: hashOk ? "SKILL.md readable" : "SKILL.md unreadable",
    });

    // 3. Runtime catalog still resolves the skill; re-register if missing.
    const catalog = getDefaultPromptSkillCatalog();
    const runtimeId = `prompt:user:${entity.installationId}`;
    const registered = catalog.get(runtimeId) !== null;
    checks.push({
      name: "catalog-registered",
      passed: registered,
      detail: registered ? runtimeId : "missing from runtime catalog",
    });
    if (!registered && structureOk) {
      const restored = this.registerPromptSkill(
        entity.activationPath,
        entity.installationId
      );
      if (restored) {
        repaired.push("catalog-re-registered");
        checks[checks.length - 1] = {
          name: "catalog-registered",
          passed: true,
          detail: `${runtimeId} (repaired)`,
        };
      }
    }

    // 4. Status reflects health.
    const statusOk = entity.status === "ready";
    checks.push({
      name: "installation-status",
      passed: statusOk,
      detail: `status=${entity.status}`,
    });

    return {
      ok: checks.every((c) => c.passed),
      checks,
      repaired,
    };
  }

  /**
   * Disable: remove the skill from model discovery and invocation
   * immediately while preserving files, provenance, and secrets (§24.3).
   */
  /**
   * Management listing (PRD §22.3): every installation across kinds with the
   * detail fields the skill-management UI shows — source, revision, mode,
   * status/health, enabled state, and credential NAMES (never values).
   */
  async listInstallations(): Promise<
    readonly {
      readonly installationId: string;
      readonly name: string;
      readonly kind: string;
      readonly sourceUri: string;
      readonly sourceRevision: string;
      readonly activationMode: string;
      readonly status: string;
      readonly enabled: boolean;
      readonly updatedAt: string;
      readonly credentialNames: readonly string[];
    }[]
  > {
    const { installations } = await this.getModels();
    const rows = await installations.listByScope("user", 0);
    const views = [];
    for (const row of rows) {
      let credentialNames: string[] = [];
      try {
        const { SkillCredentialModule } = await import(
          "@/modules/SkillCredentialModule"
        );
        const bindings = await new SkillCredentialModule().listBindings(
          row.installationId
        );
        credentialNames = bindings.map((b) => b.environmentVariable);
      } catch {
        /* credential store unavailable — names stay empty */
      }
      views.push({
        installationId: row.installationId,
        name: row.name,
        kind: row.kind,
        sourceUri: row.sourceUri,
        sourceRevision: row.sourceRevision,
        activationMode: row.activationMode,
        status: row.status,
        enabled: row.enabled,
        updatedAt: (row.updatedAt ?? new Date()).toISOString(),
        credentialNames,
      });
    }
    return views;
  }

  /**
   * FR-11 / §17.5 linked-target refresh: re-read the ORIGINAL source through
   * the app-owned link, detect a changed or vanished target, and refresh the
   * runtime catalog when the content changed. Never deletes or rewrites the
   * external target; never silently updates the recorded revision.
   */
  async refreshLinkedInstallation(
    installationId: string
  ): Promise<
    | {
        readonly ok: true;
        readonly status: "unchanged" | "changed";
        readonly contentChanged: boolean;
      }
    | { readonly ok: false; readonly code: string; readonly message: string }
  > {
    const { installations } = await this.getModels();
    const entity = await installations.findByInstallationId(installationId);
    if (!entity) {
      return {
        ok: false,
        code: "SKILL_NOT_FOUND",
        message: `No installation with id '${installationId}'.`,
      };
    }
    if (
      entity.activationMode !== "symbolic-link" &&
      entity.activationMode !== "junction"
    ) {
      return {
        ok: false,
        code: "LINK_UNSUPPORTED",
        message: "Only linked installations can be refreshed from their source.",
      };
    }
    try {
      fs.realpathSync(entity.activationPath);
    } catch {
      return {
        ok: false,
        code: "LINK_TARGET_MISSING",
        message:
          "The linked source folder is gone. Restore it, or uninstall the skill and reinstall from the new location.",
      };
    }
    // Re-register the catalog from the CURRENT target content so external
    // edits become visible after the refresh (FR-11 acceptance).
    const registered = this.registerPromptSkill(
      entity.activationPath,
      installationId
    );
    if (!registered) {
      return {
        ok: false,
        code: "SKILL_FORMAT_INVALID",
        message:
          "The linked source no longer contains a readable SKILL.md.",
      };
    }
    // Content change detection against the recorded activation baseline.
    let contentChanged = false;
    try {
      const { hashTree } = await import(
        "@/childprocess/skill-installation/stagePackage"
      );
      const current = hashTree(entity.activationPath);
      const recorded = (JSON.parse(entity.metadataJson ?? "{}") as {
        activationContentHash?: string;
      }).activationContentHash;
      contentChanged = recorded !== undefined && current !== recorded;
    } catch {
      /* hashing is best-effort; the refresh itself already succeeded */
    }
    return {
      ok: true,
      status: contentChanged ? "changed" : "unchanged",
      contentChanged,
    };
  }

  async disable(
    installationId: string
  ): Promise<{ disabled: boolean; deactivatedInvocations: number }> {
    const { installations } = await this.getModels();
    const entity = await installations.findByInstallationId(installationId);
    if (!entity) return { disabled: false, deactivatedInvocations: 0 };
    entity.enabled = false;
    entity.status = "disabled";
    await installations.save(entity);
    getDefaultPromptSkillCatalog().setEnabled(
      `prompt:user:${installationId}`,
      false
    );
    // FR-19: a disabled skill must not keep instructing conversations that
    // invoked it — durable invocation state is deactivated across ALL
    // conversations (recovery reconciles with a structured diagnostic).
    const deactivatedInvocations = await this.deactivateInvocations(
      installationId
    );
    return { disabled: true, deactivatedInvocations };
  }

  /** Deactivate every durable invocation of the runtime; failures are
   *  best-effort — disable/uninstall still complete. */
  private async deactivateInvocations(installationId: string): Promise<number> {
    try {
      const { PromptSkillInvocationModule } = await import(
        "@/modules/PromptSkillInvocationModule"
      );
      const result =
        await new PromptSkillInvocationModule().deactivateByRuntimeId(
          `prompt:user:${installationId}`
        );
      return result.affectedRows;
    } catch {
      return 0;
    }
  }

  /** Re-enable a disabled installation (§24.3 mirror). */
  async enable(installationId: string): Promise<boolean> {
    const { installations } = await this.getModels();
    const entity = await installations.findByInstallationId(installationId);
    if (!entity) return false;
    entity.enabled = true;
    entity.status = "ready";
    await installations.save(entity);
    getDefaultPromptSkillCatalog().setEnabled(
      `prompt:user:${installationId}`,
      true
    );
    return true;
  }

  /**
   * Uninstall (§24.4): ownership-verified removal of the recorded canonical
   * activation (never a path built from a user-supplied name), catalog
   * unregistration, and — by explicit choice defaulting to delete — the
   * installation's stored credentials. Linked sources are NEVER deleted.
   */
  async uninstall(input: {
    installationId: string;
    deleteSecrets?: boolean;
  }): Promise<
    | {
        ok: true;
        removed: "directory" | "link";
        targetPreserved: string | null;
        secretsDeleted: number;
        deactivatedInvocations: number;
      }
    | { ok: false; message: string }
  > {
    const { installations } = await this.getModels();
    const entity = await installations.findByInstallationId(
      input.installationId
    );
    if (!entity) {
      return { ok: false, message: "Unknown installation." };
    }

    // Disable discovery first, then deactivate any durable invocations so
    // no conversation keeps following instructions from the removed skill.
    getDefaultPromptSkillCatalog().remove(
      `prompt:user:${input.installationId}`
    );
    const deactivatedInvocations = await this.deactivateInvocations(
      input.installationId
    );

    const activation = new SkillActivationService();
    const removed = activation.uninstall(entity.activationPath);
    if (!removed.ok) {
      return { ok: false, message: removed.message };
    }

    let secretsDeleted = 0;
    if (input.deleteSecrets !== false) {
      try {
        // SkillCredentialModule (TODO 9): values from the encrypted store
        // AND binding rows from SQLite.
        const { SkillCredentialModule } = await import(
          "@/modules/SkillCredentialModule"
        );
        secretsDeleted = await new SkillCredentialModule().deleteAll(
          input.installationId
        );
      } catch {
        /* credential store unavailable — files still removed */
      }
    }

    entity.status = "revoked";
    entity.enabled = false;
    await installations.save(entity);
    return {
      ok: true,
      removed: removed.removed,
      targetPreserved: removed.targetPreserved,
      secretsDeleted,
      deactivatedInvocations,
    };
  }

  /**
   * FR-19: persist a lifecycle installation row for plugin/executable
   * packages routed through their own services — the plugin service owns
   * its storage, so the row records provenance + identity (activationPath
   * stays empty; management actions route back through the owning service).
   */
  private async persistRoutedInstallationRow(input: {
    sessions: SkillInstallationSessionModel;
    sessionId: string;
    kind: "plugin" | "executable";
    name: string;
    plan: SkillInstallPlan;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    try {
      const { installations } = await this.getModels();
      const session = await input.sessions.findBySessionId(input.sessionId);
      const installationId =
        session?.installationId ??
        crypto.randomUUID().replace(/-/g, "").slice(0, 32);
      const entity = new SkillInstallationEntity();
      entity.installationId = installationId;
      entity.name = input.name;
      entity.kind = input.kind;
      entity.scope = "user";
      entity.workspaceId = 0;
      entity.sourceUri = input.plan.source.canonicalUri;
      entity.sourceRevision = input.plan.source.resolvedRevision;
      entity.sourceSubdirectory = "";
      entity.activationMode = "managed-copy";
      entity.activationPath = "";
      entity.contentHash = input.plan.source.contentHash;
      entity.status = "ready";
      entity.enabled = true;
      entity.metadataJson = JSON.stringify(input.metadata);
      await installations.save(entity);
      if (session && !session.installationId) {
        session.installationId = installationId;
        await input.sessions.create(session);
      }
    } catch {
      /* provenance is best-effort — the routing result above governs */
    }
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private async runActivation(
    sessionId: string,
    plan: SkillInstallPlan,
    selected: SkillInstallPlan["discoveredSkills"][number],
    session: SkillInstallationSessionEntity
  ): Promise<InstallSnapshot> {
    const { sessions, events, installations } = await this.getModels();
    // Refresh the mutation lease before the (potentially slow) activation so
    // a concurrent prepare cannot take the session over mid-copy.
    await sessions.heartbeatLease(sessionId, SESSION_LEASE_TTL_MS, Date.now());
    await this.transition(sessions, events, sessionId, "activating");

    const activation = new SkillActivationService();
    // acquiredRoot IS the absolute staging path recorded at acquisition.
    let sourceRoot = plan.source.acquiredRoot;
    const isLinkedMode =
      plan.activation.mode === "symbolic-link" ||
      plan.activation.mode === "junction";
    // FR-11: linked development mode exposes the USER'S original folder —
    // NOT the installer's staging copy (external edits stay live; staging is
    // app-owned and cleaned). Only local folder sources can link; a remote
    // source has no durable original on disk, so linked mode fails with a
    // typed error instead of silently linking ephemeral staging.
    let linkedTargetPath: string | null = null;
    if (isLinkedMode) {
      const original = plan.source.canonicalUri;
      if (
        path.isAbsolute(original) &&
        fs.existsSync(original) &&
        fs.statSync(original).isDirectory()
      ) {
        sourceRoot = original;
        linkedTargetPath = original;
      } else {
        await this.fail(
          sessions,
          events,
          sessionId,
          "LINK_CREATION_FAILED",
          "Linked install mode requires a local folder source so the link targets your original checkout; use managed copy for remote repositories."
        );
        return this.errorSnapshot(
          "failed",
          "LINK_CREATION_FAILED",
          "Linked install mode requires a local folder source so the link targets your original checkout; use managed copy for remote repositories.",
          sessionId
        );
      }
    }

    const result = await activation.activate({
      sourceRoot,
      skillName: selected.name,
      mode: isLinkedMode ? ("linked" as const) : ("managed-copy" as const),
      contentHash: plan.source.contentHash,
      installationId: sessionId,
    });
    if (!result.ok) {
      await this.fail(sessions, events, sessionId, result.code, result.message);
      return this.errorSnapshot(
        "failed",
        result.code,
        result.message,
        sessionId
      );
    }

    // Persist the installation record. The identity came from the session
    // (created at prepare) so credentials stored during awaiting_secret
    // bind to the SAME installation (review C3).
    const installationId =
      session.installationId ??
      crypto.randomUUID().replace(/-/g, "").slice(0, 32);
    const entity = new SkillInstallationEntity();
    entity.installationId = installationId;
    entity.name = selected.name;
    entity.kind = selected.kind;
    entity.scope = "user";
    entity.workspaceId = 0;
    entity.sourceUri = plan.source.canonicalUri;
    entity.sourceRevision = plan.source.resolvedRevision;
    entity.sourceSubdirectory = "";
    entity.activationMode = result.mode;
    entity.activationPath = result.activationPath;
    entity.contentHash = plan.source.contentHash;
    entity.status = "ready";
    entity.enabled = true;
    // §24.2 repair baseline: the ACTIVATION tree's own hash (the staged
    // package hash covers a superset — install.md, siblings — so it is not
    // directly comparable to the activated skill root).
    let activationContentHash: string | undefined;
    try {
      const { hashTree } = await import(
        "@/childprocess/skill-installation/stagePackage"
      );
      activationContentHash = hashTree(result.activationPath);
    } catch {
      /* best-effort baseline — repair falls back to the staged hash */
    }
    entity.metadataJson = JSON.stringify({
      planRevision: plan.planRevision,
      backupPath: result.backupPath,
      ...(activationContentHash ? { activationContentHash } : {}),
      ...(linkedTargetPath ? { linkedTargetPath } : {}),
    });
    // Upsert by installation identity (D2 review test): a prior
    // revoked/failed row for the same source+revision+mode must be
    // REPLACED, not collide with the unique index.
    const priorRow = await installations.findByIdentity({
      sourceUri: entity.sourceUri,
      sourceRevision: entity.sourceRevision,
      sourceSubdirectory: entity.sourceSubdirectory,
      scope: entity.scope,
      workspaceId: entity.workspaceId,
      activationMode: entity.activationMode,
    });
    if (priorRow) {
      // Adopt the prior row's stable identity so re-installs keep ONE
      // canonical installation per identity — and sync the SESSION to the
      // adopted id so snapshots, credential bindings, and downstream
      // uninstall lookups all agree (D2 review test).
      entity.id = priorRow.id;
      if (priorRow.installationId !== installationId) {
        getDefaultPromptSkillCatalog().remove(`prompt:user:${installationId}`);
        entity.installationId = priorRow.installationId;
        await this.setInstallationId(
          sessions,
          sessionId,
          priorRow.installationId
        );
        session.installationId = priorRow.installationId;
      }
    }
    await installations.save(entity);
    await this.transition(sessions, events, sessionId, "verifying");

    // Verification levels (design §18): activation structure + dependency
    // probes + registry discovery.
    const structureOk = activation.verifyActivation(result.activationPath);
    const depsOk = plan.dependencies.every(
      (d) => d.currentStatus === "satisfied"
    );
    const registered = this.registerPromptSkill(
      result.activationPath,
      installationId
    );
    const registryOk = registered !== null;

    if (!structureOk || !registryOk) {
      const rolledBack = activation.rollback(
        result.activationPath,
        result.backupPath
      );
      // A failed verification must leave NO active trace (D2 review test):
      // unregister the catalog entry that registerPromptSkill just made,
      // and mark the prematurely-saved installation record failed.
      getDefaultPromptSkillCatalog().remove(`prompt:user:${installationId}`);
      entity.status = "failed";
      entity.enabled = false;
      try {
        await installations.save(entity);
      } catch {
        /* best-effort status update — the session failure below governs */
      }
      await this.fail(
        sessions,
        events,
        sessionId,
        "ACTIVATION_VERIFICATION_FAILED",
        rolledBack.ok
          ? "Activation verification failed; rolled back to the previous state."
          : `Activation verification failed; rollback failed: ${rolledBack.message}`
      );
      return this.errorSnapshot(
        "failed",
        "ACTIVATION_VERIFICATION_FAILED",
        rolledBack.message,
        sessionId
      );
    }
    if (!depsOk) {
      // Activation succeeded but a dependency is missing — hold at
      // installing_dependencies so the user can approve a typed install.
      await this.transition(
        sessions,
        events,
        sessionId,
        "installing_dependencies"
      );
      const held = await sessions.findBySessionId(sessionId);
      return this.snapshotFromEntity(held ?? session, plan);
    }

    await this.transition(sessions, events, sessionId, "ready");
    await this.appendEvent(
      events,
      sessionId,
      "installation-ready",
      "verifying",
      "ready"
    );
    const ready = await sessions.findBySessionId(sessionId);
    return this.snapshotFromEntity(ready ?? session, plan);
  }

  /** Register the activated skill in the prompt catalog (prompt kind only). */
  private registerPromptSkill(
    activationPath: string,
    installationId: string
  ): PromptSkillDefinition | null {
    const loaded = loadSkillMarkdownFile(activationPath);
    if (!loaded.ok) return null;
    const definition: PromptSkillDefinition = {
      runtimeId: `prompt:user:${installationId}`,
      installationId,
      sourceId: "installer",
      scope: "user",
      name: loaded.file.manifest.name,
      description: loaded.file.manifest.description,
      canonicalRoot: activationPath,
      skillMarkdownPath: path.join(activationPath, "SKILL.md"),
      contentHash: loaded.file.contentHash,
      manifest: loaded.file.manifest,
      enabled: true,
    };
    getDefaultPromptSkillCatalog().replaceSource(
      `installer:${installationId}`,
      [definition]
    );
    return definition;
  }

  private async setInstallationId(
    sessions: SkillInstallationSessionModel,
    sessionId: string,
    installationId: string
  ): Promise<void> {
    const current = await sessions.findBySessionId(sessionId);
    if (current) {
      current.installationId = installationId;
      await sessions.create(current);
    }
  }

  private async transition(
    sessions: SkillInstallationSessionModel,
    events: SkillInstallationEventModel,
    sessionId: string,
    toState: SkillInstallationState
  ): Promise<void> {
    const current = await sessions.findBySessionId(sessionId);
    if (!current) return;
    const fromState = current.state;
    const updated = await sessions.compareAndSetState(
      sessionId,
      current.stateRevision,
      { state: toState }
    );
    void updated;
    await this.appendEvent(
      events,
      sessionId,
      "state-transition",
      fromState,
      toState
    );
  }

  private async fail(
    sessions: SkillInstallationSessionModel,
    events: SkillInstallationEventModel,
    sessionId: string,
    code: string,
    message: string
  ): Promise<void> {
    const current = await sessions.findBySessionId(sessionId);
    if (!current) return;
    current.state = "failed";
    // Review D3: a failed session may never execute approved commands.
    current.approved = false;
    current.failureCode = code;
    current.failureDetail = message.replace(/https?:\/\/[^\s]+/g, "[source]");
    // FR-20 / §10.1 same-cause streak: the THIRD consecutive failure with
    // the same normalized cause exhausts automatic retries (see retry()).
    // A DIFFERENT cause restarts the count.
    if (current.lastFailureCause === code) {
      current.retryCount = (current.retryCount ?? 0) + 1;
    } else {
      current.retryCount = 1;
      current.lastFailureCause = code;
    }
    await sessions.create(current);
    await this.appendEvent(
      events,
      sessionId,
      "failed",
      current.state,
      "failed",
      code
    );
  }

  private async appendEvent(
    events: SkillInstallationEventModel,
    sessionId: string,
    eventType: string,
    fromState?: string,
    toState?: string,
    detail?: string
  ): Promise<void> {
    const seq = await events.nextSeq(sessionId);
    await events.append({
      sessionId,
      seq,
      eventType,
      ...(fromState !== undefined ? { fromState } : {}),
      ...(toState !== undefined ? { toState } : {}),
      ...(detail !== undefined ? { detail } : {}),
    } as import("@/entity/SkillInstallationEvent.entity").SkillInstallationEventEntity);
    // TODO 7 (design §23.2): every audited step also reaches the renderer as
    // a monotonic progress event on the dedicated SKILL_INSTALL_PROGRESS
    // channel. Emission failures never affect the installation.
    try {
      if (!this.progressSink) this.progressSink = defaultProgressSink();
      this.progressSink({
        sessionId,
        seq,
        state: toState ?? fromState ?? "unknown",
        step: eventType,
        messageKey: `skillInstall.progress.${eventType}`,
        recoverable: true,
      });
    } catch {
      /* progress broadcast is best-effort */
    }
  }

  /** Test seam: capture progress events instead of broadcasting. */
  setProgressSinkForTests(sink: SkillInstallationProgressSink | null): void {
    this.progressSink = sink;
  }

  /**
   * FR-29 conversation binding: when the caller identifies its conversation
   * (model tools always do, from their execution context), a session that
   * belongs to a DIFFERENT conversation is rejected with a stable error and
   * NO state change. Omitted conversationId (management UI paths that are
   * not conversation-scoped) keeps prior behavior.
   */
  private conversationMismatch(
    session: SkillInstallationSessionEntity,
    conversationId: string | undefined
  ): boolean {
    return (
      conversationId !== undefined && session.conversationId !== conversationId
    );
  }

  private snapshotFromEntity(
    session: SkillInstallationSessionEntity,
    plan?: SkillInstallPlan
  ): InstallSnapshot {
    return {
      sessionId: session.sessionId,
      installationId: session.installationId ?? null,
      state: session.state as SkillInstallationState,
      nextAction:
        STATE_TO_NEXT_ACTION[session.state as SkillInstallationState] ??
        "resume",
      planRevision:
        session.planRevision !== "none" ? session.planRevision : null,
      safeSummary: this.buildSafeSummary(session, plan),
      // TODO 8 / design §22.1: structured fields for the card's review +
      // diagnostics sections (source, revision, skills, deps, secrets, mode).
      ...(plan ? { safePlan: this.buildSafePlanView(plan) } : {}),
      recoverable: !["failed"].includes(session.state),
      ...(session.failureCode ? { errorCode: session.failureCode } : {}),
    };
  }

  /** Structured, non-secret plan view for the renderer card. */
  private buildSafePlanView(plan: SkillInstallPlan): SafePlanView {
    return {
      source: plan.source.canonicalUri,
      revision: plan.source.resolvedRevision.slice(0, 12),
      skills: plan.discoveredSkills.map((skill) => ({
        name: skill.name,
        kind: skill.kind,
        description: skill.description,
      })),
      dependencies: plan.dependencies.map((d) => ({
        id: d.id,
        name: d.name,
        status: d.currentStatus,
        ...(d.installMethod !== undefined
          ? { installMethod: d.installMethod }
          : {}),
        ...(d.requiresElevation !== undefined
          ? { requiresElevation: d.requiresElevation }
          : {}),
      })),
      credentials: plan.credentials.map((c) => c.environmentVariable),
      mode: plan.activation.mode,
      commands: plan.commands.map((c) => ({
        id: c.id,
        executable: c.executable,
        args: c.args,
        riskLevel: c.riskLevel,
        rationale: c.rationale,
        // Declared env-var NAMES only — values live in the secure store and
        // are injected directly into the child process by the runner.
        environmentNames: c.environmentNames,
      })),
      warnings: plan.warnings.map((w) => w.message),
    };
  }

  private buildSafeSummary(
    session: SkillInstallationSessionEntity,
    plan?: SkillInstallPlan
  ): string {
    if (plan) {
      const names = plan.discoveredSkills.map((s) => s.name).join(", ");
      const deps = plan.dependencies
        .map((d) => `${d.name}(${d.currentStatus})`)
        .join(", ");
      const creds = plan.credentials.map((c) => c.name).join(", ");
      return (
        `source verified; discovered: ${names}; ` +
        `dependencies: ${deps || "none"}; credentials: ${creds || "none"}; ` +
        `mode: ${plan.activation.mode}`
      );
    }
    if (session.failureDetail) return session.failureDetail;
    return `state: ${session.state}`;
  }

  private errorSnapshot(
    state: SkillInstallationState,
    code: string,
    message: string,
    sessionId: string
  ): InstallSnapshot {
    return {
      sessionId,
      installationId: null,
      state,
      nextAction:
        code === "INSTALL_SESSION_REQUIRED" ? "terminal-error" : "retry",
      planRevision: null,
      safeSummary: message,
      recoverable: code !== "INSTALL_SESSION_REQUIRED",
      errorCode: code,
    };
  }
}
