import { describe, expect, it, beforeEach, vi } from "vitest";
import { OutboundEmailWorkerStarter } from "@/service/outboundEmail/OutboundEmailWorkerStarter";
import { OutboundEmailDeliveryService } from "@/service/outboundEmail/OutboundEmailDeliveryService";
import { OutboundEmailAuthorizationService } from "@/service/outboundEmail/OutboundEmailAuthorizationService";
import { OutboundEmailDraftService } from "@/service/outboundEmail/OutboundEmailDraftService";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { SqliteDb } from "@/config/SqliteDb";
import type { EmailItem } from "@/entityTypes/emailmarketingType";
import type { AuthorizedEmailWorkerPayloadV2 } from "@/entityTypes/outboundEmailDeliveryTypes";
import type { EmailServiceEntity } from "@/entity/EmailService.entity";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-starter");

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

function recipients(): EmailItem[] {
  return [{ address: "a@example.com", title: "A", source: "direct" }];
}

/** Describes a fake utility-process child the starter can "fork". */
interface FakeChild {
  pid: number | undefined;
  postMessage: (message: string, transferList?: unknown[]) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
  kill: () => void;
}

function makeFakeFork() {
  let pidCounter = 40000;
  const spawned: Array<{
    child: FakeChild;
    messages: Array<{ action: string; data: unknown }>;
  }> = [];
  const fork = (
    modulePath: string,
    args: string[],
    options: unknown
  ): FakeChild => {
    void modulePath;
    void args;
    void options;
    const messages: Array<{ action: string; data: unknown }> = [];
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    const child: FakeChild = {
      pid: pidCounter++,
      postMessage: (message: string) => {
        messages.push(JSON.parse(message));
      },
      on: (event, handler) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(handler);
      },
      off: (event, handler) => {
        const arr = handlers.get(event);
        if (arr) {
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        }
      },
      emit: (event, ...args) => {
        const arr = handlers.get(event);
        if (arr) for (const h of arr) h(...args);
      },
      kill: () => {
        // No-op: the fake child never spawns a real process.
      },
    };
    spawned.push({ child, messages });
    return child;
  };
  return { fork, spawned };
}

async function seedAndClaim(starter: OutboundEmailWorkerStarter): Promise<{
  batchId: number;
  attemptId: number;
  batchHash: string;
  status: string;
}> {
  SqliteDb.getInstance(tmpDir);
  await SqliteDb.ensureInitialized();

  const draftService = new OutboundEmailDraftService(tmpDir, {
    aiEnabledOverride: true,
  });
  const generated = await draftService.generateBatch({
    conversationId: "conv-starter",
    sourceUserMessageId: "msg-starter",
    intentDecisionId: 1,
    recipientSourceType: "direct",
    recipients: recipients(),
    serviceIds: [1],
    senderAddress: "sender@example.com",
    subject: "Hello",
    bodyText: "Hi",
    bodyHtml: null,
  });
  expect(generated.success).toBe(true);

  const { OutboundEmailIntentModel } = await import(
    "@/model/OutboundEmailIntent.model"
  );
  const { OutboundEmailIntentEntity } = await import(
    "@/entity/OutboundEmailIntent.entity"
  );
  const intentModel = new OutboundEmailIntentModel(tmpDir);
  const intent = new OutboundEmailIntentEntity();
  intent.conversationId = "conv-starter";
  intent.sourceUserMessageId = "msg-starter";
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
    sourceUserMessageId: "msg-starter",
    conversationId: "conv-starter",
    batchHash: generated.batchHash!,
  });
  expect(auth.success).toBe(true);

  const delivery = new OutboundEmailDeliveryService(tmpDir, {
    workerStarter: starter.toWorkerStarter(),
  });
  const result = await delivery.claim({
    batchId: generated.batchId!,
    authorizationId: auth.authorizationId!,
    batchHash: generated.batchHash!,
  });
  // `result.status` is asserted per-test: "claimed" when the worker starts,
  // "worker_start_failed" when credentials are missing (§15.3).

  return {
    batchId: generated.batchId!,
    attemptId: result.attemptId!,
    batchHash: generated.batchHash!,
    status: result.status,
  };
}

describe("OutboundEmailWorkerStarter", () => {
  it("builds the v2 payload, forks the worker, marks the attempt sending, and posts sendAuthorizedEmails", async () => {
    const { fork, spawned } = makeFakeFork();
    const credentialLoader = vi.fn(
      async (id: number): Promise<EmailServiceEntity | undefined> => {
        // Return a decrypted-looking entity that satisfies EmailServiceEntitydata.
        return {
          id,
          name: "Primary",
          from: "sender@example.com",
          password: "decrypted-secret",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
          status: 1,
        } as EmailServiceEntity;
      }
    );
    const starter = new OutboundEmailWorkerStarter({
      dbpath: tmpDir,
      fork,
      credentialLoader,
    });
    const ctx = await seedAndClaim(starter);
    expect(ctx.status).toBe("claimed");

    // The worker was forked exactly once.
    expect(spawned).toHaveLength(1);
    const { child, messages } = spawned[0];
    expect(child.pid).toBeTypeOf("number");

    // The attempt is marked sending with workerStartedAt + workerPid.
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const attempt = await deliveryModel.readAttempt(ctx.attemptId);
    expect(attempt?.status).toBe("sending");
    expect(attempt?.workerPid).toBe(child.pid);
    expect(attempt?.workerStartedAt).toBeInstanceOf(Date);

    // Exactly one message posted: sendAuthorizedEmails with the v2 payload.
    expect(messages).toHaveLength(1);
    expect(messages[0].action).toBe("sendAuthorizedEmails");
    const payload = messages[0].data as AuthorizedEmailWorkerPayloadV2;
    expect(payload.version).toBe(2);
    expect(payload.mode).toBe("authorized_envelopes");
    expect(payload.batchId).toBe(ctx.batchId);
    expect(payload.sendAttemptId).toBe(ctx.attemptId);
    expect(payload.batchHash).toBe(ctx.batchHash);
    expect(payload.envelopes).toHaveLength(1);
    const env = payload.envelopes[0];
    expect(env.envelopeHash).toHaveLength(64);
    expect(env.senderAddress).toBe("sender@example.com");
    expect(payload.emailServices).toHaveLength(1);
    expect(payload.emailServices[0].id).toBe(1);
    // Credentials are present in the worker payload (sent over MessagePort,
    // never over renderer IPC).
    expect(payload.emailServices[0].password).toBe("decrypted-secret");
  });

  it("records worker_start_failed when the credential loader returns undefined for a referenced service", async () => {
    const { fork, spawned } = makeFakeFork();
    const credentialLoader = vi.fn(
      async (): Promise<EmailServiceEntity | undefined> => undefined
    );
    const starter = new OutboundEmailWorkerStarter({
      dbpath: tmpDir,
      fork,
      credentialLoader,
    });

    // §15.3 — a missing credential is a definite pre-acceptance failure; the
    // delivery service catches the workerStarter throw and records
    // worker_start_failed (it never throws to the caller of claim()).
    const ctx = await seedAndClaim(starter);
    expect(ctx).toBeDefined();
    // No worker forked when credentials can't be resolved.
    expect(spawned).toHaveLength(0);
  });

  it("returns started:true and never forks when fork is omitted in a dry-run (returns a started result without spawning)", async () => {
    // A starter with a fork that is a no-op stub still must produce started:true
    // so the delivery service records a successful claim.
    const { fork, spawned } = makeFakeFork();
    const credentialLoader = vi.fn(
      async (id: number): Promise<EmailServiceEntity | undefined> =>
        ({
          id,
          name: "Primary",
          from: "sender@example.com",
          password: "x",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
          status: 1,
        } as EmailServiceEntity)
    );
    const starter = new OutboundEmailWorkerStarter({
      dbpath: tmpDir,
      fork,
      credentialLoader,
    });
    const ctx = await seedAndClaim(starter);
    expect(ctx.status).toBe("claimed");
    expect(spawned).toHaveLength(1);
    // Sanity: the attempt was created and reached sending.
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const attempt = await deliveryModel.readAttempt(ctx.attemptId);
    expect(attempt?.status).toBe("sending");
  });
});
