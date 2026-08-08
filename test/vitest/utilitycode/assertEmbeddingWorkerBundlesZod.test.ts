import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertEmbeddingWorkerBundlesZod } from "../../../scripts/build-local-ai-runtime.mjs";

describe("assertEmbeddingWorkerBundlesZod", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  function writeTemp(contents: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-embed-zod-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "worker.js");
    fs.writeFileSync(file, contents, "utf8");
    return file;
  }

  it("rejects a worker that still require()s zod", () => {
    const file = writeTemp('const z = require("zod");\nmodule.exports = z;\n');
    expect(() => assertEmbeddingWorkerBundlesZod(file)).toThrow(/externalizes zod/i);
  });

  it("accepts a worker with zod inlined", () => {
    const file = writeTemp(
      '//#region node_modules/zod/v3/types.js\nconst ZodString = {};\n'
    );
    expect(() => assertEmbeddingWorkerBundlesZod(file)).not.toThrow();
  });
});
