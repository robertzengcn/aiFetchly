import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executeCommand } from "@/service/hooks/executors/CommandHookExecutor";
import { CommandHookDefinition, HookInput } from "@/entityTypes/hookTypes";
import { HookCommandTrustService } from "@/service/hooks/HookCommandTrustService";

const NODE = process.execPath;

function makeHook(
  overrides: Partial<CommandHookDefinition> & { command: string }
): CommandHookDefinition {
  return {
    id: "cmd-hook",
    eventName: "PreToolUse",
    source: "user",
    enabled: true,
    trusted: true,
    type: "command",
    timeoutMs: 2000,
    ...overrides,
  };
}

function makeInput(): HookInput {
  return {
    eventName: "PreToolUse",
    hookRunId: "run-1",
    source: "ai-chat-v2",
    timestamp: new Date().toISOString(),
    tool: { id: "t1", name: "shell_execute", source: "skill-registry" },
    input: { command: "ls" },
    permissionState: { allowed: true, needsPrompt: false },
  };
}

describe("CommandHookExecutor", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-cmd-"));
    HookCommandTrustService.resetForTests();
    HookCommandTrustService.setTrusted("cmd-hook", true);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFixture(name: string, body: string): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, body, "utf8");
    return p;
  }

  it("sends JSON on stdin and parses JSON output", async () => {
    const fixture = writeFixture(
      "echo.js",
      `let body='';process.stdin.on('data',c=>body+=c);process.stdin.on('end',()=>{const input=JSON.parse(body);process.stdout.write(JSON.stringify({additionalContext:'saw '+input.tool.name}));});`
    );
    const hook = makeHook({ command: `${NODE} ${fixture}` });
    const r = await executeCommand({ hook, input: makeInput() });
    expect(r.result.error).toBeUndefined();
    expect(r.result.output?.additionalContext).toBe("saw shell_execute");
  });

  it("rejects invalid JSON output as an error", async () => {
    const fixture = writeFixture(
      "bad.js",
      `process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write('not json');});setInterval(()=>{},1000);process.stdin.on('data',()=>{});`
    );
    // Make the script exit after writing garbage.
    const fixture2 = writeFixture(
      "bad2.js",
      `let body='';process.stdin.on('data',c=>body+=c);process.stdin.on('end',()=>{process.stdout.write('not json {}');process.exit(0);});`
    );
    const hook = makeHook({ command: `${NODE} ${fixture2}` });
    const r = await executeCommand({ hook, input: makeInput() });
    expect(r.result.error).toBeDefined();
    expect(r.result.error?.message).toMatch(/JSON/i);
  });

  it("enforces timeout and reports timedOut", async () => {
    const fixture = writeFixture(
      "slow.js",
      `process.stdin.resume();setInterval(()=>{},60000);`
    );
    const hook = makeHook({ command: `${NODE} ${fixture}`, timeoutMs: 150 });
    const r = await executeCommand({ hook, input: makeInput() });
    expect(r.result.error).toBeDefined();
    expect(r.result.error?.timedOut).toBe(true);
  });

  it("rejects untrusted hook without spawning", async () => {
    HookCommandTrustService.setTrusted("cmd-hook", false);
    const hook = makeHook({
      id: "cmd-hook",
      command: `${NODE} -e "process.stdout.write('{}')"`,
      trusted: false,
    });
    const r = await executeCommand({ hook, input: makeInput() });
    expect(r.result.error).toBeDefined();
    expect(r.result.error?.message).toMatch(/not trusted/i);
    expect(r.durationMs).toBeLessThan(50);
  });

  it("rejects hook with static trusted=true but no dynamic trust grant", async () => {
    HookCommandTrustService.setTrusted("cmd-hook", false);
    const hook = makeHook({
      id: "cmd-hook",
      command: `${NODE} -e "process.stdout.write('{}')"`,
      trusted: true,
    });
    const r = await executeCommand({ hook, input: makeInput() });
    expect(r.result.error).toBeDefined();
    expect(r.result.error?.message).toMatch(/not trusted/i);
  });

  it("passes only allowlisted env vars to the child", async () => {
    const fixture = writeFixture(
      "env.js",
      `let body='';process.stdin.on('data',c=>body+=c);process.stdin.on('end',()=>{const keys=Object.keys(process.env).sort();process.stdout.write(JSON.stringify({additionalContext:keys.join(',')}));});`
    );
    process.env.LEAK_ME = "super-secret-value";
    const hook = makeHook({ command: `${NODE} ${fixture}` });
    try {
      const r = await executeCommand({ hook, input: makeInput() });
      expect(r.result.error).toBeUndefined();
      const ctx = r.result.output?.additionalContext ?? "";
      // Allowlist should not contain LEAK_ME.
      expect(ctx).not.toContain("LEAK_ME");
      // PATH/HOME should be present (these exist in test env).
      // On some CI systems HOME may be unset; only assert absence of LEAK_ME.
      // (The default allowlist is enforced; secret is dropped.)
    } finally {
      delete process.env.LEAK_ME;
    }
  });

  it("honors a custom envAllowlist", async () => {
    const fixture = writeFixture(
      "env2.js",
      `let body='';process.stdin.on('data',c=>body+=c);process.stdin.on('end',()=>{const keys=Object.keys(process.env).sort();process.stdout.write(JSON.stringify({additionalContext:keys.join(',')||'(none)'}));});`
    );
    process.env.HOOK_TEST_CUSTOM = "abc";
    const hook = makeHook({
      command: `${NODE} ${fixture}`,
      envAllowlist: ["HOOK_TEST_CUSTOM"],
    });
    try {
      const r = await executeCommand({ hook, input: makeInput() });
      const ctx = r.result.output?.additionalContext ?? "";
      expect(ctx).toContain("HOOK_TEST_CUSTOM");
      expect(ctx).not.toContain("PATH");
    } finally {
      delete process.env.HOOK_TEST_CUSTOM;
    }
  });

  it("caps stdout size and reports an error", async () => {
    const fixture = writeFixture(
      "flood.js",
      `let body='';process.stdin.on('data',c=>body+=c);process.stdin.on('end',()=>{const chunk='a'.repeat(64*1024);for(let i=0;i<10;i++)process.stdout.write(chunk);});`
    );
    const hook = makeHook({ command: `${NODE} ${fixture}`, timeoutMs: 5000 });
    const r = await executeCommand({ hook, input: makeInput() });
    expect(r.result.error).toBeDefined();
    expect(r.result.error?.message).toMatch(/stdout cap|exceeded/i);
  });

  it("treats empty stdout as an empty object (no-op hook)", async () => {
    const fixture = writeFixture(
      "noop.js",
      `process.stdin.resume();process.stdin.on('end',()=>{process.exit(0);});`
    );
    const hook = makeHook({ command: `${NODE} ${fixture}` });
    const r = await executeCommand({ hook, input: makeInput() });
    expect(r.result.error).toBeUndefined();
    expect(r.result.output).toEqual({});
  });
});
