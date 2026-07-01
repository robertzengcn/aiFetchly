import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

// Capture registered handlers per channel for direct invocation.
const handlers = new Map<
  string,
  (event: unknown, arg: unknown) => Promise<unknown>
>();

// Mock electron BEFORE importing the wrapper.
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, h: (...args: unknown[]) => unknown) => {
      handlers.set(channel, h as never);
    },
  },
}));

// Mock Logger to keep test output clean. `log` is an object with methods.
vi.mock("@/modules/Logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Token so AI-enabled check is deterministic.
const tokenGetValue = vi.fn((key: string) => "false");
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: tokenGetValue,
  })),
}));

// Import AFTER mocks are in place.
import {
  registerValidatedHandler,
  registerAiValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
});

async function invoke(
  channel: string,
  arg: unknown
): Promise<{ status: boolean; msg: string; data: unknown }> {
  const h = handlers.get(channel);
  if (!h) throw new Error(`no handler registered for ${channel}`);
  return (await h({}, arg)) as never;
}

describe("registerValidatedHandler", () => {
  it("registers a handler that accepts valid input", async () => {
    const schema = lazySchema(() => z.strictObject({ x: z.number() }));
    registerValidatedHandler(
      "valid:ch",
      schema,
      async (input) => `got-${input.x}`
    );

    const res = await invoke("valid:ch", { x: 1 });
    expect(res.status).toBe(true);
    expect(res.data).toBe("got-1");
  });

  it("returns status:false on schema-invalid input (handler NOT called)", async () => {
    const schema = lazySchema(() => z.strictObject({ x: z.number() }));
    const inner = vi.fn(async () => "should-not-run");
    registerValidatedHandler("invalid:ch", schema, inner);

    const res = await invoke("invalid:ch", { x: "not-a-number" });
    expect(res.status).toBe(false);
    expect(res.data).toBeNull();
    expect(res.msg).toMatch(/type/i);
    expect(inner).not.toHaveBeenCalled();
  });

  it("catches handler exceptions and wraps them in envelope", async () => {
    const schema = lazySchema(() => z.strictObject({ x: z.number() }));
    registerValidatedHandler("throw:ch", schema, async () => {
      throw new Error("boom");
    });

    const res = await invoke("throw:ch", { x: 1 });
    expect(res.status).toBe(false);
    expect(res.msg).toBe("boom");
    expect(res.data).toBeNull();
  });

  it("rejects unexpected keys (strictObject)", async () => {
    const schema = lazySchema(() => z.strictObject({ x: z.number() }));
    registerValidatedHandler("strict:ch", schema, async () => "ok");

    const res = await invoke("strict:ch", { x: 1, extra: 2 });
    expect(res.status).toBe(false);
    expect(res.msg).toMatch(/unexpected/i);
  });
});

describe("registerAiValidatedHandler", () => {
  it('blocks when USER_AI_ENABLED is not "true"', async () => {
    tokenGetValue.mockReturnValue("false");
    const schema = lazySchema(() => z.strictObject({ q: z.string() }));
    const inner = vi.fn(async () => "should-not-run");
    registerAiValidatedHandler("ai:blocked", schema, inner);

    const res = await invoke("ai:blocked", { q: "hello" });
    expect(res.status).toBe(false);
    expect(res.msg).toMatch(/not enabled/i);
    expect(inner).not.toHaveBeenCalled();
    expect(tokenGetValue).toHaveBeenCalledWith("user_ai_enabled");
  });

  it('proceeds (and validates) when USER_AI_ENABLED is "true"', async () => {
    tokenGetValue.mockReturnValue("true");
    const schema = lazySchema(() => z.strictObject({ q: z.string() }));
    registerAiValidatedHandler(
      "ai:ok",
      schema,
      async (input) => `ai:${input.q}`
    );

    const res = await invoke("ai:ok", { q: "hello" });
    expect(res.status).toBe(true);
    expect(res.data).toBe("ai:hello");
  });

  it("still rejects invalid input even when AI is enabled", async () => {
    tokenGetValue.mockReturnValue("true");
    const schema = lazySchema(() => z.strictObject({ q: z.string() }));
    registerAiValidatedHandler("ai:bad", schema, async () => "ok");

    const res = await invoke("ai:bad", { q: 123 });
    expect(res.status).toBe(false);
    expect(res.msg).toMatch(/type/i);
  });
});
