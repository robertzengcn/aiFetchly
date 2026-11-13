import { describe, it, expect } from "vitest";
import {
  getShellToolForLLM,
  getBulkEmailToolForLLM,
  shellExecuteInputSchema,
  bulkEmailInputSchema,
} from "@/schemas/aiTools";
import type { JsonSchema7Type } from "@/utils/zodToJsonSchema";

describe("AI tool LLM-function-calling helpers", () => {
  describe("getShellToolForLLM", () => {
    it("returns an OpenAI-style function envelope", () => {
      const tool = getShellToolForLLM();
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBe("shell_execute");
      expect(typeof tool.function.description).toBe("string");
      expect(tool.function.parameters).toBeDefined();
    });

    it("emits JSON Schema with command field", () => {
      const tool = getShellToolForLLM();
      const params = tool.function.parameters as JsonSchema7Type;
      expect(params.type).toBe("object");
      expect(params.properties).toHaveProperty("command");
      expect(params.properties).toHaveProperty("cwd");
      expect(params.properties).toHaveProperty("timeout_ms");
    });

    it("caches JSON Schema via WeakMap (referential equality)", () => {
      const a = getShellToolForLLM().function.parameters;
      const b = getShellToolForLLM().function.parameters;
      expect(a).toBe(b);
    });
  });

  describe("getBulkEmailToolForLLM", () => {
    it("returns a function envelope", () => {
      const tool = getBulkEmailToolForLLM();
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBe("bulk_email_task");
      expect(tool.function.parameters).toBeDefined();
    });

    it("emits JSON Schema with bulk-email fields", () => {
      const tool = getBulkEmailToolForLLM();
      const params = tool.function.parameters as JsonSchema7Type;
      expect(params.type).toBe("object");
      expect(params.properties).toHaveProperty("service_ids");
    });

    it("caches JSON Schema via WeakMap", () => {
      const a = getBulkEmailToolForLLM().function.parameters;
      const b = getBulkEmailToolForLLM().function.parameters;
      expect(a).toBe(b);
    });
  });

  describe("lazySchema wrappers", () => {
    it("shellExecuteInputSchema returns same reference on repeat call", () => {
      expect(shellExecuteInputSchema()).toBe(shellExecuteInputSchema());
    });

    it("bulkEmailInputSchema returns same reference on repeat call", () => {
      expect(bulkEmailInputSchema()).toBe(bulkEmailInputSchema());
    });
  });

  // Pins the LLM function-calling envelope contract through the zod v4
  // migration: io:"input" must keep defaulted args OUT of `required` (the
  // zod4 output-io default forced them in — see src/utils/zodToJsonSchema.ts).
  describe("tool envelope required semantics (zod v4 io:input)", () => {
    it("shell_execute advertises defaults but does not force defaulted args", () => {
      const tool = getShellToolForLLM();
      const params = tool.function.parameters as { required?: string[]; properties?: Record<string, { default?: unknown }> };
      expect(params.properties!.shell).toMatchObject({ default: "auto" });
      expect(params.properties!.timeout_ms).toMatchObject({ default: 60000 });
      expect(params.required).toEqual(["command"]);
    });

    it("bulk_email_task does not force defaulted args", () => {
      const tool = getBulkEmailToolForLLM();
      const params = tool.function.parameters as { required?: string[]; properties?: Record<string, { default?: unknown }> };
      // The load-bearing v3-parity contract: defaulted fields stay OUT of
      // required (filter_ids default [] / not_duplicate default true).
      expect(params.required).toEqual(["service_ids"]);
      expect(params.required).not.toContain("filter_ids");
      expect(params.required).not.toContain("not_duplicate");
      expect(params.properties!.not_duplicate).toMatchObject({ default: true });
    });
  });
});