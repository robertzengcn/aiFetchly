/**
 * P1.3 / FR-014: legacy bulk-send log rows must record WHICH email-service
 * record sent and the non-secret identity it presented (From / SMTP username
 * / Reply-To), while never persisting a password. These tests exercise
 * applySendLogIdentity + the write-boundary schema round-trip through the
 * real EmailMarketingSendLogModel against isolated SQLite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailMarketingSendLogEntity } from "@/entity/EmailMarketingSendLog.entity";
import { EmailMarketingSendLogModel } from "@/model/emailMarketingSendLog.model";
import { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";
import type { EmailSendResult } from "@/entityTypes/emailmarketingType";

// Per-run temp dir so parallel workers never share one SQLite file (the
// SQLITE_BUSY shared-db flake pattern).
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-sendlog-identity-${process.pid}-${Date.now()}`
);

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
}));

function resetDb(): void {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (
    SqliteDb as unknown as { currentDbPath: string | null }
  ).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

beforeEach(() => {
  resetDb();
});

afterEach(async () => {
  await SqliteDb.destroyInstance().catch(() => undefined);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

/** Reach a private method through the prototype (module not constructed). */
function moduleWithoutConstructor(): BuckEmailTaskModule {
  return Object.create(BuckEmailTaskModule.prototype) as BuckEmailTaskModule;
}

/**
 * applySendLogIdentity is private; type-safe accessor for tests. It mutates
 * the fresh log entity it is handed (its contract), then the test persists
 * that entity through the real model to verify the schema whitelist.
 */
function callApplyIdentity(
  module: BuckEmailTaskModule,
  log: EmailMarketingSendLogEntity,
  result: EmailSendResult
): void {
  (
    module as unknown as {
      applySendLogIdentity: (
        l: EmailMarketingSendLogEntity,
        r: EmailSendResult
      ) => void;
    }
  ).applySendLogIdentity(log, result);
}

function callFormatFailure(
  module: BuckEmailTaskModule,
  result: EmailSendResult
): string {
  return (
    module as unknown as {
      formatEmailSendFailureLog: (r: EmailSendResult) => string;
    }
  ).formatEmailSendFailureLog(result);
}

const IDENTITY_RESULT: EmailSendResult = {
  receiver: "buyer@example.com",
  status: true,
  title: "Welcome",
  content: "<p>Body</p>",
  emailServiceId: 7,
  fromAddress: "sales@svc.com",
  smtpUsername: "login@svc.com",
  replyTo: "replies@svc.com",
};

describe("send-log identity (FR-014, P1.3)", () => {
  it("applySendLogIdentity copies the non-secret identity onto the log row", () => {
    const module = moduleWithoutConstructor();
    const log = new EmailMarketingSendLogEntity();

    callApplyIdentity(module, log, IDENTITY_RESULT);

    expect(log.email_service_id).toBe(7);
    expect(log.from_address).toBe("sales@svc.com");
    expect(log.smtp_username).toBe("login@svc.com");
    expect(log.reply_to).toBe("replies@svc.com");
  });

  it("legacy results without identity fields leave the columns null", () => {
    const module = moduleWithoutConstructor();
    const log = new EmailMarketingSendLogEntity();
    log.task_id = 1;
    log.status = 1;

    callApplyIdentity(module, log, {
      receiver: "buyer@example.com",
      status: true,
      title: "Welcome",
      content: "<p>Body</p>",
    });

    expect(log.email_service_id).toBeNull();
    expect(log.from_address).toBeNull();
    expect(log.smtp_username).toBeNull();
    expect(log.reply_to).toBeNull();
  });

  it("identity columns survive the write-boundary schema round-trip (real SQLite)", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const module = moduleWithoutConstructor();
    const log = new EmailMarketingSendLogEntity();
    log.task_id = 42;
    log.status = 1;
    log.receiver = "buyer@example.com";
    log.title = "Welcome";
    log.content = "<p>Body</p>";
    log.log = "";
    callApplyIdentity(module, log, IDENTITY_RESULT);

    const model = new EmailMarketingSendLogModel(tmpDir);
    const id = await model.create(log);
    const reloaded = await model.read(id);

    // The Zod whitelist must NOT strip the identity columns.
    expect(reloaded?.email_service_id).toBe(7);
    expect(reloaded?.from_address).toBe("sales@svc.com");
    expect(reloaded?.smtp_username).toBe("login@svc.com");
    expect(reloaded?.reply_to).toBe("replies@svc.com");
  });

  it("the failure log line includes the classified failure code (P0.1 parity)", () => {
    const module = moduleWithoutConstructor();
    const text = callFormatFailure(module, {
      receiver: "buyer@example.com",
      status: false,
      title: "Welcome",
      content: "<p>Body</p>",
      info: "bad credentials",
      failureCode: "smtp_auth_failed",
    });

    expect(text).toContain("Failure code: smtp_auth_failed");
  });

  it("the failure log line omits the code when the throw was unclassified", () => {
    const module = moduleWithoutConstructor();
    const text = callFormatFailure(module, {
      receiver: "buyer@example.com",
      status: false,
      title: "Welcome",
      content: "<p>Body</p>",
      info: "resolution error",
    });

    expect(text).not.toContain("Failure code:");
  });
});
