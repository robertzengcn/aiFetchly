/**
 * Unit tests for the E2E-only seed IPC (src/main-process/e2e/E2ESeedIpc.ts).
 *
 * These channels exist solely so the Playwright harness can insert rows the
 * sanitized E2E environment cannot create through the production path (the
 * email-service credential encryption requires the remote secret-key
 * backend). The invariants under test:
 *
 *   1. Nothing is registered unless AIFETCHLY_E2E === "1".
 *   2. Under E2E, the channel validates input with the strict Zod schema
 *      before the Model layer is touched.
 *   3. The write goes through EmailServiceModel.create (Model layer, never a
 *      repository in the IPC handler) with the password stored as given.
 *
 * The electron ipcMain is captured into a handlers Map so the registered
 * handler can be driven directly; EmailServiceModel is mocked so no real
 * database is touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

// Captured per-test calls into EmailServiceModel.create.
const seedState = vi.hoisted(() => ({
  createdEntities: [] as Array<Record<string, unknown>>,
  nextId: 1,
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));

vi.mock("@/modules/Logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/modules/token", () => ({
  // Class-based mock so `new Token()` works (arrow-function
  // mockImplementation breaks under `new` — arrow functions have no
  // [[Construct]], so vitest 4.x throws "is not a constructor").
  Token: class {
    getValue(name: string): string {
      return name === "user_dbpath" ? "/tmp/aifetchly-e2e-seed/test-db" : "";
    }
    setValue(): void {
      // no-op for tests
    }
  },
}));

vi.mock("@/model/EmailService.model", () => ({
  // Class-based mock for the same reason as Token above.
  EmailServiceModel: class {
    constructor(public dbpath: string) {}
    async create(entity: Record<string, unknown>): Promise<number> {
      seedState.createdEntities.push(entity);
      return seedState.nextId++;
    }
  },
}));

// T10 E2E seeds: capture the received-message upsert + audit-row create so
// the new channels are verified without touching a real database.
const messageSeedState = vi.hoisted(() => ({
  upsertedEntities: [] as Array<Record<string, unknown>>,
  nextId: 101,
}));

const auditSeedState = vi.hoisted(() => ({
  createdEntities: [] as Array<Record<string, unknown>>,
  nextId: 201,
}));

vi.mock("@/model/EmailReceivedMessage.model", () => ({
  EmailReceivedMessageModel: class {
    constructor(public dbpath: string) {}
    async upsertByProviderUid(
      entity: Record<string, unknown>
    ): Promise<{ id: number }> {
      messageSeedState.upsertedEntities.push(entity);
      return { id: messageSeedState.nextId++ };
    }
  },
}));

vi.mock("@/model/EmailAutoReplyAuditLog.model", () => ({
  EmailAutoReplyAuditLogModel: class {
    constructor(public dbpath: string) {}
    async create(entity: Record<string, unknown>): Promise<number> {
      auditSeedState.createdEntities.push(entity);
      return auditSeedState.nextId++;
    }
  },
}));

import { registerE2ESeedIpcHandlers } from "@/main-process/e2e/E2ESeedIpc";
import {
  E2E_SEED_EMAIL_SERVICE,
  E2E_SEED_RECEIVED_MESSAGE,
  E2E_SEED_AUTO_REPLY_AUDIT,
} from "@/config/channellist";

/** Invoke the captured handler the way ipcMain would: (event, rawPayload). */
async function invokeSeed(
  channel: string,
  raw: unknown
): Promise<{ status: boolean; msg: string; data: unknown }> {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`seed handler for ${channel} was not registered`);
  }
  return (await handler(undefined, raw)) as {
    status: boolean;
    msg: string;
    data: unknown;
  };
}

const validInput = {
  name: "E2E SMTP",
  from: "e2e-sender@example.com",
  password: "e2e-plaintext-pass",
  host: "127.0.0.1",
  port: "465",
};

describe("E2ESeedIpc", () => {
  const originalE2eEnv = process.env.AIFETCHLY_E2E;

  beforeEach(() => {
    handlers.clear();
    seedState.createdEntities = [];
    seedState.nextId = 1;
    messageSeedState.upsertedEntities = [];
    messageSeedState.nextId = 101;
    auditSeedState.createdEntities = [];
    auditSeedState.nextId = 201;
  });

  afterEach(() => {
    if (originalE2eEnv === undefined) {
      delete process.env.AIFETCHLY_E2E;
    } else {
      process.env.AIFETCHLY_E2E = originalE2eEnv;
    }
    vi.clearAllMocks();
  });

  it("registers nothing outside the E2E runtime (AIFETCHLY_E2E unset)", () => {
    delete process.env.AIFETCHLY_E2E;
    registerE2ESeedIpcHandlers();
    expect(handlers.has(E2E_SEED_EMAIL_SERVICE)).toBe(false);
  });

  it('registers nothing when AIFETCHLY_E2E has a non-"1" value', () => {
    process.env.AIFETCHLY_E2E = "0";
    registerE2ESeedIpcHandlers();
    expect(handlers.has(E2E_SEED_EMAIL_SERVICE)).toBe(false);
  });

  it("registers the seed channel under AIFETCHLY_E2E=1", () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();
    expect(handlers.has(E2E_SEED_EMAIL_SERVICE)).toBe(true);
  });

  it("creates an email-service row with the given plaintext credential through the Model layer", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(E2E_SEED_EMAIL_SERVICE, JSON.stringify(validInput));
    expect(result.status).toBe(true);
    expect(result.data).toEqual({ id: 1 });

    // Exactly one row written, via EmailServiceModel.create, password as given.
    expect(seedState.createdEntities).toHaveLength(1);
    const entity = seedState.createdEntities[0];
    expect(entity.name).toBe("E2E SMTP");
    expect(entity.from).toBe("e2e-sender@example.com");
    expect(entity.password).toBe("e2e-plaintext-pass");
    expect(entity.host).toBe("127.0.0.1");
    expect(entity.port).toBe("465");
    expect(entity.ssl).toBe(1);
    expect(entity.status).toBe(1);
  });

  it("applies optional ssl/status overrides when provided", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(E2E_SEED_EMAIL_SERVICE,
      JSON.stringify({ ...validInput, ssl: 0, status: 0 })
    );
    expect(result.status).toBe(true);
    const entity = seedState.createdEntities[0];
    expect(entity.ssl).toBe(0);
    expect(entity.status).toBe(0);
  });

  it("rejects invalid input (missing password) before the Model layer is touched", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const badInput = { ...validInput } as { password?: string };
    delete badInput.password;

    const result = await invokeSeed(E2E_SEED_EMAIL_SERVICE, JSON.stringify(badInput));
    expect(result.status).toBe(false);
    expect(result.data).toBeNull();
    expect(seedState.createdEntities).toHaveLength(0);
  });

  it("rejects unknown extra fields (strict schema)", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(E2E_SEED_EMAIL_SERVICE,
      JSON.stringify({ ...validInput, unexpected: "no" })
    );
    expect(result.status).toBe(false);
    expect(seedState.createdEntities).toHaveLength(0);
  });

  it("rejects non-string port values (entity column shape)", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(E2E_SEED_EMAIL_SERVICE,
      JSON.stringify({ ...validInput, port: 465 })
    );
    expect(result.status).toBe(false);
    expect(seedState.createdEntities).toHaveLength(0);
  });

  it("stamps optional smtpUsername and replyTo onto the entity (P0.3 identity scenarios)", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(E2E_SEED_EMAIL_SERVICE,
      JSON.stringify({
        ...validInput,
        smtpUsername: "smtp-login@example.com",
        replyTo: "replies@example.com",
      })
    );
    expect(result.status).toBe(true);
    const entity = seedState.createdEntities[0];
    expect(entity.smtpUsername).toBe("smtp-login@example.com");
    expect(entity.replyTo).toBe("replies@example.com");
  });

  it("defaults smtpUsername and replyTo to null when omitted (mirrors production merge)", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(E2E_SEED_EMAIL_SERVICE, JSON.stringify(validInput));
    expect(result.status).toBe(true);
    const entity = seedState.createdEntities[0];
    expect(entity.smtpUsername).toBeNull();
    expect(entity.replyTo).toBeNull();
  });

  it("rejects an smtpUsername that exceeds the 255-char column width", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(E2E_SEED_EMAIL_SERVICE,
      JSON.stringify({ ...validInput, smtpUsername: "x".repeat(256) })
    );
    expect(result.status).toBe(false);
    expect(seedState.createdEntities).toHaveLength(0);
  });

  it("rejects a replyTo that exceeds the 320-char column width", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(E2E_SEED_EMAIL_SERVICE,
      JSON.stringify({ ...validInput, replyTo: "x".repeat(321) })
    );
    expect(result.status).toBe(false);
    expect(seedState.createdEntities).toHaveLength(0);
  });

  // ---- T10: received-message + auto-reply-audit seed channels ----

  it("registers the T10 seed channels under AIFETCHLY_E2E=1 (and not otherwise)", () => {
    delete process.env.AIFETCHLY_E2E;
    registerE2ESeedIpcHandlers();
    expect(handlers.has(E2E_SEED_RECEIVED_MESSAGE)).toBe(false);
    expect(handlers.has(E2E_SEED_AUTO_REPLY_AUDIT)).toBe(false);

    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();
    expect(handlers.has(E2E_SEED_RECEIVED_MESSAGE)).toBe(true);
    expect(handlers.has(E2E_SEED_AUTO_REPLY_AUDIT)).toBe(true);
  });

  it("seeds a received message through the production upsert with the given replyStatus", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(
      E2E_SEED_RECEIVED_MESSAGE,
      JSON.stringify({
        emailServiceId: 7,
        providerUid: "e2e-audit-uid-1",
        messageId: "<e2e-audit-original-1@example.com>",
        fromAddress: "e2e-recipient@example.com",
        toAddresses: ["e2e-audit-sender@example.com"],
        subject: "E2E audit evidence original",
        replyStatus: "sent",
        isAnswered: 1,
      })
    );
    expect(result.status).toBe(true);
    expect(result.data).toEqual({ id: 101 });

    expect(messageSeedState.upsertedEntities).toHaveLength(1);
    const entity = messageSeedState.upsertedEntities[0];
    // The seeded replyStatus drives the §7.1 local-first outcome verbatim —
    // it must NOT be derived from isAnswered inside the seed handler.
    expect(entity.replyStatus).toBe("sent");
    expect(entity.isAnswered).toBe(1);
    expect(entity.providerUid).toBe("e2e-audit-uid-1");
    expect(entity.messageId).toBe("<e2e-audit-original-1@example.com>");
    expect(entity.toAddressesJson).toBe(
      JSON.stringify(["e2e-audit-sender@example.com"])
    );
  });

  it("rejects an invalid replyStatus for the received-message seed (closed union)", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(
      E2E_SEED_RECEIVED_MESSAGE,
      JSON.stringify({
        emailServiceId: 7,
        providerUid: "uid",
        messageId: "<a@b>",
        fromAddress: "from@example.com",
        toAddresses: ["to@example.com"],
        subject: "s",
        replyStatus: "drafting",
      })
    );
    expect(result.status).toBe(false);
    expect(messageSeedState.upsertedEntities).toHaveLength(0);
  });

  it("seeds an auto-reply audit row carrying the structured typed metadata", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const metadata = {
      correlationId: "e2e-corr-1",
      stage: "pre_draft",
      code: "already_replied",
    };
    const result = await invokeSeed(
      E2E_SEED_AUTO_REPLY_AUDIT,
      JSON.stringify({
        emailServiceId: 7,
        messageId: 101,
        action: "auto_reply_skipped",
        decisionStatus: "skipped",
        reason: "[already_replied] refused before any model call",
        generatedSubject: "E2E audit evidence original",
        metadataJson: JSON.stringify(metadata),
      })
    );
    expect(result.status).toBe(true);
    expect(result.data).toEqual({ id: 201 });

    expect(auditSeedState.createdEntities).toHaveLength(1);
    const entity = auditSeedState.createdEntities[0];
    expect(entity.action).toBe("auto_reply_skipped");
    expect(entity.decisionStatus).toBe("skipped");
    expect(entity.metadataJson).toBe(JSON.stringify(metadata));
    // Optional fields default to null, mirroring the production writers.
    expect(entity.draftId).toBeNull();
    expect(entity.ruleId).toBeNull();
    expect(entity.classification).toBeNull();
    expect(entity.confidence).toBeNull();
    expect(entity.requiresUserApproval).toBe(1);
  });

  it("rejects an audit seed with an unknown action (closed union)", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(
      E2E_SEED_AUTO_REPLY_AUDIT,
      JSON.stringify({
        emailServiceId: 7,
        messageId: 101,
        action: "reply_skipped",
        decisionStatus: "skipped",
      })
    );
    expect(result.status).toBe(false);
    expect(auditSeedState.createdEntities).toHaveLength(0);
  });
});
