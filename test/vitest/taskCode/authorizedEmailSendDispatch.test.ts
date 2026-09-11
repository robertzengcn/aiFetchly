import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §16.1 taskCode worker dispatch — the `sendAuthorizedEmails` action must pick
 * the schema by the payload's `version` discriminant BEFORE any send:
 *   version === 3 → authorizedEmailWorkerPayloadV3Schema → v3 path
 *   otherwise     → authorizedEmailWorkerPayloadV2Schema → legacy v2 path
 * An invalid payload never reaches EmailSend (silent return, no crash).
 *
 * The production file registers its handlers on `process.parentPort` at module
 * load. This suite injects a fake `parentPort` BEFORE importing the module so
 * the registered handler can be driven directly; heavy sibling worker modules
 * (puppeteer-based search scrapers) are mocked out so the import stays cheap.
 */

interface PostedMessage {
  action: string;
  data: unknown;
}

/** Fake `process.parentPort` (Electron utilityProcess MessagePort-like). */
class FakeParentPort {
  handler: ((e: { data: string }) => void) | null = null;
  posted: string[] = [];

  on(_event: string, handler: (e: { data: string }) => void): void {
    this.handler = handler;
  }

  postMessage(message: string): void {
    this.posted.push(message);
  }

  /** Send a ProcessMessage into the registered handler. */
  send(action: string, data: unknown): void {
    if (!this.handler) throw new Error("no handler registered");
    this.handler({ data: JSON.stringify({ action, data }) });
  }
}

const fakePort = new FakeParentPort();

// Heavy sibling modules imported at taskCode top level — mock so the import
// graph does not pull puppeteer-cluster into the vitest run.
vi.mock("@/childprocess/emailSearch", () => ({
  EmailSearch: class {},
}));
vi.mock("@/childprocess/userSearch", () => ({
  UserSearch: class {},
}));
vi.mock("@/childprocess/utils/AIRecoveryBridge", () => ({
  handleAIRecoveryResponse: vi.fn(),
}));
vi.mock("@/childprocess/utils/AiSupportBridge", () => ({
  handleAiSupportResponse: vi.fn(),
}));

// Mock the actual EmailSend so we can assert which path ran WITHOUT touching
// nodemailer; the v3/v2 worker internals are covered by authorizedEmailSend
// + EmailSendCompletion suites. Keep module shape (class with the method).
const sendAuthorizedEnvelopes = vi.fn(
  async (
    _payload: unknown,
    emit: (event: { type: string }) => void
  ): Promise<void> => {
    emit({ type: "authorized-email-worker-complete" });
  }
);
vi.mock("@/childprocess/emailSend", () => ({
  EmailSend: class {
    sendAuthorizedEnvelopes = sendAuthorizedEnvelopes;
  },
}));

async function importTaskCode(port: FakeParentPort): Promise<void> {
  const proc = process as unknown as { parentPort?: unknown };
  proc.parentPort = port;
  try {
    await import("@/taskCode");
  } finally {
    delete proc.parentPort;
  }
}

async function buildV3Payload(): Promise<{
  version: 3;
  mode: "authorized_envelopes";
  batchId: number;
  sendAttemptId: number;
  batchHash: string;
  envelopes: unknown[];
  emailServices: unknown[];
}> {
  const envelopeEntry = {
    version: 2 as const,
    draftId: 1,
    emailServiceId: 1,
    smtpUsername: "sender@example.com",
    senderAddress: "sender@example.com",
    replyToAddress: null,
    recipientAddress: "buyer@example.com",
    subject: "Hello",
    bodyText: "Hi",
    bodyHtml: null,
  };
  const { OutboundEmailEnvelopeHasher } = await import(
    "@/service/outboundEmail/OutboundEmailEnvelopeHasher"
  );
  const batchHash = OutboundEmailEnvelopeHasher.hashBatchV2([envelopeEntry]);
  const envelopeHash =
    OutboundEmailEnvelopeHasher.hashEnvelopeV2(envelopeEntry);
  return {
    version: 3,
    mode: "authorized_envelopes",
    batchId: 7,
    sendAttemptId: 11,
    batchHash,
    envelopes: [
      {
        envelopeVersion: 2,
        draftId: 1,
        revisionId: 11,
        revisionNumber: 1,
        recipientAddress: "buyer@example.com",
        emailServiceId: 1,
        smtpUsername: "sender@example.com",
        senderAddress: "sender@example.com",
        replyToAddress: null,
        subject: "Hello",
        bodyText: "Hi",
        bodyHtml: null,
        envelopeHash,
      },
    ],
    emailServices: [
      {
        id: 1,
        smtpUsername: "sender@example.com",
        from: "sender@example.com",
        replyTo: null,
        password: "secret",
        host: "smtp.example.com",
        port: "465",
        name: "Primary",
        ssl: 1,
      },
    ],
  };
}

describe("taskCode sendAuthorizedEmails version dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakePort.posted.length = 0;
  });

  afterEach(() => {
    const proc = process as unknown as { parentPort?: unknown };
    delete proc.parentPort;
  });

  it("dispatches a version-3 payload to the v3 schema path and forwards worker events", async () => {
    await importTaskCode(fakePort);
    expect(fakePort.handler).toBeTypeOf("function");

    const payload = await buildV3Payload();
    fakePort.send("sendAuthorizedEmails", payload);

    // The handler is async; flush microtasks.
    await vi.waitFor(() => {
      expect(sendAuthorizedEnvelopes).toHaveBeenCalledTimes(1);
    });

    // The v3 payload reached EmailSend with its version intact.
    const called = sendAuthorizedEnvelopes.mock.calls[0]?.[0] as {
      version: number;
    };
    expect(called.version).toBe(3);

    // The worker-complete event was forwarded to the main process with the
    // OutboundEmailDeliveryEvent action.
    await vi.waitFor(() => {
      expect(fakePort.posted.length).toBeGreaterThan(0);
    });
    const posted = fakePort.posted.map((raw) => JSON.parse(raw));
    expect(posted[0]).toMatchObject({
      action: "OutboundEmailDeliveryEvent",
      data: { type: "authorized-email-worker-complete" },
    });
  });

  it("drops a version-3 payload that fails schema validation without calling EmailSend", async () => {
    await importTaskCode(fakePort);
    expect(fakePort.handler).toBeTypeOf("function");

    // Invalid v3 payload: missing mode/batchId/envelopes entirely.
    fakePort.send("sendAuthorizedEmails", { version: 3 });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sendAuthorizedEnvelopes).not.toHaveBeenCalled();
    // No event was posted to the main process.
    expect(fakePort.posted).toHaveLength(0);
  });

  it("drops the message entirely when data is null", async () => {
    await importTaskCode(fakePort);
    fakePort.send("sendAuthorizedEmails", null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sendAuthorizedEnvelopes).not.toHaveBeenCalled();
    expect(fakePort.posted).toHaveLength(0);
  });
});
