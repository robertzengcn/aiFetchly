/**
 * Regression test for `draft_outbound_email_batch` input validation.
 *
 * Bug: the skill's execute handler read AI-supplied `args.emails` (and other
 * array fields) via raw `as` casts without parsing, so when the model emitted
 * `emails` as a non-array (e.g. a single object or string), the downstream
 * `(input.emails ?? []).map(...)` in resolveBulkRecipients crashed with
 * "(e.emails ?? []).map is not a function" and the tool returned
 * { success: false, executionTimeMs: 2, error: "..." } before any business
 * logic ran.
 *
 * Fix: validate the full args envelope with `bulkEmailTaskInputSchema` at the
 * top of the execute handler (the same schema startBulkEmailSendTask and
 * previewBulkEmailSendTask already use), returning a structured
 * validation_errors payload on bad input instead of throwing.
 *
 * This file locks the boundary: a non-array `emails` must yield a validation
 * failure, never a TypeError. The happy path is covered by the existing
 * OutboundEmailDraftService.generateBatch tests.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-draft-batch-validation");

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

// The Token-resolved USERSDBPATH must point at the test DB so the draft
// service the skill constructs internally uses the isolated temp database.
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
}));
vi.mock("@/config/usersetting", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/config/usersetting")
  >();
  return {
    ...original,
    Token: class {
      getValue(name: string) {
        return name === "user_dbpath" ? tmpDir : "";
      }
    },
  };
});

import { SkillRegistry } from "@/config/skillsRegistry";

const baseContext = {
  conversationId: "conv-1",
  toolCallId: "tc-1",
  sourceUserMessageId: "msg-1",
  intentDecisionId: 1,
};

describe("draft_outbound_email_batch input validation", () => {
  it("rejects a non-array `emails` with validation_errors instead of throwing .map is not a function", async () => {
    const skill = SkillRegistry.getSkill("draft_outbound_email_batch");
    expect(skill?.execute).toBeTypeOf("function");

    // The shape that triggered the original crash: `emails` is a truthy
    // object (not an array), so `(input.emails ?? []).map` blew up.
    const result = await skill!.execute!(
      {
        // A truthy non-array — the exact shape that triggered the original
        // `.map is not a function` crash before validation was added.
        emails: { address: "someone@example.com" },
        service_ids: [1],
        email_subject: "Hello",
        email_html_content: "<p>Hi</p>",
      },
      baseContext
    );

    expect(result.success).toBe(false);
    const payload = result.result as Record<string, unknown>;
    expect(payload.success).toBe(false);
    // Must surface a validation error, NOT the runtime TypeError.
    expect(JSON.stringify(payload)).not.toContain(".map is not a function");
    expect(payload.validation_errors).toBeInstanceOf(Array);
    expect((payload.validation_errors as string[]).length).toBeGreaterThan(0);
  });

  it("rejects `emails` as a bare string with validation_errors", async () => {
    const skill = SkillRegistry.getSkill("draft_outbound_email_batch");
    const result = await skill!.execute!(
      {
        emails: "someone@example.com",
        service_ids: [1],
        email_subject: "Hello",
        email_html_content: "<p>Hi</p>",
      },
      baseContext
    );

    expect(result.success).toBe(false);
    const payload = result.result as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain(".map is not a function");
    expect(payload.validation_errors).toBeInstanceOf(Array);
  });

  it("rejects missing service_ids (required field) with validation_errors", async () => {
    const skill = SkillRegistry.getSkill("draft_outbound_email_batch");
    const result = await skill!.execute!(
      {
        emails: [{ address: "someone@example.com" }],
        email_subject: "Hello",
        email_html_content: "<p>Hi</p>",
      },
      baseContext
    );

    expect(result.success).toBe(false);
    const payload = result.result as Record<string, unknown>;
    expect(payload.validation_errors).toBeInstanceOf(Array);
    expect((payload.validation_errors as string[]).length).toBeGreaterThan(0);
  });
});
