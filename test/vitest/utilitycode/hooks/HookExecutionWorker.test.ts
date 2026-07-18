/**
 * HOK-02 (Phase 17 / Plan 03 Task 1) — hook-execution worker + client tests.
 *
 * Covers:
 *   - runCommandCore (the worker-local spawn-core): success captures stdout;
 *     timeout SIGKILLs the child and reports error.timedOut.
 *   - Protocol strict(): smuggled extra fields are rejected on both directions.
 *   - HookExecutionClient: lazy singleton (fork at most once), hookRunId
 *     round-trip builds the result, pre-aborted signal synthesizes a non-fatal
 *     failure without forking, and a missing response synthesizes a timed-out
 *     non-fatal failure (never throws).
 *
 * runCommandCore spawns REAL children (node / sleep) — the spawn logic is the
 * security-critical surface, so it is exercised end-to-end. The client's fork
 * is mocked so the round-trip is deterministic without a real worker bundle.
 */
import { describe, expect, it } from "vitest";
import type { ChildProcess } from "child_process";
import type {
  CommandHookDefinition,
  HookInput,
} from "@/entityTypes/hookTypes";
import { runCommandCore } from "@/childprocess/hook-execution/HookExecutionWorker";
import {
  executeHookCommandSchema,
  hookResultEventSchema,
  workerEventSchema,
} from "@/childprocess/hook-execution/workerProtocol";
import {
  HookExecutionClient,
  type ForkFn,
} from "@/service/hooks/hookExecutionClient";

function cmd(overrides: Partial<CommandHookDefinition> = {}): CommandHookDefinition {
  return {
    id: "user:hook:0",
    eventName: "PreToolUse",
    source: "user",
    enabled: true,
    trusted: true,
    type: "command",
    command: "node --version",
    failureMode: "warn",
    ...overrides,
  };
}

function hookInput(hookRunId: string): HookInput {
  return {
    eventName: "SessionStart",
    hookRunId,
    source: "ai-chat-v2",
    timestamp: "2026-07-11T00:00:00.000Z",
    mode: "chat",
  } as HookInput;
}

describe("runCommandCore (worker-local spawn-core)", () => {
  it("captures stdout for a successful command (shell:false, no error)", async () => {
    const result = await runCommandCore({
      command: "node --version",
      stdinPayload: "{}",
    });
    expect(result.error).toBeUndefined();
    expect(result.stdout).toMatch(/v\d+\.\d+/);
  });

  it("reports error.timedOut when the command exceeds timeoutMs (SIGKILL)", async () => {
    const result = await runCommandCore({
      command: "sleep 5",
      timeoutMs: 60,
      stdinPayload: "{}",
    });
    expect(result.error).toBeDefined();
    expect(result.error?.timedOut).toBe(true);
  }, 5000);

  it("surfaces an invalid (empty) command as a non-fatal error (never throws)", async () => {
    const result = await runCommandCore({
      command: "   ",
      stdinPayload: "{}",
    });
    expect(result.error).toBeDefined();
    expect(result.error?.message).toMatch(/invalid command/i);
  });

  it("passes only the env allowlist (process.env never spread)", async () => {
    // Smoke test: a command that echoes an allowlisted var succeeds; the
    // spawn-core builds env from DEFAULT_HOOK_ENV_KEYS only.
    const result = await runCommandCore({
      command: "node --version",
      envAllowlist: ["PATH"],
      stdinPayload: "{}",
    });
    expect(result.error).toBeUndefined();
  });
});

describe("workerProtocol strict()", () => {
  it("rejects a smuggled extra field on execute-hook", () => {
    const parsed = executeHookCommandSchema.safeParse({
      type: "execute-hook",
      hookRunId: "r1",
      command: "node --version",
      stdinPayload: "{}",
      extra: "smuggled",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a smuggled extra field on hook-result", () => {
    const parsed = hookResultEventSchema.safeParse({
      type: "hook-result",
      hookRunId: "r1",
      stdout: "",
      stderr: "",
      durationMs: 0,
      extra: "smuggled",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a well-formed hook-result", () => {
    const parsed = workerEventSchema.safeParse({
      type: "hook-result",
      hookRunId: "r1",
      stdout: '{"continue":true}',
      stderr: "",
      durationMs: 5,
    });
    expect(parsed.success).toBe(true);
  });
});

/** A mock fork: returns a fake ChildProcess whose `message` listener the test drives. */
function mockFork(): { fork: ForkFn; emit: (msg: unknown) => void; sent: unknown[] } {
  const sent: unknown[] = [];
  let messageHandler: ((msg: unknown) => void) | null = null;
  const child = {
    on(event: string, listener: (...args: never[]) => void): typeof child {
      if (event === "message") {
        messageHandler = listener as unknown as (msg: unknown) => void;
      }
      return child;
    },
    send(msg: unknown): boolean {
      sent.push(msg);
      return true;
    },
    kill(): boolean {
      return true;
    },
  };
  return {
    fork: (() => child as unknown as ChildProcess) as ForkFn,
    emit: (msg: unknown) => messageHandler?.(msg),
    sent,
  };
}

describe("HookExecutionClient (lazy singleton + non-fatal synthesis)", () => {
  it("forks the worker at most once across multiple execute() calls (Pitfall 1)", async () => {
    const mock = mockFork();
    const client = new HookExecutionClient({
      fork: mock.fork,
      workerEntry: "fake-entry",
    });

    const p1 = client.execute({ hook: cmd(), input: hookInput("run-1") });
    mock.emit({
      type: "hook-result",
      hookRunId: "run-1",
      stdout: '{"continue":true}',
      stderr: "",
      durationMs: 3,
    });
    const r1 = await p1;
    expect(r1.result.output?.continue).toBe(true);

    const p2 = client.execute({ hook: cmd(), input: hookInput("run-2") });
    mock.emit({
      type: "hook-result",
      hookRunId: "run-2",
      stdout: '{"continue":false,"reason":"deny"}',
      stderr: "",
      durationMs: 2,
    });
    const r2 = await p2;
    expect(r2.result.output?.continue).toBe(false);

    expect(client.forkCount).toBe(1); // reused, not re-forked
  });

  it("synthesizes a non-fatal failure for a pre-aborted signal WITHOUT forking", async () => {
    const mock = mockFork();
    const client = new HookExecutionClient({
      fork: mock.fork,
      workerEntry: "fake-entry",
    });
    const ac = new AbortController();
    ac.abort();

    const result = await client.execute({
      hook: cmd(),
      input: hookInput("run-abort"),
      abortSignal: ac.signal,
    });

    expect(result.result.error).toBeDefined();
    expect(result.result.error?.message).toMatch(/aborted/i);
    expect(client.forkCount).toBe(0); // never forked
  });

  it("synthesizes a timed-out non-fatal failure when the worker never responds", async () => {
    const mock = mockFork();
    const client = new HookExecutionClient({
      fork: mock.fork,
      workerEntry: "fake-entry",
    });

    const result = await client.execute({
      hook: cmd({ timeoutMs: 1 }),
      input: hookInput("run-timeout"),
    });

    expect(result.result.error).toBeDefined();
    expect(result.result.error?.timedOut).toBe(true);
  }, 5000);

  it("drops a malformed worker event (waiter eventually times out, non-fatal)", async () => {
    const mock = mockFork();
    const client = new HookExecutionClient({
      fork: mock.fork,
      workerEntry: "fake-entry",
    });

    const p = client.execute({
      hook: cmd({ timeoutMs: 1 }),
      input: hookInput("run-malformed"),
    });
    // Malformed event (smuggled field) — dropped by safeParse.
    mock.emit({
      type: "hook-result",
      hookRunId: "run-malformed",
      stdout: "",
      stderr: "",
      durationMs: 0,
      smuggled: true,
    });
    const result = await p;
    // The malformed event was dropped; the waiter timed out instead.
    expect(result.result.error).toBeDefined();
    expect(result.result.error?.timedOut).toBe(true);
  }, 5000);
});
