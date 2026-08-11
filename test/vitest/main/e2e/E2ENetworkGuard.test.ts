import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  installE2ENetworkGuard,
  isLoopbackHost,
  extractRequestTarget,
  type InstalledNetworkGuard,
} from "@/main-process/e2e/E2ENetworkGuard";
import type { E2EEnvironment } from "@/main-process/e2e/E2EEnvironment";

function makeEnv(root: string): E2EEnvironment {
  return {
    rootPath: root,
    userDataPath: path.join(root, "user-data"),
    databasePath: path.join(root, "database"),
    workspacePath: path.join(root, "workspace"),
    downloadsPath: path.join(root, "downloads"),
    logsPath: path.join(root, "logs"),
    fakeAiBaseUrl: "http://127.0.0.1:6000/v1",
    allowedOrigins: ["http://127.0.0.1:5173", "http://127.0.0.1:6000"],
    stateFilePath: null,
  };
}

describe("E2ENetworkGuard", () => {
  describe("pure helpers", () => {
    it("isLoopbackHost recognizes loopback only", () => {
      expect(isLoopbackHost("127.0.0.1")).toBe(true);
      expect(isLoopbackHost("localhost")).toBe(true);
      expect(isLoopbackHost("::1")).toBe(true);
      expect(isLoopbackHost("example.com")).toBe(false);
      expect(isLoopbackHost("10.0.0.1")).toBe(false);
    });

    it("extractRequestTarget handles string, URL, and RequestOptions shapes", () => {
      expect(
        extractRequestTarget("https://api.example.com/v1", "https:")
      ).toEqual({
        origin: "https://api.example.com",
        pathname: "/v1",
      });
      expect(
        extractRequestTarget(new URL("http://127.0.0.1:5/v1/models"), "http:")
      ).toEqual({
        origin: "http://127.0.0.1:5",
        pathname: "/v1/models",
      });
      expect(
        extractRequestTarget(
          { hostname: "api.example.com", path: "/x", protocol: "https:" },
          "https:"
        )
      ).toEqual({ origin: "https://api.example.com", pathname: "/x" });
    });
  });

  describe("installed guard", () => {
    let root: string;
    let guard: InstalledNetworkGuard | null = null;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-e2e-guard-"));
    });

    afterEach(() => {
      guard?.uninstall();
      guard = null;
      globalThis.fetch = originalFetch;
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    });

    it("blocks a non-loopback fetch and records a redacted violation", async () => {
      // Spy: the original fetch must NOT be called for blocked requests.
      let called = false;
      globalThis.fetch = ((_input: unknown) => {
        called = true;
        return Promise.resolve(new Response("ok"));
      }) as unknown as typeof fetch;
      guard = installE2ENetworkGuard(makeEnv(root));

      await expect(
        globalThis.fetch("https://api.example.com/v1")
      ).rejects.toThrow(/E2E network guard blocked/);
      expect(called).toBe(false);

      const log = fs
        .readFileSync(guard.violationsFile, "utf8")
        .trim()
        .split("\n");
      expect(log.length).toBe(1);
      const entry = JSON.parse(log[0]) as {
        origin: string;
        pathname: string;
        source: string;
      };
      expect(entry.origin).toBe("https://api.example.com");
      expect(entry.pathname).toBe("/v1");
      expect(entry.source).toBe("fetch");
    });

    it("allows a configured-origin fetch (not blocked, no violation)", async () => {
      globalThis.fetch = ((_input: unknown) =>
        Promise.resolve(new Response("ok"))) as unknown as typeof fetch;
      guard = installE2ENetworkGuard(makeEnv(root));

      // An origin in the configured allowlist must resolve and record nothing.
      await expect(
        globalThis.fetch("http://127.0.0.1:6000/v1/models")
      ).resolves.toBeDefined();
      const log = fs.existsSync(guard.violationsFile)
        ? fs.readFileSync(guard.violationsFile, "utf8").trim()
        : "";
      expect(log).toBe("");
    });

    it("blocks an unconfigured loopback origin in strict mode (default-deny)", async () => {
      let called = false;
      globalThis.fetch = ((_input: unknown) => {
        called = true;
        return Promise.resolve(new Response("ok"));
      }) as unknown as typeof fetch;
      // Strict mode: only configured origins; unconfigured loopback is blocked.
      guard = installE2ENetworkGuard(makeEnv(root), { strict: true });

      // A loopback port NOT in the allowlist is blocked just like an external host.
      await expect(
        globalThis.fetch("http://127.0.0.1:7000/v1/models")
      ).rejects.toThrow(/E2E network guard blocked/);
      expect(called).toBe(false);
      const log = fs.readFileSync(guard.violationsFile, "utf8").trim();
      expect(log).toContain("http://127.0.0.1:7000");
    });
  });
});
