import { e2eTest, expect } from "../fixtures/base";
import { startFakeSecretKeyServer } from "../fixtures/fakeSecretKeyServer";

e2eTest("create, assign, filter, rename and delete an email service tag", async ({ aiApp }) => {
  e2eTest.setTimeout(150_000);
  const secretKey = await startFakeSecretKeyServer();
  const page = aiApp.mainWindow;
  try {
    const serviceId = await page.evaluate(async () => {
      const api = (window as unknown as {
        api: { invoke(channel: string, data: string): Promise<{ status: boolean; data: { id: number }; msg?: string }> };
      }).api;
      const result = await api.invoke("e2e:seed-email-service", JSON.stringify({
        name: "Tagged Sender", from: "sender@example.com", password: "test-only-secret",
        host: "smtp.example.com", port: "465", ssl: 1, status: 1,
      }));
      if (!result.status) throw new Error(result.msg);
      return result.data.id;
    });
    await page.evaluate(() => { window.location.hash = "/emailmarketing/emailservice/list"; });
    await page.getByTestId("email-service-manage-tags-btn").click();
    await page.getByTestId("tag-name").locator("input").fill("Marketing");
    await page.getByRole("button", { name: "Create tag", exact: true }).click();
    await expect(page.getByRole("dialog").getByText("Marketing", { exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();

    await page.evaluate((id) => { window.location.hash = `/emailmarketing/emailservice/detail/${id}`; }, serviceId);
    const selector = page.getByTestId("email-service-tag-select");
    await selector.locator("input").fill("Marketing");
    await page.getByRole("option", { name: "Marketing", exact: true }).click();
    await page.getByRole("button", { name: "submit", exact: true }).click();
    await expect(page.getByTestId("email-service-manage-tags-btn")).toBeVisible();
    const row = page.locator("tbody tr").filter({ hasText: "Tagged Sender" });
    await expect(row).toContainText("Marketing");
    await page.getByTestId("email-service-tag-filter").click();
    await page.getByRole("option", { name: "Marketing", exact: true }).click();
    await expect(row).toBeVisible();

    await page.getByTestId("email-service-manage-tags-btn").click();
    await page.getByRole("button", { name: "Rename tag", exact: true }).click();
    await page.getByTestId("tag-name").locator("input").fill("Campaigns");
    await page.getByRole("dialog").getByRole("button", { name: "save", exact: true }).click();
    await expect(page.getByRole("dialog").getByText("Campaigns", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete tag", exact: true }).click();
    await expect(page.getByRole("dialog").filter({ has: page.getByTestId("confirm-delete-tag") })).toContainText("1 service");
    await page.getByTestId("confirm-delete-tag").click();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(row).toContainText("Untagged");
    await expect(row).toContainText("Tagged Sender");
  } finally {
    await secretKey.close();
  }
});
