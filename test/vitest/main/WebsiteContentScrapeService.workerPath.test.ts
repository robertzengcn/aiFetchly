import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { UtilityProcess } from "electron";
import { utilityProcess } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  mockedFork.mockReset();
  mockedValidateWithDns.mockResolvedValue({
    safe: true,
    normalizedUrl: "https://example.com/debug",
  });
});

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

  it("resolves the unpacked packaged worker when running from app.asar", () => {
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
  it("includes captured stderr and worker context when the child exits", async () => {
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

  it("includes worker-reported stack traces in scrape errors", async () => {
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
