/**
 * Unit tests for the fast forge unpackDir packaging gate.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const verify = require("../../../scripts/verify-forge-asar-unpack.js") as {
  assertRendererNotUnpacked: (unpackDir: string) => void;
  loadProductionAsarUnpackDir: () => Promise<string>;
};

describe("verify-forge-asar-unpack", () => {
  it("rejects unpackDir patterns that unpack .vite/renderer", () => {
    expect(() =>
      verify.assertRendererNotUnpacked("{**/.vite/**,**/dist/childprocess}")
    ).toThrow(/must not unpack renderer HTML/);
  });

  it("accepts the production unpackDir that keeps renderer packed", async () => {
    const unpackDir = await verify.loadProductionAsarUnpackDir();
    expect(() => verify.assertRendererNotUnpacked(unpackDir)).not.toThrow();
    expect(unpackDir).toContain(".vite/build");
    expect(unpackDir).not.toMatch(/\*\*\/\.vite\/\*\*/);
  });
});
