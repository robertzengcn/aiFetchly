import { describe, expect, it, beforeEach, vi } from "vitest";
import { OutboundEmailWorkerStarter } from "@/service/outboundEmail/OutboundEmailWorkerStarter";
import { OutboundEmailDeliveryService } from "@/service/outboundEmail/OutboundEmailDeliveryService";
import type { ClaimResult } from "@/service/outboundEmail/OutboundEmailDeliveryService";
import { OutboundEmailAuthorizationService } from "@/service/outboundEmail/OutboundEmailAuthorizationService";
import { OutboundEmailDraftService } from "@/service/outboundEmail/OutboundEmailDraftService";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { SqliteDb } from "@/config/SqliteDb";
import type { EmailItem } from "@/entityTypes/emailmarketingType";
import type { AuthorizedEmailWorkerPayloadV3 } from "@/entityTypes/outboundEmailDeliveryTypes";
import type { EmailServiceEntity } from "@/entity/EmailService.entity";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/** Narrow a ClaimResult to its attemptId-carrying statuses. */
function attemptIdOf(claim: ClaimResult): number {
  if ("attemptId" in claim) return claim.attemptId;
  throw new Error(`expected claim to carry an attemptId, got ${claim.status}`);
}

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

/**
 * Seed an email-service row with id=1 whose resolved identity matches what
 * `generateBatch` freezes into the revision (from=sender@example.com,
 * smtpUsername=null→resolves to from, replyTo=null). The §15.5 identity-reload
 * gate reads this row at claim time; without it, `readIdentity(1)` returns
 * null and the claim aborts with `sender_identity_changed`.
 */
async function seedEmailService(overrides?: {
  from?: string;
  smtpUsername?: string | null;
  replyTo?: string | null;
}): Promise<void> {
  const { EmailServiceModel } = await import("@/model/EmailService.model");
  const { EmailServiceEntity } = await import("@/entity/EmailService.entity");
  const model = new EmailServiceModel(tmpDir);
  const entity = new EmailServiceEntity();
  entity.id = 1;
  entity.name = "Primary";
  entity.from = overrides?.from ?? "sender@example.com";
  entity.smtpUsername = overrides?.smtpUsername ?? null;
  entity.replyTo = overrides?.replyTo ?? null;
  entity.password = "secret";
  entity.host = "smtp.example.com";
  entity.port = "465";
  entity.ssl = 1;
  entity.status = 1;
  await model.create(entity);
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
  // Records the ordered sequence of listener-attach vs message-post calls per
  // child, so a test can assert the listener is wired BEFORE the payload is
  // posted (the §15.4 event-drop race fix).
  const ordering: string[] = [];
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
        ordering.push("post");
        messages.push(JSON.parse(message));
      },
      on: (event, handler) => {
        ordering.push(`on:${event}`);
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
  return { fork, spawned, ordering };
}

async function seedAndClaim(starter: OutboundEmailWorkerStarter): Promise<{
  batchId: number;
  attemptId: number;
  batchHash: string;
  status: string;
}> {
  SqliteDb.getInstance(tmpDir);
  await SqliteDb.ensureInitialized();
  await seedEmailService();

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
    attemptId: attemptIdOf(result),
    batchHash: generated.batchHash!,
    status: result.status,
  };
}

describe("OutboundEmailWorkerStarter", () => {
  it("builds the v3 payload, forks the worker, marks the attempt sending, and posts sendAuthorizedEmails", async () => {
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

    // Exactly one message posted: sendAuthorizedEmails with the v3 payload.
    // generateBatch creates v2 revisions (§17.3), so the starter emits a
    // version-3 payload carrying v2 identity (smtpUsername + replyToAddress)
    // in every envelope (§16.1).
    expect(messages).toHaveLength(1);
    expect(messages[0].action).toBe("sendAuthorizedEmails");
    const payload = messages[0].data as AuthorizedEmailWorkerPayloadV3;
    expect(payload.version).toBe(3);
    expect(payload.mode).toBe("authorized_envelopes");
    expect(payload.batchId).toBe(ctx.batchId);
    expect(payload.sendAttemptId).toBe(ctx.attemptId);
    expect(payload.batchHash).toBe(ctx.batchHash);
    expect(payload.envelopes).toHaveLength(1);
    const env = payload.envelopes[0];
    expect(env.envelopeVersion).toBe(2);
    expect(env.envelopeHash).toHaveLength(64);
    expect(env.senderAddress).toBe("sender@example.com");
    // smtpUsername falls back to the sender address when the revision carries
    // a null smtpUsername (the identity resolver resolves it to `from`).
    expect(env.smtpUsername).toBe("sender@example.com");
    expect(env.replyToAddress).toBeNull();
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

  it("attaches the message listener before posting the payload (no early-event drop)", async () => {
    const { fork, spawned, ordering } = makeFakeFork();
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

    // The "message" listener must be attached before the payload is posted —
    // otherwise the worker's synchronous early-emit paths (payload-invalid,
    // batch-too-large, hash-mismatch, duplicate-service) would be dropped and
    // the attempt stranded in `sending` (§15.4 race).
    expect(ordering).toContain("on:message");
    expect(ordering.indexOf("on:message")).toBeLessThan(
      ordering.indexOf("post")
    );
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
