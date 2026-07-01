import { describe, it, expect } from "vitest";
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { zodToJsonSchema } from "@/utils/zodToJsonSchema";

describe("zodToJsonSchema", () => {
  it("converts a simple object schema to JSON Schema", () => {
    const s = lazySchema(() =>
      z.strictObject({
        name: z.string(),
        age: z.number().int().nonnegative(),
      })
    );
    const json = zodToJsonSchema(s());
    expect(json.type).toBe("object");
    expect(json.properties).toBeDefined();
    expect(json.properties!.name).toEqual({ type: "string" });
    // zod-to-json-schema maps .int() to JSON Schema "integer"
    expect(["integer", "number"]).toContain(json.properties!.age.type);
  });

  it("returns cached result for the same schema reference (WeakMap hit)", () => {
    const s = lazySchema(() => z.strictObject({ a: z.string() }));
    const j1 = zodToJsonSchema(s());
    const j2 = zodToJsonSchema(s());
    // WeakMap cache → referential equality
    expect(j1).toBe(j2);
  });

  it("produces distinct outputs for distinct schemas", () => {
    const sa = lazySchema(() => z.strictObject({ a: z.string() }));
    const sb = lazySchema(() => z.strictObject({ b: z.number() }));
    const ja = zodToJsonSchema(sa());
    const jb = zodToJsonSchema(sb());
    expect(ja).not.toBe(jb);
    expect(ja.properties).toHaveProperty("a");
    expect(jb.properties).toHaveProperty("b");
  });

  it("handles enums", () => {
    const s = lazySchema(() => z.enum(["a", "b", "c"]));
    const json = zodToJsonSchema(s());
    expect(json.enum).toEqual(["a", "b", "c"]);
  });

  it("handles arrays", () => {
    const s = lazySchema(() => z.array(z.string()));
    const json = zodToJsonSchema(s());
    expect(json.type).toBe("array");
    expect(json.items).toEqual({ type: "string" });
  });
});
