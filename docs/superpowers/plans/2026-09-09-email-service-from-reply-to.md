# Separate SMTP Login, From, and Reply-To Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate three per-service email identities — SMTP username (authentication), From address (visible sender), and Reply-To (optional reply destination) — across persistence, validation, import/export, the renderer form, every SMTP send path, AI outbound authorization, and inbound reply delivery, while preserving byte-for-byte legacy v1 hashes and fail-closed compatibility for pre-existing approvals.

**Architecture:** Each `email_service` record gains two nullable columns (`smtpUsername`, `replyTo`). One pure `EmailServiceIdentityResolver` owns all fallback (`smtpUsername ?? from`, `replyTo ?? null`, `receiveUsername ?? smtpUsername ?? from`) — no other code may inline that rule (AD-003). Legacy rows resolve exactly as before via nullable columns + runtime resolution; no eager startup migration (AD-002). New outbound/reply approvals use envelope schema version 2 (adds SMTP username + Reply-To to the canonical hash); the authorized worker payload becomes version 3 (discriminated union on `version`); v1 canonicalizers/fixtures remain untouched (AD-006/AD-007). Main process stays authoritative for decrypt/validate/payload-build/persist; the worker validates the supplied v3 payload and submits SMTP only, never touching SQLite (AD-009).

**Tech Stack:** Electron + TypeScript, TypeORM (`synchronize: true`, WAL, path-keyed singleton) over better-sqlite3, Zod v4 (`zod/v4` for outbound/reply schemas, plain `zod` for shared emailMarketing + reply schemas, `lazySchema()` wrapper at IPC boundaries), Nodemailer, Papa Parse, Vue 3 + Vuetify + vue-i18n (6 languages), Vitest (utilitycode/main/components) + Mocha+Sinon (modules).

---

**Worktree:** `.claude/worktrees/email-service-identity` (branch `worktree-email-service-identity`, PR base `master`). Run ALL commands from this worktree directory; do NOT `cd` to the original repo root. The git stash stack is shared across worktrees — never use bare `git stash`/`git stash pop`; prefer a temporary WIP commit to set work aside.

**Verification commands** (NOT the watch-mode `yarn tsc`/`yarn vue-check`):

```bash
yarn typecheck          # tsc --noEmit
yarn vue-typecheck      # vue-tsc --noEmit
yarn test              # Mocha module tests (test/modules/*.test.ts)
yarn testmain          # Vitest main-process tests (test/vitest/main/**, with tsc globalSetup gate)
yarn vitest-puppeteer  # Vitest utilitycode tests (test/vitest/utilitycode/**, vite.utilityCode.config.mjs)
yarn test:components   # Vitest component tests — HARD CI gate
yarn test:e2e          # Playwright Electron E2E (builds first)
```

**IMPORTANT — vitest config split:** `yarn testmain` runs `vite.main.config.mjs`, whose `test.include` is `test/vitest/main/**/*.test.ts` ONLY (it does NOT pick up `test/vitest/utilitycode/**`). Utilitycode tests run under `yarn vitest-puppeteer` (config `vite.utilityCode.config.mjs`, include `test/vitest/utilitycode/**/*.test.ts`, also gated by the tsc globalSetup). So: for a file under `test/vitest/utilitycode/`, run `yarn vitest-puppeteer test/vitest/utilitycode/<file>.test.ts`; for a file under `test/vitest/main/`, run `yarn testmain test/vitest/main/<file>.test.ts`.

For focused runs during a phase, use a specific file (e.g. `yarn test test/modules/emailMarketingController.test.ts`) before the broader suites. Vitest utilitycode tests run under `vite.utilityCode.config.mjs` (include `test/vitest/utilitycode/**/*.test.ts`, tsc globalSetup; bypass only with `AIFETCHLY_SKIP_TSC=1` for tight inner loops — never commit code needing it).

**i18n:** 4 new keys added to ALL 6 language files (en, zh, es, fr, de, ja): `smtp_username`, `smtp_username_hint`, `reply_to`, `reply_to_hint`. Each language's `emailservice` block is keyed identically; the new keys go immediately after `id:` and before `from:` (matching the §12.2 form field order). emailservice lang block approximate line anchors (verify each with a Read before editing — these drift): en≈1255, es≈1256, fr≈1245, de≈1253, zh≈1205, ja≈1234.

**Test placement:**
- Controller tests → Mocha `test/modules/emailMarketingController.test.ts` (Sinon-stubbed `emailServiceModule` via `makeStubModule`, direct `controller.emailServiceModule = {...}` assignment — follows the `2026-09-04-email-service-import.md` precedent).
- Module/persistence tests → Mocha `test/modules/emailServiceModule.*.test.ts` (cipher test file uses `(module as unknown as {...}).emailServiceModel = {...}` stub injection + `userSecretKeyService.getKey` bind/restore).
- Pure resolver + SMTP + hasher + worker tests → Vitest `test/vitest/utilitycode/` (resolver: `EmailServiceIdentityResolver.test.ts`; SMTP: extend `smtpTransport.test.ts` + `EmailSendCompletion.test.ts`).
- Outbound/reply service tests → Vitest `test/vitest/main/` (draft/preflight/delivery/worker-starter/taskcode extend existing files there).
- Component tests → extend `test/vitest/main/components/EmailServiceDetail.test.ts` (§23.7 bullets) and `EmailServiceTable.test.ts` only where export/import projections change.
- §6.5 legacy-schema synchronization integration test → Vitest `test/vitest/main/`, using the `OutboundEmailDelivery.model.test.ts` SqliteDb reset pattern (tmpDir under `os.tmpdir()`, cleanup `scraper.db*`, null `instance`/`currentDbPath`/`initPromise`, then `SqliteDb.getInstance(tmpDir)` + `await SqliteDb.ensureInitialized()`).

**Existing test assertions that MUST be updated (not deleted) in Phase 2:** `emailMarketingController.test.ts` export tests assert the OLD CSV header `["id","name","from","host","port","ssl","receiveProtocol","create_time"]` and JSON rows `{id,name,from,host,receiveProtocol,create_time}`. After Phase 2 they must assert the new shared projection header `["id","name","smtpUsername","from","replyTo","host","port","ssl","receiveProtocol","create_time"]` and matching JSON rows. Also, those tests stub `validateEmailService` as `resolves({valid, errors: string[]})`; once the signature becomes `(entity, options) => ...` (Phase 1), update the stubs to accept the second arg.

**Security invariants (do not regress):** passwords never round-trip to the renderer (`password: ""` = keep existing sentinel); no password/token/raw import row/decrypted credential appears in renderer output, exports, logs, or worker events; reject CR/LF in SMTP username/From/Reply-To before persistence+hashing+sending; From and Reply-To are single addresses only; never use SMTP username/email as a metric label; never `as`-cast untrusted input without a Zod `.parse()` first; AI feature IPC handlers check `Token`/`USER_AI_ENABLED` first; never bypass git hooks with `--no-verify`; auto-commit after each completed logical unit (conventional commits); UI change + its tests committed together.

---

## File Structure

| Layer | File | Change |
|---|---|---|
| Entity | `src/entity/EmailService.entity.ts` | Add nullable `smtpUsername` (255) + `replyTo` (320) columns after `from` |
| Entity | `src/entity/OutboundEmailDraftRevision.entity.ts` | Add `envelopeVersion` (int default 1) + `smtpUsername` (255 nullable) + `replyToAddress` (320 nullable) |
| Entity | `src/entity/EmailReplyDraftRevision.entity.ts` | Same three fields |
| Types | `src/entityTypes/emailmarketingType.ts` | `EmailServiceEntitydata` += `smtpUsername?`, `replyTo?`; `EmailServiceExportPayload.services` → `SafeEmailServiceExportRow[]`; add `SafeEmailServiceExportRow` |
| Types | `src/entityTypes/outboundEmailDeliveryTypes.ts` | Add `CanonicalOutboundEnvelopeV2`, `BatchEnvelopeEntryV2`, `authorizedOutboundEnvelopeV3Schema`, `authorizedEmailWorkerPayloadV3Schema`, `AuthorizedEmailWorkerPayloadV3` |
| Types | `src/entityTypes/emailReplyReliabilityTypes.ts` | Add `EmailReplyApprovalEnvelopeV2` |
| Schema | `src/schemas/entity/outboundEmailDraftRevision.ts` | Validate `envelopeVersion`, `smtpUsername`, `replyToAddress` |
| Schema | `src/schemas/entity/emailReplyDraftRevision.ts` | Same three fields |
| Schema | `src/schemas/ipc/emailMarketing.ts` | Add `emailServiceUpdateInputSchema` with bounded `smtpUsername`/`from`/`replyTo` (keep shared passthrough for TPL/FILTER) |
| Resolver | `src/modules/lib/EmailServiceIdentityResolver.ts` | **NEW** — `resolveEmailServiceIdentity`, `containsEmailHeaderBreak` |
| Model | `src/model/EmailService.model.ts` | Add `readIdentity(id)`; keep `readSenderAddress` legacy COALESCE |
| Module | `src/modules/emailServiceModule.ts` | Options-aware `validateEmailService(entity, options)` with stable codes; 3-level receive fallback; `readIdentity` passthrough |
| Interface | `src/modules/interface/EmailServiceModuleInterface.ts` | Update `validateEmailService` signature; add `readIdentity` |
| Controller | `src/controller/emailMarketingController.ts` | `SafeEmailServiceExportRow` projection + parity; presence-aware import (lookup-before-validate); create/update mapping of new fields |
| IPC | `src/main-process/communication/emailMarketingIpc.ts` | EMAILSERVICEUPDATE uses `emailServiceUpdateInputSchema` + merges `smtpUsername`/`replyTo` with blank→null |
| UI | `src/views/pages/emailservice/servicedetail.vue` | Two new fields (§12.2 order), legacy fallback init, test-email payload |
| i18n | `src/views/lang/{en,zh,es,fr,de,ja}.ts` | 4 new keys each |
| SMTP | `src/modules/lib/smtpTransport.ts` | `auth.user = identity.smtpUsername` |
| SMTP | `src/modules/lib/emailService.ts` | `from: identity.fromAddress` + conditional `replyTo` |
| SMTP | `src/modules/lib/replyEmailService.ts` | Same identity mapping; inbound replyToAddress still sets receiver |
| SMTP | `src/modules/lib/smtpErrorClassifier.ts` | **NEW** — `classifySmtpFailure`, `SmtpFailureCode`, `ClassifiedSmtpFailure` |
| Outbound | `src/service/outboundEmail/resolveOutboundSender.ts` | `ResolvedOutboundIdentity` + `resolveOutboundIdentity` |
| Outbound | `src/service/outboundEmail/OutboundEmailEnvelopeHasher.ts` | Add v2 canonicalizer + `hashEnvelopeV2`/`hashBatchV2`; v1 untouched |
| Outbound | `src/service/outboundEmail/OutboundEmailDraftService.ts` | Persist v2 revisions + v2 hashes for new drafts |
| Outbound | `src/service/outboundEmail/OutboundEmailPreflightService.ts` | Version-aware envelope reconstruction |
| Outbound | `src/service/outboundEmail/OutboundEmailDeliveryService.ts` | Version-aware claim step 5; mixed-version block; §15.5 identity check; §17.1 legacy gate |
| Outbound | `src/service/outboundEmail/OutboundEmailWorkerStarter.ts` | v2/v3 version-aware payload projection + service rows w/ smtpUsername+replyTo |
| Worker | `src/childprocess/emailSend.ts` | v3 payload validation + v2 hash recompute + `AuthorizedSmtpMail.replyTo` + legacy bulk copy fields + shared classifier |
| Worker | `src/taskCode.ts` | Discriminated-union routing on `version` (2→v2 path, 3→v3 path) |
| Reply | `src/service/emailReply/EmailReplyRevisionHasher.ts` | Add v2 canonicalizer + `hashApprovalEnvelopeV2`; v1 untouched |
| Reply | `src/service/emailReply/EmailReplySendBinding.ts` | Compare smtpUsername + replyTo + sender (§18.2) |
| Reply | `src/service/emailReply/EmailReplyDeliveryService.ts` | Version-aware envelope + §18.3 legacy gate |
| Reply | `src/service/emailReply/EmailReplyRevisionMaterializer.ts` | `materializeRevision2` |
| Tests | `test/vitest/utilitycode/EmailServiceIdentityResolver.test.ts` | **NEW** — 7 behaviors (§23.1) |
| Tests | `test/vitest/main/EmailServiceLegacySchemaSync.test.ts` | **NEW** — §6.5 five-step sync |
| Tests | `test/modules/emailServiceModule.validation.test.ts` | **NEW** — §23.2 module validation |
| Tests | `test/modules/emailMarketingController.test.ts` | Extend import/export (§23.3) + update CSV-header assertions + validate stubs |
| Tests | `test/vitest/utilitycode/smtpTransport.test.ts` | Extend §23.4 |
| Tests | `test/vitest/utilitycode/EmailSendCompletion.test.ts` | Extend §23.4 worker v3 |
| Tests | `test/vitest/utilitycode/OutboundEmailEnvelopeHasher.test.ts` | **NEW or extend** — v1 pinned + v2 |
| Tests | `test/vitest/main/OutboundEmailDraftService.test.ts` | Extend §23.5 |
| Tests | `test/vitest/main/OutboundEmailPreflight.test.ts` | Extend §23.5 |
| Tests | `test/vitest/main/components/EmailServiceDetail.test.ts` | Extend §23.7 (8 bullets) |
| Tests | `test/vitest/main/components/EmailServiceTable.test.ts` | Extend where projections change |

---

### Task 1: Identity resolver + header-break predicate (Phase 1, part A)

**Files:**
- Create: `src/modules/lib/EmailServiceIdentityResolver.ts`
- Test: `test/vitest/utilitycode/EmailServiceIdentityResolver.test.ts`

- [ ] **Step 1.1: Write the failing resolver tests**

Create `test/vitest/utilitycode/EmailServiceIdentityResolver.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  resolveEmailServiceIdentity,
  containsEmailHeaderBreak,
} from "@/modules/lib/EmailServiceIdentityResolver";

describe("EmailServiceIdentityResolver", () => {
  it("configured SMTP username wins over From", () => {
    const identity = resolveEmailServiceIdentity({
      from: "sales@example.com",
      smtpUsername: "mailbox@example.com",
    });
    expect(identity.smtpUsername).toBe("mailbox@example.com");
    expect(identity.fromAddress).toBe("sales@example.com");
  });

  it("blank/null SMTP username falls back to From", () => {
    const identity = resolveEmailServiceIdentity({
      from: "sales@example.com",
      smtpUsername: "  ",
    });
    expect(identity.smtpUsername).toBe("sales@example.com");

    const identity2 = resolveEmailServiceIdentity({
      from: "sales@example.com",
      smtpUsername: null,
    });
    expect(identity2.smtpUsername).toBe("sales@example.com");
  });

  it("configured Reply-To is trimmed", () => {
    const identity = resolveEmailServiceIdentity({
      from: "sales@example.com",
      replyTo: "  support@example.com  ",
    });
    expect(identity.replyToAddress).toBe("support@example.com");
  });

  it("blank Reply-To becomes null", () => {
    const identity = resolveEmailServiceIdentity({
      from: "sales@example.com",
      replyTo: "   ",
    });
    expect(identity.replyToAddress).toBe(null);

    const identity2 = resolveEmailServiceIdentity({
      from: "sales@example.com",
    });
    expect(identity2.replyToAddress).toBe(null);
  });

  it("receive username follows explicit, SMTP, From order", () => {
    expect(
      resolveEmailServiceIdentity({ from: "sales@example.com" })
        .receiveUsername
    ).toBe("sales@example.com");

    expect(
      resolveEmailServiceIdentity({
        from: "sales@example.com",
        smtpUsername: "mailbox@example.com",
      }).receiveUsername
    ).toBe("mailbox@example.com");

    expect(
      resolveEmailServiceIdentity({
        from: "sales@example.com",
        smtpUsername: "mailbox@example.com",
        receiveUsername: "inbox@example.com",
      }).receiveUsername
    ).toBe("inbox@example.com");
  });

  it("SMTP username case is preserved", () => {
    const identity = resolveEmailServiceIdentity({
      from: "Sales@Example.com",
      smtpUsername: "MailBox@Example.com",
    });
    expect(identity.smtpUsername).toBe("MailBox@Example.com");
  });

  it("resolver does not mutate input", () => {
    const input = {
      from: "  sales@example.com  ",
      smtpUsername: "  mailbox@example.com  ",
      replyTo: "  support@example.com  ",
    };
    const snapshot = { ...input };
    resolveEmailServiceIdentity(input);
    expect(input).toEqual(snapshot);
  });

  it("containsEmailHeaderBreak flags CR and LF", () => {
    expect(containsEmailHeaderBreak("a\rb")).toBe(true);
    expect(containsEmailHeaderBreak("a\nb")).toBe(true);
    expect(containsEmailHeaderBreak("a\r\nb")).toBe(true);
    expect(containsEmailHeaderBreak("plain")).toBe(false);
    expect(containsEmailHeaderBreak("")).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run the tests to verify they fail**

Run: `yarn vitest-puppeteer test/vitest/utilitycode/EmailServiceIdentityResolver.test.ts`
Expected: FAIL — module `@/modules/lib/EmailServiceIdentityResolver` does not exist (import resolves to undefined).

- [ ] **Step 1.3: Write the resolver implementation**

Create `src/modules/lib/EmailServiceIdentityResolver.ts`:

```typescript
/**
 * Pure effective-identity resolver for email services (technical design §7.1).
 *
 * One place owns the fallback rule `smtpUsername ?? from`. No controller, worker,
 * or mail sender may inline that rule (AD-003). The resolver never reads the
 * database, never decrypts credentials, never lowercases SMTP usernames
 * (providers may treat non-email logins as case-sensitive), and never mutates
 * its input. It does not repair invalid From/Reply-To addresses; validation owns
 * that decision.
 */
export interface EmailServiceIdentityInput {
  readonly smtpUsername?: string | null;
  readonly from: string;
  readonly replyTo?: string | null;
  readonly receiveUsername?: string | null;
}

export interface ResolvedEmailServiceIdentity {
  readonly smtpUsername: string;
  readonly fromAddress: string;
  readonly replyToAddress: string | null;
  readonly receiveUsername: string;
}

/**
 * Resolve the effective identity for one service-like object.
 *
 * Rules (§7.1):
 *   fromAddress    = input.from.trim()
 *   smtpUsername   = input.smtpUsername?.trim() || fromAddress
 *   replyToAddress = input.replyTo?.trim() || null
 *   receiveUsername= input.receiveUsername?.trim() || smtpUsername || fromAddress
 */
export function resolveEmailServiceIdentity(
  input: EmailServiceIdentityInput
): ResolvedEmailServiceIdentity {
  const fromAddress = input.from.trim();
  const smtpUsername = input.smtpUsername?.trim() || fromAddress;
  const replyToAddress = input.replyTo?.trim() || null;
  const receiveUsername =
    input.receiveUsername?.trim() || smtpUsername || fromAddress;
  return { smtpUsername, fromAddress, replyToAddress, receiveUsername };
}

/**
 * Reject CR/LF in identity fields before persistence, hashing, and sending
 * (§7.2 header-injection defense).
 */
export function containsEmailHeaderBreak(value: string): boolean {
  return value.includes("\r") || value.includes("\n");
}
```

- [ ] **Step 1.4: Run the tests to verify they pass**

Run: `yarn vitest-puppeteer test/vitest/utilitycode/EmailServiceIdentityResolver.test.ts`
Expected: PASS — all 8 tests.

- [ ] **Step 1.5: Commit**

```bash
git add src/modules/lib/EmailServiceIdentityResolver.ts test/vitest/utilitycode/EmailServiceIdentityResolver.test.ts
git commit -m "feat: add EmailServiceIdentityResolver + header-break predicate"
```

---

### Task 2: Entity columns + shared types (Phase 1, part B)

**Files:**
- Modify: `src/entity/EmailService.entity.ts`
- Modify: `src/entityTypes/emailmarketingType.ts`

- [ ] **Step 2.1: Add nullable identity columns to the entity**

In `src/entity/EmailService.entity.ts`, insert after the `from` column (lines 13–14) and before `password` (line 16):

```typescript
  /**
   * SMTP login username (authentication identity). Nullable for legacy
   * compatibility (AD-002): a NULL value resolves at runtime to `from`.
   * NOT email-validated — providers may accept non-email login identifiers.
   */
  @Column({ type: "varchar", length: 255, nullable: true })
  smtpUsername: string | null;

  /**
   * Optional Reply-To address (where responses go). Nullable: NULL means
   * no Reply-To header is emitted. Resolved at runtime, never eagerly
   * backfilled during startup.
   */
  @Column({ type: "varchar", length: 320, nullable: true })
  replyTo: string | null;
```

- [ ] **Step 2.2: Extend `EmailServiceEntitydata` + export types**

In `src/entityTypes/emailmarketingType.ts`, update the `EmailServiceEntitydata` type (lines 157–179) — insert after `id?: number;` and before `from: string;`:

```typescript
export type EmailServiceEntitydata = {
  id?: number;
  smtpUsername?: string | null;
  from: string;
  replyTo?: string | null;
  password: string;
  host: string;
  port: string;
  name: string;
  ssl: number;
  // ---- inbound receive settings (optional; required only when receiveEnabled === 1) ----
  receiveProtocol?: EmailReceiveProtocol;
  imapHost?: string | null;
  imapPort?: string | null;
  imapSsl?: number;
  pop3Host?: string | null;
  pop3Port?: string | null;
  pop3Ssl?: number;
  receiveUsername?: string | null;
  receivePassword?: string | null;
  receiveFolder?: string;
  receiveEnabled?: number;
  lastReceiveSyncAt?: string | null;
  lastReceiveSyncError?: string | null;
};
```

Then replace the `EmailServiceExportPayload` type (lines 190–194) with the shared safe projection:

```typescript
/**
 * Safe (secret-free) single projection of one email service for both CSV and
 * JSON export (§11.1). Uses the EFFECTIVE smtpUsername so legacy rows export a
 * usable login identifier. Never contains SMTP or receive passwords.
 */
export type SafeEmailServiceExportRow = {
  id: number;
  name: string;
  smtpUsername: string;
  from: string;
  replyTo: string | null;
  host: string;
  port: string;
  ssl: number;
  receiveProtocol: EmailReceiveProtocol;
  create_time: string;
};

/** JSON export envelope for the email service list (safe fields only). */
export type EmailServiceExportPayload = {
  total: number;
  services: SafeEmailServiceExportRow[];
  exportDate: string;
};
```

- [ ] **Step 2.3: Run typecheck to verify the type changes compile**

Run: `yarn typecheck`
Expected: PASS (no new errors). Existing callers that spread `EmailServiceEntitydata` still compile because the new fields are optional.

- [ ] **Step 2.4: Commit**

```bash
git add src/entity/EmailService.entity.ts src/entityTypes/emailmarketingType.ts
git commit -m "feat: add nullable smtpUsername/replyTo columns and safe export row type"
```

---

### Task 3: §6.5 legacy-schema synchronization integration test

**Files:**
- Test: `test/vitest/main/EmailServiceLegacySchemaSync.test.ts`

This proves AD-002: a pre-feature database gains nullable columns without data loss, and legacy values + FK relationships remain intact.

- [ ] **Step 3.1: Write the failing sync test**

Create `test/vitest/main/EmailServiceLegacySchemaSync.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";

const tmpDir = path.join(os.tmpdir(), "aifetchly-legacy-schema-sync");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("Legacy schema synchronization (§6.5)", () => {
  it("adds nullable identity columns to a pre-feature database without losing data", async () => {
    const dbPath = path.join(tmpDir, "scraper.db");

    // 1. Create a pre-feature database with the OLD email_service shape
    //    (no smtpUsername / replyTo columns).
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE email_service (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(255) NOT NULL,
        "from" VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        host VARCHAR(255) NOT NULL,
        port VARCHAR(10) NOT NULL,
        ssl INTEGER DEFAULT 1,
        status INTEGER DEFAULT 1,
        receiveProtocol VARCHAR(10) DEFAULT 'imap',
        receiveFolder VARCHAR(255) DEFAULT 'INBOX',
        receiveEnabled INTEGER DEFAULT 0
      );
    `);
    const insert = legacy.prepare(
      `INSERT INTO email_service (name, "from", password, host, port, ssl, status, receiveProtocol, receiveEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      "Legacy SMTP",
      "legacy@example.com",
      "enc:legacy-password",
      "smtp.legacy.com",
      "465",
      1,
      1,
      "imap",
      0
    );
    const legacyId = Number(
      (
        legacy.prepare(`SELECT last_insert_rowid() AS id`).get() as {
          id: number;
        }
      ).id
    );
    legacy.close();

    // 2. Initialize the CURRENT SqliteDb data source (synchronize: true adds
    //    the nullable smtpUsername + replyTo columns).
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    // 3. Assert the new columns exist with NULL defaults.
    const reopened = new Database(dbPath, { readonly: true });
    const cols = reopened
      .prepare(`PRAGMA table_info(email_service)`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("smtpUsername");
    expect(colNames).toContain("replyTo");

    const row = reopened
      .prepare(
        `SELECT name, "from", password, host, port, ssl, status, smtpUsername, replyTo FROM email_service WHERE id = ?`
      )
      .get(legacyId) as {
      name: string;
      from: string;
      password: string;
      host: string;
      port: string;
      ssl: number;
      status: number;
      smtpUsername: string | null;
      replyTo: string | null;
    };

    // 4. Assert old values and identity are intact.
    expect(row.name).toBe("Legacy SMTP");
    expect(row.from).toBe("legacy@example.com");
    expect(row.password).toBe("enc:legacy-password");
    expect(row.host).toBe("smtp.legacy.com");
    expect(row.port).toBe("465");
    expect(row.ssl).toBe(1);
    expect(row.status).toBe(1);
    // 5. New columns are NULL for legacy rows (AD-002 — not eagerly backfilled).
    expect(row.smtpUsername).toBeNull();
    expect(row.replyTo).toBeNull();
    reopened.close();
  });
});
```

- [ ] **Step 3.2: Run the test to verify it passes**

Run: `yarn testmain test/vitest/main/EmailServiceLegacySchemaSync.test.ts`
Expected: PASS. (The test also fails closed if `synchronize` ever drops data — the inserted legacy row must still be present.)

- [ ] **Step 3.3: Commit**

```bash
git add test/vitest/main/EmailServiceLegacySchemaSync.test.ts
git commit -m "test: verify legacy schema synchronization adds identity columns without data loss"
```

---

### Task 4: Options-aware validation + module/interface contracts (Phase 1, part C)

**Files:**
- Modify: `src/modules/interface/EmailServiceModuleInterface.ts`
- Modify: `src/modules/emailServiceModule.ts`
- Test: `test/modules/emailServiceModule.validation.test.ts`

- [ ] **Step 4.1: Write the failing validation tests**

Create `test/modules/emailServiceModule.validation.test.ts` (Mocha + expect.js, mirroring `emailServiceModule.cipher.test.ts`):

```typescript
"use strict";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import expect from "expect.js";

function makeService(
  overrides: Partial<EmailServiceEntity> = {}
): EmailServiceEntity {
  const service = new EmailServiceEntity();
  service.id = 1;
  service.name = "Primary SMTP";
  service.from = "sales@example.com";
  service.smtpUsername = null;
  service.replyTo = null;
  service.password = "smtp-password";
  service.host = "smtp.example.com";
  service.port = "465";
  service.ssl = 1;
  service.status = 1;
  service.receiveProtocol = "imap";
  service.imapHost = null;
  service.imapPort = null;
  service.imapSsl = 1;
  service.pop3Host = null;
  service.pop3Port = null;
  service.pop3Ssl = 1;
  service.receiveUsername = null;
  service.receivePassword = null;
  service.receiveFolder = "INBOX";
  service.receiveEnabled = 0;
  service.lastReceiveSyncAt = null;
  service.lastReceiveSyncError = null;
  Object.assign(service, overrides);
  return service;
}

describe("EmailServiceModule.validateEmailService (options-aware)", function () {
  it("create mode requires an effective SMTP username and password", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ password: "" }),
      { mode: "create" }
    );
    expect(result.valid).to.be(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).to.contain("password_required");
  });

  it("update mode accepts the password sentinel when a stored password exists", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ password: "" }),
      { mode: "update", hasStoredPassword: true }
    );
    expect(result.valid).to.be(true);
  });

  it("send mode requires a real decrypted password", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ password: "" }),
      { mode: "send" }
    );
    expect(result.valid).to.be(false);
    expect(result.errors.map((e) => e.code)).to.contain("password_required");
  });

  it("blank smtpUsername resolves to From and does not error", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ smtpUsername: "   ", password: "pw" }),
      { mode: "create" }
    );
    expect(result.valid).to.be(true);
  });

  it("CR/LF in smtpUsername is rejected with email_header_break_forbidden", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ smtpUsername: "user\n@x.com", password: "pw" }),
      { mode: "create" }
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).to.contain("email_header_break_forbidden");
  });

  it("invalid From is rejected with from_invalid", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ from: "not-an-email", password: "pw" }),
      { mode: "create" }
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).to.contain("from_invalid");
  });

  it("invalid Reply-To is rejected with reply_to_invalid", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ replyTo: "not-an-email", password: "pw" }),
      { mode: "create" }
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).to.contain("reply_to_invalid");
  });

  it("port out of range is rejected with port_invalid", async function () {
    const module = new EmailServiceModule();
    const result = await module.validateEmailService(
      makeService({ port: "99999", password: "pw" }),
      { mode: "create" }
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).to.contain("port_invalid");
  });
});
```

- [ ] **Step 4.2: Run the tests to verify they fail**

Run: `yarn test test/modules/emailServiceModule.validation.test.ts`
Expected: FAIL — `validateEmailService` currently takes one arg; calling with two throws, and `result.errors` is `string[]` not `{code}[]`.

- [ ] **Step 4.3: Update the interface contract**

In `src/modules/interface/EmailServiceModuleInterface.ts`, replace the `validateEmailService` declaration (lines 84–86):

```typescript
  /**
   * Validate an email service configuration with operation context (§8.1).
   * @param service The entity to validate
   * @param options Operation mode + stored-password availability
   * @returns Validation result with stable field/error codes
   */
  validateEmailService(
    service: EmailServiceEntity,
    options: ValidateEmailServiceOptions
  ): Promise<{ valid: boolean; errors: EmailServiceValidationError[] }>;

  /**
   * Read the complete effective identity snapshot for a service (§22.2).
   * Returns null when the service does not exist.
   */
  readIdentity(
    id: number
  ): Promise<{
    smtpUsername: string;
    fromAddress: string;
    replyToAddress: string | null;
    receiveUsername: string;
  } | null>;
```

Add the supporting types at the top of the file (after the existing imports):

```typescript
export interface ValidateEmailServiceOptions {
  readonly mode: "create" | "update" | "send";
  readonly hasStoredPassword?: boolean;
}

export interface EmailServiceValidationError {
  readonly code: EmailServiceValidationCode;
  readonly message: string;
}

export type EmailServiceValidationCode =
  | "service_name_required"
  | "smtp_username_required"
  | "smtp_username_too_long"
  | "from_required"
  | "from_invalid"
  | "reply_to_invalid"
  | "email_header_break_forbidden"
  | "password_required"
  | "host_required"
  | "port_required"
  | "port_invalid"
  | "receive_config_invalid";
```

- [ ] **Step 4.4: Rewrite `validateEmailService` + add `readIdentity` in the module**

In `src/modules/emailServiceModule.ts`, add imports at the top:

```typescript
import {
  resolveEmailServiceIdentity,
  containsEmailHeaderBreak,
} from "@/modules/lib/EmailServiceIdentityResolver";
import type {
  ValidateEmailServiceOptions,
  EmailServiceValidationError,
  EmailServiceValidationCode,
} from "@/modules/interface/EmailServiceModuleInterface";
```

Replace the existing `validateEmailService` method (lines 262–327) with:

```typescript
  async validateEmailService(
    service: EmailServiceEntity,
    options: ValidateEmailServiceOptions
  ): Promise<{ valid: boolean; errors: EmailServiceValidationError[] }> {
    const errors: EmailServiceValidationError[] = [];
    const push = (
      code: EmailServiceValidationCode,
      message: string
    ): void => {
      errors.push({ code, message });
    };

    if (!service.name || service.name.trim().length === 0) {
      push("service_name_required", "Service name is required");
    }

    // Effective SMTP username is resolved (blank → From) but still bounded.
    const identity = resolveEmailServiceIdentity({
      smtpUsername: service.smtpUsername,
      from: service.from,
      replyTo: service.replyTo,
      receiveUsername: service.receiveUsername,
    });

    if (!identity.smtpUsername || identity.smtpUsername.length === 0) {
      push("smtp_username_required", "SMTP username is required");
    } else if (identity.smtpUsername.length > 255) {
      push("smtp_username_too_long", "SMTP username must be 255 characters or fewer");
    }
    if (containsEmailHeaderBreak(identity.smtpUsername)) {
      push("email_header_break_forbidden", "SMTP username must not contain line breaks");
    }

    if (!service.from || service.from.trim().length === 0) {
      push("from_required", "From email is required");
    } else if (containsEmailHeaderBreak(service.from)) {
      push("email_header_break_forbidden", "From must not contain line breaks");
    } else if (!this.isValidEmail(service.from) || service.from.length > 255) {
      push("from_invalid", "From email format is invalid");
    }

    if (service.replyTo !== null && service.replyTo !== undefined) {
      if (containsEmailHeaderBreak(service.replyTo)) {
        push("email_header_break_forbidden", "Reply-To must not contain line breaks");
      } else if (
        service.replyTo.trim().length > 0 &&
        (!this.isValidEmail(service.replyTo) || service.replyTo.length > 320)
      ) {
        push("reply_to_invalid", "Reply-To email format is invalid");
      }
    }

    // Password: create/send require a real value; update permits the sentinel
    // only when a stored password exists (AD-004).
    const hasPassword =
      typeof service.password === "string" && service.password.trim().length > 0;
    if (options.mode === "create" || options.mode === "send") {
      if (!hasPassword) {
        push("password_required", "Password is required");
      }
    } else {
      // update
      if (!hasPassword && !options.hasStoredPassword) {
        push("password_required", "Password is required");
      }
    }

    if (!service.host || service.host.trim().length === 0) {
      push("host_required", "Host is required");
    }

    if (!service.port || service.port.trim().length === 0) {
      push("port_required", "Port is required");
    } else {
      const portNum = Number(service.port);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        push("port_invalid", "Port must be a valid number between 1 and 65535");
      }
    }

    // Receive settings only validated when receive is enabled (§8.3).
    if (service.receiveEnabled === 1) {
      const protocol: EmailReceiveProtocol =
        service.receiveProtocol === "pop3" ? "pop3" : "imap";
      const host = protocol === "imap" ? service.imapHost : service.pop3Host;
      const portStr =
        protocol === "imap" ? service.imapPort : service.pop3Port;
      const receiveErrors: string[] = [];
      if (!host || host.trim().length === 0) {
        receiveErrors.push(
          `Receive ${protocol.toUpperCase()} host is required when receive is enabled`
        );
      }
      if (!portStr || portStr.trim().length === 0 || isNaN(Number(portStr))) {
        receiveErrors.push(
          `Receive ${protocol.toUpperCase()} port must be a valid number when receive is enabled`
        );
      }
      // 3-level receive fallback: explicit → SMTP username → From (§8.3).
      const rxUser = identity.receiveUsername;
      if (!rxUser || rxUser.trim().length === 0) {
        receiveErrors.push("Receive username is required when receive is enabled");
      }
      const rxPass =
        service.receivePassword && service.receivePassword.length > 0
          ? service.receivePassword
          : service.password;
      if (!rxPass || rxPass.length === 0) {
        receiveErrors.push("Receive password is required when receive is enabled");
      }
      if (receiveErrors.length > 0) {
        push("receive_config_invalid", receiveErrors.join("; "));
      }
    }

    return { valid: errors.length === 0, errors };
  }
```

Add the `readIdentity` method to the module (after `getEmailServiceReceiveConfig`):

```typescript
  /**
   * Read the complete effective identity snapshot for a service (§22.2).
   * Main-process only — never returned to the renderer or surfaced in an AI
   * tool result. Returns null when the service does not exist.
   */
  async readIdentity(
    id: number
  ): Promise<{
    smtpUsername: string;
    fromAddress: string;
    replyToAddress: string | null;
    receiveUsername: string;
  } | null> {
    await this.ensureConnection();
    const service = await this.getEmailService(id);
    if (!service) return null;
    const identity = resolveEmailServiceIdentity({
      smtpUsername: service.smtpUsername,
      from: service.from,
      replyTo: service.replyTo,
      receiveUsername: service.receiveUsername,
    });
    return identity;
  }
```

- [ ] **Step 4.5: Run the validation tests to verify they pass**

Run: `yarn test test/modules/emailServiceModule.validation.test.ts`
Expected: PASS — all 8 tests.

- [ ] **Step 4.6: Run typecheck**

Run: `yarn typecheck`
Expected: PASS. (If any caller of the old single-arg `validateEmailService` surfaces, fix it — the controller's import path is updated in Task 6; the controller test stubs are updated in Task 8.)

- [ ] **Step 4.7: Commit**

```bash
git add src/modules/interface/EmailServiceModuleInterface.ts src/modules/emailServiceModule.ts test/modules/emailServiceModule.validation.test.ts
git commit -m "feat: options-aware validateEmailService with stable codes + readIdentity"
```

---

### Task 5: Controller create/update mapping + receive fallback (Phase 1, part D)

**Files:**
- Modify: `src/controller/emailMarketingController.ts`
- Modify: `src/model/EmailService.model.ts`

- [ ] **Step 5.1: Add `readIdentity` to the model**

In `src/model/EmailService.model.ts`, after `readSenderAddress` (line 49), add:

```typescript
  /**
   * Read the complete effective identity for a service (§22.2). Returns null
   * when the service does not exist. Does not decrypt passwords.
   */
  async readIdentity(
    id: number
  ): Promise<{
    smtpUsername: string | null;
    from: string;
    replyTo: string | null;
    receiveUsername: string | null;
  } | null> {
    const entity = await this.read(id);
    if (!entity) return null;
    return {
      smtpUsername: entity.smtpUsername ?? null,
      from: entity.from,
      replyTo: entity.replyTo ?? null,
      receiveUsername: entity.receiveUsername ?? null,
    };
  }
```

- [ ] **Step 5.2: Map new fields in `createEmailService`**

In `src/controller/emailMarketingController.ts`, inside `createEmailService` (lines 224–286), add after `entity.from = param.from;` (line 231):

```typescript
    entity.smtpUsername = param.smtpUsername ?? null;
    entity.replyTo = param.replyTo ?? null;
```

- [ ] **Step 5.3: Update receive fallback to use the resolver**

In `src/modules/emailServiceModule.ts`, `getEmailServiceReceiveConfig` (lines 219–260), replace the username resolution block (lines 234–238) with the 3-level fallback through the resolver:

```typescript
      // Username: explicit receiveUsername → SMTP username → From (§8.3).
      const identity = resolveEmailServiceIdentity({
        smtpUsername: service.smtpUsername,
        from: service.from,
        receiveUsername: service.receiveUsername,
      });
      const username = identity.receiveUsername;
```

(The rest of the method — password fallback, null-return, return shape — stays unchanged.)

- [ ] **Step 5.4: Run typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/model/EmailService.model.ts src/controller/emailMarketingController.ts src/modules/emailServiceModule.ts
git commit -m "feat: map smtpUsername/replyTo on create + 3-level receive fallback"
```

---

### Task 6: IPC schema + EMAILSERVICEUPDATE handler merge (Phase 1, part E)

**Files:**
- Modify: `src/schemas/ipc/emailMarketing.ts`
- Modify: `src/main-process/communication/emailMarketingIpc.ts`

- [ ] **Step 6.1: Add the dedicated email-service update schema**

In `src/schemas/ipc/emailMarketing.ts`, append after the shared `emailMarketingUpdateInputSchema` (line 47):

```typescript
/**
 * EMAILSERVICEUPDATE — dedicated schema bounding the security-relevant
 * identity fields (§12.4). The shared passthrough schema above stays for
 * TEMPUPDATE/FILTERUPDATE; the email-service update must NOT rely on
 * `.passthrough()` for smtpUsername/from/replyTo.
 */
export const emailServiceUpdateInputSchema = lazySchema(() =>
  z.object({
    id: z.union([z.number(), z.string().min(1)]).optional(),
    name: z.string().max(255).optional(),
    smtpUsername: z.string().max(255).nullable().optional(),
    from: z.string().min(1).max(255),
    replyTo: z.string().max(320).nullable().optional(),
    password: z.string().optional(),
    host: z.string().max(255).optional(),
    port: z.string().max(10).optional(),
    ssl: z.number().optional(),
    receiveProtocol: z.string().max(10).optional(),
    imapHost: z.string().max(255).nullable().optional(),
    imapPort: z.string().max(10).nullable().optional(),
    imapSsl: z.number().optional(),
    pop3Host: z.string().max(255).nullable().optional(),
    pop3Port: z.string().max(10).nullable().optional(),
    pop3Ssl: z.number().optional(),
    receiveUsername: z.string().max(255).nullable().optional(),
    receivePassword: z.string().nullable().optional(),
    receiveFolder: z.string().max(255).optional(),
    receiveEnabled: z.number().optional(),
  })
);
```

- [ ] **Step 6.2: Switch the handler to the dedicated schema + merge new fields**

In `src/main-process/communication/emailMarketingIpc.ts`, the EMAILSERVICEUPDATE handler (lines ~272–338). Replace the `registerValidatedHandler(EMAILSERVICEUPDATE, emailMarketingUpdateInputSchema, ...)` schema reference with `emailServiceUpdateInputSchema`, and in the update-path entity build, add `smtpUsername`/`replyTo` merges with blank→null semantics. After the existing `qdata.from ?? existing.from` merge, add:

```typescript
        smtpUsername:
          qdata.smtpUsername !== undefined
            ? qdata.smtpUsername === null || qdata.smtpUsername.trim().length === 0
              ? null
              : qdata.smtpUsername.trim()
            : existing.smtpUsername ?? null,
        replyTo:
          qdata.replyTo !== undefined
            ? qdata.replyTo === null || qdata.replyTo.trim().length === 0
              ? null
              : qdata.replyTo.trim()
            : existing.replyTo ?? null,
```

(Read the file freshly before this edit to get exact surrounding context; the merge block uses `qdata.X ?? existing.X` patterns — insert the two new fields adjacent to the `from` merge. Update the import at the top of the file to import `emailServiceUpdateInputSchema` alongside the existing `emailMarketingUpdateInputSchema`.)

- [ ] **Step 6.3: Run typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 6.4: Commit Phase 1 as one compatibility unit**

```bash
git add src/schemas/ipc/emailMarketing.ts src/main-process/communication/emailMarketingIpc.ts
git commit -m "feat: bound email-service update IPC schema + merge smtpUsername/replyTo"
```

**Phase 1 exit check:** legacy services resolve exactly as before (nullable columns → From fallback); new identities can be stored and loaded without sending changes. Run `yarn vitest-puppeteer test/vitest/utilitycode/EmailServiceIdentityResolver.test.ts` + `yarn test test/modules/emailServiceModule.validation.test.ts` + `yarn testmain test/vitest/main/EmailServiceLegacySchemaSync.test.ts` — all PASS.

---

### Task 7: Safe export projection + format parity (Phase 2, part A)

**Files:**
- Modify: `src/controller/emailMarketingController.ts`
- Test: `test/modules/emailMarketingController.test.ts`

- [ ] **Step 7.1: Replace the export projection with the shared safe row**

> **PARTIALLY DONE in Task 2 (commit `8063701b`):** the JSON branch of `exportEmailServices` already builds `SafeEmailServiceExportRow[]` via `resolveEmailServiceIdentity` (pulled forward to keep the tree typecheck-clean after `EmailServiceExportPayload.services` changed type). The imports (`SafeEmailServiceExportRow`, `resolveEmailServiceIdentity`) are already in place. **Remaining work for this step: only the CSV branch** — hoist the row-building loop out of the JSON-only branch so both formats share one `rows` array (it currently sits inside `if (format === "json")`), then replace the CSV headers/rows with the shared projection below. The complete target method body:

```typescript
  // Export email services (safe fields only). format: "csv" | "json"
  public async exportEmailServices(
    format: "csv" | "json" = "csv"
  ): Promise<string | EmailServiceExportPayload> {
    const entities = await this.emailServiceModule.exportEmailServicesList();

    const rows: SafeEmailServiceExportRow[] = entities.map((item) => {
      const identity = resolveEmailServiceIdentity({
        smtpUsername: item.smtpUsername,
        from: item.from,
        replyTo: item.replyTo,
      });
      return {
        id: item.id,
        name: item.name,
        smtpUsername: identity.smtpUsername,
        from: item.from,
        replyTo: identity.replyToAddress,
        host: item.host,
        port: item.port,
        ssl: item.ssl,
        receiveProtocol: item.receiveProtocol,
        create_time: item.createdAt?.toISOString() || "",
      };
    });

    if (format === "json") {
      return {
        total: rows.length,
        services: rows,
        exportDate: new Date().toISOString(),
      };
    }

    const headers = [
      "id",
      "name",
      "smtpUsername",
      "from",
      "replyTo",
      "host",
      "port",
      "ssl",
      "receiveProtocol",
      "create_time",
    ];
    const csvRows = rows.map((row) => [
      row.id.toString(),
      this.escapeCsvField(row.name),
      this.escapeCsvField(row.smtpUsername),
      this.escapeCsvField(row.from),
      row.replyTo === null ? "" : this.escapeCsvField(row.replyTo),
      this.escapeCsvField(row.host),
      row.port,
      row.ssl.toString(),
      row.receiveProtocol,
      row.create_time,
    ]);
    const csv = [headers.join(","), ...csvRows.map((r) => r.join(","))].join(
      "\n"
    );
    return csv.length > 0 ? `${csv}\n` : `${headers.join(",")}\n`;
  }
```

<details>
<summary>Original full-method spec (both branches) — kept for reference</summary>

```typescript
  // Export email services (safe fields only). format: "csv" | "json"
  public async exportEmailServices(
    format: "csv" | "json" = "csv"
  ): Promise<string | EmailServiceExportPayload> {
    const entities = await this.emailServiceModule.exportEmailServicesList();

    const rows: SafeEmailServiceExportRow[] = entities.map((item) => {
      const identity = resolveEmailServiceIdentity({
        smtpUsername: item.smtpUsername,
        from: item.from,
        replyTo: item.replyTo,
      });
      return {
        id: item.id,
        name: item.name,
        smtpUsername: identity.smtpUsername,
        from: item.from,
        replyTo: identity.replyToAddress,
        host: item.host,
        port: item.port,
        ssl: item.ssl,
        receiveProtocol: item.receiveProtocol,
        create_time: item.createdAt?.toISOString() || "",
      };
    });

    if (format === "json") {
      return {
        total: rows.length,
        services: rows,
        exportDate: new Date().toISOString(),
      };
    }

    const headers = [
      "id",
      "name",
      "smtpUsername",
      "from",
      "replyTo",
      "host",
      "port",
      "ssl",
      "receiveProtocol",
      "create_time",
    ];
    const csvRows = rows.map((row) => [
      row.id.toString(),
      this.escapeCsvField(row.name),
      this.escapeCsvField(row.smtpUsername),
      this.escapeCsvField(row.from),
      row.replyTo === null ? "" : this.escapeCsvField(row.replyTo),
      this.escapeCsvField(row.host),
      row.port,
      row.ssl.toString(),
      row.receiveProtocol,
      row.create_time,
    ]);
    const csv = [headers.join(","), ...csvRows.map((r) => r.join(","))].join(
      "\n"
    );
    return csv.length > 0 ? `${csv}\n` : `${headers.join(",")}\n`;
  }
```

</details>

- [ ] **Step 7.2: Update the existing export test assertions**

In `test/modules/emailMarketingController.test.ts`, find the export-shape tests (the block asserting the OLD CSV header and the OLD JSON row shape). Update:

- CSV header assertions from `["id","name","from","host","port","ssl","receiveProtocol","create_time"]` → `["id","name","smtpUsername","from","replyTo","host","port","ssl","receiveProtocol","create_time"]`.
- JSON row assertions from `{id, name, from, host, receiveProtocol, create_time}` → `{id, name, smtpUsername, from, replyTo, host, port, ssl, receiveProtocol, create_time}`.
- Add an assertion that a legacy service (no `smtpUsername`/`replyTo`) exports `smtpUsername === from` and `replyTo === null` (CSV empty field, JSON null).
- Add an assertion that no `password` or `receivePassword` key appears in either format.

(Read each export test in the file freshly before editing; update assertions in place — do not delete the tests.)

- [ ] **Step 7.3: Run the controller tests to verify the export parity**

Run: `yarn test test/modules/emailMarketingController.test.ts`
Expected: PASS — including the updated header/shape assertions and the new no-password assertion.

- [ ] **Step 7.4: Commit**

```bash
git add src/controller/emailMarketingController.ts test/modules/emailMarketingController.test.ts
git commit -m "feat: shared SafeEmailServiceExportRow projection + CSV/JSON parity"
```

---

### Task 8: Presence-aware import (lookup-before-validate + merge matrix)

**Files:**
- Modify: `src/controller/emailMarketingController.ts`
- Test: `test/modules/emailMarketingController.test.ts`

- [ ] **Step 8.1: Add the presence-aware parser + header-alias resolution**

In `src/controller/emailMarketingController.ts`, replace `mapImportRowToEntity` (lines 538–563) with a presence-aware mapper that returns `{ values: Partial<EmailServiceEntitydata>, presentFields: ReadonlySet<EmailServiceImportField> }` and resolves header aliases + `duplicate_field_conflict`. Add the types near the top of the controller (after imports):

```typescript
type EmailServiceImportField =
  | "name"
  | "smtpUsername"
  | "from"
  | "replyTo"
  | "host"
  | "port"
  | "password"
  | "ssl"
  | "receiveProtocol";

interface ParsedEmailServiceImportRow {
  readonly values: Partial<EmailServiceEntitydata>;
  readonly presentFields: ReadonlySet<EmailServiceImportField>;
}

/** Source keys accepted for each normalized field (§10.2). */
const IMPORT_FIELD_ALIASES: Record<EmailServiceImportField, string[]> = {
  name: ["name"],
  smtpUsername: ["smtpUsername", "smtpusername", "smtp_username"],
  from: ["from", "from_email"],
  replyTo: ["replyTo", "replyto", "reply_to"],
  host: ["host"],
  port: ["port"],
  password: ["password"],
  ssl: ["ssl"],
  receiveProtocol: ["receiveProtocol", "receiveprotocol", "receive_protocol"],
};
```

Replace the mapper:

```typescript
  /**
   * Map a parsed row to a presence-aware import row (§10.1/§10.2). Tracks
   * which fields were PRESENT so the merge step can distinguish absent
   * (preserve) from blank (clear/reset). Rejects rows where two aliases for
   * one field carry different non-empty values (duplicate_field_conflict).
   */
  private mapImportRowToPresenceAware(
    row: Record<string, unknown>
  ): { row: ParsedEmailServiceImportRow | null; error: string | null } {
    const values: Partial<EmailServiceEntitydata> = {};
    const presentFields = new Set<EmailServiceImportField>();

    for (const field of Object.keys(
      IMPORT_FIELD_ALIASES
    ) as EmailServiceImportField[]) {
      const aliases = IMPORT_FIELD_ALIASES[field];
      const found: { alias: string; raw: unknown }[] = [];
      for (const alias of aliases) {
        // CSV headers are lowercased by transformHeader; JSON keys keep their
        // case — check both the alias and its lowercase form.
        if (Object.prototype.hasOwnProperty.call(row, alias)) {
          found.push({ alias, raw: row[alias] });
        } else if (
          alias !== alias.toLowerCase() &&
          Object.prototype.hasOwnProperty.call(row, alias.toLowerCase())
        ) {
          found.push({ alias, raw: row[alias.toLowerCase()] });
        }
      }
      if (found.length === 0) continue;

      // duplicate_field_conflict: two aliases, different non-empty values.
      const nonEmpty = found.filter(
        (f) => f.raw !== null && f.raw !== undefined && String(f.raw).trim().length > 0
      );
      const distinctValues = new Set(
        nonEmpty.map((f) => String(f.raw).trim())
      );
      if (distinctValues.size > 1) {
        return {
          row: null,
          error: "duplicate_field_conflict",
        };
      }

      const raw = found[0].raw;
      const str = this.rowValueToString(raw);
      presentFields.add(field);
      switch (field) {
        case "ssl":
          (values as Record<string, unknown>).ssl =
            this.parseImportSsl(str);
          break;
        case "receiveProtocol": {
          const lower = str.toLowerCase();
          if (lower.length > 0) {
            (values as Record<string, unknown>).receiveProtocol =
              lower as EmailServiceEntitydata["receiveProtocol"];
          }
          break;
        }
        case "smtpUsername":
          values.smtpUsername = str.length > 0 ? str : null;
          break;
        case "replyTo":
          values.replyTo = str.length > 0 ? str : null;
          break;
        default:
          (values as Record<string, unknown>)[field] = str;
      }
    }

    return { row: { values, presentFields }, error: null };
  }
```

- [ ] **Step 8.2: Rewrite the import loop — lookup-before-validate + merge matrix**

Replace the import loop body (lines 376–457) to: parse each row → lookup existing by name BEFORE validation → merge per §10.4 → validate with `{mode, hasStoredPassword}` → upsert. The new loop:

```typescript
    for (let index = 0; index < rows.length; index++) {
      const rowNumber = index + (format === "csv" ? 2 : 1);
      const rawRow = rows[index];
      if (!rawRow || typeof rawRow !== "object") {
        skipped++;
        errors.push(`row ${rowNumber}: invalid row entry`);
        continue;
      }
      const parseError = rowErrors.get(index);
      if (parseError) {
        skipped++;
        errors.push(`row ${rowNumber}: ${parseError}`);
        continue;
      }

      const mapped = this.mapImportRowToPresenceAware(rawRow);
      if (mapped.error) {
        skipped++;
        errors.push(`row ${rowNumber}: ${mapped.error}`);
        continue;
      }
      const parsedRow = mapped.row!;
      const values = parsedRow.values;
      const present = parsedRow.presentFields;

      // ssl unparseable → row error (NaN would bind as NULL in better-sqlite3).
      if (Number.isNaN(values.ssl as number)) {
        skipped++;
        errors.push(`row ${rowNumber}: ssl must be 0 or 1`);
        continue;
      }

      const name = values.name ?? "";
      // §10.3 — lookup BEFORE validate (password requirements depend on
      // create vs update).
      const existing = name
        ? await this.emailServiceModule.findEmailServiceByName(name)
        : undefined;
      const isUpdate = Boolean(existing?.id && existing.id > 0);

      const candidate = new EmailServiceEntity();
      if (isUpdate) {
        const ex = existing!;
        candidate.name = (values.name ?? ex.name) as string;
        candidate.host = (values.host ?? ex.host) as string;
        candidate.port = (values.port ?? ex.port) as string;
        candidate.from = (values.from ?? ex.from) as string;
        candidate.ssl = (values.ssl ?? ex.ssl) as number;
        candidate.password = ex.password; // preserve unless a real value present
        candidate.receiveProtocol =
          present.has("receiveProtocol") && values.receiveProtocol
            ? values.receiveProtocol
            : ex.receiveProtocol ?? "imap";
        candidate.imapHost = values.imapHost ?? ex.imapHost ?? null;
        candidate.imapPort = values.imapPort ?? ex.imapPort ?? null;
        candidate.imapSsl = values.imapSsl ?? ex.imapSsl ?? 1;
        candidate.pop3Host = values.pop3Host ?? ex.pop3Host ?? null;
        candidate.pop3Port = values.pop3Port ?? ex.pop3Port ?? null;
        candidate.pop3Ssl = values.pop3Ssl ?? ex.pop3Ssl ?? 1;
        candidate.receiveFolder = values.receiveFolder ?? ex.receiveFolder ?? "INBOX";
        candidate.receiveEnabled = values.receiveEnabled ?? ex.receiveEnabled ?? 0;
        // §10.4 merge matrix:
        //  SMTP username: absent=Preserve stored, blank=Reset to From fallback (null).
        candidate.smtpUsername = present.has("smtpUsername")
          ? (values.smtpUsername ?? null)
          : ex.smtpUsername ?? null;
        //  Reply-To: absent=Preserve stored, blank=Clear to null.
        candidate.replyTo = present.has("replyTo")
          ? (values.replyTo ?? null)
          : ex.replyTo ?? null;
        //  Password: blank/absent NEVER clears — always preserve (§10.4).
        candidate.receivePassword = ex.receivePassword;
        candidate.status = ex.status;
      } else {
        // New service: absent SMTP username → From; absent Reply-To → null;
        // password absent/blank → reject (handled by validation).
        candidate.name = (values.name ?? "") as string;
        candidate.host = (values.host ?? "") as string;
        candidate.port = (values.port ?? "") as string;
        candidate.from = (values.from ?? "") as string;
        candidate.ssl = (values.ssl ?? 1) as number;
        candidate.password = (values.password ?? "") as string;
        candidate.receiveProtocol = values.receiveProtocol ?? "imap";
        candidate.imapHost = values.imapHost ?? null;
        candidate.imapPort = values.imapPort ?? null;
        candidate.imapSsl = values.imapSsl ?? 1;
        candidate.pop3Host = values.pop3Host ?? null;
        candidate.pop3Port = values.pop3Port ?? null;
        candidate.pop3Ssl = values.pop3Ssl ?? 1;
        candidate.receiveFolder = values.receiveFolder ?? "INBOX";
        candidate.receiveEnabled = values.receiveEnabled ?? 0;
        candidate.smtpUsername = values.smtpUsername ?? null;
        candidate.replyTo = values.replyTo ?? null;
        candidate.status = 1;
      }

      const validation = await this.emailServiceModule.validateEmailService(
        candidate,
        {
          mode: isUpdate ? "update" : "create",
          hasStoredPassword: Boolean(existing?.password),
        }
      );
      if (!validation.valid) {
        skipped++;
        errors.push(
          `row ${rowNumber}: ${validation.errors
            .map((e) => e.message)
            .join("; ")}`
        );
        continue;
      }

      try {
        if (isUpdate) {
          await this.emailServiceModule.updateEmailService(
            existing!.id!,
            candidate
          );
        } else {
          await this.emailServiceModule.createEmailService(candidate);
        }
        imported++;
      } catch (rowError) {
        skipped++;
        const reason =
          rowError instanceof Error ? rowError.message : String(rowError);
        errors.push(`row ${rowNumber}: ${reason}`);
      }
    }
    const cappedErrors = errors.slice(0, 10);
    return { imported, skipped, errors: cappedErrors };
```

- [ ] **Step 8.3: Update import test stubs + add new import cases**

In `test/modules/emailMarketingController.test.ts`, update the `makeStubModule` `validateEmailService` override to accept `(entity, options)`:

```typescript
        validateEmailService:
          overrides.validateEmailService ??
          sinon.stub().resolves({ valid: true, errors: [] }),
```

(The stub ignores args by default; if a test needs to assert the mode, capture with `sinon.stub().callsFake((entity, options) => Promise.resolve({valid:true, errors:[]}))`.)

Add new import tests covering §23.3:
- all documented header aliases (`smtpUsername`/`smtpusername`/`smtp_username`; `replyTo`/`replyto`/`reply_to`) map correctly;
- conflicting alias columns reject one row with `duplicate_field_conflict`;
- missing new fields preserve existing identity (update with a legacy file omits smtpUsername/replyTo columns → existing values preserved);
- blank Reply-To clears it to null;
- blank SMTP username resets to From fallback (validation resolves blank→From, so update succeeds and stored `smtpUsername` becomes null which resolves to From);
- blank/missing password preserves an existing password (update path — `candidate.password = ex.password`);
- blank/missing password rejects a new service (create mode → `password_required`).

- [ ] **Step 8.4: Run the controller tests**

Run: `yarn test test/modules/emailMarketingController.test.ts`
Expected: PASS — existing BOM/row-mismatch/TLS-coercion/partial-import/error-cap tests still pass; new alias/presence tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add src/controller/emailMarketingController.ts test/modules/emailMarketingController.test.ts
git commit -m "feat: presence-aware import (lookup-before-validate) + merge matrix + alias dedup"
```

---

### Task 9: UI fields + 6-language translations (Phase 2, part B)

**Files:**
- Modify: `src/views/pages/emailservice/servicedetail.vue`
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts`
- Test: `test/vitest/main/components/EmailServiceDetail.test.ts`

- [ ] **Step 9.1: Add the 4 new i18n keys to all 6 language files**

In each of `src/views/lang/{en,zh,es,fr,de,ja}.ts`, inside the `emailservice` block, immediately after `id: "id",` (the first key) and before `from:` — add (English shown; translate `value` per language):

```typescript
    smtp_username: "SMTP username",
    smtp_username_hint: "SMTP login account (defaults to the From address)",
    reply_to: "Reply-To",
    reply_to_hint: "Optional address for replies (leave blank for none)",
```

Verify the exact insertion line in each file with a Read before editing (the emailservice block anchors drift). Provide accurate translations for zh/es/fr/de/ja (e.g. zh: `smtp_username: "SMTP用户名"`, `smtp_username_hint: "SMTP登录账号（默认使用发件地址）"`, `reply_to: "回复至"`, `reply_to_hint: "可选回复地址（留空表示无）"`).

- [ ] **Step 9.2: Add the two form fields to `servicedetail.vue`**

In `src/views/pages/emailservice/servicedetail.vue`, add the refs near the existing `from` ref:

```typescript
const smtpUsername = ref<string>("");
const replyTo = ref<string>("");
```

In `initialize()` edit-mode load (after `from.value = res.from` or wherever the detail is hydrated), add the legacy fallback (§12.1):

```typescript
    smtpUsername.value = res.smtpUsername?.trim() || res.from;
    replyTo.value = res.replyTo ?? "";
```

In the `<template>`, add two `<v-text-field>` rows BEFORE the From field, in §12.2 order (SMTP Username, From, Reply-To, Password, host, port, TLS):

```vue
              <v-text-field
                v-model="smtpUsername"
                :label="t('emailservice.smtp_username') || 'SMTP username'"
                :hint="t('emailservice.smtp_username_hint') || 'SMTP login account (defaults to the From address)'"
                persistent-hint
              />
              <!-- existing From field here -->
              <v-text-field
                v-model="replyTo"
                :label="t('emailservice.reply_to') || 'Reply-To'"
                :hint="t('emailservice.reply_to_hint') || 'Optional address for replies (leave blank for none)'"
                persistent-hint
              />
```

In `onSubmit()` (the save handler) and `submitTestemail()` (the test-email handler), add the identity fields to the built payload (blank Reply-To → null):

```typescript
        smtpUsername: smtpUsername.value || null,
        replyTo: replyTo.value.trim().length > 0 ? replyTo.value.trim() : null,
```

- [ ] **Step 9.3: Update the test-email receive-connection fallback**

In `servicedetail.vue`, `testReceiveConnection()` currently uses `receiveUsername.value || from.value`. Insert the SMTP-username level:

```typescript
    const resolvedReceiveUser =
      receiveUsername.value || smtpUsername.value || from.value;
```

and pass `resolvedReceiveUser` as the receive username.

- [ ] **Step 9.4: Extend the component tests (§23.7)**

In `test/vitest/main/components/EmailServiceDetail.test.ts`:
- Add `smtp_username`, `smtp_username_hint`, `reply_to`, `reply_to_hint` to the test `emailservice` i18n block.
- Add tests: all three identity fields render; a legacy service (no `smtpUsername`/`replyTo` in the detail response) displays From as the SMTP username prefilled value; edit submit carries `smtpUsername` + `replyTo`; clearing Reply-To submits `null`; Test Email carries identity + service id; existing sentinel/create-mode tests still pass.

(Read the file freshly; extend the existing `describe` block, do not replace the 3 existing tests.)

- [ ] **Step 9.5: Run the component tests**

Run: `yarn test:components`
Expected: PASS — the component gate is a hard CI gate; UI change + tests committed together.

- [ ] **Step 9.6: Commit**

```bash
git add src/views/pages/emailservice/servicedetail.vue src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts test/vitest/main/components/EmailServiceDetail.test.ts
git commit -m "feat: SMTP username + Reply-To form fields with 6-language translations"
```

**Phase 2 exit check:** old files import, password-free exports update existing rows, and alias records can be created/tested from the form. Run `yarn test test/modules/emailMarketingController.test.ts` + `yarn test:components` — both PASS.

---

### Task 10: Transport auth + standard/reply message headers (Phase 3, part A)

**Files:**
- Modify: `src/modules/lib/smtpTransport.ts`
- Modify: `src/modules/lib/emailService.ts`
- Modify: `src/modules/lib/replyEmailService.ts`
- Test: `test/vitest/utilitycode/smtpTransport.test.ts`

- [ ] **Step 10.1: Write the failing transport tests**

Extend `test/vitest/utilitycode/smtpTransport.test.ts` with:

```typescript
import { buildSmtpTransportOptions } from "@/modules/lib/smtpTransport";

describe("buildSmtpTransportOptions identity (§13.1)", () => {
  it("uses smtpUsername for auth.user when configured", () => {
    const opts = buildSmtpTransportOptions({
      from: "sales@example.com",
      smtpUsername: "mailbox@example.com",
      password: "pw",
      host: "smtp.example.com",
      port: "465",
      name: "x",
      ssl: 1,
    });
    expect(opts.auth.user).toBe("mailbox@example.com");
    expect(opts.auth.pass).toBe("pw");
  });

  it("falls back to From when smtpUsername is null/blank", () => {
    const opts = buildSmtpTransportOptions({
      from: "sales@example.com",
      smtpUsername: null,
      password: "pw",
      host: "smtp.example.com",
      port: "465",
      name: "x",
      ssl: 1,
    });
    expect(opts.auth.user).toBe("sales@example.com");
  });
});
```

- [ ] **Step 10.2: Run to verify failure**

Run: `yarn vitest-puppeteer test/vitest/utilitycode/smtpTransport.test.ts`
Expected: FAIL — `auth.user` is currently `param.from`.

- [ ] **Step 10.3: Update transport to use resolved identity**

In `src/modules/lib/smtpTransport.ts`, import the resolver and update `buildSmtpTransportOptions` (lines 43–74). Replace the `auth` block (lines 69–72):

```typescript
  const identity = resolveEmailServiceIdentity({
    smtpUsername: param.smtpUsername,
    from: param.from,
    replyTo: param.replyTo,
  });

  return {
    host: param.host,
    port,
    secure: useImplicitTls,
    requireTLS: requireTls,
    auth: {
      user: identity.smtpUsername,
      pass: param.password,
    },
  };
```

Add the import at the top:

```typescript
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";
```

- [ ] **Step 10.4: Update `EmailService` to set From + conditional Reply-To**

In `src/modules/lib/emailService.ts`, replace the class (lines 11–40):

```typescript
import nodemailer from "nodemailer";
import {
  EmailRequestData,
  EmailServiceEntitydata,
} from "@/entityTypes/emailmarketingType";
import {
  OutboundSmtpSession,
  smtpErrorMessage,
} from "@/modules/lib/smtpTransport";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";

export class EmailService {
  private session: OutboundSmtpSession;
  private readonly fromAddress: string;
  private readonly replyToAddress: string | null;

  constructor(param: EmailServiceEntitydata) {
    const identity = resolveEmailServiceIdentity({
      smtpUsername: param.smtpUsername,
      from: param.from,
      replyTo: param.replyTo,
    });
    this.fromAddress = identity.fromAddress;
    this.replyToAddress = identity.replyToAddress;
    this.session = new OutboundSmtpSession(param);
  }

  public async sendEmail(
    param: EmailRequestData,
    errorCallback?: (errorMessage: string) => void,
    successCallback?: () => void
  ): Promise<void> {
    const mailOptions: nodemailer.SendMailOptions = {
      from: this.fromAddress,
      ...(this.replyToAddress ? { replyTo: this.replyToAddress } : {}),
      to: param.Receiver,
      subject: param.Title,
      text: param.Content,
    };

    try {
      const info = await this.session.sendMail(mailOptions);
      console.log("Email sent:", info.response);
      successCallback?.();
    } catch (error: unknown) {
      errorCallback?.(smtpErrorMessage(error));
    }
  }
}
```

- [ ] **Step 10.5: Update `ReplyEmailService` similarly**

Replace the full contents of `src/modules/lib/replyEmailService.ts` with:

```typescript
import nodemailer from "nodemailer";
import type {
  EmailServiceEntitydata,
  EmailSendResult,
} from "@/entityTypes/emailmarketingType";
import {
  OutboundSmtpSession,
  smtpErrorMessage,
} from "@/modules/lib/smtpTransport";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";

/** Reply payload with thread-tracking headers preserved where available. */
export interface ReplyEmailRequestData {
  readonly receiver: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string | null;
  readonly inReplyTo?: string | null;
  readonly references?: string | null;
}

/**
 * Sends a reply email through the same SMTP credentials as outbound send,
 * preserving threading headers. The configured outgoing Reply-To (§13.2) is
 * emitted as a header; the inbound message's replyToAddress still selects
 * `data.receiver` independently (FR-011).
 */
export class ReplyEmailService {
  private session: OutboundSmtpSession;
  private readonly fromAddress: string;
  private readonly replyToAddress: string | null;

  constructor(param: EmailServiceEntitydata) {
    const identity = resolveEmailServiceIdentity({
      smtpUsername: param.smtpUsername,
      from: param.from,
      replyTo: param.replyTo,
    });
    this.fromAddress = identity.fromAddress;
    this.replyToAddress = identity.replyToAddress;
    this.session = new OutboundSmtpSession(param);
  }

  async sendReplyEmail(data: ReplyEmailRequestData): Promise<EmailSendResult> {
    const subject = ensureRePrefix(data.subject);
    const mailOptions: nodemailer.SendMailOptions = {
      from: this.fromAddress,
      ...(this.replyToAddress ? { replyTo: this.replyToAddress } : {}),
      to: data.receiver,
      subject,
      text: data.text,
    };
    if (data.html) {
      mailOptions.html = data.html;
    }
    if (data.inReplyTo) {
      mailOptions.inReplyTo = data.inReplyTo;
    }
    if (data.references) {
      mailOptions.references = data.references;
    }

    try {
      const info = await this.session.sendMail(mailOptions);
      return {
        receiver: data.receiver,
        status: true,
        title: subject,
        content: data.text,
        info: typeof info === "object" && info ? info.messageId : undefined,
      };
    } catch (error: unknown) {
      return {
        receiver: data.receiver,
        status: false,
        title: subject,
        content: data.text,
        info: smtpErrorMessage(error),
      };
    }
  }
}

/** Ensure the subject carries a `Re:` prefix without stacking duplicates. */
export function ensureRePrefix(subject: string): string {
  const trimmed = subject.trim();
  if (/^re:\s*/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}
```

- [ ] **Step 10.6: Run the transport + SMTP tests**

Run: `yarn vitest-puppeteer test/vitest/utilitycode/smtpTransport.test.ts`
Expected: PASS — `auth.user` uses smtpUsername with From fallback.

- [ ] **Step 10.7: Commit**

```bash
git add src/modules/lib/smtpTransport.ts src/modules/lib/emailService.ts src/modules/lib/replyEmailService.ts test/vitest/utilitycode/smtpTransport.test.ts
git commit -m "feat: transport authenticates with smtpUsername; messages set From + conditional Reply-To"
```

---

### Task 11: Legacy bulk copy + receive fallback + shared SMTP error classifier (Phase 3, part B)

**Files:**
- Modify: `src/childprocess/emailSend.ts`
- Modify: `src/modules/emailServiceModule.ts` (receive fallback — already done in Task 5.3; verify)
- Create: `src/modules/lib/smtpErrorClassifier.ts`
- Test: `test/vitest/utilitycode/smtpTransport.test.ts` or a new `smtpErrorClassifier.test.ts`

- [ ] **Step 11.1: Write the failing classifier tests**

Create `test/vitest/utilitycode/smtpErrorClassifier.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { classifySmtpFailure } from "@/modules/lib/smtpErrorClassifier";

describe("classifySmtpFailure (§19)", () => {
  it("classifies AUTH/535 as smtp_auth_failed (safe)", () => {
    const r = classifySmtpFailure({ code: "EAUTH", message: "Invalid login" });
    expect(r.code).toBe("smtp_auth_failed");
    expect(r.retrySafety).toBe("safe");
  });

  it("classifies MAIL FROM rejection as smtp_from_rejected (safe)", () => {
    const r = classifySmtpFailure({
      command: "MAIL",
      message: "Sender address rejected",
    });
    expect(r.code).toBe("smtp_from_rejected");
    expect(r.retrySafety).toBe("safe");
  });

  it("classifies RCPT rejection as smtp_recipient_rejected (safe)", () => {
    const r = classifySmtpFailure({ message: "Recipient address rejected" });
    expect(r.code).toBe("smtp_recipient_rejected");
  });

  it("classifies TLS/cert errors as smtp_tls_failed (safe)", () => {
    const r = classifySmtpFailure({ message: "self-signed certificate" });
    expect(r.code).toBe("smtp_tls_failed");
  });

  it("classifies DNS/refused as smtp_connection_failed (safe)", () => {
    const r = classifySmtpFailure({ code: "ENOTFOUND", message: "getaddrinfo" });
    expect(r.code).toBe("smtp_connection_failed");
  });

  it("classifies uncertain post-DATA as delivery_unknown (non-retryable)", () => {
    const r = classifySmtpFailure({ code: "ETIMEDOUT", message: "timeout" });
    expect(r.code).toBe("delivery_unknown");
    expect(r.retrySafety).toBe("unknown");
  });

  it("sanitizes the message (no password leakage)", () => {
    const r = classifySmtpFailure({
      message: "Auth failed for password=secret123",
    });
    expect(r.sanitizedMessage).not.toContain("secret123");
  });
});
```

- [ ] **Step 11.2: Run to verify failure**

Run: `yarn vitest-puppeteer test/vitest/utilitycode/smtpErrorClassifier.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 11.3: Create the shared classifier**

Create `src/modules/lib/smtpErrorClassifier.ts` (§19.2 precedence — structured Nodemailer fields before patterns):

```typescript
import type { SmtpFailureCode } from "@/modules/lib/smtpErrorClassifier";

export type SmtpFailureCode =
  | "smtp_auth_failed"
  | "smtp_from_rejected"
  | "smtp_recipient_rejected"
  | "smtp_tls_failed"
  | "smtp_connection_failed"
  | "smtp_submission_failed"
  | "delivery_unknown";

export interface ClassifiedSmtpFailure {
  readonly code: SmtpFailureCode;
  readonly retrySafety: "safe" | "unknown";
  readonly sanitizedMessage: string;
}

const LOG_LIMIT = 240;

type StructuredFields = {
  code?: unknown;
  command?: unknown;
  responseCode?: unknown;
};

function fields(error: unknown): StructuredFields {
  if (typeof error !== "object" || error === null) return {};
  return error as StructuredFields;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sanitize the provider message (§19.3): strip passwords, long responses.
 * Never echo a raw password that a provider might mirror back.
 */
function sanitize(message: string): string {
  const redacted = message.replace(/password=\S+/gi, "password=***");
  return redacted.length > LOG_LIMIT
    ? `${redacted.slice(0, LOG_LIMIT)}…`
    : redacted;
}

/**
 * Classify an SMTP failure using §19.2 precedence: structured Nodemailer
 * fields (code, command, responseCode) before known response patterns.
 * `delivery_unknown` is never auto-retried (fail-closed).
 */
export function classifySmtpFailure(error: unknown): ClassifiedSmtpFailure {
  const f = fields(error);
  const command = str(f.command).toUpperCase();
  const code = str(f.code);
  const message = text(error);
  const combined = `${code} ${command} ${message}`.toLowerCase();

  // AUTH / 535 — authentication failure.
  if (
    command === "AUTH" ||
    code === "EAUTH" ||
    /535|invalid login|authentication failed|username and password not accepted/i.test(
      combined
    )
  ) {
    return {
      code: "smtp_auth_failed",
      retrySafety: "safe",
      sanitizedMessage: sanitize(message),
    };
  }

  // MAIL FROM / sender rejected.
  if (
    command === "MAIL" ||
    code === "EENVELOPE" ||
    /sender address rejected|relay access denied|policy/i.test(combined)
  ) {
    return {
      code: "smtp_from_rejected",
      retrySafety: "safe",
      sanitizedMessage: sanitize(message),
    };
  }

  // RCPT TO / recipient rejected.
  if (
    command === "RCPT" ||
    /recipient address rejected|user unknown|no mailbox|recipients rejected/i.test(
      combined
    )
  ) {
    return {
      code: "smtp_recipient_rejected",
      retrySafety: "safe",
      sanitizedMessage: sanitize(message),
    };
  }

  // TLS / certificate before submission.
  if (
    /certificate|self-signed|unable_to_verify|cert_/i.test(combined)
  ) {
    return {
      code: "smtp_tls_failed",
      retrySafety: "safe",
      sanitizedMessage: sanitize(message),
    };
  }

  // DNS / refused / unreachable before submission.
  if (
    /enotfound|econnrefused|ehostunreachable|getaddrinfo|eai_again/i.test(
      combined
    )
  ) {
    return {
      code: "smtp_connection_failed",
      retrySafety: "safe",
      sanitizedMessage: sanitize(message),
    };
  }

  // Uncertain post-DATA handoff or unrecognized state → never auto-retry.
  return {
    code: "delivery_unknown",
    retrySafety: "unknown",
    sanitizedMessage: sanitize(message),
  };
}
```

- [ ] **Step 11.4: Run the classifier tests**

Run: `yarn vitest-puppeteer test/vitest/utilitycode/smtpErrorClassifier.test.ts`
Expected: PASS.

- [ ] **Step 11.5: Copy new fields in the legacy bulk `send()` path**

In `src/childprocess/emailSend.ts`, the legacy `send()` builds `emailserviceenditydata` (lines 681–688) from a random service. Add the identity fields to the copy:

```typescript
      const emailserviceenditydata: EmailServiceEntitydata = {
        name: randomEmailservice.name,
        from: randomEmailservice.from,
        smtpUsername: randomEmailservice.smtpUsername ?? null,
        replyTo: randomEmailservice.replyTo ?? null,
        host: randomEmailservice.host,
        port: randomEmailservice.port,
        ssl: randomEmailservice.ssl,
        password: randomEmailservice.password,
      };
```

- [ ] **Step 11.6: Run typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 11.7: Commit**

```bash
git add src/modules/lib/smtpErrorClassifier.ts src/childprocess/emailSend.ts test/vitest/utilitycode/smtpErrorClassifier.test.ts
git commit -m "feat: shared SMTP error classifier + legacy bulk identity copy"
```

**Phase 3 exit check:** all non-authorized send paths use the resolved identity; focused tests pass. Run `yarn vitest-puppeteer test/vitest/utilitycode/smtpTransport.test.ts test/vitest/utilitycode/smtpErrorClassifier.test.ts` — PASS.

---

### Task 12: Outbound v2 envelope + hasher (Phase 4, part A)

**Files:**
- Modify: `src/service/outboundEmail/OutboundEmailEnvelopeHasher.ts`
- Modify: `src/entityTypes/outboundEmailDeliveryTypes.ts`
- Test: `test/vitest/utilitycode/OutboundEmailEnvelopeHasher.test.ts`

- [ ] **Step 12.1: Write the failing v2 hasher tests (v1 fixtures pinned unchanged)**

Create/extend `test/vitest/utilitycode/OutboundEmailEnvelopeHasher.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  OutboundEmailEnvelopeHasher,
  canonicalizeOutboundEnvelope,
} from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type {
  CanonicalOutboundEnvelopeV1,
  BatchEnvelopeEntry,
} from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";

describe("OutboundEmailEnvelopeHasher v1 (pinned, byte-identical)", () => {
  it("produces the pinned v1 envelope hash", () => {
    const env: CanonicalOutboundEnvelopeV1 = {
      version: 1,
      emailServiceId: 3,
      senderAddress: "Sales@Example.com",
      recipientAddress: "user@example.com",
      subject: "Hi",
      bodyText: "Body",
      bodyHtml: null,
    };
    // Pin the canonical string so any v1 regression is caught.
    const canonical = canonicalizeOutboundEnvelope(env);
    expect(canonical).toBe(
      "version:1|emailServiceId:3|sender:16:sales@example.com|recipient:16:user@example.com|subject:2:Hi|bodyText:4:Body|bodyHtml:<<NULL_BODY_HTML>>"
    );
    expect(OutboundEmailEnvelopeHasher.hashEnvelope(env)).toHaveLength(64);
  });
});

describe("OutboundEmailEnvelopeHasher v2 (§15)", () => {
  it("binds smtpUsername and replyTo into the hash", () => {
    const base = {
      version: 2 as const,
      emailServiceId: 3,
      senderAddress: "sales@example.com",
      recipientAddress: "user@example.com",
      subject: "Hi",
      bodyText: "Body",
      bodyHtml: null,
    };
    const noIdentity = OutboundEmailEnvelopeHasher.hashEnvelopeV2({
      ...base,
      smtpUsername: "mailbox@example.com",
      replyToAddress: null,
    });
    const withReplyTo = OutboundEmailEnvelopeHasher.hashEnvelopeV2({
      ...base,
      smtpUsername: "mailbox@example.com",
      replyToAddress: "support@example.com",
    });
    expect(noIdentity).not.toBe(withReplyTo);
  });

  it("null Reply-To differs from non-null Reply-To", () => {
    const base = {
      version: 2 as const,
      emailServiceId: 1,
      smtpUsername: "x@y.com",
      senderAddress: "s@y.com",
      recipientAddress: "r@y.com",
      subject: "s",
      bodyText: "b",
      bodyHtml: null,
    };
    expect(
      OutboundEmailEnvelopeHasher.hashEnvelopeV2({ ...base, replyToAddress: null })
    ).not.toBe(
      OutboundEmailEnvelopeHasher.hashEnvelopeV2({
        ...base,
        replyToAddress: "",
      })
    );
  });

  it("v2 batch ordering is deterministic", () => {
    const entries = [
      {
        version: 2 as const,
        draftId: 2,
        emailServiceId: 1,
        smtpUsername: "x@y.com",
        senderAddress: "s@y.com",
        replyToAddress: null,
        recipientAddress: "b@y.com",
        subject: "s",
        bodyText: "b",
        bodyHtml: null,
      },
      {
        version: 2 as const,
        draftId: 1,
        emailServiceId: 1,
        smtpUsername: "x@y.com",
        senderAddress: "s@y.com",
        replyToAddress: null,
        recipientAddress: "a@y.com",
        subject: "s",
        bodyText: "b",
        bodyHtml: null,
      },
    ];
    const h1 = OutboundEmailEnvelopeHasher.hashBatchV2(entries);
    const h2 = OutboundEmailEnvelopeHasher.hashBatchV2([...entries].reverse());
    expect(h1).toBe(h2);
  });
});
```

- [ ] **Step 12.2: Run to verify failure**

Run: `yarn vitest-puppeteer test/vitest/utilitycode/OutboundEmailEnvelopeHasher.test.ts`
Expected: FAIL — `hashEnvelopeV2`/`hashBatchV2` don't exist.

- [ ] **Step 12.3: Add the v2 canonicalizer + hasher (v1 untouched)**

Append to `src/service/outboundEmail/OutboundEmailEnvelopeHasher.ts` (do NOT modify any v1 code above):

```typescript
/** Version-2 outbound envelope binds SMTP username + Reply-To (§15.1). */
export interface CanonicalOutboundEnvelopeV2 {
  version: 2;
  emailServiceId: number;
  smtpUsername: string;
  senderAddress: string;
  replyToAddress: string | null;
  recipientAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
}

/** Batch entry for v2 (adds draftId, like the v1 entry). */
export interface BatchEnvelopeEntryV2 extends CanonicalOutboundEnvelopeV2 {
  draftId: number;
}

const BATCH_PREFIX_V2 = "outbound-batch:v2";
const NULL_REPLY_TO_TOKEN = "<<NULL_REPLY_TO>>";

/**
 * v2 email normalization (§7.3): trim, preserve local part, lowercase domain
 * ONLY. Distinct from v1 whole-address lowercasing.
 */
function normalizeEmailAddressV2(address: string): string {
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return trimmed;
  return `${trimmed.slice(0, at)}${trimmed.slice(at).toLowerCase()}`;
}

/** SMTP username normalization for hashing: trim only (§7.3). */
function normalizeSmtpUsernameForHash(value: string): string {
  return value.trim();
}

export function canonicalizeOutboundEnvelopeV2(
  envelope: CanonicalOutboundEnvelopeV2
): string {
  const subject = normalizeLineEndings(envelope.subject);
  const bodyText = normalizeLineEndings(envelope.bodyText);
  const bodyHtml =
    envelope.bodyHtml === null ? null : normalizeLineEndings(envelope.bodyHtml);
  const smtpUsername = normalizeSmtpUsernameForHash(envelope.smtpUsername);
  const sender = normalizeEmailAddressV2(envelope.senderAddress);
  const replyTo =
    envelope.replyToAddress === null
      ? null
      : normalizeEmailAddressV2(envelope.replyToAddress);
  const recipient = normalizeEmailAddressV2(envelope.recipientAddress);

  const fields = [
    `version:${envelope.version}`,
    `emailServiceId:${envelope.emailServiceId}`,
    `smtpUsername:${len(smtpUsername)}:${smtpUsername}`,
    `sender:${len(sender)}:${sender}`,
    `replyTo:${replyTo === null ? NULL_REPLY_TO_TOKEN : `${len(replyTo)}:${replyTo}`}`,
    `recipient:${len(recipient)}:${recipient}`,
    `subject:${len(subject)}:${subject}`,
    `bodyText:${len(bodyText)}:${bodyText}`,
    `bodyHtml:${bodyHtml === null ? "<<NULL_BODY_HTML>>" : `${len(bodyHtml)}:${bodyHtml}`}`,
  ];
  return fields.join("|");
}
```

Add the v2 methods to the `OutboundEmailEnvelopeHasher` object (after the v1 `hashBatch`):

```typescript
  hashEnvelopeV2(envelope: CanonicalOutboundEnvelopeV2): string {
    const canonical = canonicalizeOutboundEnvelopeV2(envelope);
    return createHash("sha256").update(canonical, "utf8").digest("hex");
  },

  hashBatchV2(envelopes: ReadonlyArray<BatchEnvelopeEntryV2>): string {
    const sorted = [...envelopes].sort((a, b) => {
      const ra = normalizeEmailAddressV2(a.recipientAddress);
      const rb = normalizeEmailAddressV2(b.recipientAddress);
      if (ra !== rb) return ra < rb ? -1 : 1;
      return a.draftId - b.draftId;
    });
    const envelopeHashes = sorted.map((e) =>
      OutboundEmailEnvelopeHasher.hashEnvelopeV2(e)
    );
    const payload = `${BATCH_PREFIX_V2}\n${envelopeHashes.join("\n")}`;
    return createHash("sha256").update(payload, "utf8").digest("hex");
  },
```

- [ ] **Step 12.4: Add the v2 + v3 payload schemas to `outboundEmailDeliveryTypes.ts`**

In `src/entityTypes/outboundEmailDeliveryTypes.ts`, append the v3 schemas (§16.1/§16.2). Use `zod/v4` to match the file's existing import. Add after the v2 payload schema (around line 266):

```typescript
/** Version-3 authorized envelope (§16.1) — carries v2 identity. */
export const authorizedOutboundEnvelopeV3Schema = z.object({
  envelopeVersion: z.literal(2),
  draftId: z.number().int(),
  revisionId: z.number().int(),
  revisionNumber: z.number().int(),
  recipientAddress: z.string().max(320),
  emailServiceId: z.number().int(),
  smtpUsername: z.string().min(1).max(255),
  senderAddress: z.string().min(1).max(320),
  replyToAddress: z.string().max(320).nullable(),
  subject: z.string().max(500),
  bodyText: z.string(),
  bodyHtml: z.string().nullable(),
  envelopeHash: z.string().length(64),
});

export const authorizedEmailWorkerPayloadV3Schema = z.object({
  version: z.literal(3),
  mode: z.literal("authorized_envelopes"),
  batchId: z.number().int(),
  sendAttemptId: z.number().int(),
  batchHash: z.string().length(64),
  envelopes: z.array(authorizedOutboundEnvelopeV3Schema),
  emailServices: z.array(z.unknown()),
});

export type AuthorizedEmailWorkerPayloadV3 = Omit<
  z.infer<typeof authorizedEmailWorkerPayloadV3Schema>,
  "emailServices"
> & { emailServices: EmailServiceEntitydata[] };
```

- [ ] **Step 12.5: Run the hasher tests**

Run: `yarn vitest-puppeteer test/vitest/utilitycode/OutboundEmailEnvelopeHasher.test.ts`
Expected: PASS — v1 pinned + v2 identity/reply/batch tests.

- [ ] **Step 12.6: Commit**

```bash
git add src/service/outboundEmail/OutboundEmailEnvelopeHasher.ts src/entityTypes/outboundEmailDeliveryTypes.ts test/vitest/utilitycode/OutboundEmailEnvelopeHasher.test.ts
git commit -m "feat: outbound envelope v2 + payload v3 schemas (v1 untouched)"
```

---

### Task 13: Outbound revision fields + identity resolution + draft/preflight (Phase 4, part B)

**Files:**
- Modify: `src/entity/OutboundEmailDraftRevision.entity.ts`
- Modify: `src/schemas/entity/outboundEmailDraftRevision.ts`
- Modify: `src/service/outboundEmail/resolveOutboundSender.ts`
- Modify: `src/service/outboundEmail/OutboundEmailDraftService.ts`
- Modify: `src/service/outboundEmail/OutboundEmailPreflightService.ts`
- Modify: `src/model/EmailService.model.ts` (readIdentity — already added Task 5.1)

- [ ] **Step 13.1: Add revision identity fields**

In `src/entity/OutboundEmailDraftRevision.entity.ts`, add (default v1 for legacy rows):

```typescript
  @Column("integer", { default: 1 })
  envelopeVersion: 1 | 2;

  @Column({ type: "varchar", length: 255, nullable: true })
  smtpUsername: string | null;

  @Column({ type: "varchar", length: 320, nullable: true })
  replyToAddress: string | null;
```

In `src/schemas/entity/outboundEmailDraftRevision.ts`, add matching Zod fields (the file uses `zod/v4`):

```typescript
  envelopeVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  smtpUsername: z.string().max(255).nullable().optional(),
  replyToAddress: z.string().max(320).nullable().optional(),
```

- [ ] **Step 13.2: Make `resolveOutboundSender` an identity resolver**

In `src/service/outboundEmail/resolveOutboundSender.ts`, add `ResolvedOutboundIdentity` + `resolveOutboundIdentity` (using the model's `readIdentity` from Task 5.1 + `resolveEmailServiceIdentity`), and keep `resolveOutboundSender` as a thin wrapper so existing callers are unaffected. Replace the full file contents with:

```typescript
import { EmailServiceModel } from "@/model/EmailService.model";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";

/** Legacy single-field resolver result (kept for backward-compatible callers). */
export interface ResolvedOutboundSender {
  readonly emailServiceId: number;
  readonly senderAddress: string;
}

/** Full identity result (§13.2): authentication + visible + reply identities. */
export interface ResolvedOutboundIdentity {
  readonly emailServiceId: number;
  readonly smtpUsername: string;
  readonly senderAddress: string;
  readonly replyToAddress: string | null;
}

export interface ResolveOutboundSenderOptions {
  readonly dbpath: string;
  /** Prefer this service (the revision's frozen emailServiceId) when set. */
  readonly preferredServiceId?: number | null;
  /** Candidate service IDs from the tool args / batch row. */
  readonly serviceIds?: ReadonlyArray<number>;
}

/**
 * Coerce tool/IPC service id values into a de-duplicated list of positive
 * integers. Accepts a single number, an array, or numeric strings so a model
 * that passes `service_ids: 3` or `["3"]` still binds a real sender.
 */
export function normalizeEmailServiceIds(raw: unknown): number[] {
  if (raw == null || raw === "") {
    return [];
  }
  const values: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.includes(",")
      ? raw.split(",")
      : [raw];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const n =
      typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) {
      continue;
    }
    seen.add(n);
    ids.push(n);
  }
  return ids;
}

/**
 * Resolve the full effective identity for the preferred/candidate services,
 * falling back to the first active service with a non-empty From. Returns
 * null when nothing usable is configured — callers must fail closed.
 */
export async function resolveOutboundIdentity(
  options: ResolveOutboundSenderOptions
): Promise<ResolvedOutboundIdentity | null> {
  const model = new EmailServiceModel(options.dbpath);
  const orderedIds: number[] = [];
  const seen = new Set<number>();
  const pushId = (id: number | null | undefined): void => {
    if (id == null || !Number.isInteger(id) || id <= 0 || seen.has(id)) {
      return;
    }
    seen.add(id);
    orderedIds.push(id);
  };
  pushId(options.preferredServiceId ?? null);
  for (const id of options.serviceIds ?? []) {
    pushId(id);
  }

  const resolveOne = async (
    id: number
  ): Promise<ResolvedOutboundIdentity | null> => {
    const raw = await model.readIdentity(id);
    if (!raw || !raw.from) return null;
    const identity = resolveEmailServiceIdentity({
      smtpUsername: raw.smtpUsername,
      from: raw.from,
      replyTo: raw.replyTo,
    });
    return {
      emailServiceId: id,
      smtpUsername: identity.smtpUsername,
      senderAddress: identity.fromAddress,
      replyToAddress: identity.replyToAddress,
    };
  };

  for (const id of orderedIds) {
    const resolved = await resolveOne(id);
    if (resolved) return resolved;
  }

  const listed = await model.listEmailServices(0, 1000);
  for (const service of listed) {
    if (service.status !== 1 || seen.has(service.id)) {
      continue;
    }
    const resolved = await resolveOne(service.id);
    if (resolved) return resolved;
  }
  return null;
}

/** Thin wrapper preserving the legacy single-field return shape. */
export async function resolveOutboundSender(
  options: ResolveOutboundSenderOptions
): Promise<ResolvedOutboundSender | null> {
  const identity = await resolveOutboundIdentity(options);
  return identity
    ? {
        emailServiceId: identity.emailServiceId,
        senderAddress: identity.senderAddress,
      }
    : null;
}
```

- [ ] **Step 13.3: Persist v2 revisions in `OutboundEmailDraftService.generateBatch`**

In `src/service/outboundEmail/OutboundEmailDraftService.ts`, `generateBatch` (lines ~311/376 call `resolveOutboundSender`). Switch to `resolveOutboundIdentity`, set `envelopeVersion = 2` on new revisions, store `smtpUsername`/`replyToAddress`, build a `CanonicalOutboundEnvelopeV2` + `BatchEnvelopeEntryV2`, and compute `hashEnvelopeV2` + `hashBatchV2`. Read the file freshly to place the v2 envelope construction where the v1 `BatchEnvelopeEntry` is currently built. New revisions always use version 2 (§17.3).

- [ ] **Step 13.4: Version-aware preflight reconstruction**

In `src/service/outboundEmail/OutboundEmailPreflightService.ts`, `run(entries)` — reconstruct the envelope by `revision.envelopeVersion`: v1 → `CanonicalOutboundEnvelopeV1` + `hashEnvelope`; v2 → `CanonicalOutboundEnvelopeV2` + `hashEnvelopeV2`. A missing/unknown version → `envelope_hash_mismatch`-style finding.

- [ ] **Step 13.5: Run the outbound draft/preflight tests**

Run: `yarn testmain test/vitest/main/OutboundEmailDraftService.test.ts test/vitest/main/OutboundEmailPreflight.test.ts`
Expected: PASS — extend these files with v2 cases (version-2 SMTP username + Reply-To affect the hash; mixed-version handling) per §23.5.

- [ ] **Step 13.6: Commit**

```bash
git add src/entity/OutboundEmailDraftRevision.entity.ts src/schemas/entity/outboundEmailDraftRevision.ts src/service/outboundEmail/resolveOutboundSender.ts src/service/outboundEmail/OutboundEmailDraftService.ts src/service/outboundEmail/OutboundEmailPreflightService.ts test/vitest/main/OutboundEmailDraftService.test.ts test/vitest/main/OutboundEmailPreflight.test.ts
git commit -m "feat: outbound v2 revisions (envelopeVersion + identity snapshot) + version-aware preflight"
```

---

### Task 14: Worker payload v3 + taskCode union + delivery identity check + legacy gates (Phase 4, part C)

**Files:**
- Modify: `src/service/outboundEmail/OutboundEmailWorkerStarter.ts`
- Modify: `src/childprocess/emailSend.ts`
- Modify: `src/taskCode.ts`
- Modify: `src/service/outboundEmail/OutboundEmailDeliveryService.ts`

- [ ] **Step 14.1: Build version-aware payloads in `OutboundEmailWorkerStarter`**

In `src/service/outboundEmail/OutboundEmailWorkerStarter.ts`, `buildPayload` + `resolveEmailServices` (lines ~150–269). Project v2 envelopes for v2 revisions (add `envelopeVersion: 2`, `smtpUsername`, `replyToAddress`) and v1 envelopes for v1 revisions. Emit payload v3 when any current revision is v2; payload v2 only when ALL current revisions are v1 AND §17.1 legacy conditions hold. Service rows add `smtpUsername` + `replyTo` (effective, non-null smtpUsername; normalized replyTo).

- [ ] **Step 14.2: Worker v3 validation + v2 hash recompute + Reply-To**

In `src/childprocess/emailSend.ts`:
- Add `workerEmailServiceV3Schema` (§16.2) with `smtpUsername`/`replyTo`.
- Add `replyTo: string | null` to `AuthorizedSmtpMail` (§16.3).
- In `sendAuthorizedEnvelopes`, branch on `parsed.data.version`: v3 → validate `authorizedEmailWorkerPayloadV3Schema`, validate services via `workerEmailServiceV3Schema`, compare each envelope identity to its service row (§16.4 step 5), recompute v2 envelope hashes (`hashEnvelopeV2`) + v2 batch hash (`hashBatchV2`), abort on mismatch; v2 → existing v1 path.
- `defaultSenderFactory` maps non-null `replyTo` to Nodemailer.
- Use `classifySmtpFailure` from the new shared classifier instead of the local `classifySmtpError` (keep the local fn as a thin wrapper or remove after callers updated).

- [ ] **Step 14.3: Route the v2/v3 union in `taskCode.ts`**

In `src/taskCode.ts` (line ~151 `case "sendAuthorizedEmails"`), parse with a discriminated union on `version`: `2 → authorizedEmailWorkerPayloadV2Schema`, `3 → authorizedEmailWorkerPayloadV3Schema`. Dispatch to `sendAuthorizedEnvelopes` with the typed payload. Keep the `isAiFeatureEnabled()` gate.

- [ ] **Step 14.4: Delivery-time identity check + legacy gates**

In `src/service/outboundEmail/OutboundEmailDeliveryService.ts`:
- Claim step 5: version-aware envelope reconstruction (v1/v2) + version-aware batch hash.
- §17.2: block mixed v1+v2 current-revision batches.
- §15.5: before starting a v2 worker, reload each referenced service via `readIdentity` and compare (service ID, smtpUsername trim-only, From email-normalized, Reply-To incl. null) → `sender_identity_changed` without consuming SMTP capacity.
- §17.1: legacy v1 batch sends only when effective From == approved sender AND effective Reply-To == null AND effective SMTP username == approved sender; else `legacy_identity_requires_review`.

- [ ] **Step 14.5: Run the worker + delivery tests**

Extend `test/vitest/utilitycode/EmailSendCompletion.test.ts` (§23.4/§23.5): v3 schema rejects missing identity; service/envelope mismatch aborts before SMTP; main + worker compute same v2 hashes; identity change after approval blocks delivery; compatible all-v1 batches use payload v2; incompatible v1 identity requires review; mixed-version batch cannot send.

Run: `yarn vitest-puppeteer test/vitest/utilitycode/EmailSendCompletion.test.ts`
Expected: PASS.

- [ ] **Step 14.6: Commit**

```bash
git add src/service/outboundEmail/OutboundEmailWorkerStarter.ts src/childprocess/emailSend.ts src/taskCode.ts src/service/outboundEmail/OutboundEmailDeliveryService.ts test/vitest/utilitycode/EmailSendCompletion.test.ts
git commit -m "feat: worker payload v3 + v2 hash recompute + delivery identity check + legacy gates"
```

**Phase 4 exit check:** v2 identity is bound main-process-to-worker and mismatches fail before SMTP. Run `yarn vitest-puppeteer test/vitest/utilitycode/OutboundEmailEnvelopeHasher.test.ts test/vitest/utilitycode/EmailSendCompletion.test.ts` AND `yarn testmain test/vitest/main/OutboundEmailDraftService.test.ts test/vitest/main/OutboundEmailPreflight.test.ts` — all PASS.

---

### Task 15: Reply v2 envelope + hasher + materializer + binding + delivery + legacy gate (Phase 5)

**Files:**
- Modify: `src/entity/EmailReplyDraftRevision.entity.ts`
- Modify: `src/schemas/entity/emailReplyDraftRevision.ts`
- Modify: `src/entityTypes/emailReplyReliabilityTypes.ts`
- Modify: `src/service/emailReply/EmailReplyRevisionHasher.ts`
- Modify: `src/service/emailReply/EmailReplyRevisionMaterializer.ts`
- Modify: `src/service/emailReply/EmailReplySendBinding.ts`
- Modify: `src/service/emailReply/EmailReplyDeliveryService.ts`

- [ ] **Step 15.1: Add reply revision identity fields**

In `src/entity/EmailReplyDraftRevision.entity.ts`, add three columns after `recipientAddress` (line 46) and before `contentHash` (line 49):

```typescript
  /** Envelope schema version bound to this revision (1 = legacy, 2 = identity-bound). */
  @Column("integer", { default: 1 })
  envelopeVersion: 1 | 2;

  /** Effective SMTP login username frozen on this revision (§6.4). */
  @Column({ type: "varchar", length: 255, nullable: true })
  smtpUsername: string | null;

  /** Effective Reply-To frozen on this revision (§6.4). */
  @Column({ type: "varchar", length: 320, nullable: true })
  replyToAddress: string | null;
```

In `src/schemas/entity/emailReplyDraftRevision.ts`, add the same three optional fields inside the `z.object({...})` (after `recipientAddress`):

```typescript
    envelopeVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    smtpUsername: z.string().max(255).nullable().optional(),
    replyToAddress: z.string().max(320).nullable().optional(),
```

- [ ] **Step 15.2: Add `EmailReplyApprovalEnvelopeV2`**

In `src/entityTypes/emailReplyReliabilityTypes.ts`, add (§18.1):

```typescript
export interface EmailReplyApprovalEnvelopeV2 {
  version: 2;
  draftId: number;
  revisionId: number;
  emailServiceId: number;
  originalMessageId: number;
  smtpUsername: string;
  senderAddress: string;
  replyToAddress: string | null;
  recipientAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  policyVersion: string;
  validationVersion: string;
}
```

- [ ] **Step 15.3: Add v2 reply hasher (v1 untouched)**

Append to the END of `src/service/emailReply/EmailReplyRevisionHasher.ts` (do NOT modify any v1 code above). Also add the import for `EmailReplyApprovalEnvelopeV2` at the top alongside the existing `EmailReplyApprovalEnvelope` import:

```typescript
import type {
  EmailReplyApprovalEnvelope,
  EmailReplyApprovalEnvelopeV2,
} from "@/entityTypes/emailReplyReliabilityTypes";
```

Then append:

```typescript
const NULL_REPLY_TO_TOKEN = "<<NULL_REPLY_TO>>";

/**
 * Normalize an SMTP username for v2 hashing: trim only (§7.3). Never
 * lowercase — providers may treat non-email logins as case-sensitive.
 */
function normalizeSmtpUsernameForHash(value: string): string {
  return value.trim();
}

/**
 * Build the canonical v2 string (§18.1). Inserts `smtpUsername` +
 * `replyToAddress` (distinct null token) before `recipient`, so an identity
 * change is hash-distinct. Reuses v1 line-ending + domain-only email
 * normalization for byte-stability across the shared fields.
 */
export function canonicalizeApprovalEnvelopeV2(
  envelope: EmailReplyApprovalEnvelopeV2
): string {
  const subject = normalizeLineEndings(envelope.subject);
  const bodyText = normalizeLineEndings(envelope.bodyText);
  const bodyHtml =
    envelope.bodyHtml === null
      ? NULL_BODY_TOKEN
      : normalizeLineEndings(envelope.bodyHtml);
  const smtpUsername = normalizeSmtpUsernameForHash(envelope.smtpUsername);
  const sender = normalizeEmailAddressForHash(envelope.senderAddress);
  const replyTo =
    envelope.replyToAddress === null
      ? NULL_REPLY_TO_TOKEN
      : normalizeEmailAddressForHash(envelope.replyToAddress);
  const recipient = normalizeEmailAddressForHash(envelope.recipientAddress);

  const fields = [
    `version:${envelope.version}`,
    `draftId:${envelope.draftId}`,
    `revisionId:${envelope.revisionId}`,
    `emailServiceId:${envelope.emailServiceId}`,
    `originalMessageId:${envelope.originalMessageId}`,
    `smtpUsername:${len(smtpUsername)}:${smtpUsername}`,
    `sender:${len(sender)}:${sender}`,
    `replyTo:${replyTo === NULL_REPLY_TO_TOKEN ? NULL_REPLY_TO_TOKEN : `${len(replyTo)}:${replyTo}`}`,
    `recipient:${len(recipient)}:${recipient}`,
    `subject:${len(subject)}:${subject}`,
    `bodyText:${len(bodyText)}:${bodyText}`,
    `bodyHtml:${len(bodyHtml)}:${bodyHtml}`,
    `policyVersion:${envelope.policyVersion}`,
    `validationVersion:${envelope.validationVersion}`,
  ];
  return fields.join("|");
}

/** Compute the canonical SHA-256 hex digest of a v2 approval envelope. */
export function hashApprovalEnvelopeV2(
  envelope: EmailReplyApprovalEnvelopeV2
): string {
  const canonical = canonicalizeApprovalEnvelopeV2(envelope);
  return createHash(REVISION_HASH_ALGORITHM)
    .update(canonical, "utf8")
    .digest("hex");
}
```

- [ ] **Step 15.4: Add `materializeRevision2`**

Append to the END of `src/service/emailReply/EmailReplyRevisionMaterializer.ts` (do NOT modify `materializeRevision1`). Add the v2 import at the top alongside the existing v1 import:

```typescript
import {
  hashApprovalEnvelope,
  hashApprovalEnvelopeV2,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import type {
  EmailReplyApprovalEnvelope,
  EmailReplyApprovalEnvelopeV2,
} from "@/entityTypes/emailReplyReliabilityTypes";
```

(Replace the existing single `hashApprovalEnvelope` import and single `EmailReplyApprovalEnvelope` type import with the paired versions above.) Then append:

```typescript
/**
 * Materialize an identity-bound revision (envelope version 2, §18.1).
 *
 * New reply revisions always use v2 (§17.3 reply analogue): the hash binds
 * the effective SMTP username AND the configured Reply-To, so changing either
 * after approval invalidates the approval. The two-step placeholder flow
 * mirrors {@link materializeRevision1}.
 */
export async function materializeRevision2(
  draftAccess: RevisionCapableDraftAccess,
  input: {
    draftId: number;
    actor: "ai" | "user";
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    senderAddress: string;
    recipientAddress: string;
    emailServiceId: number;
    originalMessageId: number;
    smtpUsername: string;
    replyToAddress: string | null;
    generationMetadataJson?: string | null;
  }
): Promise<{
  revisionId: number;
  revisionNumber: number;
  contentHash: string;
}> {
  const validation = validateReplyOutput(input.subject, input.bodyText);

  const appended = await draftAccess.appendRevision({
    draftId: input.draftId,
    actor: input.actor,
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    senderAddress: input.senderAddress,
    recipientAddress: input.recipientAddress,
    contentHash: "pending-materialize",
    policyVersion: REPLY_POLICY_VERSION,
    validationVersion: REPLY_VALIDATOR_VERSION,
    generationMetadataJson: input.generationMetadataJson ?? null,
    validationFindingsJson: JSON.stringify({
      findings: validation.findings,
      sendableAfterApproval: validation.sendableAfterApproval,
      validatorVersion: validation.validatorVersion,
    }),
  });

  const envelope: EmailReplyApprovalEnvelopeV2 = {
    version: 2,
    draftId: input.draftId,
    revisionId: appended.revision.id,
    emailServiceId: input.emailServiceId,
    originalMessageId: input.originalMessageId,
    smtpUsername: input.smtpUsername,
    senderAddress: input.senderAddress,
    replyToAddress: input.replyToAddress,
    recipientAddress: input.recipientAddress,
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    policyVersion: REPLY_POLICY_VERSION,
    validationVersion: REPLY_VALIDATOR_VERSION,
  };
  const contentHash = hashApprovalEnvelopeV2(envelope);
  await draftAccess.applyContentHash(
    input.draftId,
    appended.revision.id,
    contentHash
  );

  return {
    revisionId: appended.revision.id,
    revisionNumber: appended.revision.revisionNumber,
    contentHash,
  };
}
```

- [ ] **Step 15.5: Extend send binding (§18.2)**

Replace the full contents of `src/service/emailReply/EmailReplySendBinding.ts` with the identity-aware version below. The revision + service inputs gain `smtpUsername` + `replyToAddress`; three new comparisons (smtp username trim-only, sender email-normalized, reply-to incl. null) are enforced BEFORE the claim. The inbound-recipient rule stays independent of the configured outgoing Reply-To (FR-011):

```typescript
import { normalizeEmailAddressForHash } from "@/service/emailReply/EmailReplyRevisionHasher";

/**
 * Pure mailbox + envelope binding validation for an approved send (FR-017,
 * P0.2, §18.2). Throws {@link SendBindingError} on any mismatch; returns void
 * when the envelope is consistent. Extracted so the rules are unit-testable
 * without a database or SMTP.
 *
 * Invariants enforced (every violation throws BEFORE the atomic claim, so no
 * SMTP submission can occur):
 *  - the requested draftId is the draft the approval was minted for;
 *  - the approval is bound to the draft's current revision;
 *  - the draft, the original message, and the SMTP service share one mailbox;
 *  - the approved smtpUsername matches the bound mailbox effective login (trim-only);
 *  - the approved sender matches the bound mailbox `from` (email-normalized);
 *  - the approved replyTo matches the bound mailbox configured Reply-To (incl. null);
 *  - the approved recipient matches the original message Reply-To or sender
 *    (independent of the configured outgoing Reply-To — FR-011).
 */
export interface SendBindingInput {
  requestedDraftId: number;
  approval: {
    draftId: number;
    revisionId: number;
    approvedHash: string;
  };
  draft: {
    id: number;
    currentRevisionId: number | null;
    contentHash: string | null;
    emailServiceId: number | null;
  };
  revision: {
    id: number;
    senderAddress: string;
    recipientAddress: string;
    contentHash: string;
    smtpUsername: string;
    replyToAddress: string | null;
  };
  message: {
    id: number;
    emailServiceId: number;
    fromAddress: string;
    replyToAddress: string | null;
  };
  service: {
    id: number;
    from: string;
    status: number;
    smtpUsername: string | null;
    replyToAddress: string | null;
  };
  recomputedHash: string;
}

/** Thrown when an approved-send envelope binding check fails. */
export class SendBindingError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "SendBindingError";
  }
}

function fail(code: string, message: string): never {
  throw new SendBindingError(message, code);
}

/** Normalize an SMTP username for trim-only comparison (§7.3 — never lowercase). */
function normalizeSmtpUsernameForCompare(value: string): string {
  return value.trim();
}

/** Validate the full envelope binding. Throws SendBindingError on mismatch. */
export function validateSendBinding(input: SendBindingInput): void {
  const { approval, draft, revision, message, service } = input;

  if (input.requestedDraftId !== approval.draftId) {
    fail(
      "draft_token_mismatch",
      "Send rejected: approval token does not match the requested draft"
    );
  }
  if (draft.currentRevisionId !== approval.revisionId) {
    fail(
      "approval_stale",
      "Send rejected: approval is not bound to the draft's current revision"
    );
  }
  if (approval.approvedHash !== input.recomputedHash) {
    fail(
      "hash_mismatch",
      "Send rejected: approved content no longer matches the recomputed envelope"
    );
  }
  if (revision.contentHash !== input.recomputedHash) {
    fail(
      "revision_hash_mismatch",
      "Send rejected: revision content hash differs from the recomputed envelope"
    );
  }

  // Mailbox boundary: draft / message / service must agree on one mailbox.
  const emailServiceId = draft.emailServiceId ?? message.emailServiceId;
  if (draft.emailServiceId != null) {
    if (draft.emailServiceId !== message.emailServiceId) {
      fail(
        "mailbox_mismatch",
        "Send rejected: draft mailbox differs from original message"
      );
    }
    if (draft.emailServiceId !== emailServiceId) {
      fail(
        "mailbox_mismatch",
        "Send rejected: draft mailbox differs from resolved service"
      );
    }
  }
  if (service.id !== emailServiceId) {
    fail(
      "mailbox_mismatch",
      "Send rejected: loaded service id does not match bound mailbox"
    );
  }
  if (message.emailServiceId !== emailServiceId) {
    fail(
      "mailbox_mismatch",
      "Send rejected: original message belongs to a different mailbox"
    );
  }

  if (service.status !== 1) {
    fail("service_inactive", "Send rejected: bound email service is not active");
  }

  // §18.2 identity checks — all three before the claim.
  // 1. SMTP username (trim-only; resolver fallback means service.smtpUsername
  //    may be null → resolve to service.from for the comparison).
  const effectiveServiceSmtp = service.smtpUsername ?? service.from;
  if (
    normalizeSmtpUsernameForCompare(revision.smtpUsername) !==
    normalizeSmtpUsernameForCompare(effectiveServiceSmtp)
  ) {
    fail(
      "smtp_username_mismatch",
      "Send rejected: approved SMTP username does not match the bound mailbox login"
    );
  }
  // 2. Sender (email-normalized).
  if (
    normalizeEmailAddressForHash(service.from) !==
    normalizeEmailAddressForHash(revision.senderAddress)
  ) {
    fail(
      "sender_mismatch",
      "Send rejected: approved sender does not match the bound mailbox address"
    );
  }
  // 3. Reply-To (incl. null) — the configured outgoing reply-to.
  const effectiveServiceReplyTo = service.replyToAddress ?? null;
  if (
    (revision.replyToAddress ?? null) !==
    (effectiveServiceReplyTo ?? null)
  ) {
    fail(
      "reply_to_mismatch",
      "Send rejected: approved Reply-To does not match the bound mailbox configured Reply-To"
    );
  }
  // 4. Recipient — inbound message's Reply-To or From (FR-011: independent of
  // the configured outgoing Reply-To).
  const approvedRecipient = message.replyToAddress || message.fromAddress;
  if (
    !approvedRecipient ||
    normalizeEmailAddressForHash(revision.recipientAddress) !==
      normalizeEmailAddressForHash(approvedRecipient)
  ) {
    fail(
      "recipient_mismatch",
      "Send rejected: approved recipient does not match the original sender / Reply-To"
    );
  }
}
```

- [ ] **Step 15.6: Version-aware delivery + §18.3 legacy gate**

Replace the full contents of `src/service/emailReply/EmailReplyDeliveryService.ts` with the version-aware version below. Changes vs. the v1 file:
- imports add `hashApprovalEnvelopeV2` + the `EmailReplyApprovalEnvelopeV2` type + `resolveEmailServiceIdentity`;
- `BoundMailbox` + `ReplySenderFactory` + `serviceLoader` gain `smtpUsername` + `replyToAddress`;
- envelope construction branches on `revision.envelopeVersion` (1 → v1 hash, 2 → v2 hash);
- `validateSendBinding` receives the identity fields;
- the `senderFactory` call passes `smtpUsername` + `replyTo` so `ReplyEmailService` emits the configured outgoing Reply-To header;
- §18.3 legacy gate: a v1 approval sends only when effective SMTP username == From AND configured Reply-To == null, else throws `legacy_identity_requires_review`.

```typescript
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyDraftRevisionModule } from "@/modules/EmailReplyDraftRevisionModule";
import { EmailReplyApprovalModule } from "@/modules/EmailReplyApprovalModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { ReplyEmailService } from "@/modules/lib/replyEmailService";
import { EmailReplyPolicyOrchestrator } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import { classifySubmissionResult } from "@/service/emailReply/EmailSubmissionClassifier";
import {
  buildSendIdempotencyKey,
  hashApprovalToken,
  hashApprovalEnvelope,
  hashApprovalEnvelopeV2,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import { validateSendBinding } from "@/service/emailReply/EmailReplySendBinding";
import { buildOutboundHeaders } from "@/service/emailReply/EmailReplyHeaderBuilder";
import {
  incrementReplyMetric,
  observeReplyDurationMs,
} from "@/service/emailReply/EmailReplyMetrics";
import {
  REPLY_POLICY_VERSION,
  REPLY_VALIDATOR_VERSION,
} from "@/service/emailReply/replyReliabilityVersions";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";
import type {
  EmailReplyApprovalEnvelope,
  EmailReplyApprovalEnvelopeV2,
  SendApprovedReplyInput,
  SendApprovedReplyOutcome,
} from "@/entityTypes/emailReplyReliabilityTypes";
import type { EmailReplyStatus } from "@/entityTypes/emailReceiveTypes";
import type { EmailSendResult } from "@/entityTypes/emailmarketingType";

export interface ReplySender {
  sendReplyEmail(req: {
    receiver: string;
    subject: string;
    text: string;
    html?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
  }): Promise<EmailSendResult>;
}

export type ReplySenderFactory = (service: {
  id?: number;
  from: string;
  smtpUsername?: string | null;
  replyTo?: string | null;
  password: string;
  host: string;
  port: string;
  name: string;
  ssl: number;
}) => ReplySender;

export interface BoundMailbox {
  id: number;
  from: string;
  smtpUsername: string | null;
  replyToAddress: string | null;
  status: number;
  password: string;
  host: string;
  port: string;
  name: string;
  ssl: number;
}

export class EmailReplyDeliveryService {
  private readonly draftModule = new EmailReplyDraftModule();
  private readonly revisionModule = new EmailReplyDraftRevisionModule();
  private readonly approvalModule = new EmailReplyApprovalModule();
  private readonly attemptModule = new EmailReplySendAttemptModule();
  private readonly messageModule = new EmailReceivedMessageModule();
  private readonly serviceModule = new EmailServiceModule();
  private readonly policy = new EmailReplyPolicyOrchestrator();
  private readonly senderFactory: ReplySenderFactory;
  private readonly serviceLoader: (id: number) => Promise<BoundMailbox | null>;

  constructor(options?: {
    senderFactory?: ReplySenderFactory;
    serviceLoader?: (id: number) => Promise<BoundMailbox | null>;
  }) {
    this.senderFactory =
      options?.senderFactory ??
      ((svc) => new ReplyEmailService(svc) as unknown as ReplySender);
    this.serviceLoader =
      options?.serviceLoader ??
      ((id) =>
        this.serviceModule.getEmailService(id) as Promise<BoundMailbox | null>);
  }

  async sendApprovedReply(
    input: SendApprovedReplyInput
  ): Promise<SendApprovedReplyOutcome> {
    const tokenHash = hashApprovalToken(input.approvalToken);
    const approval = await this.approvalModule.findActiveByTokenHash(tokenHash);
    if (!approval) {
      throw new Error(
        "Send rejected: approval token is invalid, expired, or already used"
      );
    }
    const draft = await this.draftModule.readAggregate(approval.draftId);
    if (!draft) {
      throw new Error("Send rejected: draft no longer exists");
    }
    const revision = await this.revisionModule.read(approval.revisionId);
    if (!revision) {
      throw new Error("Send rejected: approved revision no longer exists");
    }
    const message = await this.messageModule.read(draft.messageId);
    if (!message) {
      throw new Error("Send rejected: original message not found");
    }

    const emailServiceId = draft.emailServiceId ?? message.emailServiceId;
    const service = await this.serviceLoader(emailServiceId);
    if (!service) {
      throw new Error("Send rejected: bound email service not found");
    }

    const identity = resolveEmailServiceIdentity({
      smtpUsername: service.smtpUsername,
      from: service.from,
      replyTo: service.replyToAddress,
    });

    // Version-aware envelope + hash recompute.
    const envelopeVersion: 1 | 2 =
      revision.envelopeVersion === 2 ? 2 : 1;
    let recomputedHash: string;
    if (envelopeVersion === 2) {
      const envelope: EmailReplyApprovalEnvelopeV2 = {
        version: 2,
        draftId: draft.id,
        revisionId: revision.id,
        emailServiceId,
        originalMessageId: message.id,
        smtpUsername: revision.smtpUsername ?? identity.smtpUsername,
        senderAddress: revision.senderAddress,
        replyToAddress: revision.replyToAddress ?? null,
        recipientAddress: revision.recipientAddress,
        subject: revision.subject,
        bodyText: revision.bodyText,
        bodyHtml: revision.bodyHtml,
        policyVersion: REPLY_POLICY_VERSION,
        validationVersion: REPLY_VALIDATOR_VERSION,
      };
      recomputedHash = hashApprovalEnvelopeV2(envelope);
    } else {
      // §18.3 legacy gate: v1 approval sends ONLY when effective SMTP username
      // == From AND configured Reply-To == null. Otherwise fail closed.
      if (identity.smtpUsername !== identity.fromAddress || identity.replyToAddress !== null) {
        incrementReplyMetric("reply_identity_mismatch", {
          reason: "legacy_identity_requires_review",
        });
        throw new Error(
          "Send rejected: legacy v1 approval requires review after identity change (legacy_identity_requires_review)"
        );
      }
      const envelope: EmailReplyApprovalEnvelope = {
        draftId: draft.id,
        revisionId: revision.id,
        emailServiceId,
        originalMessageId: message.id,
        senderAddress: revision.senderAddress,
        recipientAddress: revision.recipientAddress,
        subject: revision.subject,
        bodyText: revision.bodyText,
        bodyHtml: revision.bodyHtml,
        policyVersion: REPLY_POLICY_VERSION,
        validationVersion: REPLY_VALIDATOR_VERSION,
      };
      recomputedHash = hashApprovalEnvelope(envelope);
    }

    validateSendBinding({
      requestedDraftId: input.draftId,
      approval: {
        draftId: approval.draftId,
        revisionId: approval.revisionId,
        approvedHash: approval.approvedHash,
      },
      draft: {
        id: draft.id,
        currentRevisionId: draft.currentRevisionId,
        contentHash: draft.contentHash,
        emailServiceId: draft.emailServiceId,
      },
      revision: {
        id: revision.id,
        senderAddress: revision.senderAddress,
        recipientAddress: revision.recipientAddress,
        contentHash: revision.contentHash,
        smtpUsername: revision.smtpUsername ?? identity.smtpUsername,
        replyToAddress: revision.replyToAddress ?? null,
      },
      message: {
        id: message.id,
        emailServiceId: message.emailServiceId,
        fromAddress: message.fromAddress,
        replyToAddress: message.replyToAddress,
      },
      service: {
        id: service.id,
        from: service.from,
        status: service.status,
        smtpUsername: service.smtpUsername,
        replyToAddress: service.replyToAddress,
      },
      recomputedHash,
    });

    const decision = await this.policy.evaluate({
      stage: "pre_send",
      messageId: message.id,
      draftId: draft.id,
      revisionId: revision.id,
    });
    incrementReplyMetric("policy_decision", {
      stage: "pre_send",
      code: decision.code,
      allowed: decision.allowed,
    });
    if (!decision.allowed) {
      throw new Error(`Send rejected by policy: ${decision.reason}`);
    }

    const idempotencyKey = buildSendIdempotencyKey(
      draft.id,
      revision.id,
      recomputedHash,
      approval.id
    );
    const existing = await this.attemptModule.findByIdempotencyKey(
      idempotencyKey
    );
    if (existing) {
      return { status: "already_processed", attemptId: existing.id };
    }

    const claim = await this.draftModule.claimApprovedRevisionForSend({
      draftId: draft.id,
      revisionId: revision.id,
      approvedHash: recomputedHash,
      idempotencyKey,
      approvalId: approval.id,
      messageId: message.id,
      conversationId: draft.conversationId ?? null,
      emailServiceId,
      senderAddress: revision.senderAddress,
      recipientAddress: revision.recipientAddress,
      policyVersion: REPLY_POLICY_VERSION,
    });
    if (claim.status === "already_processed") {
      incrementReplyMetric("send_claim", { outcome: "already_processed" });
      return { status: "already_processed", attemptId: claim.attempt.id };
    }
    if (claim.status === "precondition_failed") {
      incrementReplyMetric("send_claim", { outcome: "precondition_failed" });
      throw new Error(`Send rejected: ${claim.reason}`);
    }
    const attemptId = claim.attemptId;
    incrementReplyMetric("send_claim", { outcome: "claimed" });

    await this.attemptModule.markSubmitted(attemptId, new Date());

    const sender = this.senderFactory({
      id: service.id,
      from: service.from,
      smtpUsername: service.smtpUsername,
      replyTo: service.replyToAddress,
      password: service.password,
      host: service.host,
      port: service.port,
      name: service.name,
      ssl: service.ssl,
    });

    let certainty: "accepted" | "definitely_rejected" | "unknown";
    let providerMessageId: string | null = null;
    let sanitizedError: string | null = null;
    try {
      const headers = buildOutboundHeaders({
        subject: revision.subject,
        recipientAddress: revision.recipientAddress,
        parentMessageId: message.messageId,
        parentReferences: message.referencesHeader,
      });
      const raw = await sender.sendReplyEmail({
        receiver: headers.recipientAddress,
        subject: headers.subject,
        text: revision.bodyText,
        html: revision.bodyHtml,
        inReplyTo: headers.thread.inReplyTo,
        references: headers.thread.references.join(" "),
      });
      const classified = classifySubmissionResult(raw);
      certainty = classified.certainty;
      providerMessageId = classified.providerMessageId;
      sanitizedError = classified.sanitizedError;
    } catch (error) {
      certainty = "unknown";
      sanitizedError = error instanceof Error ? error.message : String(error);
    }

    const smtpStart = Date.now();
    const outcome = certaintyToOutcome(certainty);
    observeReplyDurationMs("smtp", Date.now() - smtpStart, { outcome });
    incrementReplyMetric("send_outcome", { outcome });
    const messageReplyStatus: EmailReplyStatus | undefined =
      outcome === "sent" ? "sent" : outcome === "failed" ? "failed" : undefined;
    await this.draftModule.finalizeSendOutcome({
      attemptId,
      draftId: draft.id,
      approvalId: approval.id,
      emailServiceId,
      messageId: message.id,
      outcome,
      providerMessageId,
      failureCode: certainty === "accepted" ? null : certainty,
      sanitizedError,
      messageReplyStatus,
    });

    if (outcome === "sent") {
      return {
        status: "sent",
        attemptId,
        sentAt: new Date().toISOString(),
      };
    }
    return {
      status: outcome,
      attemptId,
      error: sanitizedError ?? outcome,
    };
  }
}

function certaintyToOutcome(
  certainty: "accepted" | "definitely_rejected" | "unknown"
): "sent" | "failed" | "delivery_unknown" {
  if (certainty === "accepted") return "sent";
  if (certainty === "definitely_rejected") return "failed";
  return "delivery_unknown";
}
```

> **Note on `claimApprovedRevisionForSend`:** if the existing method signature on `EmailReplyDraftModule` does not already accept an `envelopeVersion`/identity fields, leave the call shape unchanged for v1 revisions and add the identity snapshot fields only to the v2 path in a follow-up if the model requires them. The binding + hash recompute above are the authoritative identity enforcement; the claim row records what was approved.

- [ ] **Step 15.7: Run reply tests (§23.6)**

Extend reply hasher/binding/delivery tests: v1 fixtures unchanged; v2 binds smtpUsername + replyTo; current service mismatch blocks before claim; inbound Reply-To still selects recipient; configured outgoing Reply-To becomes the sent header; legacy compatibility rules enforced.

Run: `yarn vitest-puppeteer` (reply-related utilitycode tests) and `yarn testmain` (reply-related main tests)
Expected: PASS.

- [ ] **Step 15.8: Commit**

```bash
git add src/entity/EmailReplyDraftRevision.entity.ts src/schemas/entity/emailReplyDraftRevision.ts src/entityTypes/emailReplyReliabilityTypes.ts src/service/emailReply/EmailReplyRevisionHasher.ts src/service/emailReply/EmailReplyRevisionMaterializer.ts src/service/emailReply/EmailReplySendBinding.ts src/service/emailReply/EmailReplyDeliveryService.ts
git commit -m "feat: reply approval v2 (identity-bound envelope + legacy gate)"
```

**Phase 5 exit check:** reply approvals bind both authentication and visible reply headers without changing inbound recipient selection.

---

### Task 16: Cross-layer verification (Phase 6)

**Files:** none (verification only)

- [ ] **Step 16.1: Type checks**

Run: `yarn typecheck && yarn vue-typecheck`
Expected: PASS (zero errors).

- [ ] **Step 16.2: Component gate**

Run: `yarn test:components`
Expected: PASS (hard CI gate).

- [ ] **Step 16.3: Focused utilitycode + main suites**

Run: `yarn vitest-puppeteer` (utilitycode) and `yarn testmain` (main)
Expected: No NEW failures vs baseline. **Note:** the main suite has ~27 pre-existing failures across ~8 unrelated files (EmailReply trio flaky under parallel load, `rescanSlaBackstop` perf-timing, `documentServiceStagedAttachment`×2, `AIFetchlyConfigLoader.agents`×5/`commands`×4/×1, `WorkspaceConfigScanner`×10, `exportGeneratedArtifactsTool`×2) that exist on `master` without this feature. Phase 6 passes when the only failing tests are that same baseline set — capture the baseline failure list (`yarn testmain 2>&1 | grep -E "FAIL|×"`) before feature work and diff against it here.

- [ ] **Step 16.4: Mocha module suite**

Run: `yarn test`
Expected: PASS.

- [ ] **Step 16.5: Fake-SMTP E2E (§23.8)**

Build + run: `yarn test:e2e` (Linux: `xvfb-run -a yarn test:e2e`). The fake-SMTP scenario verifies actual message headers: authenticate with `mailbox@example.test`, send From `sales@example.test`, set Reply-To `support@example.test`, assert the fake server observed the login and message headers separately; simulate a MAIL FROM rejection and assert alias guidance; repeat through authorized outbound and reply paths.

Expected: PASS.

- [ ] **Step 16.6: Secret scan**

Scan logs, exports, and IPC fixtures for secrets: no password, token, raw import row, or decrypted credential appears in renderer output, exports, logs, or worker events. (Grep the test fixtures + run output for `password=`/`enc:`/`secret` and confirm only redacted/sentinel forms appear.)

- [ ] **Step 16.7: Final commit (if any verification fixups)**

```bash
git add -A
git commit -m "test: phase 6 cross-layer verification green"
```

---

## Definition of Done (design §29)

- nullable identity columns synchronize without losing legacy data;
- one resolver owns all effective identity fallback;
- import preserves absent fields and stored update passwords;
- safe CSV and JSON exports have matching non-secret fields;
- every send path authenticates with SMTP username and sets From/Reply-To independently;
- inbound recipient Reply-To remains separate from outgoing configured Reply-To;
- new outbound and reply approvals use version-2 identity-bound hashes;
- payload version 3 is independently verified by the worker;
- legacy approvals follow documented fail-closed compatibility rules;
- all six language files and required component tests are updated;
- focused and full verification suites pass;
- no password, token, raw import row, or decrypted credential appears in renderer output, exports, logs, or worker events.
