/**
 * Regression tests for the outbound email tool input contract.
 *
 * Production failure (test environment, 2026-11-14): the scheduled outreach
 * conversation is served by a rotating model queue. The z-ai/glm-5.3-flash
 * route emitted start_email_send_task calls whose arguments were valid JSON
 * but missing `emails` and `email_subject` (e.g.
 * {email_content, service_ids, skip_review}) — 12 of 13 attempts that day.
 * Every call failed tool validation with "Invalid email marketing tool
 * input" and the model regenerated the same incomplete call for 6+ rounds.
 *
 * Two root causes on the app side:
 * 1. The tool schema declared only `required: ["service_ids"]`, while the
 *    runtime contract (bulkEmailTaskInputSchema) additionally requires a
 *    recipient source (emails XOR email_search_task_id) and a content source
 *    (template_ids XOR email_subject + email_content). Schema-literal models
 *    followed the schema and omitted the rest.
 * 2. The validation failure named no parameters, so weak models had nothing
 *    concrete to fix on retry (they DO respond when a param is named).
 *
 * Fix 1: the schema now carries an `anyOf` of the four exact required sets.
 * Fix 2: validation failures include `missing_params` and name them in
 * `error` (shapes-in-words only — never copy-pasteable values).
 *
 * The diagnostic helper describeUnexecutableToolCallFragments covers the
 * related silent-loss case: nameless stream fragments dropped by the loop's
 * name/id filter are now warn-logged instead of vanishing.
 */
import { describe, expect, it } from "vitest";
import { SkillRegistry } from "@/config/skillsRegistry";
import { describeMissingBulkEmailParams } from "@/entityTypes/emailMarketingAiTypes";
import {
  OpenAIStreamAccumulator,
  describeUnexecutableToolCallFragments,
} from "@/service/OpenAIStreamAccumulator";
import {
  previewBulkEmailSendTask,
  startBulkEmailSendTask,
} from "@/service/EmailMarketingAiTools";

/** The exact cross-product the runtime accepts, as sorted required-sets. */
const EXPECTED_REQUIRED_SETS = [
  ["email_search_task_id", "template_ids"],
  ["email_search_task_id", "email_subject", "email_content"],
  ["emails", "template_ids"],
  ["emails", "email_subject", "email_content"],
].map((branch) => [...branch].sort().join("|"));

describe("outbound email tool schema required branches", () => {
  it.each(["start_email_send_task", "draft_outbound_email_batch"])(
    "%s encodes recipient × content required sets in anyOf",
    (toolName) => {
      const skill = SkillRegistry.getSkill(toolName);
      expect(skill).not.toBeNull();

      const parameters = skill!.parameters as Record<string, unknown>;
      // service_ids stays the only flat-required field; the alternatives are
      // expressed via branches.
      expect(parameters.required).toEqual(["service_ids"]);

      const anyOf = parameters.anyOf as Array<{ required: string[] }>;
      expect(Array.isArray(anyOf)).toBe(true);
      expect(anyOf).toHaveLength(4);
      const actualSets = anyOf.map((branch) =>
        [...branch.required].sort().join("|")
      );
      expect(new Set(actualSets)).toEqual(new Set(EXPECTED_REQUIRED_SETS));

      // The properties block is unchanged — branches only add constraints.
      const properties = parameters.properties as Record<string, unknown>;
      for (const key of [
        "emails",
        "email_subject",
        "email_content",
        "template_ids",
        "service_ids",
        "email_search_task_id",
      ]) {
        expect(properties[key]).toBeDefined();
      }
    }
  );
});

describe("describeMissingBulkEmailParams", () => {
  it("names emails and email_subject for the observed GLM flash shape", () => {
    // Exactly the arguments z-ai/glm-5.3-flash produced 12 times on
    // 2026-11-14 (valid JSON, missing recipient + subject).
    const missing = describeMissingBulkEmailParams({
      email_content: "Hello",
      service_ids: [15],
      skip_review: true,
    });
    expect(missing.some((m) => m.startsWith("emails"))).toBe(true);
    expect(missing.some((m) => m.startsWith("email_subject"))).toBe(true);
    // email_content was provided — it must not be reported missing.
    expect(missing.some((m) => m.startsWith("email_content"))).toBe(false);
  });

  it("names subject and content when only recipients are provided", () => {
    const missing = describeMissingBulkEmailParams({
      emails: ["someone@example.com"],
      service_ids: [1],
    });
    expect(missing.some((m) => m.startsWith("email_subject"))).toBe(true);
    expect(missing.some((m) => m.startsWith("email_content"))).toBe(true);
    expect(missing.some((m) => m.startsWith("emails"))).toBe(false);
  });

  it("returns an empty list for a fully-populated direct send", () => {
    expect(
      describeMissingBulkEmailParams({
        emails: ["someone@example.com"],
        email_subject: "Hello",
        email_content: "Body",
        service_ids: [1],
      })
    ).toEqual([]);
  });

  it("accepts template_ids and email_search_task_id variants", () => {
    expect(
      describeMissingBulkEmailParams({
        email_search_task_id: 12,
        template_ids: [3],
        service_ids: [1],
      })
    ).toEqual([]);
  });

  it("reports service_ids when it is absent", () => {
    const missing = describeMissingBulkEmailParams({
      emails: ["someone@example.com"],
      email_subject: "Hello",
      email_content: "Body",
    });
    expect(missing.some((m) => m.startsWith("service_ids"))).toBe(true);
  });
});

describe("bulk email tool validation failures name missing params", () => {
  it("startBulkEmailSendTask reports the missing arguments for the GLM shape", async () => {
    const result = await startBulkEmailSendTask({
      email_content: "Hello",
      service_ids: [15],
      skip_review: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("emails");
    expect(result.error).toContain("email_subject");
    const payload = result as unknown as Record<string, unknown>;
    expect(payload.validation_errors).toBeInstanceOf(Array);
    expect(payload.missing_params).toBeInstanceOf(Array);
  });

  it("previewBulkEmailSendTask reports the missing arguments for the GLM shape", async () => {
    const result = await previewBulkEmailSendTask({
      email_content: "Hello",
      service_ids: [15],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("email_subject");
    const payload = result as unknown as Record<string, unknown>;
    expect(payload.missing_params).toBeInstanceOf(Array);
  });
});

describe("describeUnexecutableToolCallFragments", () => {
  it("returns nothing when every buffered call has a name and id", () => {
    expect(
      describeUnexecutableToolCallFragments([
        {
          index: 0,
          id: "call_a",
          name: "file_read",
          ok: true,
          arguments: {},
          rawArgumentsJson: "{}",
        },
      ])
    ).toEqual([]);
  });

  it("describes a nameless continuation fragment", () => {
    const details = describeUnexecutableToolCallFragments([
      {
        index: 0,
        id: "call_a",
        name: "start_email_send_task",
        ok: true,
        arguments: {},
        rawArgumentsJson: "{}",
      },
      {
        index: 1,
        ok: false,
        rawArgumentsJson: '{"emails":["a@b.c"]}',
      },
    ]);
    expect(details).toHaveLength(1);
    expect(details[0]).toContain("without name");
    expect(details[0]).toContain("index=1");
    expect(details[0]).toContain('"emails"');
  });

  it("describes an unnamed and an id-less fragment distinctly", () => {
    const details = describeUnexecutableToolCallFragments([
      { index: 0, id: "call_x", ok: true, rawArgumentsJson: "{}" },
      { index: 1, name: "file_read", ok: true, rawArgumentsJson: "{}" },
    ]);
    expect(details).toHaveLength(2);
    expect(details[0]).toContain("without name");
    expect(details[1]).toContain("without id");
  });

  it("surfaces fragments produced by real GLM-style delta streams", () => {
    // A provider quirk: one logical call streamed as index 0 (named, partial
    // args) plus a nameless index 1 continuation. After buffering, the
    // fragment report must flag index 1 so the argument loss is visible.
    const accumulator = new OpenAIStreamAccumulator();
    accumulator.ingest({
      id: "chunk-1",
      object: "chat.completion.chunk",
      created: 0,
      model: "test",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: {
                  name: "start_email_send_task",
                  arguments: '{"emails":["a@b.c"],',
                },
              },
              {
                index: 1,
                function: { arguments: '"email_subject":"Hi"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    const parsed = accumulator.tryParseToolCallArguments();
    const details = describeUnexecutableToolCallFragments(parsed);
    expect(details).toHaveLength(1);
    expect(details[0]).toContain("without name+id");
    expect(details[0]).toContain("index=1");
    // The nameless fragment's raw (unmerged) arguments are preserved in the
    // diagnostic so the loss is attributable.
    expect(details[0]).toContain("email_subject");
  });
});
