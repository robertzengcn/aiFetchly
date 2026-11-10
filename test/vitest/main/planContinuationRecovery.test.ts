import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/modules/token", () => ({
  Token: vi.fn(function TokenMock() {
    return { getValue: vi.fn() };
  }),
}));
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn(function AIChatV2ModuleMock() {
    return {
      createConversationIfNeeded: (existing?: string) =>
        existing && existing.startsWith("v2-") ? existing : "v2-created",
    };
  }),
}));
vi.mock("@/modules/AIChatAttachmentModule", () => ({
  AIChatAttachmentModule: vi.fn(function AIChatAttachmentModuleMock() {
    return {
      saveUploadedFiles: vi.fn().mockResolvedValue(undefined),
      deleteByMessageId: vi.fn().mockResolvedValue(1),
      deleteByConversation: vi.fn().mockResolvedValue(0),
      getByMessageId: vi.fn().mockResolvedValue([]),
    };
  }),
}));
vi.mock("@/service/DesktopNotifyService", () => ({
  DesktopNotifyService: {
    getInstance: () => ({ show: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import { AIChatPendingMessageModule } from "@/modules/AIChatPendingMessageModule";
import { AIChatPlanModel } from "@/model/AIChatPlan.model";
import { AIChatPendingMessageModel } from "@/model/AIChatPendingMessage.model";
import { planContinuationRequestId } from "@/views/utils/planContinuationIdentity";
import { SqliteDb } from "@/config/SqliteDb";
import { resolveTestDbPath } from "@/config/testDbPath";
import fs from "node:fs";
import path from "node:path";

beforeEach(async () => {
  await SqliteDb.destroyInstance();
  const dir = resolveTestDbPath();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith("scraper.db")) {
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch {
          // ignore
        }
      }
    }
  }
});

const APPROVED_CONTINUE_TEXT = "Plan approved. Please begin executing the plan now.";

async function seedAwaitingApproval(conversationId: string): Promise<{
  planModule: AIChatPlanModule;
  planId: string;
  version: number;
}> {
  const planModule = new AIChatPlanModule();
  await planModule.ensurePlanForConversation({
    conversationId,
    title: "Campaign plan",
    objective: "Grow the newsletter",
  });
  const state = await planModule.submitPlanForApproval({
    conversationId,
    payload: {
      title: "Campaign plan",
      objective: "Grow the newsletter",
      planMarkdown: "# Plan v1",
    },
  });
  return { planModule, planId: state.planId, version: state.currentVersion };
}

/** Simulate the continuation having been accepted in main (durable pending row). */
async function acceptContinuation(
  conversationId: string,
  clientRequestId: string,
  message: string
): Promise<void> {
  await new AIChatPendingMessageModule().createPendingMessage({
    clientRequestId,
    request: { message, conversationId },
  });
}

/**
 * R12 (FR-PLN-005..008, AD-007, acceptance 12): a plan decision commits
 * durably in main, but its continuation turn only exists if the renderer's
 * follow-up send ever landed. Between "decision committed" and "reply
 * received + intent saved" there is a crash gap — reconcile the persisted
 * decision transitions against their deterministic pending continuation
 * ids so an intent that was never recorded is reconstructed on
 * restart/reselection. Never execute an uncommitted decision; never
 * duplicate an accepted continuation.
 */
describe("R12 — plan-continuation commit-to-response crash recovery", () => {
  it("reconstructs the approve intent when main commits the decision but the reply is lost", async () => {
    const conv = "v2-r12-approve";
    const { planModule, planId, version } = await seedAwaitingApproval(conv);

    // The decision commits durably in main (approval row + status), but the
    // IPC reply is lost or the renderer crashes before saving the intent:
    // no pending row exists, no renderer retry intent exists.
    await planModule.approvePlan({ conversationId: conv, planId, version });

    const recovery = await planModule.getRecoverablePlanContinuation(conv);
    expect(recovery).not.toBeNull();
    expect(recovery?.conversationId).toBe(conv);
    expect(recovery?.planId).toBe(planId);
    expect(recovery?.version).toBe(version);
    expect(recovery?.action).toBe("approve-plan");
    expect(recovery?.feedback).toBe("");
    // Cross-process identity parity: the renderer derives the SAME id at
    // retry time, so the replay dedupes in main (one accepted continuation).
    expect(recovery?.clientRequestId).toBe(
      await planContinuationRequestId(planId, version, "approve-plan")
    );
  });

  it("never resurfaces the intent once the continuation was accepted (no duplicate provider turn)", async () => {
    const conv = "v2-r12-accepted";
    const { planModule, planId, version } = await seedAwaitingApproval(conv);
    await planModule.approvePlan({ conversationId: conv, planId, version });
    const recovery = await planModule.getRecoverablePlanContinuation(conv);
    expect(recovery).not.toBeNull();

    await acceptContinuation(conv, recovery!.clientRequestId, APPROVED_CONTINUE_TEXT);
    expect(await planModule.getRecoverablePlanContinuation(conv)).toBeNull();

    // Terminal rows count too: the turn ran to completion (status `sent`)
    // long ago — reopening must not re-offer the continuation.
    const model = new AIChatPendingMessageModel(resolveTestDbPath());
    const row = await model.getByClientRequestId(recovery!.clientRequestId);
    expect(row?.status).toBe("queued");
  });

  it("does not resurface an already-completed continuation (terminal pending row)", async () => {
    const conv = "v2-r12-terminal";
    const { planModule, planId, version } = await seedAwaitingApproval(conv);
    await planModule.approvePlan({ conversationId: conv, planId, version });
    await acceptContinuation(conv, await planContinuationRequestId(planId, version, "approve-plan"), APPROVED_CONTINUE_TEXT);

    // Promote the queued row to its terminal `sent` state the way the queue
    // does (claim -> promote), proving recovery also stops after completion.
    const pendingModule = new AIChatPendingMessageModule();
    const claim = await pendingModule.getModel().claimOldestForDispatch(conv);
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    await pendingModule.getModel().promoteDispatchToUserMessage({
      pendingMessageId: claim.row.pendingMessageId,
      claimToken: claim.row.claimToken ?? "",
    });
    expect(await planModule.getRecoverablePlanContinuation(conv)).toBeNull();
  });

  it("preserves rejected feedback in the recovered intent", async () => {
    const conv = "v2-r12-reject";
    const { planModule, planId, version } = await seedAwaitingApproval(conv);
    await planModule.rejectPlan({
      conversationId: conv,
      planId,
      version,
      feedback: "Scope is too broad",
    });

    const recovery = await planModule.getRecoverablePlanContinuation(conv);
    expect(recovery?.action).toBe("reject-plan");
    expect(recovery?.feedback).toBe("Scope is too broad");
    expect(recovery?.clientRequestId).toBe(
      await planContinuationRequestId(planId, version, "reject-plan")
    );

    // The rejected continuation is recoverable even though the plan row is
    // now terminal (status "rejected") — the feedback must not be lost.
    await acceptContinuation(
      conv,
      recovery!.clientRequestId,
      "Plan rejected. Please revise the plan based on the following feedback and resubmit for approval.\n\nFeedback: Scope is too broad"
    );
    expect(await planModule.getRecoverablePlanContinuation(conv)).toBeNull();
  });

  it("preserves change-request feedback in the recovered intent", async () => {
    const conv = "v2-r12-changes";
    const { planModule, planId, version } = await seedAwaitingApproval(conv);
    await planModule.requestPlanChanges({
      conversationId: conv,
      planId,
      version,
      feedback: "Add a budget section",
    });

    const recovery = await planModule.getRecoverablePlanContinuation(conv);
    expect(recovery?.action).toBe("request-plan-changes");
    expect(recovery?.feedback).toBe("Add a budget section");
    expect(recovery?.clientRequestId).toBe(
      await planContinuationRequestId(planId, version, "request-plan-changes")
    );
  });

  it("never recovers an uncommitted decision (no approval row → no intent, no continuation)", async () => {
    const conv = "v2-r12-uncommitted";
    const { planModule } = await seedAwaitingApproval(conv);
    // The approval never committed (null/stale/failed decision path).
    expect(await planModule.getRecoverablePlanContinuation(conv)).toBeNull();
  });

  it("never recovers a stale decision after the plan advanced to a newer version", async () => {
    const conv = "v2-r12-stale";
    const { planModule, planId, version } = await seedAwaitingApproval(conv);
    await planModule.approvePlan({ conversationId: conv, planId, version });
    // The plan advances (model resubmits a new version for approval) without
    // the v1 continuation ever being sent — the v1 intent is obsolete.
    await planModule.submitPlanForApproval({
      conversationId: conv,
      payload: {
        title: "Campaign plan",
        objective: "Grow the newsletter",
        planMarkdown: "# Plan v2",
      },
    });
    expect(await planModule.getRecoverablePlanContinuation(conv)).toBeNull();
  });

  it("does not recover when the plan lifecycle ended (completed or cancelled)", async () => {
    const conv = "v2-r12-ended";
    const { planModule, planId, version } = await seedAwaitingApproval(conv);
    await planModule.approvePlan({ conversationId: conv, planId, version });
    const planModel = new AIChatPlanModel(resolveTestDbPath());
    await planModel.updateStatus({ planId, status: "completed" });
    expect(await planModule.getRecoverablePlanContinuation(conv)).toBeNull();

    await planModel.updateStatus({ planId, status: "cancelled" });
    expect(await planModule.getRecoverablePlanContinuation(conv)).toBeNull();
  });

  it("recovers a mid-commit crash: decision row persisted, status write lost", async () => {
    const conv = "v2-r12-midcommit";
    // Seed with a clean module first.
    const seeded = await seedAwaitingApproval(conv);
    const { planId, version } = seeded;

    // Fault injection: the status update fails AFTER the approval decision
    // row committed. BaseDb guards capture prototype methods at construction
    // time, so the stub must be installed BEFORE the module is constructed.
    const spy = vi
      .spyOn(AIChatPlanModel.prototype, "updateStatus")
      .mockRejectedValueOnce(new Error("status write lost"));
    const crashingModule = new AIChatPlanModule();
    await expect(
      crashingModule.approvePlan({ conversationId: conv, planId, version })
    ).rejects.toThrow("status write lost");
    spy.mockRestore();

    // The IPC reply is a denial — the renderer saved no intent — yet the
    // decision row committed. Reconcile must reconstruct the intent from the
    // persisted transition (the derived plan state is approved again).
    const recoveryModule = new AIChatPlanModule();
    const recovery = await recoveryModule.getRecoverablePlanContinuation(conv);
    expect(recovery?.action).toBe("approve-plan");
    expect(recovery?.version).toBe(version);
    expect(recovery?.clientRequestId).toBe(
      await planContinuationRequestId(planId, version, "approve-plan")
    );
  });

  it("returns null for a conversation without any plan", async () => {
    const planModule = new AIChatPlanModule();
    expect(
      await planModule.getRecoverablePlanContinuation("v2-r12-empty")
    ).toBeNull();
  });
});
