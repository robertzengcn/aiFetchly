import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EmailReplyDeliveryService } from "@/service/emailReply/EmailReplyDeliveryService";

/**
 * P0.1 invariant: no public send path (IPC EMAIL_REPLY_SEND or the built-in
 * send_email_reply AI tool) can reach SMTP without a current, valid approval
 * token. The legacy direct-SMTP branch was removed; both paths route exclusively
 * through EmailReplyDeliveryService.sendApprovedReply, whose first step resolves
 * the opaque token to a trusted approval and throws otherwise.
 */
describe("P0.1 — authoritative send path (no SMTP without approval)", () => {
  it("sendApprovedReply rejects a bogus approval token before any SMTP work", async () => {
    const delivery = new EmailReplyDeliveryService();
    await expect(
      delivery.sendApprovedReply({
        draftId: 1,
        approvalToken: "not-a-real-one-time-token",
      })
    ).rejects.toThrow(/approval token/i);
  });

  it("the AI tool no longer contains a direct SMTP / ReplyEmailService call", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../../src/service/EmailReceiveAiTools.ts"),
      "utf8"
    );
    // Legacy SMTP plumbing must be gone.
    expect(src).not.toContain("ReplyEmailService");
    expect(src).not.toContain(".sendReplyEmail(");
    // The only send path is the idempotent delivery service.
    expect(src).toContain("EmailReplyDeliveryService");
  });

  it("the EMAIL_REPLY_SEND IPC handler has no legacy branch and requires a token", () => {
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../src/main-process/communication/emailReceive-ipc.ts"
      ),
      "utf8"
    );
    // The legacy delegate-to-AI-tool fallback must be gone from the send handler.
    expect(src).not.toMatch(/Legacy path — delegate to the AI tool/);
    // The handler rejects a missing token up front.
    expect(src).toContain("Approve the draft before sending");
    // It routes through the delivery service.
    expect(src).toContain("EmailReplyDeliveryService");
  });
});
