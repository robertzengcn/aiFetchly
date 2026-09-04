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
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockReturnValue("/tmp/aifetchly-e2e-seed/test-db"),
    setValue: vi.fn(),
  })),
}));

vi.mock("@/model/EmailService.model", () => ({
  EmailServiceModel: vi.fn().mockImplementation((dbpath: string) => ({
    dbpath,
    create: vi.fn(async (entity: Record<string, unknown>) => {
      seedState.createdEntities.push(entity);
      return seedState.nextId++;
    }),
  })),
}));

import { registerE2ESeedIpcHandlers } from "@/main-process/e2e/E2ESeedIpc";
import { E2E_SEED_EMAIL_SERVICE } from "@/config/channellist";

/** Invoke the captured handler the way ipcMain would: (event, rawPayload). */
async function invokeSeed(
  raw: unknown
): Promise<{ status: boolean; msg: string; data: unknown }> {
  const handler = handlers.get(E2E_SEED_EMAIL_SERVICE);
  if (!handler) {
    throw new Error("seed handler was not registered");
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

  it("registers nothing when AIFETCHLY_E2E has a non-\"1\" value", () => {
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

    const result = await invokeSeed(JSON.stringify(validInput));
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

    const result = await invokeSeed(
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

    const result = await invokeSeed(JSON.stringify(badInput));
    expect(result.status).toBe(false);
    expect(result.data).toBeNull();
    expect(seedState.createdEntities).toHaveLength(0);
  });

  it("rejects unknown extra fields (strict schema)", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(
      JSON.stringify({ ...validInput, unexpected: "no" })
    );
    expect(result.status).toBe(false);
    expect(seedState.createdEntities).toHaveLength(0);
  });

  it("rejects non-string port values (entity column shape)", async () => {
    process.env.AIFETCHLY_E2E = "1";
    registerE2ESeedIpcHandlers();

    const result = await invokeSeed(
      JSON.stringify({ ...validInput, port: 465 })
    );
    expect(result.status).toBe(false);
    expect(seedState.createdEntities).toHaveLength(0);
  });
});
