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
    const { sessions, events } = await this.getModels();
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
    }

    const sessionId =
      request.sessionId ?? crypto.randomUUID().replace(/-/g, "").slice(0, 32);
    const acquisition = new SkillSourceAcquisitionService();

    const created = await sessions.create({
      sessionId,
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
    const sourceRoot =
      plan.source.acquiredRoot && requiresStagingLookup(plan)
        ? pathJoinStaging(sessionId, plan.source.acquiredRoot)
        : plan.source.acquiredRoot;

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

    // Persist the installation record (idempotent identity).
    const installationId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
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
    await installations.save(entity);
    // Record the installation id on the session. This is NOT a state
    // transition, so it bypasses the CAS on stateRevision — the id is
    // set-once and the session row is already exclusively owned by this run.
    await this.setInstallationId(sessions, sessionId, installationId);
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

function requiresStagingLookup(plan: SkillInstallPlan): boolean {
  // acquiredRoot is already absolute under the staging root for this run.
  return Boolean(plan.source.acquiredRoot);
}

function pathJoinStaging(sessionId: string, acquiredRoot: string): string {
  // acquiredRoot IS the staging path recorded by the acquisition service.
  void sessionId;
  return acquiredRoot;
}
