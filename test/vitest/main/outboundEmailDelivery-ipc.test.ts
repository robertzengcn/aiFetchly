import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Test-only electron shim. Captures ipcMain handlers so tests can invoke them
// directly, and exposes a BrowserWindow with a webContents.send spy so the
// progress broadcaster can be asserted.
vi.mock("electron", () => {
  const handlers = new Map<
    string,
    (e: unknown, data: unknown) => Promise<unknown>
  >();
  const sendSpy = vi.fn();
  return {
    ipcMain: {
      handle(
        channel: string,
        fn: (e: unknown, data: unknown) => Promise<unknown>
      ) {
        handlers.set(channel, fn);
      },
      _handledChannels: () => Array.from(handlers.keys()),
      _invoke: (channel: string, data: unknown) =>
        (
          handlers.get(channel) ??
          (() => Promise.reject(new Error(`no handler for ${channel}`)))
        )(undefined, data),
      _clear: () => handlers.clear(),
      // Expose the BrowserWindow send spy on ipcMain for synchronous test access.
      _sendSpy: sendSpy,
    },
    BrowserWindow: class {
      webContents = { send: sendSpy };
      isDestroyed() {
        return false;
      }
      static getAllWindows() {
        return [new this()];
      }
    },
  };
});

import { ipcMain } from "electron";
import { SqliteDb } from "@/config/SqliteDb";
import { OutboundEmailDraftService } from "@/service/outboundEmail/OutboundEmailDraftService";
import { OutboundEmailAuthorizationService } from "@/service/outboundEmail/OutboundEmailAuthorizationService";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailIntentModel } from "@/model/OutboundEmailIntent.model";
import { OutboundEmailIntentEntity } from "@/entity/OutboundEmailIntent.entity";
import {
  OUTBOUND_EMAIL_BATCH_GET,
  OUTBOUND_EMAIL_DRAFT_UPDATE,
  OUTBOUND_EMAIL_BATCH_APPROVE,
  OUTBOUND_EMAIL_BATCH_SEND,
  OUTBOUND_EMAIL_BATCH_DISCARD,
  OUTBOUND_EMAIL_BATCH_STATUS,
  OUTBOUND_EMAIL_BATCH_PROGRESS,
} from "@/config/channellist";
import type { EmailItem } from "@/entityTypes/emailmarketingType";
import {
  registerOutboundEmailDeliveryIpcHandlers,
  broadcastOutboundEmailProgress,
} from "@/main-process/communication/outboundEmailDelivery-ipc";

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-ipc");

const mockedIpc = ipcMain as unknown as {
  _handledChannels: () => string[];
  _invoke: (channel: string, data?: unknown) => Promise<unknown>;
  _clear: () => void;
  _sendSpy: ReturnType<typeof vi.fn>;
};

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
  vi.clearAllMocks();
  mockedIpc._clear();
  mockedIpc._sendSpy.mockClear();
  registerOutboundEmailDeliveryIpcHandlers({
    dbpath: tmpDir,
    workerStarter: async () => ({ started: true }),
  });
});

function recipients(): EmailItem[] {
  return [{ address: "alice@example.com", title: "Alice", source: "direct" }];
}

/** Seed a full draft_ready batch + intent decision (send_now). */
async function seedBatch(): Promise<{
  batchId: number;
  batchHash: string;
  draftId: number;
  intentDecisionId: number;
}> {
  SqliteDb.getInstance(tmpDir);
  await SqliteDb.ensureInitialized();
  const draftService = new OutboundEmailDraftService(tmpDir, {
    aiEnabledOverride: true,
  });
  const generated = await draftService.generateBatch({
    conversationId: "conv-1",
    sourceUserMessageId: "msg-1",
    intentDecisionId: 1,
    recipientSourceType: "direct",
    recipients: recipients(),
    serviceIds: [1],
    senderAddress: "sender@example.com",
    subject: "Hello Alice",
    bodyText: "Hi Alice",
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

  const drafts = await draftModel.listDraftsByBatch(generated.batchId!);
  return {
    batchId: generated.batchId!,
    batchHash: generated.batchHash!,
    draftId: drafts[0].id,
    intentDecisionId: createdIntent.id,
  };
}

/** Invoke an outbound channel with a JSON-stringified payload (matches renderer). */
async function invoke(channel: string, data: unknown): Promise<unknown> {
  return mockedIpc._invoke(channel, JSON.stringify(data));
}

describe("outbound email delivery IPC", () => {
  it("registers an invoke handler for every §17 request channel (progress is push-only)", () => {
    const channels = mockedIpc._handledChannels();
    expect(channels).toContain(OUTBOUND_EMAIL_BATCH_GET);
    expect(channels).toContain(OUTBOUND_EMAIL_DRAFT_UPDATE);
    expect(channels).toContain(OUTBOUND_EMAIL_BATCH_APPROVE);
    expect(channels).toContain(OUTBOUND_EMAIL_BATCH_SEND);
    expect(channels).toContain(OUTBOUND_EMAIL_BATCH_DISCARD);
    expect(channels).toContain(OUTBOUND_EMAIL_BATCH_STATUS);
    // Progress is a main→renderer push channel, not an invoke handler.
    expect(channels).not.toContain(OUTBOUND_EMAIL_BATCH_PROGRESS);
  });

  it("BATCH_GET returns the batch + drafts + status", async () => {
    const seed = await seedBatch();
    const result = (await invoke(OUTBOUND_EMAIL_BATCH_GET, {
      batchId: seed.batchId,
    })) as {
      status: boolean;
      data: { batch: { id: number; status: string }; drafts: unknown[] };
    };

    expect(result.status).toBe(true);
    expect(result.data.batch.id).toBe(seed.batchId);
    expect(result.data.batch.status).toBe("draft_ready");
    expect(result.data.drafts).toHaveLength(1);
  });

  it("BATCH_GET rejects an invalid batchId with a validation failure", async () => {
    const result = (await invoke(OUTBOUND_EMAIL_BATCH_GET, {
      batchId: 0,
    })) as { status: boolean; msg: string };
    expect(result.status).toBe(false);
    expect(result.msg).toMatch(/batch id/i);
  });

  it("DRAFT_UPDATE creates a new revision and invalidates prior approval", async () => {
    const seed = await seedBatch();
    const authz = new OutboundEmailAuthorizationService(tmpDir);
    const approval = await authz.createReviewApproval({
      batchId: seed.batchId,
      batchHash: seed.batchHash,
      sourceUserMessageId: "msg-1",
    });
    expect(approval.success).toBe(true);

    const result = (await invoke(OUTBOUND_EMAIL_DRAFT_UPDATE, {
      draftId: seed.draftId,
      emailServiceId: 1,
      senderAddress: "sender@example.com",
      subject: "Edited Subject",
      bodyText: "Edited body",
      bodyHtml: null,
    })) as {
      status: boolean;
      data: { revisionId: number; batchHash: string; batchStatus: string };
    };

    expect(result.status).toBe(true);
    expect(result.data.revisionId).toBeTypeOf("number");
    expect(result.data.batchStatus).toBe("draft_ready");
    // A new revision produces a new batch hash.
    expect(result.data.batchHash).not.toBe(seed.batchHash);

    // Prior approval is invalidated (edit invalidates approval, §18).
    const active = await authz.findActiveByBatch(seed.batchId);
    expect(active).toBeNull();
  });

  it("BATCH_SEND claims an authorized batch and returns the attempt id", async () => {
    const seed = await seedBatch();
    const authz = new OutboundEmailAuthorizationService(tmpDir);
    const auth = await authz.createDirectSendAuthorization({
      intentDecisionId: seed.intentDecisionId,
      batchId: seed.batchId,
      sourceUserMessageId: "msg-1",
      conversationId: "conv-1",
      batchHash: seed.batchHash,
    });
    expect(auth.success).toBe(true);

    const result = (await invoke(OUTBOUND_EMAIL_BATCH_SEND, {
      batchId: seed.batchId,
      authorizationId: auth.authorizationId!,
      batchHash: seed.batchHash,
    })) as {
      status: boolean;
      data: { status: string; attemptId: number };
    };

    expect(result.status).toBe(true);
    expect(result.data.status).toBe("claimed");
    expect(result.data.attemptId).toBeTypeOf("number");
  });

  it("BATCH_SEND returns send_already_claimed on a duplicate claim", async () => {
    const seed = await seedBatch();
    const authz = new OutboundEmailAuthorizationService(tmpDir);
    const auth = await authz.createDirectSendAuthorization({
      intentDecisionId: seed.intentDecisionId,
      batchId: seed.batchId,
      sourceUserMessageId: "msg-1",
      conversationId: "conv-1",
      batchHash: seed.batchHash,
    });

    const first = (await invoke(OUTBOUND_EMAIL_BATCH_SEND, {
      batchId: seed.batchId,
      authorizationId: auth.authorizationId!,
      batchHash: seed.batchHash,
    })) as { status: boolean; data: { attemptId: number } };
    const second = (await invoke(OUTBOUND_EMAIL_BATCH_SEND, {
      batchId: seed.batchId,
      authorizationId: auth.authorizationId!,
      batchHash: seed.batchHash,
    })) as { status: boolean; data: { status: string; attemptId: number } };

    expect(first.status).toBe(true);
    expect(second.status).toBe(true);
    expect(second.data.status).toBe("already_processed");
    expect(second.data.attemptId).toBe(first.data.attemptId);
  });

  it("BATCH_SEND fails when the authorization is missing (ownership failure)", async () => {
    const seed = await seedBatch();
    const result = (await invoke(OUTBOUND_EMAIL_BATCH_SEND, {
      batchId: seed.batchId,
      authorizationId: 999999,
      batchHash: seed.batchHash,
    })) as { status: boolean; msg: string };

    expect(result.status).toBe(false);
    // The claim transaction throws authorization_not_found; the handler wraps it.
    expect(result.msg).toMatch(/authorization/i);
  });

  it("BATCH_DISCARD marks the batch discarded", async () => {
    const seed = await seedBatch();
    const result = (await invoke(OUTBOUND_EMAIL_BATCH_DISCARD, {
      batchId: seed.batchId,
    })) as { status: boolean };

    expect(result.status).toBe(true);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const batch = await draftModel.readBatch(seed.batchId);
    expect(batch?.status).toBe("discarded");
  });

  it("BATCH_STATUS returns the attempt + outcomes for a sending batch", async () => {
    const seed = await seedBatch();
    const authz = new OutboundEmailAuthorizationService(tmpDir);
    const auth = await authz.createDirectSendAuthorization({
      intentDecisionId: seed.intentDecisionId,
      batchId: seed.batchId,
      sourceUserMessageId: "msg-1",
      conversationId: "conv-1",
      batchHash: seed.batchHash,
    });
    await invoke(OUTBOUND_EMAIL_BATCH_SEND, {
      batchId: seed.batchId,
      authorizationId: auth.authorizationId!,
      batchHash: seed.batchHash,
    });

    const result = (await invoke(OUTBOUND_EMAIL_BATCH_STATUS, {
      batchId: seed.batchId,
    })) as {
      status: boolean;
      data: {
        batchStatus: string;
        attempt: { id: number; status: string } | null;
        outcomes: unknown[];
      };
    };

    expect(result.status).toBe(true);
    expect(result.data.batchStatus).toBe("queued");
    expect(result.data.attempt).not.toBeNull();
    expect(result.data.outcomes).toHaveLength(1);
  });

  it("broadcastOutboundEmailProgress pushes the event to every window on the progress channel", () => {
    const sendSpy = mockedIpc._sendSpy;
    const event = {
      type: "authorized-email-submitted" as const,
      batchId: 7,
      sendAttemptId: 11,
      draftId: 1,
      revisionId: 10,
      envelopeHash: "a".repeat(64),
      providerMessageId: "mid-1",
    };
    broadcastOutboundEmailProgress(event);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(OUTBOUND_EMAIL_BATCH_PROGRESS, event);
  });
});
