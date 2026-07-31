import { describe, expect, it } from "vitest";
import {
  truncateDescription,
  pruneJsonSchema,
} from "@/service/ToolSchemaSanitizer";

describe("ToolSchemaSanitizer.truncateDescription", () => {
  it("leaves undefined unchanged and reports not truncated", () => {
    const r = truncateDescription(undefined);
    expect(r.value).toBeUndefined();
    expect(r.truncated).toBe(false);
  });

  it("leaves short text unchanged", () => {
    const r = truncateDescription("short description");
    expect(r.value).toBe("short description");
    expect(r.truncated).toBe(false);
  });

  it("truncates text exceeding the limit with a marker", () => {
    const long = "x".repeat(3000);
    const r = truncateDescription(long, 2048);
    expect(r.truncated).toBe(true);
    expect(r.value!.endsWith("... [truncated]")).toBe(true);
    // value length = limit + marker length (no extra content beyond limit)
    expect(r.value!.length).toBe(2048 + "... [truncated]".length);
  });

  it("respects a custom limit", () => {
    const r = truncateDescription("0123456789", 5);
    expect(r.truncated).toBe(true);
    expect(r.value).toBe("01234... [truncated]");
  });
});

describe("ToolSchemaSanitizer.pruneJsonSchema", () => {
  it("returns input unchanged when under budget", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    };
    const r = pruneJsonSchema(schema);
    expect(r.changed).toBe(false);
    expect(r.schema).toEqual(schema);
    expect(r.actions).toEqual([]);
  });

  it("removes examples field when over budget", () => {
    const bigExample = "e".repeat(15000);
    const schema = {
      type: "object",
      properties: {
        a: { type: "string", examples: [bigExample] },
      },
    };
    const r = pruneJsonSchema(schema, 1000);
    expect(r.changed).toBe(true);
    expect(r.actions).toContain("removed-examples");
    expect(JSON.stringify(r.schema).length).toBeLessThan(
      JSON.stringify(schema).length
    );
    // structural fields preserved
    expect(r.schema.type).toBe("object");
    expect(r.schema.properties).toBeDefined();
  });

  it("truncates long nested descriptions", () => {
    const longDesc = "d".repeat(15000);
    const schema = {
      type: "object",
      properties: {
        a: { type: "string", description: longDesc },
      },
    };
    const r = pruneJsonSchema(schema, 1000);
    expect(r.changed).toBe(true);
    const desc = (r.schema.properties as Record<string, unknown>).a as Record<
      string,
      unknown
    >;
    expect(typeof desc.description).toBe("string");
    expect((desc.description as string).length).toBeLessThan(longDesc.length);
  });

  it("preserves required structural fields", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
      required: ["a"],
      additionalProperties: true,
    };
    const r = pruneJsonSchema(schema, 1000);
    expect(r.schema.type).toBe("object");
    expect(r.schema.required).toEqual(["a"]);
    expect(r.schema.additionalProperties).toBe(true);
  });

  it("never throws on non-object input", () => {
    const r = pruneJsonSchema("not-a-schema" as unknown as Record<
      string,
      unknown
    >);
    expect(r.changed).toBe(false);
  });
});
