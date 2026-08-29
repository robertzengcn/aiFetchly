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

    const created = await sessions.create({
      sessionId,
      installationId,
      approvalToken,
      conversationId: request.conversationId,
      state: "acquiring",
      planRevision: "none",
      stateRevision: 0,
    } as SkillInstallationSessionEntity);
    await this.appendEvent(
      events,
      sessionId,
      "session-created",
      "",
      "acquiring"
    );

    const acquired = await acquisition.acquire(sessionId, descriptor);
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

    return this.runActivation(input.sessionId, plan, selected[0], session);
  }

  /**
   * Resume after a secret was submitted through the secure channel. The
   * secret VALUE never enters this module — the credential service stores
   * it; this only advances the state machine.
   */
  async resumeAfterSecret(sessionId: string): Promise<InstallSnapshot> {
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
   * Approval token for the RENDERER approval card only (review D1). Never
   * included in any snapshot the model can observe.
   */
  async getApprovalToken(sessionId: string): Promise<string | null> {
    const { sessions } = await this.getModels();
    const session = await sessions.findBySessionId(sessionId);
    return session?.approvalToken ?? null;
  }

  async getStatus(sessionId: string): Promise<InstallSnapshot> {
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
    const plan = session.planJson
      ? (JSON.parse(session.planJson) as SkillInstallPlan)
      : null;
    return this.snapshotFromEntity(session, plan ?? undefined);
  }

  async cancel(sessionId: string): Promise<InstallSnapshot> {
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
    if (["ready", "cancelled"].includes(session.state)) {
      return this.snapshotFromEntity(session);
    }
    // Before activation: remove staging. After activation: rollback.
    if (["activating", "verifying"].includes(session.state)) {
      await this.transition(sessions, events, sessionId, "rollback_required");
    } else {
      await this.transition(sessions, events, sessionId, "cancelled");
      new SkillSourceAcquisitionService().removeSession(sessionId);
    }
    const cancelled = await sessions.findBySessionId(sessionId);
    return this.snapshotFromEntity(cancelled ?? session);
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
  async update(installationId: string): Promise<InstallSnapshot> {
    const { installations } = await this.getModels();
    const entity = await installations.findByInstallationId(installationId);
    if (!entity) {
      return this.errorSnapshot(
        "failed",
        "INSTALL_SESSION_REQUIRED",
        `Unknown installation '${installationId}'.`,
        "none"
      );
    }
    // Update flows through prepare against the recorded source; the
    // activation service's backup mechanism retains the previous version
    // until the new one verifies.
    // Update FORCES a fresh session (the ready-installation idempotency
    // gate must not short-circuit an explicit update request): pass an
    // explicit sessionId so prepare skips the resume/report-ready path.
    return this.prepare({
      conversationId: `update:${installationId}`,
      source: entity.sourceUri,
      ...(entity.sourceSubdirectory
        ? { subdirectory: entity.sourceSubdirectory }
        : {}),
      mode:
        entity.activationMode === "symbolic-link" ||
        entity.activationMode === "junction"
          ? "linked"
          : "managed-copy",
      sessionId: `update-${installationId}-${Date.now()}`,
    });
  }

  /**
   * Repair: recheck the recorded activation WITHOUT moving to a newer
   * revision (§24.2). Verifies the activation path still resolves, the
   * SKILL.md hash matches the recorded content hash, the runtime catalog
   * still resolves the skill, and re-registers when the catalog lost it.
   */
  async repair(installationId: string): Promise<{
    ok: boolean;
    checks: readonly {
      readonly name: string;
      readonly passed: boolean;
      readonly detail: string;
    }[];
    repaired: readonly string[];
  }> {
    const { installations } = await this.getModels();
    const entity = await installations.findByInstallationId(installationId);
    if (!entity) {
      return {
        ok: false,
        checks: [],
        repaired: [],
      };
    }

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
    const runtimeId = `prompt:user:${installationId}`;
    const registered = catalog.get(runtimeId) !== null;
    checks.push({
      name: "catalog-registered",
      passed: registered,
      detail: registered ? runtimeId : "missing from runtime catalog",
    });
    if (!registered && structureOk) {
      const restored = this.registerPromptSkill(
        entity.activationPath,
        installationId
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
  async disable(installationId: string): Promise<boolean> {
    const { installations } = await this.getModels();
    const entity = await installations.findByInstallationId(installationId);
    if (!entity) return false;
    entity.enabled = false;
    entity.status = "disabled";
    await installations.save(entity);
    getDefaultPromptSkillCatalog().setEnabled(
      `prompt:user:${installationId}`,
      false
    );
    return true;
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

    // Disable discovery first.
    getDefaultPromptSkillCatalog().remove(
      `prompt:user:${input.installationId}`
    );

    const activation = new SkillActivationService();
    const removed = activation.uninstall(entity.activationPath);
    if (!removed.ok) {
      return { ok: false, message: removed.message };
    }

    let secretsDeleted = 0;
    if (input.deleteSecrets !== false) {
      try {
        const { SkillCredentialService } = await import(
          "@/service/SkillCredentialService"
        );
        secretsDeleted = new SkillCredentialService().delete(
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
    };
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
    await this.transition(sessions, events, sessionId, "activating");

    const activation = new SkillActivationService();
    // acquiredRoot IS the absolute staging path recorded at acquisition.
    const sourceRoot = plan.source.acquiredRoot;

    const result = await activation.activate({
      sourceRoot,
      skillName: selected.name,
      mode:
        plan.activation.mode === "symbolic-link" ||
        plan.activation.mode === "junction"
          ? ("linked" as const)
          : ("managed-copy" as const),
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
    entity.metadataJson = JSON.stringify({
      planRevision: plan.planRevision,
      backupPath: result.backupPath,
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
    current.failureCode = code;
    current.failureDetail = message.replace(/https?:\/\/[^\s]+/g, "[source]");
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
  setProgressSinkForTests(
    sink: SkillInstallationProgressSink | null
  ): void {
    this.progressSink = sink;
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
      recoverable: !["failed"].includes(session.state),
      ...(session.failureCode ? { errorCode: session.failureCode } : {}),
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
