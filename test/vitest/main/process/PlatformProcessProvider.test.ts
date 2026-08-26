/**
 * Platform process provider tests (design §7.4, §21.2).
 *
 * POSIX cases execute live here. Windows-specific behavior (env
 * preservation, UTF-16LE decode, empty-output sentinel, taskkill tree
 * termination, pwsh fallback) is covered by pure-function tests plus
 * provider behavior that runs identically on any platform through the
 * shared capture core; the real-Windows runner matrix is a CI gate that
 * runs these same describe blocks on a Windows VM.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  PosixProcessProvider,
  WindowsProcessProvider,
  buildChildEnvironment,
  decodeProcessOutput,
  getPlatformProcessProvider,
  normalizeProcessLineEndings,
  resolveShellInterpreter,
} from "@/service/process";

const POSIX = process.platform !== "win32";

function tmpCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "procprov-"));
}

describe("decodeProcessOutput", () => {
  it("decodes UTF-8 with BOM and strips the BOM", () => {
    const buf = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("sentinel-utf8", "utf-8"),
    ]);
    expect(decodeProcessOutput(buf)).toBe("sentinel-utf8");
  });

  it("decodes UTF-16LE with BOM and strips the BOM", () => {
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("sentinel-utf16", "utf16le"),
    ]);
    expect(decodeProcessOutput(buf)).toBe("sentinel-utf16");
  });

  it("detects BOM-less UTF-16LE by NUL-byte heuristic", () => {
    const buf = Buffer.from("hello windows powershell", "utf16le");
    expect(decodeProcessOutput(buf)).toBe("hello windows powershell");
  });

  it("decodes plain UTF-8 unchanged", () => {
    expect(decodeProcessOutput(Buffer.from("plain", "utf-8"))).toBe("plain");
  });

  it("returns empty string for zero bytes", () => {
    expect(decodeProcessOutput(Buffer.alloc(0))).toBe("");
  });
});

describe("normalizeProcessLineEndings", () => {
  it("normalizes CRLF without erasing content", () => {
    expect(normalizeProcessLineEndings("a\r\nb\r\nc")).toBe("a\nb\nc");
    expect(normalizeProcessLineEndings("a\nb")).toBe("a\nb");
  });
});

describe("buildChildEnvironment", () => {
  it("removes known secret keys but preserves required Windows variables", () => {
    const env = buildChildEnvironment({
      PATH: "/usr/bin",
      PATHEXT: ".COM;.EXE",
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\system32\\cmd.exe",
      TEMP: "C:\\Temp",
      TMP: "C:\\Temp",
      USERPROFILE: "C:\\Users\\u",
      APPDATA: "C:\\Users\\u\\AppData",
      LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
      ELEVENLABS_API_KEY: "sk-secret",
      OPENAI_API_KEY: "sk-secret-2",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.SystemRoot).toBe("C:\\Windows");
    expect(env.ComSpec).toBeDefined();
    expect(env.ELEVENLABS_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("applies explicit overrides last", () => {
    const env = buildChildEnvironment(
      { PATH: "/usr/bin" } as unknown as NodeJS.ProcessEnv,
      { CUSTOM_VAR: "value" }
    );
    expect(env.CUSTOM_VAR).toBe("value");
  });
});

describe("resolveShellInterpreter", () => {
  it("resolves bash -c on POSIX for auto", () => {
    if (!POSIX) return;
    const r = resolveShellInterpreter("auto");
    expect(r.executable).toBe("/bin/bash");
    expect(r.args).toEqual(["-c"]);
  });

  it("resolves PowerShell with -NoLogo -NoProfile -NonInteractive -Command", () => {
    const r = resolveShellInterpreter("powershell");
    expect(r.args).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
    ]);
  });

  it("resolves cmd with /d /s /c on Windows", () => {
    const r = resolveShellInterpreter("cmd");
    if (process.platform === "win32") {
      expect(r.executable).toBe("cmd.exe");
      expect(r.args).toEqual(["/d", "/s", "/c"]);
    } else {
      expect(r.args).toEqual(["-c"]);
    }
  });
});

describe("PosixProcessProvider (live)", () => {
  const provider = new PosixProcessProvider();
  const cwd = tmpCwd();

  it("captures stdout for Write-Output-equivalent echo", async () => {
    if (!POSIX) return;
    const r = await provider.execute({
      executable: "/bin/bash",
      args: ["-c", "echo sentinel"],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 10_000,
      outputLimitBytes: 1_000_000,
      expectOutput: true,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("sentinel");
    expect(r.stdoutBytes).toBeGreaterThan(0);
    expect(r.diagnosticCode).toBeUndefined();
  }, 20_000);

  it("round-trips unicode (CJK + emoji) exactly", async () => {
    if (!POSIX) return;
    const text = "你好世界 🎬 video-use";
    const r = await provider.execute({
      executable: "/bin/bash",
      args: ["-c", `printf '%s' "${text}"`],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 10_000,
      outputLimitBytes: 1_000_000,
      expectOutput: true,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(text);
  }, 20_000);

  it("keeps stdout and stderr independently with exit code", async () => {
    if (!POSIX) return;
    const r = await provider.execute({
      executable: "/bin/bash",
      args: ["-c", "echo out-msg; echo err-msg >&2; exit 3"],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 10_000,
      outputLimitBytes: 1_000_000,
    });
    expect(r.exitCode).toBe(3);
    expect(r.stdout).toContain("out-msg");
    expect(r.stderr).toContain("err-msg");
  }, 20_000);

  it("times out and terminates the process tree", async () => {
    if (!POSIX) return;
    const r = await provider.execute({
      executable: "/bin/bash",
      args: ["-c", "sleep 30 & wait"],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 1_500,
      outputLimitBytes: 1_000_000,
    });
    expect(r.timedOut).toBe(true);
    expect(r.diagnosticCode).toBe("PROCESS_TIMEOUT");
    expect(r.durationMs).toBeLessThan(10_000);
  }, 20_000);

  it("flags PROCESS_OUTPUT_EMPTY_UNEXPECTED for expect-output zero-byte success", async () => {
    if (!POSIX) return;
    const r = await provider.execute({
      executable: "/bin/bash",
      args: ["-c", "true"],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 10_000,
      outputLimitBytes: 1_000_000,
      expectOutput: true,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdoutBytes).toBe(0);
    expect(r.stderrBytes).toBe(0);
    expect(r.diagnosticCode).toBe("PROCESS_OUTPUT_EMPTY_UNEXPECTED");
  }, 20_000);

  it("truncates output beyond the byte limit with metadata", async () => {
    if (!POSIX) return;
    const r = await provider.execute({
      executable: "/bin/bash",
      args: ["-c", "head -c 100000 /dev/zero | tr '\\0' 'x'"],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 10_000,
      outputLimitBytes: 1_000,
    });
    expect(r.diagnosticCode).toBe("PROCESS_OUTPUT_TRUNCATED");
    expect(r.stdoutBytes).toBeLessThanOrEqual(1_000);
  }, 20_000);

  it("reports spawn failure for a missing executable", async () => {
    const r = await provider.execute({
      executable: "/nonexistent/definitely-missing-binary",
      args: [],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 10_000,
      outputLimitBytes: 1_000,
    });
    expect(r.diagnosticCode).toBe("PROCESS_SPAWN_FAILED");
    expect(r.exitCode).toBeNull();
  }, 20_000);

  it("runs correctly in a cwd containing spaces", async () => {
    if (!POSIX) return;
    const spaced = path.join(cwd, "dir with spaces");
    fs.mkdirSync(spaced, { recursive: true });
    const r = await provider.execute({
      executable: "/bin/bash",
      args: ["-c", "pwd"],
      cwd: spaced,
      environment: buildChildEnvironment(),
      timeoutMs: 10_000,
      outputLimitBytes: 1_000_000,
      expectOutput: true,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(fs.realpathSync(spaced));
  }, 20_000);
});

// ---------------------------------------------------------------------------
// Windows verification matrix (PRD §16.4 / design §7.4) — runs ONLY on a
// real Windows runner. These cases are the release gate for the observed
// "exit 0 with empty output" defect; each asserts NON-EMPTY captured output.
// ---------------------------------------------------------------------------

const WINDOWS = process.platform === "win32";

describe("WindowsProcessProvider live matrix (PRD §16.4)", () => {
  const provider = new WindowsProcessProvider();
  const cwd = tmpCwd();

  const run = (command: string, expectOutput = false) =>
    provider.execute({
      executable: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 30_000,
      outputLimitBytes: 1_000_000,
      ...(expectOutput ? { expectOutput: true } : {}),
    });

  it("PowerShell: Write-Output 'sentinel' → stdout contains sentinel", async () => {
    if (!WINDOWS) return;
    const r = await run("Write-Output 'sentinel'", true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("sentinel");
    expect(r.stdoutBytes).toBeGreaterThan(0);
    expect(r.diagnosticCode).toBeUndefined();
  }, 60_000);

  it("PowerShell: Get-Content on a UTF-8 file → exact expected content", async () => {
    if (!WINDOWS) return;
    const fs = await import("fs");
    const path = await import("path");
    const file = path.join(cwd, "utf8-fixture.txt");
    fs.writeFileSync(file, "expected-utf8-content", "utf-8");
    // PowerShell accepts forward slashes in -LiteralPath, avoiding
    // backslash-escaping in the generated command string.
    const r = await run(
      `Get-Content -LiteralPath '${file.split("\\").join("/")}'`,
      true
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("expected-utf8-content");
  }, 60_000);

  it("PowerShell: unicode output round-trips", async () => {
    if (!WINDOWS) return;
    const r = await run("Write-Output '你好世界 🎬'", true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("你好世界");
  }, 60_000);

  it("PowerShell: stderr and non-zero exit stay separated", async () => {
    if (!WINDOWS) return;
    const r = await run(
      "Write-Output 'out-msg'; Write-Error 'err-msg'; exit 3"
    );
    expect(r.exitCode).toBe(3);
    expect(r.stdout).toContain("out-msg");
    expect(r.stderr).toContain("err-msg");
  }, 60_000);

  it("cmd: echo sentinel → stdout contains sentinel", async () => {
    if (!WINDOWS) return;
    const r = await provider.execute({
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", "echo cmd-sentinel"],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 30_000,
      outputLimitBytes: 1_000_000,
      expectOutput: true,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("cmd-sentinel");
    expect(r.stdoutBytes).toBeGreaterThan(0);
  }, 60_000);

  it("native Git: --version emits non-empty version output", async () => {
    if (!WINDOWS) return;
    const r = await provider.execute({
      executable: "git.exe",
      args: ["--version"],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 30_000,
      outputLimitBytes: 64 * 1024,
      expectOutput: true,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/git version/i);
  }, 60_000);

  it("timeout terminates the process tree", async () => {
    if (!WINDOWS) return;
    const r = await provider.execute({
      executable: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Sleep -Seconds 30",
      ],
      cwd,
      environment: buildChildEnvironment(),
      timeoutMs: 3_000,
      outputLimitBytes: 64 * 1024,
    });
    expect(r.timedOut).toBe(true);
    expect(r.diagnosticCode).toBe("PROCESS_TIMEOUT");
    expect(r.durationMs).toBeLessThan(20_000);
  }, 60_000);

  it("expect-output zero-byte success is flagged, never treated as verified", async () => {
    if (!WINDOWS) return;
    const r = await run("exit 0", true);
    expect(r.exitCode).toBe(0);
    expect(r.stdoutBytes).toBe(0);
    expect(r.stderrBytes).toBe(0);
    expect(r.diagnosticCode).toBe("PROCESS_OUTPUT_EMPTY_UNEXPECTED");
  }, 60_000);

  it("commands run correctly in a cwd containing spaces", async () => {
    if (!WINDOWS) return;
    const fs = await import("fs");
    const path = await import("path");
    const spaced = path.join(cwd, "dir with spaces");
    fs.mkdirSync(spaced, { recursive: true });
    const r = await provider.execute({
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", "cd"],
      cwd: spaced,
      environment: buildChildEnvironment(),
      timeoutMs: 30_000,
      outputLimitBytes: 64 * 1024,
      expectOutput: true,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("dir with spaces");
  }, 60_000);
});

describe("getPlatformProcessProvider", () => {
  it("returns the provider for the current platform", () => {
    const p = getPlatformProcessProvider();
    expect(p.kind).toBe(process.platform === "win32" ? "windows" : "posix");
  });
});
