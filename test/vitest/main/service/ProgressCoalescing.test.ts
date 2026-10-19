import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MCP_PROGRESS_MAX_PER_SECOND,
  ProgressRateLimiter,
  redactProgressText,
} from "@/modules/mcp/progressCoalescing";
import {
  PluginToolPolicyRegistry,
  setPluginToolPolicyRegistryForTest,
} from "@/service/PluginToolPolicyRegistry";
import { setPluginBrowserCapabilityServiceForTest } from "@/service/PluginBrowserCapabilityService";
import {
  buildToolExecutionDiagnostics,
  envelopeErrorIdentity,
} from "@/service/ToolExecutionDiagnostics";

describe("ProgressRateLimiter (G02)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first burst of four and coalesces the rest to the latest", () => {
    const limiter = new ProgressRateLimiter();
    const delivered: string[] = [];

    for (let i = 1; i <= 6; i += 1) {
      const label = `#${i}`;
      limiter.schedule(() => delivered.push(label));
    }
    // 4 delivered immediately; #5/#6 coalesced with the LATEST retained.
    expect(delivered).toEqual(["#1", "#2", "#3", "#4"]);

    clk_jump_then_flush: {
      // The earliest emission is ~t0; the window empties at t0+1000.
      vi.advanceTimersByTime(1000);
    }
    expect(delivered).toEqual(["#1", "#2", "#3", "#4", "#6"]);
  });

  it("delivers at most four per second over a longer burst", () => {
    const limiter = new ProgressRateLimiter();
    const delivered: string[] = [];
    for (let i = 1; i <= 24; i += 1) {
      const label = `#${i}`;
      limiter.schedule(() => delivered.push(label));
      vi.advanceTimersByTime(50);
    }
    expect(delivered.length).toBeLessThanOrEqual(4 + Math.floor(24 * 50 / 250));
  });

  it("discards pending trailing updates on dispose", () => {
    const clkBase = Date.parse("2026-01-01T00:00:00Z");
    const limiter = new ProgressRateLimiter();
    const delivered: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const label = `#${i}`;
      limiter.schedule(() => delivered.push(label));
    }
    limiter.dispose();
    vi.advanceTimersByTime(1000);
    expect(delivered).toEqual(["#1", "#2", "#3", "#4"]);
    void clkBase;
  });

  it("keeps at most one pending trailing update (latest wins)", () => {
    const limiter = new ProgressRateLimiter(1);
    const delivered: string[] = [];
    limiter.schedule(() => delivered.push("first"));
    limiter.schedule(() => delivered.push("second"));
    limiter.schedule(() => delivered.push("third"));
    expect(delivered).toEqual(["first"]);
    vi.advanceTimersByTime(1000);
    expect(delivered).toEqual(["first", "third"]);
  });
});

describe("redactProgressText (G02)", () => {
  it("redacts authorization headers, api keys, passwords and tokens", () => {
    expect(
      redactProgressText("using bearer skJhkZyXsqmNIwFExmpIuVGbVkgbsjqk6yOaemlw")
    ).toBe("using bearer [redacted]");
    expect(
      redactProgressText("api_key=superSecretValue123 and token:abcdef123456")
    ).toBe("api_key=[redacted] and token:[redacted]");
  });

  it("strips userinfo from credentialed URLs", () => {
    expect(
      redactProgressText("call https://user:hunter2@example.com/api?q=chrome")
    ).toBe("call https://[redacted]@example.com/api?q=chrome");
  });

  it("drops control characters so log lines cannot be forged", () => {
    expect(redactProgressText("line\u0000broken\tvalue")).toBe(
      "linebrokenvalue"
    );
  });

  it("redacts long opaque token runs but keeps normal words", () => {
    const redacted = redactProgressText("ok=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp");
    expect(redacted).toContain("[redacted]");
    // Over-redaction is acceptable — the whole run including the "ok="
    // assignment is replaced rather than partially kept.
    expect(redacted).toMatch(/^\[redacted\]$/);
    const plain = redactProgressText("Collected 120 of 200 records");
    expect(plain).toBe("Collected 120 of 200 records");
  });

  it("bounds the message length", () => {
    expect(redactProgressText("x".repeat(400)).length).toBeLessThanOrEqual(201);
  });
});

describe("plugin identity in the policy registry (G02)", () => {
  beforeEach(() => {
    setPluginToolPolicyRegistryForTest(undefined);
    setPluginBrowserCapabilityServiceForTest(undefined);
  });

  afterEach(() => {
    setPluginToolPolicyRegistryForTest(undefined);
    setPluginBrowserCapabilityServiceForTest(undefined);
  });

  it("records the registered version + manifest generation and follows unregister", () => {
    const reg = new PluginToolPolicyRegistry();
    const manifest = {
      name: "diag-plugin",
      version: "1.2.3",
      toolPolicies: {
        "scraper/scrape_records": {
          contractVersion: 1,
          timeoutClass: "async" as const,
          maxRunMs: 1_800_000,
          supportsProgress: true,
          supportsPartialResult: true,
          cancellable: true,
          maxConcurrentPerConversation: 1,
        },
      },
    };
    reg.registerFromManifest("diag-plugin", manifest);
    expect(reg.getPluginVersion("diag-plugin")).toBe("1.2.3");
    const gen = reg.getPluginGeneration("diag-plugin");
    expect(gen).toMatch(/^[0-9a-f]{12}$/);

    // An update re-registration changes the generation.
    reg.registerFromManifest("diag-plugin", { ...manifest, version: "2.0.0" });
    expect(reg.getPluginVersion("diag-plugin")).toBe("2.0.0");
    expect(reg.getPluginGeneration("diag-plugin")).not.toBe(gen);
  });
});

describe("execution diagnostics record (G02)", () => {
  beforeEach(() => {
    setPluginToolPolicyRegistryForTest(undefined);
    setPluginBrowserCapabilityServiceForTest(undefined);
  });

  afterEach(() => {
    setPluginToolPolicyRegistryForTest(undefined);
    setPluginBrowserCapabilityServiceForTest(undefined);
  });

  it("contains approved identity/counts/state only, with redacted errors", () => {
    const reg = new PluginToolPolicyRegistry();
    reg.registerFromManifest("diag-plugin", {
      name: "diag-plugin",
      version: "1.2.3",
      capabilities: { fileArtifacts: ["json", "csv"] },
      toolPolicies: {
        "scraper/scrape_records": {
          contractVersion: 1,
          timeoutClass: "async" as const,
          maxRunMs: 1_800_000,
          supportsProgress: true,
          supportsPartialResult: true,
          cancellable: true,
          maxConcurrentPerConversation: 1,
        },
      },
    });
    setPluginToolPolicyRegistryForTest(reg);

    const record = buildToolExecutionDiagnostics({
      toolName: "mcp__diag-plugin__scraper__scrape_records",
      toolCallId: "exec-1",
      conversationId: "conv-1",
      pluginName: "diag-plugin",
      outcome: "failed",
      attempt: "retry_after_delay",
      durationMs: 1234.6,
      errorCode: "PATTERN_POLICY",
      errorMessage: "crashed https://user:secret@host/db x=abcdef0123456789abcdef0123456789",
      artifactsRegistered: 1,
      artifactErrors: 2,
      resultRecordCount: 3,
      cleanupPending: false,
    });

    expect(record.pluginVersion).toBe("1.2.3");
    expect(String(record.pluginGeneration)).toMatch(/^[0-9a-f]{12}$/);
    expect(record.artifactsDeclared).toEqual(["json", "csv"]);
    // No browser capability declared → browser state stays unknown (null).
    expect(record.browserDeclared).toBe(false);
    expect(record.browserCompatible).toBe(null);
    expect(record.errorCode).toBe("PATTERN_POLICY");
    expect(record.errorMessage).not.toContain("secret@");
    expect(record.errorMessage).toContain("[redacted]");
    // No raw envelope keys can ever appear.
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('candidates"');
    expect(serialized).not.toContain('stagingDir"');
  });

  it("fails conservatively for an unregistered plugin", () => {
    const record = buildToolExecutionDiagnostics({
      toolName: "mcp__ghost__srv__tool",
      toolCallId: "exec-2",
      conversationId: "conv-2",
      pluginName: "ghost",
      outcome: "cancelled",
      attempt: "initial",
      durationMs: 0,
      errorCode: null,
      errorMessage: null,
      artifactsRegistered: 0,
      artifactErrors: 0,
      resultRecordCount: null,
      cleanupPending: true,
    });
    expect(record.pluginVersion).toBe(null);
    expect(record.pluginGeneration).toBe(null);
  });
});

describe("envelopeErrorIdentity (G02)", () => {
  it("extracts bounded error identity without any payload content", () => {
    const identity = envelopeErrorIdentity({
      success: false,
      error: {
        code: "X".repeat(300),
        message: "boom".repeat(200),
      },
      count: 7,
    });
    expect(identity.code).toBe("X".repeat(120));
    expect(identity.message).toHaveLength(200);
    expect(identity.recordCount).toBe(7);
  });

  it("returns nulls for non-envelope results", () => {
    expect(envelopeErrorIdentity(null)).toEqual({
      code: null,
      message: null,
      recordCount: null,
    });
    expect(envelopeErrorIdentity("plain text")).toEqual({
      code: null,
      message: null,
      recordCount: null,
    });
  });
});
