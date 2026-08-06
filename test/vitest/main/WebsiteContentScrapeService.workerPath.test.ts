import path from "node:path";
import * as fs from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { UtilityProcess } from "electron";
import { utilityProcess } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  utilityProcess: {
    fork: vi.fn(),
  },
}));

vi.mock("@/service/UrlGuard", () => ({
  UrlGuard: {
    validateWithDns: vi.fn(),
  },
}));

import { UrlGuard } from "@/service/UrlGuard";
import { WebsiteContentScrapeService } from "@/service/WebsiteContentScrapeService";

class MockUtilityProcess extends EventEmitter {
  pid: number | null = 1234;
  stdout: PassThrough | null = new PassThrough();
  stderr: PassThrough | null = new PassThrough();
  kill = vi.fn(() => true);
  postMessage = vi.fn();
}

function asUtilityProcess(
  childProcess: MockUtilityProcess
): UtilityProcess {
  return childProcess as unknown as UtilityProcess;
}

const mockedFork = vi.mocked(utilityProcess.fork);
const mockedValidateWithDns = vi.mocked(UrlGuard.validateWithDns);
const websiteWorkerBundlePath = path.join(
  process.cwd(),
  "dist",
  "childprocess",
  "websiteContentScraper.js"
);
let createdWebsiteWorkerBundle = false;

beforeEach(() => {
  mockedFork.mockReset();
  mockedValidateWithDns.mockResolvedValue({
    safe: true,
    normalizedUrl: "https://example.com/debug",
  });
});

function ensureWebsiteWorkerBundleExists(): void {
  if (fs.existsSync(websiteWorkerBundlePath)) {
    return;
  }
  fs.mkdirSync(path.dirname(websiteWorkerBundlePath), { recursive: true });
  fs.writeFileSync(websiteWorkerBundlePath, "module.exports = {};\n");
  createdWebsiteWorkerBundle = true;
}

describe("WebsiteContentScrapeService worker path resolution", () => {
  it("resolves the local dist childprocess worker used by Vite worker builds", () => {
    const expected = path.join(
      "/repo",
      "dist",
      "childprocess",
      "websiteContentScraper.js"
    );

    const resolved = WebsiteContentScrapeService.resolveChildProcessPath({
      dirname: path.join("/repo", ".vite", "build"),
      cwd: "/repo",
      existsSync: (candidate) => candidate === expected,
    });

    expect(resolved).toBe(expected);
  });

  it("prefers the app.asar virtual path over the unpacked mirror when packaged", () => {
    // Loading through app.asar keeps Electron module resolution able to find
    // puppeteer in app.asar/node_modules. Preferring unpacked first caused
    // MODULE_NOT_FOUND on Windows packaged builds.
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const asarPath = path.join(
      resourcesPath,
      "app.asar",
      "dist",
      "childprocess",
      "websiteContentScraper.js"
    );
    const unpackedPath = path.join(
      resourcesPath,
      "app.asar.unpacked",
      "dist",
      "childprocess",
      "websiteContentScraper.js"
    );

    const resolved = WebsiteContentScrapeService.resolveChildProcessPath({
      dirname: path.join(resourcesPath, "app.asar", ".vite", "build"),
      cwd: "/tmp",
      resourcesPath,
      existsSync: (candidate) =>
        candidate === asarPath || candidate === unpackedPath,
    });

    expect(resolved).toBe(asarPath);
    expect(resolved).not.toBe(unpackedPath);
  });

  it("falls back to the unpacked packaged worker when the asar virtual path is missing", () => {
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const expected = path.join(
      resourcesPath,
      "app.asar.unpacked",
      "dist",
      "childprocess",
      "websiteContentScraper.js"
    );

    const resolved = WebsiteContentScrapeService.resolveChildProcessPath({
      dirname: path.join(resourcesPath, "app.asar", ".vite", "build"),
      cwd: "/tmp",
      resourcesPath,
      existsSync: (candidate) => candidate === expected,
    });

    expect(resolved).toBe(expected);
  });

  it("maps Windows app.asar paths to the app.asar.unpacked mirror", () => {
    const packedPath =
      "E:\\aifetchly\\app-1.0.123\\resources\\app.asar\\.vite\\build\\childprocess\\websiteContentScraper.js";

    expect(
      WebsiteContentScrapeService.mirrorAppAsarUnpackedPath(packedPath)
    ).toBe(
      "E:\\aifetchly\\app-1.0.123\\resources\\app.asar.unpacked\\.vite\\build\\childprocess\\websiteContentScraper.js"
    );
  });
});

describe("WebsiteContentScrapeService child process diagnostics", () => {
  afterEach(() => {
    if (createdWebsiteWorkerBundle) {
      fs.rmSync(websiteWorkerBundlePath, { force: true });
      createdWebsiteWorkerBundle = false;
    }
  });

  it("includes captured stderr and worker context when the child exits", async () => {
    ensureWebsiteWorkerBundleExists();
    const childProcess = new MockUtilityProcess();
    mockedFork.mockImplementation((childPath: string) => {
      queueMicrotask(() => childProcess.emit("spawn"));
      childProcess.postMessage.mockImplementation(() => {
        childProcess.stderr?.emit(
          "data",
          Buffer.from("Cannot find module 'puppeteer'\nRequire stack...")
        );
        childProcess.stdout?.emit("data", Buffer.from("worker booting\n"));
        childProcess.emit("exit", 1, null);
      });
      expect(childPath).toContain("websiteContentScraper.js");
      return asUtilityProcess(childProcess);
    });

    const service = new WebsiteContentScrapeService();

    await expect(service.scrapePage("https://example.com/debug")).rejects.toThrow(
      /Child process exited with code 1[\s\S]*requestId=scrape-[\s\S]*workerPath=.*websiteContentScraper\.js[\s\S]*Cannot find module 'puppeteer'/
    );
  });

  it("passes packaged NODE_PATH so unpacked workers can resolve puppeteer", async () => {
    ensureWebsiteWorkerBundleExists();
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const previousResourcesPath = (process as NodeJS.Process & {
      resourcesPath?: string;
    }).resourcesPath;
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath =
      resourcesPath;

    const childProcess = new MockUtilityProcess();
    mockedFork.mockImplementation((_childPath, _args, options) => {
      const env = (options as { env?: NodeJS.ProcessEnv } | undefined)?.env;
      expect(env?.NODE_PATH).toContain(
        path.join(resourcesPath, "app.asar", "node_modules")
      );
      expect(env?.NODE_PATH).toContain(
        path.join(resourcesPath, "app.asar.unpacked", "node_modules")
      );
      queueMicrotask(() => childProcess.emit("spawn"));
      childProcess.postMessage.mockImplementation((rawMessage: string) => {
        const request = JSON.parse(rawMessage) as { requestId: string };
        childProcess.emit("message", {
          data: JSON.stringify({
            type: "SCRAPE_SUCCESS",
            requestId: request.requestId,
            markdown: "# ok",
            finalUrl: "https://example.com/debug",
            links: [],
          }),
        });
      });
      return asUtilityProcess(childProcess);
    });

    try {
      const service = new WebsiteContentScrapeService();
      await expect(
        service.scrapePage("https://example.com/debug")
      ).resolves.toMatchObject({ markdown: "# ok" });
    } finally {
      if (previousResourcesPath === undefined) {
        delete (process as NodeJS.Process & { resourcesPath?: string })
          .resourcesPath;
      } else {
        (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath =
          previousResourcesPath;
      }
    }
  });

  it("includes worker-reported stack traces in scrape errors", async () => {
    ensureWebsiteWorkerBundleExists();
    const childProcess = new MockUtilityProcess();
    mockedFork.mockImplementation(() => {
      queueMicrotask(() => childProcess.emit("spawn"));
      childProcess.postMessage.mockImplementation((rawMessage: string) => {
        const request = JSON.parse(rawMessage) as { requestId: string };
        childProcess.emit("message", {
          data: JSON.stringify({
            type: "SCRAPE_ERROR",
            requestId: request.requestId,
            error: "Navigation failed",
            stack: "Error: Navigation failed\n    at scrapeWebsite",
          }),
        });
      });
      return asUtilityProcess(childProcess);
    });

    const service = new WebsiteContentScrapeService();

    await expect(service.scrapePage("https://example.com/debug")).rejects.toThrow(
      /Navigation failed[\s\S]*at scrapeWebsite[\s\S]*url=https:\/\/example\.com\/debug/
    );
  });
});
