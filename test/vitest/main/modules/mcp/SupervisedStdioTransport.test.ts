// test/vitest/main/modules/mcp/SupervisedStdioTransport.test.ts
//
// Phase 0 tests (design §14.2): SDK transport handshake, chunked multi-byte
// UTF-8, content-block preservation, protocol-version fail-closed, message
// caps, and graceful process cleanup. These run the real SDK Client over the
// real SupervisedStdioTransport against a spawned fake MCP stdio server.
import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import * as fs from "fs";
import * as os from "os";
import {
  PluginMcpRuntimeResolver,
  setPluginMcpRuntimeResolverForTest,
} from "@/service/PluginMcpRuntimeResolver";
import { MCPClient } from "@/modules/MCPClient";
import {
  SupervisedStdioTransport,
  McpMessageTooLargeError,
} from "@/modules/mcp/SupervisedStdioTransport";
import {
  buildSanitizedChildEnv,
  isDeniedEnvName,
  assertShellFreeArgv,
} from "@/modules/mcp/mcpSpawnPolicy";
import { Client as McpSdkClient } from "@modelcontextprotocol/sdk/client/index.js";

const FIXTURE = join(__dirname, "..", "..", "fixtures", "fakeMcpStdioServer.mjs");

function serverClient(flags: string[] = [], extra: Record<string, unknown> = {}) {
  return new MCPClient({
    transport: "stdio",
    command: process.execPath,
    args: [FIXTURE, ...flags],
    timeout: 8_000,
    ...extra,
  });
}

const openedClients: MCPClient[] = [];
function track(client: MCPClient): MCPClient {
  openedClients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(
    openedClients.splice(0).map((client) => client.disconnect().catch(() => undefined))
  );
});

describe("mcpSpawnPolicy", () => {
  it("keeps only allowlisted process.env entries", () => {
    const env = buildSanitizedChildEnv(undefined);
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it("blocks hijacking env names from caller config", () => {
    const env = buildSanitizedChildEnv({
      MY_VAR: "ok",
      LD_PRELOAD: "/evil.so",
      NODE_OPTIONS: "--require /evil.js",
      ELECTRON_RUN_AS_NODE: "1",
      AIFETCHLY_SECRET: "x",
    });
    expect(env.MY_VAR).toBe("ok");
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.AIFETCHLY_SECRET).toBeUndefined();
  });

  it("isDeniedEnvName is case-insensitive", () => {
    expect(isDeniedEnvName("node_options")).toBe(true);
    expect(isDeniedEnvName("dyld_insert_libraries")).toBe(true);
    expect(isDeniedEnvName("safe")).toBe(false);
  });

  it("rejects shell metacharacters in commands", () => {
    expect(() => assertShellFreeArgv("echo `rm -rf /`", [])).toThrow();
    expect(() => assertShellFreeArgv("a;b", [])).toThrow();
    expect(() => assertShellFreeArgv("", [])).toThrow();
    expect(() => assertShellFreeArgv("node", ["-e", "console.log(1)"])).not.toThrow();
  });
});

describe("SupervisedStdioTransport + MCPClient (stdio, official SDK)", () => {
  it("completes the full handshake and lists tools", async () => {
    const client = track(serverClient());
    await client.connect();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("echo");
    await client.disconnect();
  });

  it("preserves multi-byte UTF-8 split across stdout chunks", async () => {
    const client = track(serverClient(["--split-write", "--echo-cjk"]));
    await client.connect();
    const result = await client.callToolContent("echo", {});
    const text = result.content.find((b) => b.type === "text");
    expect(text && text.type === "text" ? text.text : "").toBe("你好，世界！🎉");
    await client.disconnect();
  });

  it("preserves every content block and structuredContent", async () => {
    const client = track(serverClient(["--multi-block"]));
    await client.connect();
    const result = await client.callToolContent("echo", {});
    expect(result.content.map((b) => b.type)).toEqual(["text", "image"]);
    const image = result.content[1];
    if (image.type !== "image") throw new Error("expected image block");
    expect(image.mimeType).toBe("image/png");
    expect(image.data).toBe("aGk=");

    const structured = track(serverClient(["--structured"]));
    await structured.connect();
    const structuredResult = await structured.callToolContent("echo", {
      kind: "check",
    });
    expect(structuredResult.structuredContent).toMatchObject({
      ok: true,
      args: { kind: "check" },
    });
  });

  it("routes structuredContent through the compat callTool shape", async () => {
    const client = track(serverClient(["--structured"]));
    await client.connect();
    const result = await client.callTool("echo", { a: 1 });
    expect(result).toMatchObject({ ok: true, args: { a: 1 } });
  });

  it("fails closed on an unsupported negotiated protocol version", async () => {
    const client = track(serverClient(["--bad-protocol"]));
    await expect(client.connect()).rejects.toThrow(/protocol version/i);
  });

  it("supports cancellation of an in-flight tool call", async () => {
    const client = track(serverClient(["--delay-ms", "5000"]));
    await client.connect();
    const controller = new AbortController();
    const promise = client.callToolContent("echo", {}, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow();
  });

  it("rejects a send exceeding the message cap", async () => {
    const transport = new SupervisedStdioTransport({
      command: process.execPath,
      args: [FIXTURE],
      maxMessageBytes: 1024,
    });
    const client = new McpSdkClient(
      { name: "aiFetchly", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
    await expect(
      transport.send({
        jsonrpc: "2.0",
        id: 999,
        method: "tools/call",
        params: { name: "echo", arguments: { big: "x".repeat(64 * 1024) } },
      })
    ).rejects.toBeInstanceOf(McpMessageTooLargeError);
    await client.close();
  });

  it("closes the transport and evicts an oversize inbound line", async () => {
    const client = track(serverClient(["--oversize"], { timeout: 8_000 }));
    await client.connect();
    await expect(client.callToolContent("echo", {})).rejects.toThrow();
    await client.disconnect();
  });

  it("rejects pending requests when the server exits", async () => {
    const client = track(serverClient(["--die-after-init"]));
    await client.connect();
    // The server exits immediately after initialize; the next call must
    // reject rather than hang.
    await expect(client.listTools()).rejects.toThrow();
  });
});

describe("trusted host-runtime launch (aifetchly-node)", () => {
  it("spawns the host executable with the validated entry and injects ELECTRON_RUN_AS_NODE after sanitization", async () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), "yp-trust-"));
    const pluginRoot = join(tmp, "demo-plugin");
    fs.mkdirSync(join(pluginRoot, "dist"), { recursive: true });
    // Entry wrapper: enables env reporting on the shared fixture.
    fs.writeFileSync(
      join(pluginRoot, "dist", "entry.mjs"),
      `import { pathToFileURL } from "node:url";
process.argv.push("--env-report");
await import(pathToFileURL(${JSON.stringify(FIXTURE)}).href);`
    );
    const restore = () => fs.rmSync(tmp, { recursive: true, force: true });
    try {
      setPluginMcpRuntimeResolverForTest(
        new PluginMcpRuntimeResolver({
          tmpRoot: join(tmp, "ctx"),
          installRootFor: () => pluginRoot,
          executionIdFactory: () => "trust-exec-1",
        })
      );
      const client = track(
        new MCPClient({
          transport: "stdio",
          command: "ignored-in-runtime-mode",
          timeout: 8_000,
          // Declaration-supplied ELECTRON_RUN_AS_NODE must be REJECTED by the
          // sanitizer; the trusted injection then supplies "1".
          env: { MY_VAR: "hello", ELECTRON_RUN_AS_NODE: "0" },
          hostRuntime: {
            pluginName: "demo-plugin",
            entry: "dist/entry.mjs",
          },
        })
      );
      await client.connect();
      const tools = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("echo");

      const result = await client.callToolContent("echo", {});
      expect(result.structuredContent).toMatchObject({
        runAsNode: "1",
        myVar: "hello",
      });
      await client.disconnect();
    } finally {
      setPluginMcpRuntimeResolverForTest(undefined);
      restore();
    }
  });

  it("rejects a runtime entry that escapes the plugin root", async () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), "yp-trust-escape-"));
    const pluginRoot = join(tmp, "demo-plugin");
    fs.mkdirSync(pluginRoot, { recursive: true });
    try {
      setPluginMcpRuntimeResolverForTest(
        new PluginMcpRuntimeResolver({
          tmpRoot: join(tmp, "ctx"),
          installRootFor: () => pluginRoot,
        })
      );
      const client = track(
        new MCPClient({
          transport: "stdio",
          command: "unused",
          timeout: 8_000,
          hostRuntime: {
            pluginName: "demo-plugin",
            entry: "../../../etc/passwd",
          },
        })
      );
      await expect(client.connect()).rejects.toThrow(/plugin root/i);
      await client.disconnect().catch(() => undefined);
    } finally {
      setPluginMcpRuntimeResolverForTest(undefined);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
