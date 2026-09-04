import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECT_EMAIL_SOURCE } from "@/entityTypes/emailMarketingAiTypes";
import { BuckEmailType } from "@/model/buckEmailTaskdb";

const moduleMocks = vi.hoisted(() => ({
  ensureConnection: vi.fn<() => Promise<void>>(),
  startCampaign:
    vi.fn<
      (input: unknown, options?: { waitForExit?: boolean }) => Promise<number>
    >(),
  startLegacyTask: vi.fn<() => Promise<number>>(),
}));

vi.mock("@/modules/buckEmailTaskModule", () => ({
  BuckEmailTaskModule: class BuckEmailTaskModule {
    public async ensureConnection(): Promise<void> {
      return await moduleMocks.ensureConnection();
    }

    public async startBuckEmailCampaign(
      input: unknown,
      options?: { waitForExit?: boolean }
    ): Promise<number> {
      return await moduleMocks.startCampaign(input, options);
    }

    public async startBuckEmailTask(): Promise<number> {
      return await moduleMocks.startLegacyTask();
    }
  },
}));

import { startBulkEmailSendTask } from "@/service/EmailMarketingAiTools";

describe("startBulkEmailSendTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    moduleMocks.ensureConnection.mockResolvedValue();
    moduleMocks.startCampaign.mockResolvedValue(77);
    moduleMocks.startLegacyTask.mockImplementation(
      () => new Promise<number>(() => undefined)
    );
  });

  it("returns completed only after SMTP delivery finishes", async () => {
    let finishDelivery: ((taskId: number) => void) | undefined;
    moduleMocks.startCampaign.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          finishDelivery = resolve;
        })
    );

    const outcomePromise = startBulkEmailSendTask({
      emails: ["buyer@example.com"],
      service_ids: [3],
      email_subject: "Campaign subject",
      email_html_content: "<p>Body</p>",
    });
    let settled = false;
    void outcomePromise.then(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      expect(finishDelivery).toBeDefined();
    });

    expect(settled).toBe(false);
    finishDelivery?.(77);

    const outcome = await outcomePromise;
    expect(outcome).toMatchObject({
      success: true,
      task_id: 77,
      status: "completed",
      recipient_count: 1,
    });
    expect(moduleMocks.startLegacyTask).not.toHaveBeenCalled();
    expect(moduleMocks.startCampaign).toHaveBeenCalledWith(
      {
        EmailBtype: BuckEmailType.EXTRACTEMAIL,
        EmailtaskentityId: undefined,
        EmailList: [
          {
            address: "buyer@example.com",
            source: DIRECT_EMAIL_SOURCE,
            title: undefined,
          },
        ],
        EmailTemplateslist: [],
        EmailFilterlist: [],
        EmailServicelist: [3],
        NotDuplicate: true,
        email_subject: "Campaign subject",
        email_html_content: "<p>Body</p>",
      },
      { waitForExit: true }
    );
  });

  it("returns the SMTP failure instead of reporting success", async () => {
    moduleMocks.startCampaign.mockRejectedValue(
      new Error("SMTP authentication failed")
    );

    const outcome = await startBulkEmailSendTask({
      emails: ["buyer@example.com"],
      service_ids: [3],
      email_subject: "Campaign subject",
      email_html_content: "<p>Body</p>",
    });

    expect(outcome).toEqual({
      success: false,
      error: "SMTP authentication failed",
    });
  });
});
