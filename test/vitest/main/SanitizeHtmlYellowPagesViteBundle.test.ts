import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAndRunViteCjsBundle } from "./helpers/viteCjsBundle";

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntryPath = path.join(
  testDir,
  "fixtures",
  "sanitizeHtmlViteEntry.mjs"
);
const yellowPagesViteConfigPath = path.resolve(
  process.cwd(),
  "vite.yellowPages.config.mjs"
);

const SANITIZE_HTML_RUNTIME_DEPS = [
  "sanitize-html",
  "htmlparser2",
  "escape-string-regexp",
  "is-plain-object",
  "deepmerge",
  "parse-srcset",
  "postcss",
  "launder",
  "entities",
  "domhandler",
  "domutils",
  "domelementtype",
  "dom-serializer",
  "nanoid",
  "picocolors",
  "source-map-js",
  "dayjs",
] as const;

/**
 * Regression for packaged YellowPagesScraper worker crash:
 *   Error: Cannot find module 'sanitize-html'
 *   Require stack: .../app.asar.unpacked/.vite/build/YellowPagesScraper.js
 *
 * SSR Vite builds externalize node_modules by default. YellowPagesScraper must
 * list sanitize-html and its pure-JS dependency tree in ssr.noExternal so the
 * packaged worker (loaded from app.asar.unpacked) does not emit bare requires
 * for those packages.
 */
describe("YellowPagesScraper sanitize-html Vite bundle packaging", () => {
  it("lists sanitize-html and its deps in ssr.noExternal", () => {
    const config = fs.readFileSync(yellowPagesViteConfigPath, "utf-8");
    const shared = fs.readFileSync(
      path.resolve(process.cwd(), "vite.workerSsrNoExternal.mjs"),
      "utf-8"
    );
    const rollupExternalMatch = config.match(
      /rollupOptions:\s*\{[\s\S]*?external:\s*\[([\s\S]*?)\]/
    );

    expect(rollupExternalMatch).not.toBeNull();
    expect(rollupExternalMatch?.[1]).not.toMatch(/sanitize-html/);
    expect(config).toMatch(/noExternal:\s*SANITIZE_HTML_SSR_NO_EXTERNAL/);

    for (const dep of SANITIZE_HTML_RUNTIME_DEPS) {
      expect(shared).toContain(`"${dep}"`);
    }
  });

  it("bundles sanitize-html into a CJS worker-style build without runtime require", async () => {
    const result = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-sanitize-html-vite-",
      fileName: "sanitize-html-bundle.cjs",
    });

    expect(result.code).not.toMatch(/require\(["']sanitize-html["']\)/);
    expect(result.run).not.toBeNull();
    expect(result.run?.status).toBe(0);
    expect(result.combinedOutput).toContain("sanitize-html-vite-ok");
  });

  it("YellowPages Vite SSR build inlines sanitize-html graph (no runtime require)", async () => {
    const { build } = require("vite") as {
      build: (inlineConfig: Record<string, unknown>) => Promise<unknown>;
    };
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-yp-sanitize-ssr-")
    );
    const outDir = path.join(tempRoot, "dist");

    try {
      await build({
        configFile: false,
        root: process.cwd(),
        logLevel: "error",
        resolve: {
          alias: {
            "@": path.resolve(process.cwd(), "src"),
          },
          conditions: ["node"],
        },
        ssr: {
          noExternal: [...SANITIZE_HTML_RUNTIME_DEPS],
        },
        build: {
          outDir,
          emptyOutDir: true,
          ssr: true,
          rollupOptions: {
            input: path.resolve(
              process.cwd(),
              "src/childprocess/YellowPagesScraper.ts"
            ),
            output: {
              entryFileNames: "YellowPagesScraper.js",
              format: "cjs",
            },
            external: [
              "electron",
              "sqlite3",
              "better-sqlite3",
              "bindings",
              "typeorm",
              "puppeteer",
              "puppeteer-extra",
              "puppeteer-extra-plugin-stealth",
              "@puppeteer/browsers",
            ],
          },
        },
      });

      const bundlePath = path.join(outDir, "YellowPagesScraper.js");
      expect(fs.existsSync(bundlePath)).toBe(true);
      const code = fs.readFileSync(bundlePath, "utf-8");
      for (const dep of SANITIZE_HTML_RUNTIME_DEPS) {
        expect(code).not.toMatch(
          new RegExp(`require\\(["']${dep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\\)`)
        );
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
