import { describe, expect, it, vi } from "vitest";
// NOTE: the wrapper and its production schemas are Zod v3-typed (`ZodTypeDef`),
// so this test imports bare `zod` — matching registerValidatedHandler.test.ts.
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

// Stub ipcMain so registerValidatedHandler can be exercised without Electron.
const handlers: Record<string, (e: unknown, raw: unknown) => Promise<unknown>> =
  {};
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (channel: string, fn: (e: unknown, raw: unknown) => Promise<unknown>) => {
        handlers[channel] = fn;
      }
    ),
  },
  IpcMainInvokeEvent: class {},
}));

import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";

const schema = lazySchema(() => z.strictObject({ x: z.number() }));

describe("registerValidatedHandler malformed JSON", () => {
  it("returns status:false (not a throw) for a non-JSON string", async () => {
    registerValidatedHandler("test:malformed", schema, async () => ({
      ok: true,
    }));
    const result = await handlers["test:malformed"]({}, "{ this is not json ");
    expect(result).toMatchObject({ status: false, data: null });
  });

  it("still validates a valid object", async () => {
    registerValidatedHandler("test:valid", schema, async (input) => ({
      doubled: (input as { x: number }).x * 2,
    }));
    const result = await handlers["test:valid"]({}, { x: 5 });
    expect(result).toMatchObject({ status: true, data: { doubled: 10 } });
  });

  it("still validates a valid JSON string", async () => {
    registerValidatedHandler(
      "test:valid-json-string",
      schema,
      async (input) => ({ doubled: (input as { x: number }).x * 2 })
    );
    const result = await handlers["test:valid-json-string"]({}, '{"x":7}');
    expect(result).toMatchObject({ status: true, data: { doubled: 14 } });
  });
});
