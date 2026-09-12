/**
 * Integration test for the `start_email_send_task` tool's authorized routing
 * (RC4, technical design §14.3/§15). When the tool gate (§14.2) resolved a
 * request-scoped authorization for the turn, the skill's execute must claim
 * the draft batch via OutboundEmailDeliveryService.claim (§15.1 idempotency)
 * instead of the legacy startBulkEmailSendTask ad-hoc send. Without this, an
 * authorized send would silently bypass the durable draft pipeline.
 *
 * The legacy path (no authorization in context) is covered by the existing
 * bulk-send tests; this file locks the NEW routing decision only.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-send-tool-outbound-route");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

// Mock the legacy send so we can assert the authorized path NEVER calls it
// and the unauthorized path still does.
vi.mock("@/service/EmailMarketingAiTools", () => ({
  startBulkEmailSendTask: vi.fn(async () => ({
    success: false,
    msg: "legacy path must not run when authorized",
  })),
}));

// The skill wires the production worker starter (OutboundEmailWorkerStarter,
// §15.2) via dynamic import; its real default forks a taskCode.js utility
// process, which cannot run under vitest. Mock the module so the starter
// returns the same { started: true } stub the delivery-service tests inject.
// The wiring itself is asserted by OutboundEmailWorkerStarter.test.ts.
vi.mock("@/service/outboundEmail/OutboundEmailWorkerStarter", () => ({
  OutboundEmailWorkerStarter: class {
    toWorkerStarter() {
      return async () => ({ started: true });
    }
  },
}));

// The Token-resolved USERSDBPATH must point at the test DB.
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
}));
vi.mock("@/config/usersetting", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/config/usersetting")
  >();
  return {
    ...original,
    Token: class {
      getValue(name: string) {
        return name === "user_dbpath" ? tmpDir : "";
      }
    },
  };
});

import { SkillRegistry } from "@/config/skillsRegistry";
import { startBulkEmailSendTask } from "@/service/EmailMarketingAiTools";
import { OutboundEmailDraftService } from "@/service/outboundEmail/OutboundEmailDraftService";
import { OutboundEmailAuthorizationService } from "@/service/outboundEmail/OutboundEmailAuthorizationService";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailIntentModel } from "@/model/OutboundEmailIntent.model";
import { OutboundEmailIntentEntity } from "@/entity/OutboundEmailIntent.entity";
import type { EmailItem } from "@/entityTypes/emailmarketingType";

/** Seed a fully-authorized draft batch and return the claim triple. */
async function seedAuthorizedBatch(): Promise<{
  batchId: number;
  batchHash: string;
  authorizationId: number;
}> {
  const draftService = new OutboundEmailDraftService(tmpDir, {
    aiEnabledOverride: true,
  });
  const generated = await draftService.generateBatch({
    conversationId: "conv-1",
    sourceUserMessageId: "msg-1",
    intentDecisionId: 1,
    recipientSourceType: "direct",
    recipients: [
      { address: "a@example.com", title: "A", source: "direct" } as EmailItem,
    ],
    serviceIds: [1],
    senderAddress: "sender@example.com",
    subject: "Hello",
    bodyText: "Hi",
    bodyHtml: null,
  });
  expect(generated.success).toBe(true);

  const intentModel = new OutboundEmailIntentModel(tmpDir);
  const intent = new OutboundEmailIntentEntity();
  intent.conversationId = "conv-1";
  intent.sourceUserMessageId = "msg-1";
  intent.mode = "send_now";
  intent.reasonCode = "explicit_send_instruction";
  intent.confidence = 1;
  intent.evidenceJson = "[]";
  intent.sourceTextHash = "a".repeat(64);
  intent.resolverVersion = "outbound-resolver-v1";
  intent.previousAssistantMessageId = null;
  const createdIntent = await intentModel.create(intent);

  const draftModel = new OutboundEmailDraftModel(tmpDir);
  await draftModel.updateBatchStatus(generated.batchId!, "draft_ready", {
    intentDecisionId: createdIntent.id,
  });

  const authz = new OutboundEmailAuthorizationService(tmpDir);
  const auth = await authz.createDirectSendAuthorization({
    intentDecisionId: createdIntent.id,
    batchId: generated.batchId!,
    sourceUserMessageId: "msg-1",
    conversationId: "conv-1",
    batchHash: generated.batchHash!,
  });
  expect(auth.success).toBe(true);

  return {
    batchId: generated.batchId!,
    batchHash: generated.batchHash!,
    authorizationId: auth.authorizationId!,
  };
}

describe("start_email_send_task authorized routing (RC4)", () => {
  it("creates outbound drafts without a separate permission decision", () => {
    const draftSkill = SkillRegistry.getSkill("draft_outbound_email_batch");
    expect(draftSkill?.requiresConfirmation).toBe(false);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims the draft batch instead of the legacy send when the gate authorized the turn", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const triple = await seedAuthorizedBatch();

    const skill = SkillRegistry.getSkill("start_email_send_task");
    expect(skill).toBeDefined();

    const exec = skill!.execute!;
    const result = await exec(
      {
        service_ids: [1],
        email_subject: "Hello",
        email_html_content: "<p>Hi</p>",
      },
      {
        conversationId: "conv-1",
        toolCallId: "tc-1",
        sourceUserMessageId: "msg-1",
        intentDecisionId: 1,
        outboundAuthorization: triple,
      }
    );

    // The authorized path claimed the batch — NOT the legacy send.
    expect(startBulkEmailSendTask).not.toHaveBeenCalled();
    expect(result.success).toBe(true);

    // The batch advanced to queued (§15.1 step 11) — the claim executed.
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const batch = await draftModel.readBatch(triple.batchId);
    expect(batch?.status).toBe("queued");
  });

  it("returns already_processed success on a duplicate claim without re-sending", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const triple = await seedAuthorizedBatch();

    const skill = SkillRegistry.getSkill("start_email_send_task");
    const exec = skill!.execute!;

    // First call claims.
    const first = await exec(
      { service_ids: [1] },
      {
        conversationId: "conv-1",
        toolCallId: "tc-1",
        outboundAuthorization: triple,
      }
    );
    expect(first.success).toBe(true);

    // Second call for the SAME authorization is an idempotent no-op (the
    // §15.1 unique idempotency key) — still success, never a duplicate send.
    const second = await exec(
      { service_ids: [1] },
      {
        conversationId: "conv-1",
        toolCallId: "tc-2",
        outboundAuthorization: triple,
      }
    );
    expect(second.success).toBe(true);
    expect(startBulkEmailSendTask).not.toHaveBeenCalled();
  });

  it("falls back to the legacy send when no authorization is present in the context", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const skill = SkillRegistry.getSkill("start_email_send_task");
    const exec = skill!.execute!;
    await exec(
      { service_ids: [1] },
      {
        conversationId: "conv-1",
        toolCallId: "tc-3",
      }
    );
    // Non-chat/legacy callers (no gate) still route to startBulkEmailSendTask.
    expect(startBulkEmailSendTask).toHaveBeenCalledTimes(1);
  });
});
