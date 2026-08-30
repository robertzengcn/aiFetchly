import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { formatZodValidationError } from "@/utils/zodErrors";

/**
 * Privacy boundary regression (design §18.3): validation error messages must
 * NEVER echo rejected values, which could carry secrets, prompts, or PII. The
 * error formatter only emits paths, type names, and key names — this test
 * locks that invariant so a future refactor cannot silently reintroduce a
 * value leak.
 */
const SECRET = "SUPER_SECRET_VALUE_123";
const ANOTHER_SECRET = "another-secret-prompt-content";

const schema = z.strictObject({
  schemaVersion: z.literal(2),
  comment: z.string().max(10),
  items: z.array(z.strictObject({ text: z.string().max(5) })),
});

describe("formatZodValidationError does not leak rejected values", () => {
  it("never includes the rejected string value in the formatted message", () => {
    const bad = {
      schemaVersion: 9,
      comment: SECRET,
      items: [{ text: ANOTHER_SECRET }],
      sneaky: "leak",
    };
    const result = schema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodValidationError("test:channel", result.error);
      expect(typeof msg).toBe("string");
      expect(msg).not.toContain(SECRET);
      expect(msg).not.toContain(ANOTHER_SECRET);
    }
  });

  it("reports unexpected keys without echoing their values", () => {
    const bad = { schemaVersion: 2, comment: "ok", extra: SECRET };
    const result = schema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodValidationError("test:channel", result.error);
      expect(msg).not.toContain(SECRET);
      expect(msg).toContain("extra");
    }
  });

  it("does not leak a too-long string value", () => {
    const result = schema.safeParse({
      schemaVersion: 2,
      comment: SECRET,
      items: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodValidationError("test:channel", result.error);
      expect(msg).not.toContain(SECRET);
    }
  });
});
