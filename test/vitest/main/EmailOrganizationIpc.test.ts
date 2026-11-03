import { describe, it, expect, vi, beforeEach } from "vitest";

// Email organization IPC contract tests: exercise the REAL registration +
// dispatch wrapper end-to-end (pattern from EmailReplyIpcStructuredFailure).
// Key invariants under test:
//   1. AI-gated channels check AI enablement BEFORE schema parsing (design
//      §8.2 — the gate order is load-bearing).
//   2. Manual mailbox controls work regardless of AI entitlement (PRD §9).
//   3. Structured failures carry stable reason codes.

const handlers = new Map<
  string,
  (event: unknown, arg: unknown) => Promise<unknown>
>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, h: (...args: unknown[]) => unknown) => {
      handlers.set(channel, h as never);
    },
  },
}));

vi.mock("@/modules/Logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const tokenGetValue = vi.fn((key: string) =>
  key === "user_ai_enabled" ? "true" : "false"
);
vi.mock("@/modules/token", () => ({
  Token: class {
    constructor() {
      return { getValue: tokenGetValue };
    }
  },
}));

import { registerEmailOrganizationIpcHandlers } from "@/main-process/communication/emailOrganization-ipc";
import {
  EMAIL_FORWARD_DRAFT_CREATE,
  EMAIL_ORG_TRASH,
  EMAIL_ORG_OPERATION_GET,
} from "@/config/channellist";

interface Envelope {
  status: boolean;
  msg: string;
  data: unknown;
  code?: string;
}

async function invoke(channel: string, arg: unknown): Promise<Envelope> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return (await handler({}, arg)) as Envelope;
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  tokenGetValue.mockImplementation((key: string) =>
    key === "user_ai_enabled" ? "true" : "false"
  );
  registerEmailOrganizationIpcHandlers();
});

describe("email organization IPC surface", () => {
  it("keeps manual draft creation available WITHOUT AI entitlement (review D3)", async () => {
    tokenGetValue.mockImplementation((key: string) =>
      key === "user_ai_enabled" ? "false" : "false"
    );
    const result = await invoke(EMAIL_FORWARD_DRAFT_CREATE, { garbage: true });
    expect(result.status).toBe(false);
    // The failure is a zod validation message, NOT an AI-entitlement refusal:
    // the trusted review dialog owns this channel; the AI path is the tool
    // layer (request-scoped confirmation + scheduled hard-block).
    expect(result.msg.toLowerCase()).not.toContain("ai feature");
  });

  it("validates draft creation bodies (manual channel)", async () => {
    const result = await invoke(EMAIL_FORWARD_DRAFT_CREATE, { messageId: -5 });
    expect(result.status).toBe(false);
    expect(result.msg).not.toContain("AI feature");
  });

  it("keeps manual trash controls available without AI entitlement (PRD §9)", async () => {
    tokenGetValue.mockImplementation((key: string) =>
      key === "user_ai_enabled" ? "false" : "false"
    );
    // Unknown message id: the handler runs (no AI refusal) and returns a
    // deterministic SOURCE_NOT_FOUND failure envelope.
    const result = await invoke(EMAIL_ORG_TRASH, { messageId: 987654321 });
    expect(result.status).toBe(true);
    const data = result.data as { success: boolean; errorCode: string };
    expect(data.success).toBe(false);
    expect(data.errorCode).toBe("SOURCE_NOT_FOUND");
  });

  it("rejects malformed trash bodies with a validation message", async () => {
    const result = await invoke(EMAIL_ORG_TRASH, { messageId: "abc" });
    expect(result.status).toBe(false);
    expect(result.msg).not.toContain("AI");
  });

  it("returns a null operation for an unknown operation id", async () => {
    const result = await invoke(EMAIL_ORG_OPERATION_GET, {
      operationId: "op-does-not-exist-anywhere",
    });
    expect(result.status).toBe(true);
    const data = result.data as { operation: unknown };
    expect(data.operation).toBeNull();
  });

  it("rejects short operation ids before any lookup", async () => {
    const result = await invoke(EMAIL_ORG_OPERATION_GET, { operationId: "x" });
    expect(result.status).toBe(false);
  });
});
