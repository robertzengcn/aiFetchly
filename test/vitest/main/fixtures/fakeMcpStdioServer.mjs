// test/vitest/main/fixtures/fakeMcpStdioServer.mjs
//
// A minimal newline-delimited JSON-RPC MCP server used by the
// SupervisedStdioTransport / MCPClient / MCPSessionPool tests.
//
// Behaviors are selected via argv flags:
//   --echo-cjk            tools/call returns a CJK string as text content
//   --delay-ms <n>        delay every tools/call response by <n> ms
//   --never-initialize    never answer initialize (timeout tests)
//   --bad-protocol        answer initialize with an unsupported version
//   --oversize            answer tools/call with a >cap line
//   --structured          answer tools/call with structuredContent
//   --multi-block         answer tools/call with text+image blocks
//   --env-report          tools/call reports sanitized child env as structuredContent
//   --die-after-init      exit(0) right after initialize completes

let delayMs = 0;
const behaviors = new Set();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--delay-ms") {
    delayMs = Number(process.argv[++i]) || 0;
  } else {
    behaviors.add(arg);
  }
}

const PROTOCOL_VERSION = behaviors.has("--bad-protocol")
  ? "1999-01-01"
  : "2024-11-05";

let buffer = "";
process.stdin.setEncoding("utf8");

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx = buffer.indexOf("\n");
  while (idx >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.trim()) {
      handleMessage(line);
    }
    idx = buffer.indexOf("\n");
  }
});

function send(message) {
  const line = JSON.stringify(message) + "\n";
  if (behaviors.has("--split-write")) {
    // Split in the middle of a multi-byte UTF-8 sequence so the client must
    // buffer bytes across chunk boundaries to decode correctly.
    const bytes = Buffer.from(line, "utf8");
    const mid = Math.floor(bytes.length / 2);
    let i = mid;
    while (i < bytes.length && (bytes[i] & 0xc0) !== 0xc0) i++; // find a start byte
    if (i >= bytes.length) i = bytes.length; // no multi-byte char found
    else i += 1; // split right after the start byte, before continuation bytes
    process.stdout.write(bytes.subarray(0, i));
    setTimeout(() => process.stdout.write(bytes.subarray(i)), 5);
    return;
  }
  process.stdout.write(line);
}

function handleMessage(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) {
    // Notification (e.g. notifications/initialized) — no response.
    // R9 T04: --die-after-init must die AFTER the SDK's initialized
    // notification ARRIVES, not right after the initialize response: an
    // immediate exit raced the notification write and turned the
    // deterministic "rejects pending requests" contract into a coin-flip
    // (the EPIPE could land on connect()'s awaited notification send and
    // reject the handshake, or later on a pending call).
    if (
      behaviors.has("--die-after-init") &&
      message.method === "notifications/initialized"
    ) {
      process.exit(0);
    }
    return;
  }
  const { id, method, params } = message;
  switch (method) {
    case "initialize":
      if (behaviors.has("--never-initialize")) {
        return; // never answer: connect-timeout tests
      }
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "fake-mcp", version: "0.0.1" },
        },
      });
      // R9 T04: the exit moved to the notifications/initialized handler —
      // dying here raced the SDK's awaited notification send (the EPIPE
      // could reject connect() itself).
      break;
    case "tools/list":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "echo",
              description: "Echo the arguments back",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
      break;
    case "tools/call": {
      const respond = () => {
        if (behaviors.has("--env-report")) {
          // Trusted-launch tests: report the sanitized child environment as
          // structuredContent (ELECTRON_RUN_AS_NODE injection + allowlist).
          send({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: "env" }],
              structuredContent: {
                runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
                myVar: process.env.MY_VAR ?? null,
              },
            },
          });
          return;
        }
        if (behaviors.has("--oversize")) {
          const padding = "x".repeat(9 * 1024 * 1024);
          send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: padding }] } });
          return;
        }
        if (behaviors.has("--echo-cjk")) {
          send({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: "你好，世界！🎉" }] },
          });
          return;
        }
        if (behaviors.has("--structured")) {
          send({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: "ignored" }],
              structuredContent: { ok: true, args: params?.arguments ?? null },
            },
          });
          return;
        }
        if (behaviors.has("--multi-block")) {
          send({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                { type: "text", text: "caption" },
                { type: "image", mimeType: "image/png", data: "aGk=" },
              ],
            },
          });
          return;
        }
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ echoed: params?.arguments ?? null }) }],
          },
        });
      };
      if (delayMs > 0) setTimeout(respond, delayMs);
      else respond();
      break;
    }
    default:
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } });
  }
}
