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
import { SkillDependencyBindingModel } from "@/model/SkillDependencyBinding.model";
import { SkillInstallationEntity } from "@/entity/SkillInstallation.entity";
import { SkillInstallationSessionEntity } from "@/entity/SkillInstallationSession.entity";
import type {
  ApprovedCommandTemplate,
  InstallSnapshot,
  SafePlanView,
  SkillInstallPlan,
  SkillInstallationState,
  SkillInstallNextAction,
  SkillManualActionApprovalRecord,
} from "@/entityTypes/skillInstallationTypes";
import { parseManualActionApprovalDetail } from "@/entityTypes/skillInstallationTypes";
import {
  SkillSourceAcquisitionService,
  normalizeSkillSource,
} from "@/service/SkillSourceAcquisitionService";
import { SkillPackageInspectionService } from "@/service/SkillPackageInspectionService";
import { buildSkillInstallPlan } from "@/service/SkillInstallPlanner";
import {
  SkillActivationService,
  resolvePromptSkillRoot,
} from "@/service/SkillActivationService";
import { detectAll } from "@/service/SkillDependencyOrchestrator";
import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";
import { loadSkillMarkdownFile } from "@/service/PromptSkillLoader";
import { toolCatalogCounters } from "@/service/ToolCatalogCounters";
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
  awaiting_commands: "run-commands",
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
  /** Audit R9: persistent dependency bindings (design §14.1). */
  private dependencyBindingModel: SkillDependencyBindingModel | null = null;

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

  /** Audit R9: lazily-built dependency-binding model on the shared path. */
  private async getDependencyBindingModel(): Promise<SkillDependencyBindingModel> {
    await this.ensureConnection();
    if (!this.dependencyBindingModel) {
      this.dependencyBindingModel = new SkillDependencyBindingModel(
        this.dbpath
      );
    }
    return this.dependencyBindingModel;
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
    // AND the same full request identity resumes instead of re-acquiring
    // (audit finding 1 — ref/subdirectory/mode must match, or the request
    // gets its OWN session rather than a foreign one).
    if (!request.sessionId) {
      const active = await sessions.findActiveByCanonicalUri(
        descriptor.canonicalUri
      );
      const matching = active
        .filter((s) =>
          SkillInstallationSessionModel.requestIdentityMatches(s, {
            ref: request.ref,
            subdirectory: request.subdirectory,
            mode: request.mode,
          })
        )
        // Audit R4: a session belongs to its CREATING conversation
        // (FR-29) — an identical request from a different conversation
        // must get its OWN session, never a foreign one whose
        // conversation-bound operations would then mismatch.
        .filter(
          (s) =>
            s.conversationId ===
            (request.conversationId ?? s.conversationId)
        );
      if (matching.length > 0) {
        return this.snapshotFromEntity(matching[0]);
      }
      // A healthy ready installation of the same source is REPORTED as
      // ready — never re-acquired because the model asked again.
      const ready = await installations.findReadyBySourceUri(
        descriptor.canonicalUri
      );
      if (ready.length > 0) {
        // Ready reuse requires the full request identity (audit findings
        // 1 + R4): subdirectory must match when the request pins one; the
        // request-level mode "linked" equals the persisted symbolic-link /
        // junction forms (different representations of the same choice);
        // a full-SHA pin compares exactly, while a symbolic ref
        // (branch/tag) cannot be compared to the stored resolved SHA, so
        // ref-pinned requests never shortcut — they re-prepare and
        // re-resolve.
        const normalizeMode = (
          m: string | null | undefined
        ): string | null => {
          if (!m) return null;
          return m === "linked" || m === "symbolic-link" || m === "junction"
            ? "linked"
            : m;
        };
        const requestSubdir =
          descriptor.subdirectory && descriptor.subdirectory !== "."
            ? descriptor.subdirectory
            : null;
        const requestedSha =
          descriptor.requestedRevision &&
          /^[0-9a-f]{40}$/i.test(descriptor.requestedRevision)
            ? descriptor.requestedRevision.toLowerCase()
            : null;
        const identityReady = ready.filter((r) => {
          // Subdirectory: a pinned request only accepts the same subdir
          // (the audit's root-vs-nested probe).
          if (
            requestSubdir &&
            (r.sourceSubdirectory ?? "") !== requestSubdir
          ) {
            return false;
          }
          // Mode: normalized comparison ("linked" == symbolic-link/junction).
          if (
            request.mode &&
            normalizeMode(r.activationMode) !== normalizeMode(request.mode)
          ) {
            return false;
          }
          // Revision: a full-SHA pin compares exactly; a symbolic ref
          // NEVER reuses (cannot be verified against the stored SHA
          // without re-resolution).
          if (descriptor.requestedRevision && !requestedSha) return false;
          if (requestedSha && (r.sourceRevision ?? "") !== requestedSha) {
            return false;
          }
          return true;
        });
        const verified = identityReady.some((r) =>
          new SkillActivationService().verifyActivation(r.activationPath)
        );
        if (verified && identityReady.length > 0) {
          return {
            sessionId: `installation:${identityReady[0].installationId}`,
            installationId: identityReady[0].installationId,
            state: "ready",
            nextAction: "ready",
            planRevision: null,
            safeSummary: `'${identityReady[0].name}' is already installed and healthy; no changes made.`,
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
          // Full request identity persisted AT CREATION (audit finding 1):
          // idempotent reuse and the transactional claim compare these.
          requestedRevision: descriptor.requestedRevision ?? null,
          requestedSubdirectory: descriptor.subdirectory ?? null,
          requestedMode: request.mode ?? null,
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
    // Same-name replacement detection (§24.1, audit finding 3): map of
    // enabled skill NAME -> its source URI for the plan warning.
    const existingEnabledByName = new Map<string, string>();
    for (const pkg of inspection.discovered) {
      const rows = await installations.findEnabledByName(pkg.name);
      const enabled = rows.find((r) => r.enabled === true);
      if (enabled) existingEnabledByName.set(pkg.name, enabled.sourceUri);
    }
    // The inspection root (subdirectory applied) is the base candidates'
    // rootRelativePaths are relative TO — record it on the plan source so
    // activation/plugin/executable routing resolves the right directory
    // (audit finding 2: acquiredRoot alone ignores the subdirectory).
    const inspectionRoot = descriptor.subdirectory
      ? path.join(acquired.source.acquiredRoot, descriptor.subdirectory)
      : acquired.source.acquiredRoot;
    // Audit R9 (PRD §18.1): a bounded top-level file listing feeds
    // language-environment classification (requirements.txt / package.json).
    let stagedFiles: string[] = [];
    try {
      stagedFiles = fs
        .readdirSync(inspectionRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .slice(0, 500);
    } catch {
      /* unreadable root — environment classification stays text-based */
    }
    const prePlan = buildSkillInstallPlan({
      sessionId,
      source: { ...acquired.source, acquiredRoot: inspectionRoot },
      discovered: inspection.discovered,
      instructionFiles: inspection.instructionFiles,
      activationMode: request.mode === "linked" ? "linked" : "managed-copy",
      // Audit R9 (PRD §22.2): the REAL activation location the plan names —
      // the review card shows where the files land, not a placeholder.
      activationTargetDir: resolvePromptSkillRoot(),
      constraints: request.constraints ?? [],
      existingEnabledByName,
      stagedFiles,
    });
    const detectedDeps = await detectAll(
      prePlan.dependencies,
      acquired.source.acquiredRoot
    );
    // Review RV2: seed the approved-command verification baseline from the
    // INSPECTION root (the plan's acquiredRoot — the subdirectory when one
    // was requested). plan.source.contentHash covers the WHOLE acquired
    // repository, so comparing it against the sub-root's tree hash made a
    // subdirectory install's first approved command always fail.
    let commandBaselineHash: string | undefined;
    try {
      const { hashTree } = await import(
        "@/childprocess/skill-installation/stagePackage"
      );
      commandBaselineHash = hashTree(inspectionRoot);
    } catch {
      /* hashing unavailable — the runner hard-refuses instead */
    }
    const plan: SkillInstallPlan = {
      ...prePlan,
      // Audit finding 11: the request's non-secret constraints join the
      // persisted contract (the planner already consumes them for
      // instruction precedence; the plan is the durable home).
      ...(request.constraints && request.constraints.length > 0
        ? { constraints: request.constraints }
        : {}),
      ...(commandBaselineHash !== undefined ? { commandBaselineHash } : {}),
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
    // Review D1: approval must be bound to a human gesture. The token is
    // created at prepare and handed ONLY to the renderer approval card; a
    // model-originated approve (no token, or a wrong one) is rejected —
    // on EVERY state, not just awaiting_approval. The guard runs BEFORE
    // the state echo below so a wrong-token call on a held/paused session
    // can never be silently answered with the current snapshot (CI D1
    // regression: installing_dependencies hold returned errorCode
    // undefined instead of APPROVAL_REQUIRED).
    if (session.approvalToken) {
      if (
        input.approvalToken === undefined ||
        input.approvalToken !== session.approvalToken
      ) {
        return this.errorSnapshot(
          session.state as SkillInstallationState,
          "APPROVAL_REQUIRED",
          "Installation approval must come from the user's install card. " +
            "Present the plan and wait for the user to approve it.",
          input.sessionId
        );
      }
    }
    if (session.state !== "awaiting_approval") {
      return this.snapshotFromEntity(session);
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

    let plan = JSON.parse(session.planJson ?? "{}") as SkillInstallPlan;
    // Persist the user's submission INTO the plan (audit finding 2): a
    // multi-selection must survive the approve round-trip so later stages
    // (secret resume, dependency continuation) resolve the same candidates.
    if (
      input.selectedSkillIds &&
      input.selectedSkillIds.length > 0 &&
      input.selectedSkillIds.some((id) => !plan.selectedSkillIds.includes(id))
    ) {
      plan = { ...plan, selectedSkillIds: [...input.selectedSkillIds] };
      await sessions.savePlan(
        input.sessionId,
        session.planRevision,
        JSON.stringify(plan)
      );
    }
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

    // The ONE §18.4 continuation (audit R1): deps -> credentials ->
    // commands -> kind routing/activation. Every hold is enforced on every
    // path; the per-path duplicates are gone. approve() uses the
    // "declared" credential pause — a fresh approval always shows the
    // secure-input step for every declared credential (§19.3 / C3).
    return this.continueInstallation(input.sessionId, plan, session, {
      credentialPause: "declared",
    });
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
    sessions: SkillInstallationSessionModel,
    selected: SkillInstallPlan["discoveredSkills"][number]
  ): Promise<InstallSnapshot> {
    await this.transition(sessions, events, sessionId, "activating");
    try {
      const { PluginImportService } = await import(
        "@/service/PluginImportService"
      );
      // Route the SELECTED candidate's root (nested/wrapper layouts), not
      // the acquisition root (audit finding 2).
      const pluginRoot =
        selected.rootRelativePath &&
        selected.rootRelativePath !== "." &&
        selected.rootRelativePath !== ""
          ? path.join(plan.source.acquiredRoot, selected.rootRelativePath)
          : plan.source.acquiredRoot;
      const result = await PluginImportService.installFromLocalRoot(
        pluginRoot,
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
      // (The plugin summary is optional — a minimal plugin import result
      // carries no summary; the row then falls back to the plan name.)
      await this.persistRoutedInstallationRow({
        sessions,
        sessionId,
        kind: "plugin",
        name: result.plugin?.name ?? plan.discoveredSkills[0]?.name ?? "plugin",
        plan,
        metadata: {
          ...(result.plugin ? { pluginId: result.plugin.id } : {}),
          ...(result.plugin?.version !== undefined
            ? { pluginVersion: result.plugin.version }
            : {}),
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
    sessions: SkillInstallationSessionModel,
    selected: SkillInstallPlan["discoveredSkills"][number]
  ): Promise<InstallSnapshot> {
    await this.transition(sessions, events, sessionId, "activating");
    try {
      const { SkillImportService } = await import(
        "@/service/SkillImportService"
      );
      const executableRoot =
        selected.rootRelativePath &&
        selected.rootRelativePath !== "." &&
        selected.rootRelativePath !== ""
          ? path.join(plan.source.acquiredRoot, selected.rootRelativePath)
          : plan.source.acquiredRoot;
      const result = await SkillImportService.importFromDirectory(
        executableRoot
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
      await this.appendEvent(
        events,
        input.sessionId,
        "installation-ready",
        "installing_dependencies",
        "installing_dependencies",
        `dependency ${dependency.name} installed and verified`
      );
      // Dependencies satisfied -> the unified §18.4 continuation
      // (credentials -> commands -> routing/activation; audit R1: the
      // command checkpoint can no longer be skipped here either).
      return this.continueInstallation(input.sessionId, updatedPlan, session);
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
    const heldSnapshot = await this.snapshotFromEntity(
      held ?? session,
      updatedPlan
    );
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
    // Ticket P1-2 (decline path): only roll back when THIS session actually
    // activated — a held UPDATE session adopted the existing identity but
    // wrote nothing; declining its dependency must not delete the working
    // installation's files.
    const activated = await this.sessionActivatedAnything(
      events,
      session.sessionId
    );
    if (session.installationId && activated) {
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
    if (session.state !== "awaiting_secret") {
      return this.snapshotFromEntity(session);
    }
    const plan = JSON.parse(session.planJson ?? "{}") as SkillInstallPlan;
    // FR-15/FR-17 gate: the session leaves awaiting_secret ONLY when every
    // REQUIRED credential named by the plan is configured. A partial
    // submission keeps the pause (finding 5).
    const missing = await this.unconfiguredCredentials(session, plan);
    if (missing.length > 0) {
      await this.appendEvent(
        events,
        sessionId,
        "secret-still-missing",
        "awaiting_secret",
        "awaiting_secret",
        missing.join(", ")
      );
      const awaiting = await sessions.findBySessionId(sessionId);
      return this.snapshotFromEntity(awaiting ?? session, plan);
    }
    // Credentials complete -> the unified §18.4 continuation (commands
    // can no longer be skipped here; audit R1).
    return this.continueInstallation(sessionId, plan, session);
  }

  /**
   * Required plan credentials that are NOT yet configured for this
   * session's installation identity. Values are never read here — only
   * the credential module's configured-status check (§19.2).
   */
  private async unconfiguredCredentials(
    session: SkillInstallationSessionEntity,
    plan: SkillInstallPlan
  ): Promise<readonly string[]> {
    const required = plan.credentials
      .filter((c) => c.required)
      .map((c) => c.environmentVariable);
    if (required.length === 0 || !session.installationId) return [];
    const { SkillCredentialModule } = await import(
      "@/modules/SkillCredentialModule"
    );
    const credentialModule = new SkillCredentialModule();
    return required.filter(
      (name) =>
        !credentialModule.isConfigured(session.installationId as string, name)
    );
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
    // Completion bookkeeping (audit finding 4): a successful run marks the
    // command complete in the plan; once every template has completed, a
    // session held at awaiting_commands advances.
    if (result.ok && session.state === "awaiting_commands") {
      const updatedPlan: SkillInstallPlan = {
        ...plan,
        commands: plan.commands.map((c) =>
          c.id === commandId
            ? {
                ...c,
                rationale: c.rationale.endsWith(" [completed]")
                  ? c.rationale
                  : `${c.rationale} [completed]`,
              }
            : c
        ),
        // Review RV1: persist the post-run tree hash so the NEXT approved
        // command — possibly in a fresh process — sanctions this run's
        // writes instead of failing with SOURCE_CHANGED_AFTER_APPROVAL.
        ...(result.postRunBaselineHash !== undefined
          ? { commandBaselineHash: result.postRunBaselineHash }
          : {}),
      };
      await sessions.savePlan(
        sessionId,
        session.planRevision,
        JSON.stringify(updatedPlan)
      );
      if (this.pendingCommandsFor(session, updatedPlan).length === 0) {
        // All commands complete -> the unified §18.4 continuation, which
        // invokes the kind-appropriate import service for executable/plugin
        // plans instead of only transitioning to activating (audit R1).
        await this.continueInstallation(sessionId, updatedPlan, session);
      }
    }
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
   * The ONE §18.4 continuation (audit R1): given an APPROVED session's
   * current plan, advance through every remaining hold in order —
   * missing dependencies -> awaiting_secret -> awaiting_commands -> the
   * kind-appropriate activation/import -> verify -> ready. approve(),
   * resumeAfterSecret(), approveDependency completion, and runApprovedCommand
   * completion all route through here so no path can skip a hold.
   */
  private async continueInstallation(
    sessionId: string,
    plan: SkillInstallPlan,
    session: SkillInstallationSessionEntity,
    opts: { readonly credentialPause?: "declared" | "unconfigured" } = {}
  ): Promise<InstallSnapshot> {
    const credentialPause = opts.credentialPause ?? "unconfigured";
    const { sessions, events } = await this.getModels();
    const fresh = async (): Promise<SkillInstallationSessionEntity> =>
      (await sessions.findBySessionId(sessionId)) ?? session;

    // 1. Missing dependencies hold FIRST (the ElevenLabs sequence). Review
    //    RV8: an INCOMPATIBLE dependency (probe passed but the version is
    //    below the declared constraint) holds exactly like a missing one —
    //    activation on a known-broken dependency was silent. Classification
    //    items (mcp-server / model-artifact, permanently "unknown") do NOT
    //    hold: they are visible setup decisions without an install path.
    if (
      plan.dependencies.some(
        (d) => d.currentStatus === "missing" || d.currentStatus === "incompatible"
      )
    ) {
      await this.transition(sessions, events, sessionId, "installing_dependencies");
      return this.snapshotFromEntity(await fresh(), plan);
    }

    // 2. Credential pause. "declared" (approve's fresh review) pauses for
    // EVERY declared credential — the user has not seen the secure-input
    // step for THIS approval. "unconfigured" (the continuation paths)
    // pauses only for values still missing, so an already-stored value
    // never dead-ends a resume.
    if (plan.credentials.length > 0) {
      const shouldPause =
        credentialPause === "declared"
          ? true
          : (await this.unconfiguredCredentials(session, plan)).length > 0;
      if (shouldPause) {
        await this.transition(sessions, events, sessionId, "awaiting_secret");
        return this.snapshotFromEntity(await fresh(), plan);
      }
    }

    // 3. Pending required commands.
    if (this.pendingCommandsFor(session, plan).length > 0) {
      await this.transition(sessions, events, sessionId, "awaiting_commands");
      return this.snapshotFromEntity(await fresh(), plan);
    }

    // 4. Kind routing (FR-07) — multi-skill selection (audit R2) iterates
    // every SELECTED candidate; single-skill keeps the historical path.
    const selected = plan.discoveredSkills.filter((c) =>
      plan.selectedSkillIds.includes(c.candidateId)
    );
    const chosen =
      selected.length > 0 ? selected : [plan.discoveredSkills[0]].filter(Boolean);
    if (chosen.length === 0) {
      return this.errorSnapshot(
        (await fresh()).state as SkillInstallationState,
        "SKILL_AMBIGUOUS",
        "Select which discovered skill(s) to activate.",
        sessionId
      );
    }
    let last: InstallSnapshot | null = null;
    for (let i = 0; i < chosen.length; i += 1) {
      const candidate = chosen[i];
      // Audit R2: every candidate needs a DISTINCT installation identity —
      // candidate 0 keeps the session's (credential binding, review C3),
      // later candidates receive fresh overrides so their rows and catalog
      // entries cannot overwrite their siblings.
      const identity =
        i === 0
          ? undefined
          : {
              installationId: crypto
                .randomUUID()
                .replace(/-/g, "")
                .slice(0, 32),
            };
      if (candidate.kind === "plugin") {
        last = await this.routeToPluginService(sessionId, plan, events, sessions, candidate);
      } else if (candidate.kind === "executable") {
        last = await this.routeToExecutableService(sessionId, plan, events, sessions, candidate);
      } else {
        last = await this.runActivation(
          sessionId,
          plan,
          candidate,
          await fresh(),
          identity
        );
      }
      // Review RV7: stop on EVERY unsuccessful terminal — a candidate that
      // ended in rollback_required used to be concealed by the next
      // candidate reporting ready, leaving the session's recovery state
      // overwritten and the user misled.
      if (
        last &&
        (last.state === "failed" || last.state === "rollback_required")
      ) {
        return last;
      }
    }
    return last as InstallSnapshot;
  }

  /** Compose a requested subdirectory with a candidate wrapper path
   *  (audit R5): both may be present; neither clobbers the other. */
  private composeSubdirectory(
    requested: string | null,
    candidate: string | null | undefined
  ): string {
    const parts = [requested, candidate].filter(
      (p): p is string => Boolean(p && p !== "." && p !== "")
    );
    return parts.length > 0 ? path.join(...parts) : "";
  }

  /** Plan commands not yet executed (audit finding 4 checkpoint). */
  private pendingCommandsFor(
    _session: SkillInstallationSessionEntity,
    plan: SkillInstallPlan
  ): readonly ApprovedCommandTemplate[] {
    void _session;
    return plan.commands.filter((c) => !c.rationale.includes("[completed]"));
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

  /**
   * Ticket P1-2: did THIS session reach activation? An UPDATE session
   * adopts the EXISTING installation's identity at update() time, so a
   * held update (installing_dependencies) carries a non-null
   * installationId while having activated nothing — rolling it back would
   * delete or stale-restore the WORKING installation's files. A session
   * whose own history shows the activating/verifying transition wrote the
   * current activation; the installing_dependencies hold exists both
   * BEFORE (approve-time hold) and AFTER (post-activation deps hold)
   * activation, so the history is the discriminator. Unreadable history
   * fails SAFE for the user's files: no rollback.
   */
  private async sessionActivatedAnything(
    events: SkillInstallationEventModel,
    sessionId: string
  ): Promise<boolean> {
    try {
      const history = await events.listBySession(sessionId);
      return history.some(
        (e) => e.toState === "activating" || e.toState === "verifying"
      );
    } catch {
      return false;
    }
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
    // Ticket P1-2: the installing_dependencies hold fires BOTH before
    // activation (approve-time hold — an update session here adopted the
    // existing identity but wrote nothing) and after (post-activation deps
    // hold); only a session that ACTUALLY activated gets rolled back.
    const reachedActivation =
      ["activating", "verifying"].includes(session.state) ||
      (session.state === "installing_dependencies" &&
        (await this.sessionActivatedAnything(events, sessionId)));
    if (reachedActivation) {
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
    // the same canonical source and inherits the failure streak. The
    // RETRY resumes the persisted checkpoint — ref, subdirectory, mode,
    // constraints, and selection (audit findings 11 + R6 / FR-20 §10.1).
    // requestedMode stores the REQUEST-level value ("linked" |
    // "managed-copy") — earlier code compared against the persisted
    // symbolic-link/junction forms, so linked retries silently became
    // managed copies.
    const priorPlan = this.parsePlan(session);
    const constraints =
      priorPlan?.constraints && priorPlan.constraints.length > 0
        ? [...priorPlan.constraints]
        : undefined;
    return this.prepare({
      conversationId: session.conversationId,
      source,
      ...(session.requestedRevision
        ? { ref: session.requestedRevision }
        : {}),
      ...(session.requestedSubdirectory
        ? { subdirectory: session.requestedSubdirectory }
        : {}),
      ...(session.requestedMode === "linked" ||
      session.requestedMode === "managed-copy"
        ? { mode: session.requestedMode }
        : {}),
      ...(constraints ? { constraints } : {}),
    });
  }

  /** Parse a session's persisted plan JSON; null when absent/unreadable. */
  private parsePlan(session: SkillInstallationSessionEntity): SkillInstallPlan | null {
    try {
      if (!session.planJson) return null;
      return JSON.parse(session.planJson) as SkillInstallPlan;
    } catch {
      return null;
    }
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
    const updateSession = await this.prepare({
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
    if (typeof updateSession.sessionId !== "string") return updateSession;
    // FR-19 (audit finding 3): the update session carries the EXISTING
    // installation identity so credential bindings survive the revision
    // change and the activation upsert supersedes the old row instead of
    // leaving a second ready record.
    await this.setInstallationId(
      (await this.getModels()).sessions,
      updateSession.sessionId,
      entity.installationId
    );
    return updateSession;
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
          detail: `Linked target is missing (${
            err instanceof Error ? err.message : String(err)
          }). Restore the folder or reinstall.`,
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
      /** Audit finding 12 (PRD §22.2–§22.4): manager surface gains the
       *  linked canonical target, the source subdirectory, and the
       *  recorded content hash (last-verification baseline). */
      readonly linkedTargetPath?: string;
      readonly sourceSubdirectory?: string;
      readonly contentHash?: string;
      /** Audit R9 (PRD §22.3): the activation location on disk — the
       *  reveal-source action opens its containing folder. Main-process
       *  owned value from the installation row, never renderer-supplied. */
      readonly activationPath?: string;
      /** Audit R9 (PRD §22.3): dependency bindings — detected versions,
       *  resolved paths, and the last verification time. */
      readonly dependencies?: readonly {
        readonly name: string;
        readonly kind: string;
        readonly status: string;
        readonly detectedVersion?: string;
        readonly requiredVersion?: string;
        readonly resolvedPath?: string;
        readonly provider?: string;
        readonly verifiedAt?: string;
      }[];
      /** Audit R9 (PRD §22.3): permission kinds granted at approval. */
      readonly grantedPermissions?: readonly string[];
      /** Audit R9 (PRD §22.3): the activation verification baseline time. */
      readonly verifiedAt?: string;
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
      let linkedTargetPath: string | undefined;
      let contentHash: string | undefined;
      let grantedPermissions: string[] | undefined;
      let verifiedAt: string | undefined;
      try {
        const metadata = JSON.parse(row.metadataJson ?? "{}") as {
          linkedTargetPath?: string;
          activationContentHash?: string;
          grantedPermissions?: string[];
          verifiedAt?: string;
        };
        linkedTargetPath = metadata.linkedTargetPath;
        contentHash = metadata.activationContentHash;
        grantedPermissions = metadata.grantedPermissions;
        verifiedAt = metadata.verifiedAt;
      } catch {
        /* unreadable metadata — optional fields stay absent */
      }
      // Audit R9 (design §14.1): the installation's persisted dependency
      // bindings — detected version, resolved path, last verification.
      let dependencies:
        | {
            name: string;
            kind: string;
            status: string;
            detectedVersion?: string;
            requiredVersion?: string;
            resolvedPath?: string;
            provider?: string;
            verifiedAt?: string;
          }[]
        | undefined;
      try {
        const bindingRows = await (
          await this.getDependencyBindingModel()
        ).listByInstallation(row.installationId);
        dependencies = bindingRows.map((binding) => ({
          name: binding.dependencyName,
          kind: binding.kind,
          status: binding.status,
          ...(binding.detectedVersion
            ? { detectedVersion: binding.detectedVersion }
            : {}),
          ...(binding.requiredVersion
            ? { requiredVersion: binding.requiredVersion }
            : {}),
          ...(binding.resolvedPath
            ? { resolvedPath: binding.resolvedPath }
            : {}),
          ...(binding.provider ? { provider: binding.provider } : {}),
          ...(binding.verifiedAt
            ? { verifiedAt: binding.verifiedAt.toISOString() }
            : {}),
        }));
      } catch {
        /* bindings unavailable — optional field stays absent */
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
        ...(linkedTargetPath ? { linkedTargetPath } : {}),
        ...(row.sourceSubdirectory
          ? { sourceSubdirectory: row.sourceSubdirectory }
          : {}),
        ...(contentHash ? { contentHash } : {}),
        ...(row.activationPath ? { activationPath: row.activationPath } : {}),
        ...(dependencies ? { dependencies } : {}),
        ...(grantedPermissions ? { grantedPermissions } : {}),
        ...(verifiedAt ? { verifiedAt } : {}),
      });
    }
    return views;
  }

  /**
   * Audit R9 (PRD §22.3 reveal-source): the installation's activation path
   * resolved from the persisted row — the reveal action opens its
   * containing folder. The id is looked up; the renderer never supplies a
   * path.
   */
  async getActivationPath(
    installationId: string
  ): Promise<{ ok: true; activationPath: string } | { ok: false; code: string; message: string }> {
    const { installations } = await this.getModels();
    const entity = await installations.findByInstallationId(installationId);
    if (!entity) {
      return {
        ok: false,
        code: "SKILL_NOT_FOUND",
        message: `No installation with id '${installationId}'.`,
      };
    }
    if (!entity.activationPath) {
      return {
        ok: false,
        code: "ACTIVATION_PATH_MISSING",
        message: "This installation has no recorded activation path.",
      };
    }
    return { ok: true, activationPath: entity.activationPath };
  }

  /**
   * FR-11 / §17.5 linked-target refresh: re-read the ORIGINAL source through
   * the app-owned link, detect a changed or vanished target, and refresh the
   * runtime catalog when the content changed. Never deletes or rewrites the
   * external target; never silently updates the recorded revision.
   */
  async refreshLinkedInstallation(installationId: string): Promise<
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
        message:
          "Only linked installations can be refreshed from their source.",
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
        message: "The linked source no longer contains a readable SKILL.md.",
      };
    }
    // Content change detection against the recorded activation baseline.
    let contentChanged = false;
    try {
      const { hashTree } = await import(
        "@/childprocess/skill-installation/stagePackage"
      );
      const current = hashTree(entity.activationPath);
      const recorded = (
        JSON.parse(entity.metadataJson ?? "{}") as {
          activationContentHash?: string;
        }
      ).activationContentHash;
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

  /**
   * FR-30: the PERSISTED routing decision for a conversation — its most
   * recent active installer session. The tool boundary enforces against
   * this across follow-up turns and restarts, not just the current message.
   */
  async findActiveSessionRouting(
    conversationId: string
  ): Promise<{ sessionId: string; canonicalUri: string | null } | null> {
    const { sessions } = await this.getModels();
    const session = await sessions.findActiveByConversation(conversationId);
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      canonicalUri: session.canonicalUri ?? null,
    };
  }

  /**
   * FR-30 / §9.7 manual-action transition: the ONE typed result that opens
   * a bounded generic fallback. Marks the session as having an approved
   * manual action (audit event + session approval flag semantics), which the
   * tool boundary then honors for generic tools on the recognized target.
   *
   * Audit R8: the approval MUST carry the typed provider manual-action
   * result — the exact operation it authorizes. The event records target +
   * tool + operation + cwd, and the policy layer authorizes ONLY that
   * operation; a matching target alone no longer opens every call.
   */
  async approveManualAction(input: {
    sessionId: string;
    /** Renderer-only opaque token — same binding as plan approval. */
    approvalToken: string;
    /** FR-29 conversation binding. */
    conversationId?: string;
    /** Audit R8: the exact tool the fallback will run (e.g. shell_execute). */
    toolName: string;
    /** Audit R8: the exact command line being approved. */
    operation: string;
    /** Audit R8: the exact working directory, when the plan names one. */
    cwd?: string;
    /** §8.6 payload: why no typed provider can perform this step. */
    reason?: string;
    /** §8.6 payload: the permission the operation needs. */
    permission?: string;
    /** §8.6 payload: how the user verifies the step happened. */
    verification?: string;
    /** §8.6 payload: how to undo the operation. */
    rollback?: string;
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
    if (
      session.approvalToken &&
      input.approvalToken !== session.approvalToken
    ) {
      return this.errorSnapshot(
        session.state as SkillInstallationState,
        "APPROVAL_REQUIRED",
        "Manual action approval must come from the user's install card.",
        input.sessionId
      );
    }
    // Audit R8: a typed manual-action result names the exact operation.
    // Target-only approvals (finding 9) authorized ANY call against the
    // target; refusing an unbound approval keeps the contract typed.
    const toolName = (input.toolName ?? "").trim();
    const operation = (input.operation ?? "").trim();
    if (!toolName || toolName.length > 100 || !/^[a-z0-9_]+$/i.test(toolName)) {
      return this.errorSnapshot(
        session.state as SkillInstallationState,
        "MANUAL_ACTION_OPERATION_REQUIRED",
        "Manual action approval must name the exact tool it authorizes.",
        input.sessionId
      );
    }
    if (!operation || operation.length > 2_000) {
      return this.errorSnapshot(
        session.state as SkillInstallationState,
        "MANUAL_ACTION_OPERATION_REQUIRED",
        "Manual action approval must name the exact operation it authorizes.",
        input.sessionId
      );
    }
    // Bounded approval (audit finding 9 + R8): the event records the
    // EXACT canonical target AND the exact approved operation, so the
    // policy can refuse any other call even against the same target.
    const boundOperation = JSON.stringify({
      target: session.canonicalUri ?? "",
      toolName,
      operation,
      ...(input.cwd !== undefined && input.cwd !== ""
        ? { cwd: input.cwd }
        : {}),
      ...(input.reason !== undefined && input.reason !== ""
        ? { reason: input.reason.slice(0, 500) }
        : {}),
      ...(input.permission !== undefined && input.permission !== ""
        ? { permission: input.permission.slice(0, 500) }
        : {}),
      ...(input.verification !== undefined && input.verification !== ""
        ? { verification: input.verification.slice(0, 500) }
        : {}),
      ...(input.rollback !== undefined && input.rollback !== ""
        ? { rollback: input.rollback.slice(0, 500) }
        : {}),
    } as SkillManualActionApprovalRecord);
    await this.appendEvent(
      events,
      input.sessionId,
      "manual-action-approved",
      session.state,
      session.state,
      boundOperation
    );
    await this.appendEvent(
      events,
      input.sessionId,
      "generic-fallback-opened",
      session.state,
      session.state,
      `generic fallback opened for ${toolName}: ${operation.slice(0, 120)}`
    );
    const current = await sessions.findBySessionId(input.sessionId);
    return this.snapshotFromEntity(current ?? session);
  }

  /**
   * FR-30: has this session an approved manual-action transition? The tool
   * boundary supplies this as manualActionApproved before allowing generic
   * fallback tools on the install target. Audit R8: a structured record
   * carries the bound operation; a plain-string detail (pre-R8 event) is
   * read as target-only legacy.
   */
  async hasApprovedManualAction(
    sessionId: string
  ): Promise<{
    approved: boolean;
    target?: string;
    toolName?: string;
    operation?: string;
    cwd?: string;
    reason?: string;
    permission?: string;
    verification?: string;
    rollback?: string;
  }> {
    const { events } = await this.getModels();
    const history = await events.listBySession(sessionId);
    const approval = [...history]
      .reverse()
      .find((e) => e.eventType === "manual-action-approved");
    if (!approval) return { approved: false };
    const parsed = parseManualActionApprovalDetail(approval.detail ?? "");
    return { approved: true, ...parsed };
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
    // Ticket P2-9: lifecycle actions dispatch by KIND. Plugin/executable
    // rows previously only flipped THIS row and touched a prompt catalog
    // entry that does not exist for them — their owning registries stayed
    // live (tools still registered/executable) while the manager reported
    // disabled.
    if (entity.kind === "plugin" || entity.kind === "executable") {
      try {
        const { SkillManagementModule } = await import(
          "@/modules/SkillManagementModule"
        );
        await new SkillManagementModule().toggleSkill(entity.name, false);
      } catch {
        /* owning registry unavailable — the row state above still governs */
      }
    } else {
      getDefaultPromptSkillCatalog().setEnabled(
        `prompt:user:${installationId}`,
        false
      );
    }
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

  /** Re-enable a disabled installation (§24.3 mirror; ticket P2-9 kind
   *  dispatch mirrors disable()). */
  async enable(installationId: string): Promise<boolean> {
    const { installations } = await this.getModels();
    const entity = await installations.findByInstallationId(installationId);
    if (!entity) return false;
    entity.enabled = true;
    entity.status = "ready";
    await installations.save(entity);
    if (entity.kind === "plugin" || entity.kind === "executable") {
      try {
        const { SkillManagementModule } = await import(
          "@/modules/SkillManagementModule"
        );
        await new SkillManagementModule().toggleSkill(entity.name, true);
      } catch {
        /* owning registry unavailable — the row state above still governs */
      }
    } else {
      getDefaultPromptSkillCatalog().setEnabled(
        `prompt:user:${installationId}`,
        true
      );
    }
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

    // Ticket P2-9: plugin/executable rows have NO activation path — their
    // owning registries manage the files. Route to them instead of the
    // activation service (which failed on the empty path) so the package's
    // registered tools are actually removed, then finish the shared
    // lifecycle bookkeeping below.
    if (entity.kind === "plugin" || entity.kind === "executable") {
      const owningRemoval = await this.uninstallRoutedPackage(entity);
      if (!owningRemoval.ok) {
        return { ok: false, message: owningRemoval.message };
      }
      const deactivatedInvocations = await this.deactivateInvocations(
        input.installationId
      );
      await this.cleanupInstallationRecords(input.installationId, entity, {
        deleteSecrets: input.deleteSecrets !== false,
      });
      return {
        ok: true,
        removed: "directory",
        targetPreserved: null,
        secretsDeleted: owningRemoval.secretsDeleted,
        deactivatedInvocations,
      };
    }

    // Ticket P1-1: verify the activation still belongs to THIS
    // installation BEFORE any mutation — a same-name replacement leaves
    // the superseded row pointing at the replacement's files, and the old
    // row must neither delete them nor unregister the live catalog entry.
    const activation = new SkillActivationService();
    if (
      entity.activationMode === "symbolic-link" ||
      entity.activationMode === "junction"
    ) {
      // Links carry no ownership file; bind to the recorded link target —
      // a replacement re-pointed the link at ITS source.
      try {
        const recorded = (
          JSON.parse(entity.metadataJson ?? "{}") as {
            linkedTargetPath?: string;
          }
        ).linkedTargetPath;
        const current = fs.realpathSync(entity.activationPath);
        if (recorded && fs.realpathSync(recorded) !== current) {
          return {
            ok: false,
            message:
              "This link was replaced by a different installation; " +
              "refusing to remove the replacement's link. Uninstall the " +
              "current installation instead.",
          };
        }
      } catch {
        /* broken/missing link or unreadable metadata — the service's own
         * guards govern removal below */
      }
    }
    const removed = activation.uninstall(
      entity.activationPath,
      input.installationId
    );
    if (!removed.ok) {
      return { ok: false, message: removed.message };
    }

    // Disable discovery first, then deactivate any durable invocations so
    // no conversation keeps following instructions from the removed skill.
    getDefaultPromptSkillCatalog().remove(
      `prompt:user:${input.installationId}`
    );
    const deactivatedInvocations = await this.deactivateInvocations(
      input.installationId
    );
    const secretsDeleted = await this.cleanupInstallationRecords(
      input.installationId,
      entity,
      { deleteSecrets: input.deleteSecrets !== false, installations }
    );
    return {
      ok: true,
      removed: removed.removed,
      targetPreserved: removed.targetPreserved,
      secretsDeleted,
      deactivatedInvocations,
    };
  }

  /**
   * Ticket P2-9: remove a plugin/executable package through its OWNING
   * registry (the activation service cannot — routed rows carry no
   * activation path). Failures are typed, never silently "success".
   */
  private async uninstallRoutedPackage(
    entity: SkillInstallationEntity
  ): Promise<{ ok: true; secretsDeleted: number } | { ok: false; message: string }> {
    const secretsDeleted = 0;
    if (entity.kind === "plugin") {
      try {
        const { PluginManagementModule } = await import(
          "@/modules/PluginManagementModule"
        );
        const result = await new PluginManagementModule().uninstallPlugin(
          entity.name
        );
        if (!result.removedPlugin) {
          return {
            ok: false,
            message:
              result.errors[0]?.message ??
              `The plugin manager could not remove '${entity.name}'.`,
          };
        }
      } catch (err) {
        return {
          ok: false,
          message: `The plugin manager could not remove '${entity.name}': ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    } else {
      try {
        const { SkillManagementModule } = await import(
          "@/modules/SkillManagementModule"
        );
        const removed = await new SkillManagementModule().uninstallSkill(
          entity.name
        );
        if (!removed) {
          return {
            ok: false,
            message: `The skill manager could not remove '${entity.name}'.`,
          };
        }
      } catch (err) {
        return {
          ok: false,
          message: `The skill manager could not remove '${entity.name}': ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    }
    return { ok: true, secretsDeleted };
  }

  /**
   * Shared uninstall bookkeeping (ticket P2-9): credential deletion,
   * dependency-binding cleanup, and the terminal row update.
   */
  private async cleanupInstallationRecords(
    installationId: string,
    entity: SkillInstallationEntity,
    opts: {
      deleteSecrets: boolean;
      installations?: SkillInstallationModel;
    }
  ): Promise<number> {
    let secretsDeleted = 0;
    if (opts.deleteSecrets) {
      try {
        // SkillCredentialModule (TODO 9): values from the encrypted store
        // AND binding rows from SQLite.
        const { SkillCredentialModule } = await import(
          "@/modules/SkillCredentialModule"
        );
        secretsDeleted = await new SkillCredentialModule().deleteAll(
          installationId
        );
      } catch {
        /* credential store unavailable — files still removed */
      }
    }
    // Audit R9 (design §14.1): dependency bindings are installation-scoped
    // rows — remove them with the installation (shared binaries stay put).
    try {
      await (
        await this.getDependencyBindingModel()
      ).deleteByInstallation(installationId);
    } catch {
      /* binding cleanup is best-effort — uninstall still completes */
    }
    entity.status = "revoked";
    entity.enabled = false;
    const installations = opts.installations ?? (await this.getModels()).installations;
    await installations.save(entity);
    return secretsDeleted;
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
    session: SkillInstallationSessionEntity,
    identityOverride?: { readonly installationId: string }
  ): Promise<InstallSnapshot> {
    const { sessions, events, installations } = await this.getModels();
    // Refresh the mutation lease before the (potentially slow) activation so
    // a concurrent prepare cannot take the session over mid-copy.
    await sessions.heartbeatLease(sessionId, SESSION_LEASE_TTL_MS, Date.now());
    await this.transition(sessions, events, sessionId, "activating");

    const activation = new SkillActivationService();
    // acquiredRoot IS the absolute staging path recorded at acquisition,
    // but the SELECTED candidate may live in a wrapper/child directory
    // (nested SKILL.md, skills/<name>) — join its rootRelativePath so the
    // right root is copied/linked (audit finding 2 / FR-04–08).
    let sourceRoot = plan.source.acquiredRoot;
    const candidateRoot = selected.rootRelativePath;
    if (candidateRoot && candidateRoot !== "." && candidateRoot !== "") {
      sourceRoot = path.join(sourceRoot, candidateRoot);
    }
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
        // Audit R5: the link targets the CANDIDATE's directory inside the
        // original folder — nested/SKILL.md installs previously reset the
        // root to the repository root. The candidate path is relative to
        // the INSPECTION root (already inside the requested subdirectory),
        // so the link composes original + requested subdir + candidate path.
        const candidateRoot = selected.rootRelativePath;
        const requestedSubdir = session.requestedSubdirectory ?? null;
        const linkedRoot = this.composeSubdirectory(
          original,
          this.composeSubdirectory(requestedSubdir, candidateRoot)
        ) || original;
        if (
          linkedRoot !== original &&
          (!fs.existsSync(linkedRoot) || !fs.statSync(linkedRoot).isDirectory())
        ) {
          await this.fail(
            sessions,
            events,
            sessionId,
            "LINK_CREATION_FAILED",
            `Linked install mode could not find the selected skill directory (${candidateRoot}) inside the source folder.`
          );
          return this.errorSnapshot(
            "failed",
            "LINK_CREATION_FAILED",
            `Linked install mode could not find the selected skill directory (${candidateRoot}) inside the source folder.`,
            sessionId
          );
        }
        sourceRoot = linkedRoot;
        linkedTargetPath = linkedRoot;
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

    // Persist the installation record. The identity came from the session
    // (created at prepare) so credentials stored during awaiting_secret
    // bind to the SAME installation (review C3). Multi-candidate installs
    // (audit R2) pass a DISTINCT identity per candidate — sharing the
    // session's id made each activation overwrite the previous candidate's
    // row and catalog entry.
    const installationId =
      identityOverride?.installationId ??
      session.installationId ??
      crypto.randomUUID().replace(/-/g, "").slice(0, 32);
    // An override identity must NOT sync back onto the session (the
    // session keeps its own id; the override rows stand alone).
    const syncSessionIdentity = identityOverride === undefined;

    // Ticket P1-1: the ownership file must carry the INSTALLATION identity
    // (it previously recorded the session id, so identity-bound uninstall
    // could never match). Resolving the identity BEFORE activation keeps
    // the ownership file, the installation row, and the catalog entry in
    // agreement.
    const result = await activation.activate({
      sourceRoot,
      skillName: selected.name,
      mode: isLinkedMode ? ("linked" as const) : ("managed-copy" as const),
      contentHash: plan.source.contentHash,
      installationId,
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
    const entity = new SkillInstallationEntity();
    entity.installationId = installationId;
    entity.name = selected.name;
    entity.kind = selected.kind;
    entity.scope = "user";
    entity.workspaceId = 0;
    entity.sourceUri = plan.source.canonicalUri;
    entity.sourceRevision = plan.source.resolvedRevision;
    // Audit R5: persist the FULL effective subdirectory — a requested
    // subdirectory PLUS the candidate's wrapper path — so update/reacquire
    // resolves the same location. (candidateRoot alone loses the request
    // subdir; the two compose with a path join.)
    entity.sourceSubdirectory = this.composeSubdirectory(
      session.requestedSubdirectory ?? null,
      candidateRoot
    );
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
      // Audit R9 (PRD §22.3): the permission kinds the user granted at
      // approval and the verification baseline timestamp — the management
      // detail view shows both.
      grantedPermissions: plan.permissions.map((p) => p.kind),
      verifiedAt: new Date().toISOString(),
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
        if (syncSessionIdentity) {
          await this.setInstallationId(
            sessions,
            sessionId,
            priorRow.installationId
          );
          session.installationId = priorRow.installationId;
        }
        // Ticket P1-1: the freshly written ownership file still names the
        // PRE-adopted identity — rewrite it so identity-bound uninstall
        // matches the row that now owns the activation. Managed copies
        // only (links carry no ownership file).
        if (
          entity.activationMode !== "symbolic-link" &&
          entity.activationMode !== "junction"
        ) {
          try {
            const ownershipPath = path.join(
              result.activationPath,
              ".aifetchly-install.json"
            );
            const ownership = JSON.parse(
              fs.readFileSync(ownershipPath, "utf-8")
            ) as { owned: boolean; installationId: string };
            ownership.installationId = priorRow.installationId;
            fs.writeFileSync(
              ownershipPath,
              JSON.stringify(ownership, null, 2),
              "utf-8"
            );
          } catch {
            /* unreadable/unwritable ownership — uninstall's guards govern */
          }
        }
      }
    } else {
      // Audit finding 3: an UPDATE session carries the EXISTING identity
      // (set by update()) while its NEW revision matches no prior identity
      // row — UPDATE the existing row in place instead of inserting a
      // duplicate installationId (UNIQUE) and leaving a stale ready twin.
      const byExistingId = await installations.findByInstallationId(
        installationId
      );
      if (byExistingId) {
        entity.id = byExistingId.id;
        entity.installationId = byExistingId.installationId;
      }
    }
    await installations.save(entity);
    // Audit finding 3 (FR-19/NFR-01): a changed revision (update) or a
    // same-name install from a different source leaves the PREVIOUS row
    // enabled and "ready" while the activation service already replaced
    // its files — an ambiguous lifecycle target. Supersede every OTHER
    // enabled row for this skill name so exactly ONE ready row exists.
    const staleRows = (await installations.findEnabledByName(entity.name))
      .filter(
        (row) =>
          row.installationId !== entity.installationId &&
          row.enabled === true
      );
    for (const row of staleRows) {
      row.status = "superseded";
      row.enabled = false;
      try {
        await installations.save(row);
        // Ticket P1-5: unregister the superseded runtime's catalog entry
        // BEFORE the replacement registers. The two share one SKILL.md
        // real path, and the catalog's cross-source real-path dedup lets
        // the OLD entry win by scope precedence — without this removal the
        // replacement never registers while the session still reports
        // ready with invocation pointed at the stale entry.
        getDefaultPromptSkillCatalog().remove(
          `prompt:user:${row.installationId}`
        );
        // FR-19 parity with disable(): conversations that invoked the
        // superseded runtime stop following its instructions.
        await this.deactivateInvocations(row.installationId);
        await this.appendEvent(
          events,
          sessionId,
          "installation-superseded",
          "activating",
          "activating",
          `previous row for '${row.name}' (${row.installationId}) superseded`
        );
      } catch {
        /* best-effort row update — the new ready row governs */
      }
    }
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
      if (rolledBack.ok) {
        await this.fail(
          sessions,
          events,
          sessionId,
          "ACTIVATION_VERIFICATION_FAILED",
          "Activation verification failed; rolled back to the previous state."
        );
        return this.errorSnapshot(
          "failed",
          "ACTIVATION_VERIFICATION_FAILED",
          "Activation verification failed; rolled back to the previous state.",
          sessionId
        );
      }
      // §10.1: a FAILED rollback must surface rollback_required with the
      // recovery detail preserved — never a plain failed (finding 6).
      await this.appendEvent(
        events,
        sessionId,
        "rollback-failed",
        "verifying",
        "rollback_required",
        rolledBack.message
      );
      await this.transition(sessions, events, sessionId, "rollback_required");
      return this.errorSnapshot(
        "rollback_required",
        "ROLLBACK_FAILED",
        `Activation verification failed and rollback failed: ${rolledBack.message}`,
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
    // Ticket P1-5: registration must be VERIFIED, not assumed — a same-path
    // twin from a stale entry (scope-precedence loser) or a catalog cap can
    // refuse the new definition while the session would still report ready.
    const result = getDefaultPromptSkillCatalog().replaceSource(
      `installer:${installationId}`,
      [definition]
    );
    const actuallyRegistered = result.registered.some(
      (entry) => entry.runtimeId === definition.runtimeId
    );
    return actuallyRegistered ? definition : null;
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
    // Audit R10 (design §19): prepare-to-ready timing — record the elapsed
    // ms once, on the transition INTO ready. Failures inside the timing
    // read never affect the installation.
    if (toState === "ready" && fromState !== "ready") {
      try {
        const startedAt = current.createdAt;
        if (startedAt instanceof Date) {
          toolCatalogCounters.increment(
            "install_prepare_to_ready_ms_total",
            Math.max(0, Date.now() - startedAt.getTime())
          );
        }
        toolCatalogCounters.increment("install_ready_total");
      } catch {
        /* metrics are best-effort */
      }
      // Audit R9 (design §14.1): persist the dependency bindings — the
      // skill-management view of what was detected (version, resolved
      // path, last verification). Best-effort: never blocks readiness.
      try {
        await this.persistDependencyBindings(current);
      } catch {
        /* binding persistence is repairable via repair() */
      }
    }
  }

  /**
   * Audit R9 (design §14.1 / PRD §22.3): write one binding row per plan
   * dependency — detected version, resolved path, provider, evidence, and
   * the verification timestamp. The row never claims ownership of shared
   * system packages.
   */
  private async persistDependencyBindings(
    session: SkillInstallationSessionEntity
  ): Promise<void> {
    if (!session.installationId || !session.planJson) return;
    let plan: SkillInstallPlan;
    try {
      plan = JSON.parse(session.planJson) as SkillInstallPlan;
    } catch {
      return;
    }
    const model = await this.getDependencyBindingModel();
    const verifiedAt = new Date();
    for (const dep of plan.dependencies ?? []) {
      await model.upsert({
        installationId: session.installationId,
        dependencyName: dep.name,
        kind: dep.kind,
        status: dep.currentStatus,
        ...(dep.detectedVersion !== undefined
          ? { detectedVersion: dep.detectedVersion }
          : {}),
        ...(dep.requiredVersion !== undefined
          ? { requiredVersion: dep.requiredVersion }
          : {}),
        ...(dep.resolvedPath !== undefined
          ? { resolvedPath: dep.resolvedPath }
          : {}),
        ...(dep.installMethod !== undefined
          ? { provider: dep.installMethod }
          : {}),
        ...(dep.detectionEvidence !== undefined
          ? { probeEvidence: dep.detectionEvidence }
          : {}),
        verifiedAt,
      });
    }
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

  private async snapshotFromEntity(
    session: SkillInstallationSessionEntity,
    plan?: SkillInstallPlan
  ): Promise<InstallSnapshot> {
    const snapshot: InstallSnapshot = {
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
    // Audit R3: surface the credential the secure input should collect
    // next — the first declared name still unconfigured. The card binds
    // its label/submit to THIS field instead of scraping the summary.
    if (plan && plan.credentials.length > 0 && session.installationId) {
      const missing = await this.unconfiguredCredentials(session, plan);
      if (missing.length > 0) {
        snapshot.nextMissingCredential = missing[0];
      }
    }
    return snapshot;
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
        candidateId: skill.candidateId,
        selected: plan.selectedSkillIds.includes(skill.candidateId),
      })),
      dependencies: plan.dependencies.map((d) => ({
        id: d.id,
        name: d.name,
        status: d.currentStatus,
        kind: d.kind,
        ...(d.requiredVersion !== undefined
          ? { requiredVersion: d.requiredVersion }
          : {}),
        ...(d.detectedVersion !== undefined
          ? { detectedVersion: d.detectedVersion }
          : {}),
        ...(d.installMethod !== undefined
          ? { installMethod: d.installMethod }
          : {}),
        ...(d.requiresElevation !== undefined
          ? { requiresElevation: d.requiresElevation }
          : {}),
        ...(d.detectionEvidence !== undefined
          ? { evidence: d.detectionEvidence }
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
      warnings: plan.warnings.map((w) => `[${w.code}] ${w.message}`),
      // Audit finding 12 (§22.2): the review card shows the requested
      // permissions and where the activation lands.
      permissions: plan.permissions.map((p) => ({ kind: p.kind })),
      activationTarget: plan.activation.targetDirectory,
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
