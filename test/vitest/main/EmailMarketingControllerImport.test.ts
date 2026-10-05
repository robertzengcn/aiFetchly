/**
 * Controller-level import tests for the email-service identity split (P1.4,
 * PRD FR-002 Scenario D; technical design §23.3).
 *
 * Scenario D: three aliases (Sales / Support / Billing) with unique names
 * and From addresses but the SAME SMTP username, host, port, and password
 * must all import as independent records, each independently selectable by
 * service id. Duplicate detection keys on name first, then host+From, so
 * distinct names keep them as separate creates rather than collapsing into
 * one update.
 *
 * The production IPC handler test (emailMarketingIpc.test.ts) mocks the
 * entire controller, so it never exercises the real parse → map →
 * validate → create path. This file drives `importEmailServices()` with a
 * mocked EmailServiceModule so the create/update calls and the candidate
 * entities they receive are observable — proving the identity fields are
 * persisted per-alias, not merged onto a single record.
 *
 * Invariants under test:
 *  - Three unique-name rows with a shared SMTP login → 3 creates, 0 skips.
 *  - Each created candidate carries the shared smtpUsername/host/port/
 *    password but its own name + from (+ replyTo when provided).
 *  - createEmailService returns distinct ids → the aliases are
 *    independently selectable by service id.
 *  - Re-importing the same names hits the update path (findEmailServiceByName
 *    resolves each to its existing id), proving name-based selection maps to
 *    the right distinct record — no alias overwrites another.
 *  - Passwords are never logged in import error messages.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Captured calls into the mocked EmailServiceModule so each test can assert
// which candidates were created/updated and what ids they received.
const created: EmailServiceEntity[] = [];
const updated: { id: number; entity: EmailServiceEntity }[] = [];
let nextId = 1;

// Per-test stub for findEmailServiceByName: tests seed the "existing store"
// so the duplicate-detection branch can be driven deterministically. Keys
// are service names.
let existingByName: Map<string, EmailServiceEntity>;

// validateEmailService is a hoisted vi.fn so the "rejects blank password"
// test can override the default (accept) behavior per-test. The first
// parameter mirrors the production signature (the candidate entity), even
// though the default implementation ignores it.
const validateStub = vi.hoisted(() =>
  vi.fn(
    async (
      service: EmailServiceEntity
    ): Promise<{
      valid: boolean;
      errors: { code: string; message: string }[];
    }> => {
      void service;
      return { valid: true, errors: [] };
    }
  )
);

// Hoisted metrics stub so the P2.1 counters fired inside importEmailServices
// are observable without depending on the real logger. Each call pushes the
// metric name into this array; tests assert on the counts.
const metricsStub = vi.hoisted(() =>
  vi.fn((name: string) => {
    void name;
  })
);

vi.mock("@/modules/emailServiceModule", () => ({
  EmailServiceModule: class {
    async createEmailService(entity: EmailServiceEntity): Promise<number> {
      created.push(entity);
      return nextId++;
    }
    async getEmailService(id: number): Promise<EmailServiceEntity | undefined> {
      return [...existingByName.values()].find((e) => e.id === id);
    }
    async updateEmailService(
      id: number,
      entity: EmailServiceEntity
    ): Promise<void> {
      updated.push({ id, entity });
    }
    async findEmailServiceByName(
      name: string
    ): Promise<EmailServiceEntity | undefined> {
      return existingByName.get(name);
    }
    async findEmailServicesByHost(): Promise<EmailServiceEntity[]> {
      return [];
    }
    // Delegates to the hoisted vi.fn so the "rejects blank password" test
    // can override the default (accept) behavior per-test.
    async validateEmailService(service: EmailServiceEntity): Promise<{
      valid: boolean;
      errors: { code: string; message: string }[];
    }> {
      return validateStub(service);
    }
    // Unused by the import path but required by the interface.
    async listEmailServices(): Promise<unknown> {
      return { records: [], num: 0 };
    }
    async countEmailServices(): Promise<number> {
      return 0;
    }
    async deleteEmailService(): Promise<void> {}
    async updateEmailServiceStatus(): Promise<void> {}
    async getActiveEmailServices(): Promise<EmailServiceEntity[]> {
      return [];
    }
    async readIdentity(): Promise<null> {
      return null;
    }
    async resolveReceiveConnectionConfig(): Promise<null> {
      return null;
    }
  },
}));

// The controller constructor also instantiates four other modules; none are
// touched by importEmailServices, so cheap no-op mocks keep the constructor
// off the database.
vi.mock("@/modules/EmailTemplateModule", () => ({
  EmailTemplateModule: class {},
}));
vi.mock("@/modules/EmailFilterTaskRelationModule", () => ({
  EmailFilterTaskRelationModule: class {},
}));
vi.mock("@/modules/EmailFilterModule", () => ({
  EmailFilterModule: class {},
}));
vi.mock("@/modules/EmailFilterDetailModule", () => ({
  EmailFilterDetailModule: class {},
}));

// Mock the metrics module so the P2.1 counters fired during import are
// observable without going through the real logger. Delegates to the hoisted
// stub so beforeEach can reset call history between tests.
vi.mock("@/modules/lib/EmailServiceMetrics", () => ({
  incrementEmailServiceMetric: (name: string) => metricsStub(name),
}));

import { EmailMarketingController } from "@/controller/emailMarketingController";
import { EmailServiceEntity } from "@/entity/EmailService.entity";

/**
 * Minimal local type for the structural fields the assertions read. The full
 * production type is imported above for the create-candidate construction.
 */
type AliasRow = {
  readonly name: string;
  readonly from: string;
  readonly smtpUsername: string;
  readonly replyTo?: string;
  readonly password: string;
  readonly host: string;
  readonly port: string;
  readonly ssl: number;
};

const sharedSmtpUsername = "shared-login@example.com";
const sharedHost = "smtp.example.com";
const sharedPort = "587";
const sharedPassword = "shared-secret-pass";

/** Scenario D: Sales / Support / Billing aliases on one SMTP login. */
function scenarioDRows(): readonly AliasRow[] {
  return [
    {
      name: "Sales",
      from: "sales@example.com",
      smtpUsername: sharedSmtpUsername,
      replyTo: "sales-replies@example.com",
      password: sharedPassword,
      host: sharedHost,
      port: sharedPort,
      ssl: 0,
    },
    {
      name: "Support",
      from: "support@example.com",
      smtpUsername: sharedSmtpUsername,
      replyTo: "support-replies@example.com",
      password: sharedPassword,
      host: sharedHost,
      port: sharedPort,
      ssl: 0,
    },
    {
      name: "Billing",
      from: "billing@example.com",
      smtpUsername: sharedSmtpUsername,
      // Billing has no Reply-To — proves conditional wiring per row.
      password: sharedPassword,
      host: sharedHost,
      port: sharedPort,
      ssl: 0,
    },
  ];
}

/** Build the CSV import string for the given rows. */
function rowsToCsv(rows: readonly AliasRow[]): string {
  const header = "name,from,smtpUsername,replyTo,password,host,port,ssl";
  const lines = rows.map((r) =>
    [
      r.name,
      r.from,
      r.smtpUsername,
      r.replyTo ?? "",
      r.password,
      r.host,
      r.port,
      String(r.ssl),
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

/** Find the created candidate for a given alias name. */
function createdFor(name: string): EmailServiceEntity {
  const found = created.find((c) => c.name === name);
  if (!found) throw new Error(`no created candidate for ${name}`);
  return found;
}

describe("EmailMarketingController.importEmailServices — Scenario D aliases on one login (P1.4)", () => {
  beforeEach(() => {
    created.length = 0;
    updated.length = 0;
    nextId = 1;
    existingByName = new Map();
    // Restore the default accept-all validate behavior between tests so a
    // per-test override (e.g. the blank-password rejection) does not leak.
    validateStub.mockReset();
    validateStub.mockResolvedValue({ valid: true, errors: [] });
    // Reset the metrics stub so counter-call counts are per-test.
    metricsStub.mockReset();
  });

  it("imports three aliases sharing one SMTP login as three independent records", async () => {
    const controller = new EmailMarketingController();
    const rows = scenarioDRows();

    const result = await controller.importEmailServices(rowsToCsv(rows), "csv");

    // All three rows imported, none skipped, no errors.
    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(created).toHaveLength(3);

    // Each candidate carries the shared SMTP login + host + port + password.
    for (const candidate of created) {
      expect(candidate.smtpUsername).toBe(sharedSmtpUsername);
      expect(candidate.host).toBe(sharedHost);
      expect(candidate.port).toBe(sharedPort);
      expect(candidate.password).toBe(sharedPassword);
    }

    // Each candidate carries its OWN name + From (+ Reply-To when provided).
    expect(createdFor("Sales").from).toBe("sales@example.com");
    expect(createdFor("Sales").replyTo).toBe("sales-replies@example.com");
    expect(createdFor("Support").from).toBe("support@example.com");
    expect(createdFor("Support").replyTo).toBe("support-replies@example.com");
    expect(createdFor("Billing").from).toBe("billing@example.com");
    // Billing omitted Reply-To → null (conditional wiring per row).
    expect(createdFor("Billing").replyTo).toBeNull();
  });

  it("assigns distinct ids so each alias is independently selectable by service id", async () => {
    const controller = new EmailMarketingController();
    const rows = scenarioDRows();

    const result = await controller.importEmailServices(rowsToCsv(rows), "csv");
    expect(result.imported).toBe(3);

    // Re-run: the same names now exist, so the import must UPDATE each
    // record by its resolved id rather than create duplicates. This proves
    // name-based selection maps each alias to its own distinct record — no
    // alias overwrites another.
    existingByName = new Map(
      created.map((c, i) => {
        const existing = new EmailServiceEntity();
        Object.assign(existing, c);
        existing.id = i + 1;
        return [c.name as string, existing] as const;
      })
    );
    created.length = 0;

    const second = await controller.importEmailServices(rowsToCsv(rows), "csv");
    expect(second.imported).toBe(3);
    expect(second.skipped).toBe(0);
    expect(created).toHaveLength(0); // all updates, no new creates
    expect(updated).toHaveLength(3);

    // Each update targeted the correct distinct id for its alias name.
    const updatedByName = new Map(
      updated.map((u) => [u.entity.name as string, u.id])
    );
    expect(updatedByName.get("Sales")).toBe(1);
    expect(updatedByName.get("Support")).toBe(2);
    expect(updatedByName.get("Billing")).toBe(3);
  });

  it("imports the same three aliases from JSON export shape as independent records", async () => {
    const controller = new EmailMarketingController();
    const rows = scenarioDRows();

    // JSON export shape: { total, services: [...], exportDate } (§10.2).
    const json = JSON.stringify({
      total: rows.length,
      services: rows.map((r) => ({
        name: r.name,
        from: r.from,
        smtpUsername: r.smtpUsername,
        replyTo: r.replyTo ?? null,
        password: r.password,
        host: r.host,
        port: r.port,
        ssl: r.ssl,
      })),
    });

    const result = await controller.importEmailServices(json, "json");
    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(created).toHaveLength(3);

    for (const candidate of created) {
      expect(candidate.smtpUsername).toBe(sharedSmtpUsername);
      expect(candidate.host).toBe(sharedHost);
    }
    expect(createdFor("Billing").replyTo).toBeNull();
  });

  it("rejects a row missing a password in create mode (FR-002 import password required)", async () => {
    const controller = new EmailMarketingController();
    const rows: AliasRow[] = [
      {
        name: "No Password",
        from: "nopw@example.com",
        smtpUsername: sharedSmtpUsername,
        password: "", // blank — create mode requires it
        host: sharedHost,
        port: sharedPort,
        ssl: 0,
      },
    ];

    // Override the module's validate stub to reject the blank password the
    // way the production validator does (create mode + no stored password).
    validateStub.mockResolvedValue({
      valid: false,
      errors: [{ code: "password_required", message: "Password is required" }],
    });

    const result = await controller.importEmailServices(rowsToCsv(rows), "csv");
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toContain("Password is required");
    // The rejected password value must never appear in the error message.
    expect(result.errors[0]).not.toContain(sharedPassword);
    expect(created).toHaveLength(0);
  });

  // P2.1 (§21): the two import password counters must fire on the right
  // conditions and never carry the password or any identity value (the stub
  // only receives the metric name, never a label with private content).
  it("fires import_password_preserved when an update row omits the password (P2.1)", async () => {
    const controller = new EmailMarketingController();
    const rows = scenarioDRows();
    // Seed the store so all three rows hit the update path.
    existingByName = new Map(
      rows.map((r, i) => {
        const existing = new EmailServiceEntity();
        existing.id = i + 1;
        existing.name = r.name;
        existing.from = r.from;
        existing.smtpUsername = r.smtpUsername;
        existing.replyTo = r.replyTo ?? null;
        existing.password = "old-stored-pass";
        existing.host = r.host;
        existing.port = r.port;
        existing.ssl = r.ssl;
        return [r.name, existing] as const;
      })
    );
    // Re-import WITHOUT passwords — every row must preserve the stored one.
    const noPwRows = rows.map((r) => ({ ...r, password: "" }));
    // The scenario rows carry an explicit smtpUsername, so the legacy-fallback
    // counter should NOT fire here — only import_password_preserved.
    const result = await controller.importEmailServices(
      rowsToCsv(noPwRows),
      "csv"
    );
    expect(result.imported).toBe(3);
    const names = metricsStub.mock.calls.map((c) => c[0]);
    expect(names.filter((n) => n === "import_password_preserved")).toHaveLength(
      3
    );
    expect(names).not.toContain("import_new_password_missing");
  });

  it("fires import_new_password_missing when a create row has no password (P2.1)", async () => {
    const controller = new EmailMarketingController();
    const rows: AliasRow[] = [
      {
        name: "No Password",
        from: "nopw@example.com",
        smtpUsername: sharedSmtpUsername,
        password: "", // blank — create mode requires it
        host: sharedHost,
        port: sharedPort,
        ssl: 0,
      },
    ];
    // Reject the blank password the way the production validator does.
    validateStub.mockResolvedValue({
      valid: false,
      errors: [{ code: "password_required", message: "Password is required" }],
    });
    await controller.importEmailServices(rowsToCsv(rows), "csv");
    const names = metricsStub.mock.calls.map((c) => c[0]);
    expect(names).toContain("import_new_password_missing");
    expect(names).not.toContain("import_password_preserved");
  });
});
