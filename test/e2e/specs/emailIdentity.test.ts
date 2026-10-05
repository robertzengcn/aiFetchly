/**
 * Email-identity Playwright E2E spec (P0.3, PRD §17.4; technical design §23.8,
 * §26.4).
 *
 * Drives the production renderer → preload → IPC → controller → EmailService →
 * nodemailer → fake loopback SMTP path to prove the three identity fields are
 * wired independently end-to-end. The fake SMTP server records AUTH user, MAIL
 * FROM envelope, RCPT TO, and parsed DATA headers (including Reply-To) so each
 * scenario can assert exactly which field landed where — the guarantee the
 * unit-level resolver/worker tests cannot prove on their own.
 *
 * Scenarios implemented here (TODO doc P0.3, lines 89-105):
 *
 *  1. SMTP username differs from From → assert the fake SMTP server saw the
 *     AUTH user, From envelope, and optional Reply-To header separately.
 *  1b. No Reply-To → no Reply-To header emitted (the conditional-wiring
 *      guarantee, scenario 1 variant).
 *  2. Import two aliases that share one SMTP login and send a test message
 *     through each — proves the import path persists them as independent
 *     records (FR-002, Scenario D) and each resolves its own From.
 *  5. MAIL FROM rejection on Test Email → assert the classifier maps it to
 *     the alias-guidance error key (depends on P0.1).
 *
 * Scenarios 3 (approve outbound draft, change Reply-To, delivery blocked) and
 * 4 (reply-to-received-message recipient independence) require seed channels
 * for received messages / reply drafts / approval tokens that do not yet
 * exist; they are tracked separately and are out of scope for this spec.
 *
 * Network: the fake SMTP server runs on an ephemeral loopback port in the
 * Playwright test process. The E2ENetworkGuard patches globalThis.fetch and
 * http.request only — it does NOT patch net.connect, so nodemailer's raw TCP
 * socket transport reaches the loopback server unobstructed (design §10.2).
 *
 * Launch patterns:
 *  - Scenarios 1, 1b, 5 use the `aiApp` fixture (authenticated + local-enabled),
 *    which is sufficient: the Test Email IPC is a plain (non-AI-gated) handler.
 *  - Scenario 2 imports via a native file-dialog, so it must configure the
 *    E2ENativeDialogService manifest BEFORE launch. It follows the
 *    nativeDialog.test.ts pattern exactly: plain `test`, manual temp root +
 *    FakeOpenAI server, explicit launch + closeApp, root.remove() in finally.
 *
 * Test-layer decoupling (design §12): NO `@/` imports — the Playwright test
 * compiler is esbuild without the vite `@/` alias, so all types are local
 * structural mirrors of the production shapes (mirrors the convention in
 * outbound-email-review.test.ts).
 */

import { test as baseTest, expect } from "@playwright/test";
import { e2eTest } from "../fixtures/base";
import type { LaunchedApp } from "../fixtures/electronApp";
import { launchAiFetchly } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";
import { assertCleanTeardown } from "../support/assertions";
import {
  createTemporaryRoot,
  writeStateManifest,
} from "../fixtures/temporaryState";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";
import { startFakeSmtpServer } from "../fixtures/fakeSmtpServer";
import { startFakeSecretKeyServer } from "../fixtures/fakeSecretKeyServer";
import * as fs from "node:fs";
import * as path from "node:path";

/** IPC envelope the renderer sees for Test Email results (CommonDialogMsg). */
interface TestEmailResult {
  readonly status: boolean;
  readonly code: number;
  readonly data: {
    readonly action: string;
    readonly title: string;
    readonly content: string;
  };
}

/**
 * Local structural mirror of EmailServiceEntitydata — only the fields the Test
 * Email Setting payload carries that this spec reads or forwards. The full
 * production type lives in src/entityTypes and is intentionally not imported
 * (test-layer decoupling, design §12).
 */
interface EmailServiceDetail {
  readonly id: number;
  readonly name: string;
  readonly from: string;
  readonly smtpUsername: string | null;
  readonly replyTo: string | null;
  readonly password: string;
  readonly host: string;
  readonly port: string;
  readonly ssl: number;
  readonly status: number;
}

/** One row from the EMAILSERVICELIST response. */
interface EmailServiceListRow {
  readonly id: number;
  readonly name: string;
  readonly from: string;
}

/** Email-service import result envelope ({imported, skipped, errors}). */
interface EmailServiceImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly errors: readonly string[];
}

/** Preload bridge surface (subset used by these scenarios). */
interface PreloadApi {
  invoke: (
    channel: string,
    data?: unknown
  ) => Promise<{ status: boolean; data: unknown; msg?: string } | undefined>;
  send: (channel: string, data: string) => void;
  receive: (channel: string, cb: (raw: string) => void) => void;
  removeListener: (channel: string, cb: (raw: string) => void) => void;
}

/**
 * Seed one email-service row through the E2E-only channel, pointing at the
 * recording fake SMTP server, and return its id. Plain SMTP (ssl: 0): the
 * fake server speaks no TLS, so implicit-TLS or STARTTLS would fail the
 * handshake before any identity assertion could run.
 */
async function seedService(
  app: LaunchedApp,
  smtpPort: number,
  overrides: Partial<{
    name: string;
    from: string;
    password: string;
    smtpUsername: string;
    replyTo: string;
  }> = {}
): Promise<number> {
  const result = await app.mainWindow.evaluate(
    async (input: {
      port: number;
      name: string;
      from: string;
      password: string;
      smtpUsername: string;
      replyTo: string;
    }) => {
      const api = (window as unknown as { api: PreloadApi }).api;
      const resp = await api.invoke(
        "e2e:seed-email-service",
        JSON.stringify({
          name: input.name,
          from: input.from,
          password: input.password,
          host: "127.0.0.1",
          port: String(input.port),
          ssl: 0,
          status: 1,
          smtpUsername: input.smtpUsername,
          replyTo: input.replyTo,
        })
      );
      return resp;
    },
    {
      port: smtpPort,
      name: overrides.name ?? "E2E Identity SMTP",
      from: overrides.from ?? "e2e-sender@example.com",
      password: overrides.password ?? "e2e-plaintext-pass",
      // Empty string → the seed schema's .optional() keeps it, but the handler
      // stamps `?? null`, so an empty smtpUsername falls back to From in the
      // resolver. Pass a real value when the scenario needs a distinct login.
      smtpUsername: overrides.smtpUsername ?? "",
      replyTo: overrides.replyTo ?? "",
    }
  );
  expect(result?.status, `seed failed: ${result?.msg ?? "?"}`).toBe(true);
  const id = (result?.data as { id?: unknown } | undefined)?.id;
  expect(typeof id, "seed returned no id").toBe("number");
  return id as number;
}

/**
 * Send a Test Email through the production SENDTESTEMAIL IPC and await the
 * RECEIVESENDTESTEMAILMESSAGE push-back. The Test Email handler uses the push
 * model (ipcMain.on + event.sender.send), so the renderer must register a
 * receive listener before invoking send.
 *
 * The `Setting` is built from the seeded service's detail (fetched via
 * EMAILSERVICEDETAIL), which carries a blank password sentinel ("") —
 * resolveOutboundSetting swaps in the stored password, so no credential
 * round-trips through the renderer. `EmailRequestData.From` carries the From
 * address the user typed; the controller does not use it for the envelope
 * (the EmailService identity resolver owns that).
 */
async function sendTestEmail(
  app: LaunchedApp,
  service: EmailServiceDetail,
  recipient: string,
  subject: string,
  content: string
): Promise<TestEmailResult> {
  return app.mainWindow.evaluate(
    async (input: {
      setting: EmailServiceDetail;
      receiver: string;
      title: string;
      content: string;
    }) => {
      const api = (window as unknown as { api: PreloadApi }).api;
      const payload = JSON.stringify({
        Setting: input.setting,
        EmailRequestData: {
          From: input.setting.from,
          Receiver: input.receiver,
          Title: input.title,
          Content: input.content,
        },
      });
      return await new Promise<TestEmailResult>((resolve) => {
        const channel = "receive:send:test:email:message";
        const onResult = (raw: string): void => {
          api.removeListener(channel, onResult);
          clearTimeout(timer);
          resolve(JSON.parse(raw) as TestEmailResult);
        };
        const timer = setTimeout(() => {
          api.removeListener(channel, onResult);
          resolve({
            status: false,
            code: -1,
            data: { action: "timeout", title: "", content: "" },
          });
        }, 60_000);
        api.receive(channel, onResult);
        api.send("send:test:email", payload);
      });
    },
    { setting: service, receiver: recipient, title: subject, content }
  );
}

/** Fetch the full service detail by id (for building the Test Email Setting). */
async function getServiceDetail(
  app: LaunchedApp,
  id: number
): Promise<EmailServiceDetail> {
  const result = await app.mainWindow.evaluate(async (serviceId: number) => {
    const api = (window as unknown as { api: PreloadApi }).api;
    return api.invoke("email:service:detail", { id: serviceId });
  }, id);
  expect(result?.status, `detail fetch failed for service ${id}`).toBe(true);
  return result!.data as EmailServiceDetail;
}

/** List all email services (used to confirm import created separate rows). */
async function listServices(
  app: LaunchedApp
): Promise<readonly EmailServiceListRow[]> {
  const result = await app.mainWindow.evaluate(async () => {
    const api = (window as unknown as { api: PreloadApi }).api;
    return api.invoke("email:service:list", {
      page: 0,
      size: 100,
      search: "",
    });
  });
  expect(result?.status, "service list failed").toBe(true);
  const data = result!.data as { records?: EmailServiceListRow[] };
  return data.records ?? [];
}

// ───────────────────────────────────────────────────────────────────────────
// Scenarios 1, 1b, 5 — use the shared aiApp fixture (plain Test Email IPC).
// ───────────────────────────────────────────────────────────────────────────

e2eTest.describe(
  "Email identity: separate SMTP login, From, Reply-To (P0.3)",
  () => {
    e2eTest.afterEach(({ app, aiApp, disabledApp }) => {
      const a = app ?? aiApp ?? disabledApp;
      if (!a) return;
      assertCleanTeardown(a);
    });

    // ─── Scenario 1: AUTH user, From, and Reply-To wired separately ─────────
    e2eTest(
      "SMTP username differs from From: fake SMTP sees AUTH, MAIL FROM, and Reply-To separately (scenario 1)",
      async ({ aiApp }) => {
        e2eTest.setTimeout(150_000);
        const smtp = await startFakeSmtpServer();
        try {
          // Seed a service where the SMTP login is NOT the From address and a
          // Reply-To independent of both. This is the core identity-separation
          // guarantee (FR-001/FR-003): AUTH authenticates as smtpUsername, the
          // envelope sender is From, and the Reply-To header directs replies to
          // a third address.
          const serviceId = await seedService(aiApp, smtp.port, {
            name: "E2E Identity Separation",
            from: "from-addr@example.com",
            smtpUsername: "smtp-login@example.com",
            replyTo: "replies@example.com",
            password: "e2e-plaintext-pass",
          });
          const setting = await getServiceDetail(aiApp, serviceId);

          const result = await sendTestEmail(
            aiApp,
            setting,
            "e2e-recipient@example.com",
            "E2E identity separation subject",
            "E2E identity separation body"
          );
          expect(
            result.status,
            `test email failed: ${result.data.content}`
          ).toBe(true);

          // The fake SMTP server recorded exactly one message.
          await expect
            .poll(() => smtp.recordedMessages.length, { timeout: 15_000 })
            .toBe(1);
          const recorded = smtp.recordedMessages[0];

          // AUTH user is the SMTP username, NOT the From address.
          expect(recorded.authUser).toBe("smtp-login@example.com");
          // MAIL FROM envelope is the From address, NOT the SMTP username.
          expect(recorded.mailFrom).toBe("from-addr@example.com");
          // RCPT TO is the recipient the test email targeted.
          expect(recorded.rcptTo).toEqual(["e2e-recipient@example.com"]);
          // Reply-To header is the independent third address.
          expect(recorded.headers["reply-to"]).toBe("replies@example.com");
          // Subject header landed in DATA.
          expect(recorded.headers["subject"]).toBe(
            "E2E identity separation subject"
          );
        } finally {
          await smtp.close();
        }
      }
    );

    // ─── Scenario 1b: no Reply-To → no Reply-To header emitted ──────────────
    e2eTest(
      "service without Reply-To: fake SMTP sees no Reply-To header (scenario 1 variant)",
      async ({ aiApp }) => {
        e2eTest.setTimeout(150_000);
        const smtp = await startFakeSmtpServer();
        try {
          const serviceId = await seedService(aiApp, smtp.port, {
            name: "E2E No Reply-To",
            from: "from-only@example.com",
            smtpUsername: "login-only@example.com",
            // replyTo intentionally omitted → null → resolver omits the header.
          });
          const setting = await getServiceDetail(aiApp, serviceId);

          const result = await sendTestEmail(
            aiApp,
            setting,
            "e2e-recipient@example.com",
            "E2E no reply-to subject",
            "E2E no reply-to body"
          );
          expect(result.status).toBe(true);

          await expect
            .poll(() => smtp.recordedMessages.length, { timeout: 15_000 })
            .toBe(1);
          const recorded = smtp.recordedMessages[0];
          expect(recorded.authUser).toBe("login-only@example.com");
          expect(recorded.mailFrom).toBe("from-only@example.com");
          // No Reply-To header when the field is null/absent.
          expect(recorded.headers["reply-to"]).toBeUndefined();
        } finally {
          await smtp.close();
        }
      }
    );

    // ─── Scenario 5: MAIL FROM rejection → alias guidance (P0.1 dependency) ─
    e2eTest(
      "MAIL FROM rejection on Test Email: classifier maps to from_rejected guidance (scenario 5)",
      async ({ aiApp }) => {
        e2eTest.setTimeout(150_000);
        const smtp = await startFakeSmtpServer();
        smtp.setRejectMailFrom(true);
        try {
          const serviceId = await seedService(aiApp, smtp.port, {
            name: "E2E MAIL FROM Reject",
            from: "rejected-sender@example.com",
            smtpUsername: "smtp-login@example.com",
          });
          const setting = await getServiceDetail(aiApp, serviceId);

          const result = await sendTestEmail(
            aiApp,
            setting,
            "e2e-recipient@example.com",
            "E2E from-rejected subject",
            "E2E from-rejected body"
          );

          // The send must fail: the fake SMTP rejected MAIL FROM with 550.
          expect(result.status).toBe(false);
          // The handler maps the classified code via smtpFailureI18nKey to the
          // title key `emailservice.smtp_error_from_rejected` (P0.1 wiring).
          expect(result.data.title).toBe(
            "emailservice.smtp_error_from_rejected"
          );
          // The content carries the sanitized message (never the password).
          expect(result.data.content.length).toBeGreaterThan(0);
          expect(result.data.content).not.toContain("e2e-plaintext-pass");
        } finally {
          await smtp.close();
        }
      }
    );
  }
);

// ───────────────────────────────────────────────────────────────────────────
// Scenario 2 — import two aliases sharing one SMTP login.
//
// Uses the nativeDialog.test.ts pattern (plain `test`, manual root + fake AI,
// explicit launch/close) because the import's native file-dialog must be
// configured in the state manifest BEFORE launch — the aiApp fixture launches
// without a dialog response.
// ───────────────────────────────────────────────────────────────────────────

baseTest.describe(
  "Email identity: import aliases sharing one SMTP login (P0.3 scenario 2)",
  () => {
    baseTest(
      "import two aliases sharing one SMTP login: each sends with its own From (scenario 2)",
      // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures object
      async ({}, testInfo) => {
        baseTest.setTimeout(240_000);

        const fakeAi = await startFakeOpenAiServer();
        // The import-create path encrypts the password via
        // UserSecretKeyService.getKey() → GET /apis/api/user/secret-key. The E2E
        // build bakes VITE_LOGIN_URL as "" so HttpClient falls back to
        // localhost:3000; the fake secret-key server serves the expected envelope
        // there. Without it the import would throw SecretKeyUnavailableError.
        const secretKey = await startFakeSecretKeyServer();
        const smtp = await startFakeSmtpServer();
        const root = createTemporaryRoot({
          testId: testInfo.titlePath.join(" "),
          workerIndex: testInfo.workerIndex,
        });

        let app: LaunchedApp | undefined;
        try {
          await fakeAi.reset();

          // Write a CSV with two aliases: unique names + From addresses, same
          // SMTP username / host / port / password. This is Scenario D
          // (Sales / Support / Billing) — duplicate detection uses name then
          // host+From, so unique names keep them as separate records. CSV
          // headers are case-insensitive (transformHeader lowercases them); the
          // alias map accepts smtpUsername/from/replyTo/password/host/port/ssl.
          const csvPath = path.join(root.workspacePath, "aliases.csv");
          const csvContent = [
            "name,from,smtpUsername,replyTo,password,host,port,ssl",
            [
              "E2E Sales",
              "sales@example.com",
              "shared-login@example.com",
              "",
              "e2e-plaintext-pass",
              "127.0.0.1",
              String(smtp.port),
              "0",
            ].join(","),
            [
              "E2E Support",
              "support@example.com",
              "shared-login@example.com",
              "",
              "e2e-plaintext-pass",
              "127.0.0.1",
              String(smtp.port),
              "0",
            ].join(","),
          ].join("\n");
          fs.writeFileSync(csvPath, csvContent, "utf8");

          // Manifest with the dialog response so E2ENativeDialogService returns
          // the CSV path deterministically (no OS dialog). The path must be under
          // the E2E root or the dialog service downgrades it to canceled.
          writeStateManifest(root, {
            authState: "authenticated",
            aiState: "local-enabled",
            fakeAiBaseUrl: fakeAi.providerBaseUrl,
            workspacePath: root.workspacePath,
            dialogResponses: {
              open: { action: "confirmed", paths: [csvPath] },
            },
          });

          app = await launchAiFetchly({
            testRoot: root,
            fakeAiBaseUrl: fakeAi.providerBaseUrl,
          });

          try {
            // Invoke the import IPC. The handler opens the (faked) dialog,
            // reads the CSV, and creates rows through the production import
            // path (encryptCredentialsForStorage → fake secret-key server).
            const importResult = await app.mainWindow.evaluate(async () => {
              const api = (window as unknown as { api: PreloadApi }).api;
              const resp = await api.invoke("email:service:import", {});
              return resp;
            });
            expect(importResult?.status, "import failed").toBe(true);
            const importData = importResult!.data as EmailServiceImportResult;
            expect(
              importData.imported,
              `import errors: ${JSON.stringify(importData.errors)}`
            ).toBe(2);
            expect(importData.skipped).toBe(0);

            // Confirm both rows exist as independent records.
            const services = await listServices(app);
            const sales = services.find((s) => s.name === "E2E Sales");
            const support = services.find((s) => s.name === "E2E Support");
            expect(sales, "Sales alias not imported").toBeDefined();
            expect(support, "Support alias not imported").toBeDefined();
            expect(sales!.from).toBe("sales@example.com");
            expect(support!.from).toBe("support@example.com");

            // Send a test email through each. Both authenticate with the shared
            // SMTP login but carry their own From envelope.
            const salesSetting = await getServiceDetail(app, sales!.id);
            const supportSetting = await getServiceDetail(app, support!.id);

            const salesResult = await sendTestEmail(
              app,
              salesSetting,
              "sales-recipient@example.com",
              "Sales subject",
              "Sales body"
            );
            expect(
              salesResult.status,
              `sales send failed: ${salesResult.data.content}`
            ).toBe(true);

            const supportResult = await sendTestEmail(
              app,
              supportSetting,
              "support-recipient@example.com",
              "Support subject",
              "Support body"
            );
            expect(
              supportResult.status,
              `support send failed: ${supportResult.data.content}`
            ).toBe(true);

            await expect
              .poll(() => smtp.recordedMessages.length, { timeout: 15_000 })
              .toBe(2);

            const [first, second] = smtp.recordedMessages;
            // Both authenticated with the shared SMTP login.
            expect(first.authUser).toBe("shared-login@example.com");
            expect(second.authUser).toBe("shared-login@example.com");
            // Each carried its own From envelope.
            const froms = new Set([first.mailFrom, second.mailFrom]);
            expect(froms).toContain("sales@example.com");
            expect(froms).toContain("support@example.com");
            // Each targeted its own recipient.
            expect(first.rcptTo).toEqual(["sales-recipient@example.com"]);
            expect(second.rcptTo).toEqual(["support-recipient@example.com"]);

            assertCleanTeardown(app);
          } catch (err) {
            assertCleanTeardown(app);
            throw err;
          }
        } finally {
          if (app) {
            await closeApp(app);
          }
          await smtp.close();
          await secretKey.close();
          await fakeAi.stop();
          root.remove();
        }
      }
    );
  }
);
