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
});
