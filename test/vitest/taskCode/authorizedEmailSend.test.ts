import { describe, expect, it } from "vitest";
import { EmailSend } from "@/childprocess/emailSend";
import type {
  AuthorizedSmtpSender,
  AuthorizedSmtpMail,
} from "@/childprocess/emailSend";
import { OutboundEmailEnvelopeHasher } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type { BatchEnvelopeEntry } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type {
  AuthorizedEmailWorkerEvent,
  AuthorizedEmailWorkerPayloadV2,
  AuthorizedOutboundEnvelope,
} from "@/entityTypes/outboundEmailDeliveryTypes";
import type { EmailServiceEntitydata } from "@/entityTypes/emailmarketingType";

/**
 * Worker-side tests for the authorized exact-envelope send path (technical
 * design §16). The worker must: recompute hashes before any SMTP submission
 * (stopping the entire batch on mismatch), use the exact per-envelope service
 * and content with no template conversion or random selection, emit typed
 * per-envelope events, cap SMTP concurrency at five, and release transport
 * objects after completion. It performs no database access.
 */

function makeEnvelope(
  overrides: Partial<AuthorizedOutboundEnvelope> & { draftId: number }
): AuthorizedOutboundEnvelope {
  const base: Omit<AuthorizedOutboundEnvelope, "envelopeHash"> = {
    draftId: overrides.draftId,
    revisionId: overrides.draftId * 10 + 1,
    revisionNumber: 1,
    recipientAddress: `user${overrides.draftId}@example.com`,
    emailServiceId: 1,
    senderAddress: "sender@example.com",
    subject: "Hello",
    bodyText: "Hi there",
    bodyHtml: null,
  };
  const envelope = { ...base, ...overrides };
  const canonical: Omit<AuthorizedOutboundEnvelope, "envelopeHash"> = {
    draftId: envelope.draftId,
    revisionId: envelope.revisionId,
    revisionNumber: envelope.revisionNumber,
    recipientAddress: envelope.recipientAddress,
    emailServiceId: envelope.emailServiceId,
    senderAddress: envelope.senderAddress,
    subject: envelope.subject,
    bodyText: envelope.bodyText,
    bodyHtml: envelope.bodyHtml,
  };
  return {
    ...envelope,
    envelopeHash: OutboundEmailEnvelopeHasher.hashEnvelope(
      toBatchEntry(canonical)
    ),
  };
}

function toBatchEntry(
  envelope: Omit<AuthorizedOutboundEnvelope, "envelopeHash">
): BatchEnvelopeEntry {
  return {
    version: 1,
    draftId: envelope.draftId,
    emailServiceId: envelope.emailServiceId,
    senderAddress: envelope.senderAddress,
    recipientAddress: envelope.recipientAddress,
    subject: envelope.subject,
    bodyText: envelope.bodyText,
    bodyHtml: envelope.bodyHtml,
  };
}

function makeService(id: number, from: string): EmailServiceEntitydata {
  return {
    id,
    from,
    password: `secret-${id}`,
    host: "smtp.example.com",
    port: "465",
    name: `service-${id}`,
    ssl: 1,
  };
}

function makePayload(
  envelopes: AuthorizedOutboundEnvelope[],
  emailServices: EmailServiceEntitydata[],
  batchHashOverride?: string
): AuthorizedEmailWorkerPayloadV2 {
  const batchHash =
    batchHashOverride ??
    OutboundEmailEnvelopeHasher.hashBatch(envelopes.map(toBatchEntry));
  return {
    version: 2,
    mode: "authorized_envelopes",
    batchId: 7,
    sendAttemptId: 11,
    batchHash,
    envelopes,
    emailServices,
  };
}

interface FakeSenderCall {
  readonly service: EmailServiceEntitydata;
  readonly mail: AuthorizedSmtpMail;
}

class FakeSender implements AuthorizedSmtpSender {
  readonly calls: FakeSenderCall[] = [];
  closed = false;
  /** Controls concurrent in-flight sends for the concurrency test. */
  readonly delayMs: number;

  constructor(readonly service: EmailServiceEntitydata, delayMs = 0) {
    this.delayMs = delayMs;
  }

  async send(mail: AuthorizedSmtpMail): Promise<{ messageId: string | null }> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    this.calls.push({ service: this.service, mail });
    return { messageId: `mid-${this.calls.length}` };
  }

  close(): void {
    this.closed = true;
  }
}

/** Records the peak number of simultaneously in-flight submissions. */
class ConcurrencyProbeSender extends FakeSender {
  static inFlight = 0;
  static peak = 0;

  async send(mail: AuthorizedSmtpMail): Promise<{ messageId: string | null }> {
    ConcurrencyProbeSender.inFlight += 1;
    ConcurrencyProbeSender.peak = Math.max(
      ConcurrencyProbeSender.peak,
      ConcurrencyProbeSender.inFlight
    );
    try {
      return await super.send(mail);
    } finally {
      ConcurrencyProbeSender.inFlight -= 1;
    }
  }
}

async function runWorker(
  payload: AuthorizedEmailWorkerPayloadV2,
  senders: FakeSender[]
): Promise<AuthorizedEmailWorkerEvent[]> {
  const events: AuthorizedEmailWorkerEvent[] = [];
  const worker = new EmailSend((service) => {
    const sender = senders.find((s) => s.service.id === service.id);
    if (!sender) {
      throw new Error(`no fake sender for service ${service.id}`);
    }
    return sender;
  });
  await worker.sendAuthorizedEnvelopes(payload, (event) => events.push(event));
  return events;
}

describe("EmailSend.sendAuthorizedEnvelopes", () => {
  it("stops the entire batch with worker_payload_hash_mismatch before any SMTP submission", async () => {
    const good = makeEnvelope({ draftId: 2 });
    const tampered = {
      ...makeEnvelope({ draftId: 1 }),
      envelopeHash: "b".repeat(64),
    };
    const payload = makePayload([tampered, good], [makeService(1, "s@x.com")]);
    const senders = [new FakeSender(makeService(1, "s@x.com"))];

    const events = await runWorker(payload, senders);

    // No SMTP submission happened.
    expect(senders[0].calls).toHaveLength(0);

    // Every envelope reports a definite pre-send failure (safe to retry with a
    // fresh authorization; nothing was sent).
    const failures = events.filter(
      (
        e
      ): e is Extract<
        AuthorizedEmailWorkerEvent,
        { type: "authorized-email-failed" }
      > => e.type === "authorized-email-failed"
    );
    expect(failures).toHaveLength(2);
    for (const f of failures) {
      expect(f.errorCode).toBe("worker_payload_hash_mismatch");
      expect(f.retrySafety).toBe("safe");
      expect(f.batchId).toBe(7);
      expect(f.sendAttemptId).toBe(11);
    }

    // The worker always terminates with the complete event.
    expect(events[events.length - 1]?.type).toBe(
      "authorized-email-worker-complete"
    );
  });

  it("rejects a batch hash mismatch the same way", async () => {
    const envelopes = [makeEnvelope({ draftId: 1 })];
    const payload = makePayload(
      envelopes,
      [makeService(1, "s@x.com")],
      "c".repeat(64)
    );
    const senders = [new FakeSender(makeService(1, "s@x.com"))];

    const events = await runWorker(payload, senders);

    expect(senders[0].calls).toHaveLength(0);
    const failures = events.filter((e) => e.type === "authorized-email-failed");
    expect(failures).toHaveLength(1);
  });

  it("sends the exact frozen envelope with the exact assigned service (no template conversion, no random selection)", async () => {
    const e1 = makeEnvelope({
      draftId: 1,
      emailServiceId: 1,
      subject: "Exact Subject A",
      bodyText: "Body A",
      bodyHtml: "<p>A</p>",
    });
    const e2 = makeEnvelope({
      draftId: 2,
      emailServiceId: 2,
      subject: "Exact Subject B",
      bodyText: "Body B",
      bodyHtml: null,
    });
    const payload = makePayload(
      [e1, e2],
      [makeService(1, "one@example.com"), makeService(2, "two@example.com")]
    );
    const sender1 = new FakeSender(makeService(1, "one@example.com"));
    const sender2 = new FakeSender(makeService(2, "two@example.com"));

    const events = await runWorker(payload, [sender1, sender2]);

    // Each envelope went to ITS assigned service sender — deterministic, not
    // random.
    expect(sender1.calls).toHaveLength(1);
    expect(sender2.calls).toHaveLength(1);

    // Exact content — no convertVariableInTemplate, no random template.
    expect(sender1.calls[0]?.mail.subject).toBe("Exact Subject A");
    expect(sender1.calls[0]?.mail.text).toBe("Body A");
    expect(sender1.calls[0]?.mail.html).toBe("<p>A</p>");
    expect(sender1.calls[0]?.mail.to).toBe(e1.recipientAddress);
    expect(sender1.calls[0]?.mail.from).toBe("one@example.com");

    expect(sender2.calls[0]?.mail.subject).toBe("Exact Subject B");
    expect(sender2.calls[0]?.mail.text).toBe("Body B");
    expect(sender2.calls[0]?.mail.html).toBe(null);
    expect(sender2.calls[0]?.mail.to).toBe(e2.recipientAddress);
    expect(sender2.calls[0]?.mail.from).toBe("two@example.com");

    // Typed submitted events correlate the exact revision + hash.
    const submitted = events.filter(
      (
        e
      ): e is Extract<
        AuthorizedEmailWorkerEvent,
        { type: "authorized-email-submitted" }
      > => e.type === "authorized-email-submitted"
    );
    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toMatchObject({
      batchId: 7,
      sendAttemptId: 11,
      draftId: 1,
      revisionId: e1.revisionId,
      envelopeHash: e1.envelopeHash,
      providerMessageId: "mid-1",
    });
    expect(submitted[1]).toMatchObject({
      draftId: 2,
      revisionId: e2.revisionId,
      envelopeHash: e2.envelopeHash,
    });
  });

  it("emits typed failure events with retry safety when SMTP rejects", async () => {
    const envelope = makeEnvelope({ draftId: 1 });
    const payload = makePayload([envelope], [makeService(1, "s@x.com")]);

    const events: AuthorizedEmailWorkerEvent[] = [];
    const worker = new EmailSend(() => ({
      send: () => Promise.reject(new Error("550 mailbox unavailable")),
      close: () => undefined,
    }));
    await worker.sendAuthorizedEnvelopes(payload, (e) => events.push(e));

    const failures = events.filter(
      (
        e
      ): e is Extract<
        AuthorizedEmailWorkerEvent,
        { type: "authorized-email-failed" }
      > => e.type === "authorized-email-failed"
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.errorCode).toBe("smtp_rejected");
    expect(failures[0]?.retrySafety).toBe("safe");
    expect(failures[0]?.envelopeHash).toBe(envelope.envelopeHash);
  });

  it("classifies ambiguous SMTP errors as retry-unknown", async () => {
    const envelope = makeEnvelope({ draftId: 1 });
    const payload = makePayload([envelope], [makeService(1, "s@x.com")]);

    const events: AuthorizedEmailWorkerEvent[] = [];
    const worker = new EmailSend(() => ({
      send: () =>
        Promise.reject(new Error("Greeting never received ETIMEDOUT")),
      close: () => undefined,
    }));
    await worker.sendAuthorizedEnvelopes(payload, (e) => events.push(e));

    const failures = events.filter(
      (
        e
      ): e is Extract<
        AuthorizedEmailWorkerEvent,
        { type: "authorized-email-failed" }
      > => e.type === "authorized-email-failed"
    );
    expect(failures[0]?.retrySafety).toBe("unknown");
  });

  it("aborts when an envelope references a missing service record", async () => {
    const envelope = makeEnvelope({ draftId: 1, emailServiceId: 99 });
    const payload = makePayload([envelope], [makeService(1, "s@x.com")]);
    const senders = [new FakeSender(makeService(1, "s@x.com"))];

    const events = await runWorker(payload, senders);

    expect(senders[0].calls).toHaveLength(0);
    const failures = events.filter((e) => e.type === "authorized-email-failed");
    expect(failures).toHaveLength(1);
    expect((failures[0] as { errorCode: string }).errorCode).toBe(
      "worker_service_missing"
    );
  });

  it("aborts on duplicate service records", async () => {
    const envelope = makeEnvelope({ draftId: 1, emailServiceId: 1 });
    const payload = makePayload(
      [envelope],
      [makeService(1, "a@x.com"), makeService(1, "b@x.com")]
    );
    const senders = [new FakeSender(makeService(1, "a@x.com"))];

    const events = await runWorker(payload, senders);

    expect(senders[0].calls).toHaveLength(0);
    const failures = events.filter((e) => e.type === "authorized-email-failed");
    expect((failures[0] as { errorCode: string }).errorCode).toBe(
      "worker_service_duplicate"
    );
  });

  it("limits concurrent SMTP submissions to five and closes senders after completion", async () => {
    ConcurrencyProbeSender.inFlight = 0;
    ConcurrencyProbeSender.peak = 0;
    const envelopes = Array.from({ length: 12 }, (_, i) =>
      makeEnvelope({ draftId: i + 1, emailServiceId: 1 })
    );
    const payload = makePayload([envelopes[0]], [makeService(1, "s@x.com")]);
    // Rebuild the payload so all 12 envelopes share the same batch hash.
    const fullPayload: AuthorizedEmailWorkerPayloadV2 = {
      ...payload,
      envelopes,
      batchHash: OutboundEmailEnvelopeHasher.hashBatch(
        envelopes.map(toBatchEntry)
      ),
    };

    const probe = new ConcurrencyProbeSender(makeService(1, "s@x.com"), 15);
    const events: AuthorizedEmailWorkerEvent[] = [];
    const worker = new EmailSend(() => probe);
    await worker.sendAuthorizedEnvelopes(fullPayload, (e) => events.push(e));

    expect(probe.calls).toHaveLength(12);
    expect(ConcurrencyProbeSender.peak).toBeLessThanOrEqual(5);
    expect(probe.closed).toBe(true);

    const submitted = events.filter(
      (e) => e.type === "authorized-email-submitted"
    );
    expect(submitted).toHaveLength(12);
    expect(events[events.length - 1]?.type).toBe(
      "authorized-email-worker-complete"
    );
  });
});
