import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression: downloadable embedding-xenova worker.js used to emit
 *   require("zod")
 * which crashes when forked from userData (runtime does not ship zod;
 * NODE_PATH→asar is unreliable for external workers).
 *
 * vite.localEmbeddingWorker.config.mjs must keep zod in ssr.noExternal so
 * the worker is self-contained. CI rebuilds this file before packaging
 * runtimes; this test locks the config contract and the built artifact.
 */
describe("LocalEmbeddingWorker zod Vite bundle packaging", () => {
  const configPath = path.resolve(
    process.cwd(),
    "vite.localEmbeddingWorker.config.mjs"
  );
  const sharedPath = path.resolve(process.cwd(), "vite.workerSsrNoExternal.mjs");
  const builtWorkerCandidates = [
    path.resolve(process.cwd(), "dist/childprocess/LocalEmbeddingWorker.js"),
    path.resolve(
      process.cwd(),
      ".vite/build/childprocess/LocalEmbeddingWorker.js"
    ),
  ];

  it("lists zod in ssr.noExternal via ZOD_SSR_NO_EXTERNAL", () => {
    const config = fs.readFileSync(configPath, "utf-8");
    const shared = fs.readFileSync(sharedPath, "utf-8");
    expect(config).toMatch(/noExternal:\s*ZOD_SSR_NO_EXTERNAL/);
    expect(shared).toMatch(/ZOD_SSR_NO_EXTERNAL\s*=\s*\[["']zod["']\]/);
    const externalMatch = config.match(
      /rollupOptions:\s*\{[\s\S]*?external:\s*\[([\s\S]*?)\]/
    );
    expect(externalMatch).not.toBeNull();
    expect(externalMatch?.[1]).not.toMatch(/["']zod["']/);
  });

  it("built LocalEmbeddingWorker.js does not bare-require zod", () => {
    const built = builtWorkerCandidates.find((candidate) =>
      fs.existsSync(candidate)
    );
    expect(
      built,
      "Build LocalEmbeddingWorker.js first (vite.localEmbeddingWorker.config.mjs)"
    ).toBeTruthy();
    const source = fs.readFileSync(built as string, "utf-8");
    expect(source).not.toMatch(/require\(\s*["']zod(?:\/v4)?["']\s*\)/);
    // Positive signal that zod was inlined rather than merely absent.
    expect(source).toMatch(/node_modules\/zod\//);
  });
});
