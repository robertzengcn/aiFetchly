import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECT_EMAIL_SOURCE } from "@/entityTypes/emailMarketingAiTypes";
import { BuckEmailType } from "@/model/buckEmailTaskdb";

const moduleMocks = vi.hoisted(() => ({
  ensureConnection: vi.fn<() => Promise<void>>(),
  startCampaign: vi.fn<(input: unknown) => Promise<number>>(),
  startLegacyTask: vi.fn<() => Promise<number>>(),
}));

vi.mock("@/modules/buckEmailTaskModule", () => ({
  BuckEmailTaskModule: class BuckEmailTaskModule {
    public async ensureConnection(): Promise<void> {
      return await moduleMocks.ensureConnection();
    }

    public async startBuckEmailCampaign(input: unknown): Promise<number> {
      return await moduleMocks.startCampaign(input);
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

  it("returns a started task without waiting for SMTP delivery", async () => {
    const outcome = await Promise.race([
      startBulkEmailSendTask({
        emails: ["buyer@example.com"],
        service_ids: [3],
        email_subject: "Campaign subject",
        email_html_content: "<p>Body</p>",
      }),
      new Promise<"timed-out">((resolve) => {
        setTimeout(() => resolve("timed-out"), 100);
      }),
    ]);

    expect(outcome).not.toBe("timed-out");
    expect(outcome).toMatchObject({
      success: true,
      task_id: 77,
      status: "started",
      recipient_count: 1,
    });
    expect(moduleMocks.startLegacyTask).not.toHaveBeenCalled();
    expect(moduleMocks.startCampaign).toHaveBeenCalledWith({
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
    });
  });
});
