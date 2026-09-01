import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskStatus } from "@/entityTypes/commonType";
import type { Buckemailstruct } from "@/entityTypes/emailmarketingType";
import { BuckEmailType } from "@/model/buckEmailTaskdb";
import { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";

const campaign: Buckemailstruct = {
  EmailBtype: BuckEmailType.EXTRACTEMAIL,
  EmailList: [
    {
      address: "buyer@example.com",
      source: "test",
    },
  ],
  EmailTemplateslist: [],
  EmailFilterlist: [],
  EmailServicelist: [3],
  NotDuplicate: true,
  email_subject: "Campaign subject",
  email_html_content: "<p>Body</p>",
};

function moduleWithoutConstructor(): BuckEmailTaskModule {
  return Object.create(BuckEmailTaskModule.prototype) as BuckEmailTaskModule;
}

describe("BuckEmailTaskModule.startBuckEmailCampaign", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the task id without waiting for worker preparation", async () => {
    const module = moduleWithoutConstructor();
    vi.spyOn(module, "createBuckEmailTask").mockResolvedValue(77);
    vi.spyOn(module, "buckEmailsend").mockImplementation(
      () => new Promise<number>(() => undefined)
    );

    const outcome = await Promise.race([
      module.startBuckEmailCampaign(campaign),
      new Promise<"timed-out">((resolve) => {
        setTimeout(() => resolve("timed-out"), 100);
      }),
    ]);

    expect(outcome).toBe(77);
  });

  it("marks the task failed when detached worker startup rejects", async () => {
    const module = moduleWithoutConstructor();
    vi.spyOn(module, "createBuckEmailTask").mockResolvedValue(88);
    vi.spyOn(module, "buckEmailsend").mockRejectedValue(
      new Error("sender lookup failed")
    );
    const updateStatus = vi
      .spyOn(module, "updateTaskStatus")
      .mockResolvedValue();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(module.startBuckEmailCampaign(campaign)).resolves.toBe(88);
    await vi.waitFor(() => {
      expect(updateStatus).toHaveBeenCalledWith(88, TaskStatus.Error);
    });
  });
});
