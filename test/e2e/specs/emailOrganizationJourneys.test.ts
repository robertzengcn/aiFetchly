/**
 * Email-organization Playwright E2E journeys (fifth-audit R5-08 closure).
 *
 * Drives the production renderer UI → preload → IPC → EmailMailboxActionService
 * → real loopback IMAP (the fake server now speaks native UID MOVE and serves
 * BODY[] source literals) so the PRD's mailbox journeys run end-to-end:
 *
 *   1. Trash → Undo AFTER navigation — the operation card confirms the move,
 *      the user navigates away and back, and the DURABLE history (not page
 *      state) still exposes the Undo entry, which restores the message.
 *   2. Keyboard-operable Trash — the action button is reachable and triggers
 *      the move without a pointer.
 *   3. Bulk search → frozen preview → execute — the list page's bulk dialog
 *      searches local rows, freezes a selection, previews the exact
 *      count/destination/expiry, and executes through the real bulk loop.
 *
 * Network: everything is loopback (the fake IMAP server binds 127.0.0.1);
 * no external traffic (E2ENetworkGuard policy).
 *
 * Test-layer decoupling: no `@/` imports — all production shapes are
 * structural mirrors (design §12).
 */

import { createHash } from "node:crypto";
import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import { startFakeImapServer } from "../fixtures/fakeImapServer";
import type { LaunchedApp } from "../fixtures/electronApp";

interface FailureEnvelope {
  status: boolean;
  msg?: string;
  data: null;
  code?: string;
}

const IMAP_UID_VALIDITY = 424242;
const SENDER = "e2e-org-sender@example.com";
const IMAP_PASS = "e2e-plaintext-pass";

/** Replicates buildNamespacedProviderUid({folder, uidValidity, uid}). */
function namespacedUid(folder: string, validity: number, uid: number): string {
  const folderHash = createHash("sha256")
    .update(folder, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `imap:${folderHash}:${validity}:${uid}`;
}

function rawSource(subject: string): string {
  return [
    "From: Alice Sender <alice@example.com>",
    "To: ops@example.com",
    `Subject: ${subject}`,
    "Date: Wed, 10 Nov 2026 10:00:00 +0000",
    `Message-ID: <org-${Buffer.from(subject).toString("hex").slice(0, 12)}@example.com>`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    `${subject} — plain body`,
    "",
  ].join("\r\n");
}

async function invoke(
  app: LaunchedApp,
  channel: string,
  payload: Record<string, unknown>
): Promise<{ status: boolean; data: unknown; msg?: string; code?: string }> {
  const result = await app.mainWindow.evaluate(
    async ({ ch, data }: { ch: string; data: Record<string, unknown> }) => {
      const api = (
        window as unknown as {
          api: {
            invoke: (
              channel: string,
              data?: unknown
            ) => Promise<
              | { status: boolean; data: unknown; msg?: string; code?: string }
              | undefined
            >;
          };
        }
      ).api;
      return api.invoke(ch, JSON.stringify(data));
    },
    { ch: channel, data: payload }
  );
  expect(result, `invoke ${channel} returned undefined`).toBeDefined();
  return result!;
}

async function seedImapService(
  app: LaunchedApp,
  imapPort: number
): Promise<number> {
  const result = await invoke(app, "e2e:seed-email-service", {
    name: "E2E Org Mailbox",
    from: SENDER,
    password: IMAP_PASS,
    host: "127.0.0.1",
    port: String(imapPort),
    ssl: 0,
    status: 1,
    receiveEnabled: 1,
    imapHost: "127.0.0.1",
    imapPort: String(imapPort),
    imapSsl: 0,
    receiveFolder: "INBOX",
  });
  expect(result.status, `seed service failed: ${result.msg ?? "?"}`).toBe(true);
  return (result.data as { id: number }).id;
}

async function seedOrgMessage(
  app: LaunchedApp,
  input: { emailServiceId: number; uid: number; subject: string }
): Promise<number> {
  const seeded = await invoke(app, "e2e:seed-received-message", {
    emailServiceId: input.emailServiceId,
    providerUid: namespacedUid("INBOX", IMAP_UID_VALIDITY, input.uid),
    messageId: `<org-seed-${input.uid}@example.com>`,
    fromAddress: "alice@example.com",
    toAddresses: ["ops@example.com"],
    subject: input.subject,
    replyStatus: "not_started",
    providerFolder: "INBOX",
    providerUidValidity: String(IMAP_UID_VALIDITY),
  });
  expect(seeded.status, `seed message failed: ${seeded.msg ?? "?"}`).toBe(true);
  const messageId = (seeded.data as { id: number }).id;
  const location = await invoke(app, "e2e:seed-message-location", {
    messageId,
    emailServiceId: input.emailServiceId,
    folderPath: "INBOX",
    uidValidity: String(IMAP_UID_VALIDITY),
    providerUid: String(input.uid),
  });
  expect(location.status, `seed location failed: ${location.msg ?? "?"}`).toBe(true);
  return messageId;
}

async function navigate(app: LaunchedApp, hash: string): Promise<void> {
  // Push through the router instance (raw hash assignment races the
  // SPA's initial navigation and lands on the 404 catch-all).
  await app.mainWindow.evaluate(async (target: string) => {
    const container = document.querySelector<HTMLElement>("#app");
    const vueApp = (
      container as unknown as { __vue_app__?: { config: { globalProperties: { $router: { push: (to: string) => Promise<unknown> } } } } }
    ).__vue_app__;
    if (vueApp) {
      await vueApp.config.globalProperties.$router.push(target);
      return;
    }
    window.location.hash = target;
  }, hash);
  await app.mainWindow.waitForTimeout(300);
}

test.describe("Email organization journeys (Trash/Undo after navigation, bulk)", () => {
  test.afterEach(({ app, aiApp, disabledApp }) => {
    const a = app ?? aiApp ?? disabledApp;
    if (!a) return;
    assertCleanTeardown(a);
  });

  test("Trash then Undo AFTER navigation — durable history restores the message", async ({
    aiApp,
  }) => {
    test.setTimeout(180_000);
    const imap = await startFakeImapServer({
      user: SENDER,
      pass: IMAP_PASS,
      folders: {
        INBOX: {
          uidValidity: IMAP_UID_VALIDITY,
          messages: [
            {
              uid: 1,
              flags: ["\\Seen"],
              source: rawSource("org journey one"),
            },
          ],
        },
        Trash: { uidValidity: 99, messages: [] },
      },
    });
    try {
      const serviceId = await seedImapService(aiApp, imap.port);
      const messageId = await seedOrgMessage(aiApp, {
        emailServiceId: serviceId,
        uid: 1,
        subject: "org journey one",
      });

      // Journey 1: Trash from the detail page UI.
      await navigate(
        aiApp,
        `/emailmarketing/emailreceive/detail/${messageId}?emailServiceId=${serviceId}`
      );
      const trashButton = aiApp.mainWindow.locator(
        "[data-testid='org-trash-button']"
      );
      await expect(trashButton).toBeVisible({ timeout: 30_000 });
      await trashButton.click();

      // The operation card confirms the move (durable, polled result).
      await expect(
        aiApp.mainWindow.locator("[data-testid='email-org-action-message']")
      ).toContainText(/Moved to Trash|已移动/i, { timeout: 45_000 });

      // The fake IMAP server saw exactly one native MOVE into Trash.
      await expect
        .poll(async () => imap.moveLog.length, { timeout: 30_000 })
        .toBe(1);
      expect(imap.moveLog[0]).toMatchObject({ from: "INBOX", to: "Trash", uid: 1 });

      // Navigate AWAY and back — the Undo entry must survive via history.
      await navigate(aiApp, "/emailmarketing/emailreceive/list");
      await navigate(
        aiApp,
        `/emailmarketing/emailreceive/detail/${messageId}?emailServiceId=${serviceId}`
      );
      const history = aiApp.mainWindow.locator("[data-testid='email-org-history']");
      await expect(history).toBeVisible({ timeout: 30_000 });
      const undoButton = history.locator("[data-testid='email-org-history-restore']");
      await expect(undoButton).toBeVisible({ timeout: 30_000 });
      await undoButton.click();

      // The restore moved the message back through the REAL move path.
      await expect
        .poll(async () => imap.moveLog.length, { timeout: 45_000 })
        .toBe(2);
      expect(imap.moveLog[1]).toMatchObject({ from: "Trash", to: "INBOX" });
    } finally {
      await imap.close();
    }
  });

  test("Trash is keyboard-operable (no pointer) — accessibility journey", async ({
    aiApp,
  }) => {
    test.setTimeout(180_000);
    const imap = await startFakeImapServer({
      user: SENDER,
      pass: IMAP_PASS,
      folders: {
        INBOX: {
          uidValidity: IMAP_UID_VALIDITY,
          messages: [
            { uid: 2, flags: ["\\Seen"], source: rawSource("org journey keyboard") },
          ],
        },
        Trash: { uidValidity: 99, messages: [] },
      },
    });
    try {
      const serviceId = await seedImapService(aiApp, imap.port);
      const messageId = await seedOrgMessage(aiApp, {
        emailServiceId: serviceId,
        uid: 2,
        subject: "org journey keyboard",
      });
      await navigate(
        aiApp,
        `/emailmarketing/emailreceive/detail/${messageId}?emailServiceId=${serviceId}`
      );
      const trashButton = aiApp.mainWindow.locator(
        "[data-testid='org-trash-button']"
      );
      await expect(trashButton).toBeVisible({ timeout: 30_000 });
      // Keyboard only: focus + Enter (no click).
      await trashButton.focus();
      await aiApp.mainWindow.keyboard.press("Enter");
      await expect(
        aiApp.mainWindow.locator("[data-testid='email-org-action-message']")
      ).toContainText(/Moved to Trash|已移动/i, { timeout: 45_000 });
      await expect
        .poll(async () => imap.moveLog.length, { timeout: 30_000 })
        .toBe(1);
    } finally {
      await imap.close();
    }
  });

  test("R6-05: list-row Trash, then leaving the list, still finds Undo (detail history)", async ({
    aiApp,
  }) => {
    test.setTimeout(180_000);
    const imap = await startFakeImapServer({
      user: SENDER,
      pass: IMAP_PASS,
      folders: {
        INBOX: {
          uidValidity: IMAP_UID_VALIDITY,
          messages: [
            { uid: 21, flags: ["\\Seen"], source: rawSource("org list row trash") },
          ],
        },
        Trash: { uidValidity: 99, messages: [] },
      },
    });
    try {
      const serviceId = await seedImapService(aiApp, imap.port);
      const messageId = await seedOrgMessage(aiApp, {
        emailServiceId: serviceId,
        uid: 21,
        subject: "org list row trash",
      });

      // Trash from the LIST ROW (not the detail page).
      await navigate(aiApp, `/emailmarketing/emailreceive/list?emailServiceId=${serviceId}`);
      const rowTrash = aiApp.mainWindow.locator(
        `[data-testid='org-row-trash-${messageId}']`
      );
      await expect(rowTrash).toBeVisible({ timeout: 30_000 });
      await rowTrash.click();

      // The row action confirms and the server saw the move.
      await expect(
        aiApp.mainWindow.locator("[data-testid='org-row-message']")
      ).toContainText(/Moved to Trash|已移动/i, { timeout: 45_000 });
      await expect
        .poll(async () => imap.moveLog.length, { timeout: 30_000 })
        .toBe(1);

      // LEAVE the list for the detail page — the Undo must still be found
      // through the DURABLE history (never page-local state).
      await navigate(
        aiApp,
        `/emailmarketing/emailreceive/detail/${messageId}?emailServiceId=${serviceId}`
      );
      const history = aiApp.mainWindow.locator("[data-testid='email-org-history']");
      await expect(history).toBeVisible({ timeout: 30_000 });
      const undoButton = history.locator("[data-testid='email-org-history-restore']");
      await expect(undoButton).toBeVisible({ timeout: 30_000 });
      await undoButton.click();
      await expect
        .poll(async () => imap.moveLog.length, { timeout: 45_000 })
        .toBe(2);
      expect(imap.moveLog[1]).toMatchObject({ from: "Trash", to: "INBOX" });
    } finally {
      await imap.close();
    }
  });

  test("bulk journey: search → frozen preview → execute through the real bulk loop", async ({
    aiApp,
  }) => {
    test.setTimeout(240_000);
    const imap = await startFakeImapServer({
      user: SENDER,
      pass: IMAP_PASS,
      folders: {
        INBOX: {
          uidValidity: IMAP_UID_VALIDITY,
          messages: [
            { uid: 11, flags: ["\\Seen"], source: rawSource("org bulk alpha") },
            { uid: 12, flags: ["\\Seen"], source: rawSource("org bulk beta") },
            { uid: 13, flags: ["\\Seen"], source: rawSource("unrelated gamma") },
          ],
        },
        Trash: { uidValidity: 99, messages: [] },
      },
    });
    try {
      const serviceId = await seedImapService(aiApp, imap.port);
      const seededIds: number[] = [];
      for (const [uid, subject] of [
        [11, "org bulk alpha"],
        [12, "org bulk beta"],
        [13, "unrelated gamma"],
      ] as const) {
        seededIds.push(
          await seedOrgMessage(aiApp, { emailServiceId: serviceId, uid, subject })
        );
      }

      await navigate(aiApp, `/emailmarketing/emailreceive/list?emailServiceId=${serviceId}`);
      const bulkOpen = aiApp.mainWindow.locator("[data-testid='org-bulk-open']");
      await expect(bulkOpen).toBeVisible({ timeout: 30_000 });
      await bulkOpen.click();

      const dialog = aiApp.mainWindow.locator("[data-testid='email-org-bulk-dialog']");
      await expect(dialog).toBeVisible({ timeout: 30_000 });

      // Search by subject (local source over the seeded rows).
      await dialog
        .locator("[data-testid='email-org-bulk-subject'] input")
        .first()
        .fill("org bulk");
      await dialog.locator("[data-testid='email-org-bulk-search']").click();
      const checkboxes = dialog.locator("input[type='checkbox']");
      await expect(checkboxes).toHaveCount(2, { timeout: 30_000 });

      // Freeze the full visible subset.
      for (let i = 0; i < 2; i += 1) {
        await checkboxes.nth(i).check();
      }
      await dialog.locator("[data-testid='email-org-bulk-freeze']").click();

      // The frozen preview states the exact count + destination + expiry.
      const preview = dialog.locator("[data-testid='email-org-bulk-preview']");
      await expect(preview).toBeVisible({ timeout: 30_000 });
      await expect(preview).toContainText("2 messages will move to Trash", {
        timeout: 30_000,
      });
      await expect(preview).toContainText("Expires", { timeout: 30_000 });

      // Execute: the real bulk loop moves both messages.
      await dialog.locator("[data-testid='email-org-bulk-execute']").click();
      await expect
        .poll(async () => imap.moveLog.length, { timeout: 60_000 })
        .toBe(2);
      const movedUids = imap.moveLog.map((entry) => entry.uid).sort();
      expect(movedUids).toEqual([11, 12]);
      // The unrelated message never moved.
      expect(imap.moveLog.every((entry) => entry.to === "Trash")).toBe(true);
      void seededIds;
    } finally {
      await imap.close();
    }
  });
});
