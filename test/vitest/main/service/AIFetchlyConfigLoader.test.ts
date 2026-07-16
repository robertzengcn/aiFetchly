/**
 * CFG-01 / CFG-03 / CFG-04 / CFG-05 / CFG-06 / DX-01 — loader + path-safety tests.
 *
 * Two describe blocks:
 *   - resolveConfigRelativePath (CFG-05): pure path-safety unit cases.
 *   - AIFetchlyConfigLoader (CFG-01/03/04/06, DX-01): real-disk integration-style
 *     cases. Each test builds an ephemeral fake ~/.aifetchly under os.tmpdir()
 *     and cleans up in afterEach. Nothing is mocked — the loader is pure
 *     filesystem I/O.
 */
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  AIFETCHLY_CONFIG_LIMITS,
  DEFAULT_AIFETCHLY_CONFIG_SETTINGS,
} from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import { AIFetchlyConfigLoader } from "@/service/aifetchlyConfig/AIFetchlyConfigLoader";
import { resolveConfigRelativePath } from "@/service/aifetchlyConfig/resolveConfigRelativePath";

describe("resolveConfigRelativePath (CFG-05)", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-path-"));

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("resolves a simple relative name under the root", () => {
    const r = resolveConfigRelativePath(tmpRoot, "AGENTS.md");
    expect(r).toEqual({
      ok: true,
      absolutePath: path.join(tmpRoot, "AGENTS.md"),
    });
  });

  it("resolves a nested relative path", () => {
    const r = resolveConfigRelativePath(tmpRoot, "commands/review.md");
    expect(r).toEqual({
      ok: true,
      absolutePath: path.join(tmpRoot, "commands", "review.md"),
    });
  });

  it.each([
    ["POSIX absolute", "/etc/passwd"],
    ["Windows drive absolute", "C:\\Windows\\system32"],
    ["Windows drive with forward slashes", "C:/etc/passwd"],
  ])("rejects absolute path: %s", (_label, input) => {
    const r = resolveConfigRelativePath(tmpRoot, input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.toLowerCase()).toContain("absolute");
    }
  });

  it.each([
    ["parent traversal", "../escape"],
    ["nested parent traversal", "sub/../../escape"],
    ["leading parent segment", "../../etc/passwd"],
  ])("rejects traversal: %s", (_label, input) => {
    const r = resolveConfigRelativePath(tmpRoot, input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.toLowerCase()).toContain("escape");
    }
  });

  it("rejects null bytes", () => {
    const r = resolveConfigRelativePath(tmpRoot, "AGENTS.md\0.evil");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.toLowerCase()).toContain("null");
    }
  });

  it("rejects control characters", () => {
    const r = resolveConfigRelativePath(tmpRoot, "AGENTS.md\x07");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.toLowerCase()).toContain("control");
    }
  });

  it("rejects a symlink that escapes the root", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-out-"));
    try {
      const outsideFile = path.join(outsideDir, "secret.txt");
      fs.writeFileSync(outsideFile, "secret");
      const linkPath = path.join(tmpRoot, "escape-link");
      try {
        fs.symlinkSync(outsideFile, linkPath);
      } catch {
        // symlink creation may be forbidden on some sandboxes; skip if so.
        return;
      }
      const r = resolveConfigRelativePath(tmpRoot, "escape-link");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason.toLowerCase()).toContain("escape");
      }
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("AIFetchlyConfigLoader (CFG-01, CFG-03, CFG-04, CFG-06, DX-01)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-cfg-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("CFG-01: missing global config folder returns an empty snapshot, source 'user', no diagnostics", async () => {
    const loader = new AIFetchlyConfigLoader(path.join(tmpRoot, "does-not-exist"));
    const snap = await loader.scanGlobalRoot();
    expect(snap.source).toBe("user");
    expect(snap.sourceId).toBe("user");
    expect(snap.files).toEqual([]);
    expect(snap.instructions).toEqual([]);
    expect(snap.diagnostics).toEqual([]); // missing folder is the happy path — no diagnostic
    expect(snap.commands).toEqual([]);
    expect(snap.agents).toEqual([]);
    expect(snap.hooks).toEqual([]);
    expect(snap.skills).toEqual([]);
  });

  it("CFG-01: empty config folder returns an empty snapshot", async () => {
    const loader = new AIFetchlyConfigLoader(tmpRoot);
    const snap = await loader.scanGlobalRoot();
    expect(snap.files).toEqual([]);
    expect(snap.instructions).toEqual([]);
    expect(snap.diagnostics).toEqual([]);
  });

  it("CFG-04: oversized AGENTS.md emits 'file-too-large' and excludes the file", async () => {
    const oversized = Buffer.alloc(
      AIFETCHLY_CONFIG_LIMITS.agentsMdBytes + 1,
      0x61 // 'a'
    );
    fs.writeFileSync(path.join(tmpRoot, "AGENTS.md"), oversized);
    const loader = new AIFetchlyConfigLoader(tmpRoot);
    const snap = await loader.scanGlobalRoot();
    expect(snap.files).toHaveLength(0);
    expect(snap.instructions).toHaveLength(0);
    const diag = snap.diagnostics.find((d) => d.code === "file-too-large");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("warning");
    expect(diag!.filePath).toBe("AGENTS.md");
    expect(diag!.source).toBe("user");
    expect(diag!.sourceId).toBe("user");
    expect(diag!.recoverable).toBe(true);
  });

  it("CFG-04: oversized settings.json emits 'file-too-large' too", async () => {
    const oversized = Buffer.alloc(
      AIFETCHLY_CONFIG_LIMITS.settingsJsonBytes + 1,
      0x20 // space
    );
    fs.writeFileSync(path.join(tmpRoot, "settings.json"), oversized);
    const loader = new AIFetchlyConfigLoader(tmpRoot);
    const snap = await loader.scanGlobalRoot();
    const diag = snap.diagnostics.find((d) => d.code === "file-too-large");
    expect(diag).toBeDefined();
    expect(diag!.filePath).toBe("settings.json");
  });

  it("CFG-03: invalid JSON in settings.json falls back to DEFAULT + emits warning", async () => {
    fs.writeFileSync(path.join(tmpRoot, "settings.json"), "{ not valid json");
    const loader = new AIFetchlyConfigLoader(tmpRoot);
    const snap = await loader.scanGlobalRoot();
    const diag = snap.diagnostics.find((d) => d.code === "settings-json-invalid");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("warning");
    expect(loader.getSettings()).toEqual(DEFAULT_AIFETCHLY_CONFIG_SETTINGS);
  });

  it("CFG-03: wrong-typed field in settings.json fails validation + falls back to DEFAULT", async () => {
    fs.writeFileSync(
      path.join(tmpRoot, "settings.json"),
      JSON.stringify({ commandsEnabled: "yes" }) // wrong type
    );
    const loader = new AIFetchlyConfigLoader(tmpRoot);
    const snap = await loader.scanGlobalRoot();
    expect(
      snap.diagnostics.some((d) => d.code === "settings-json-invalid")
    ).toBe(true);
    expect(loader.getSettings()).toEqual(DEFAULT_AIFETCHLY_CONFIG_SETTINGS);
  });

  it("CFG-03: valid settings.json merges over defaults; unknown fields ignored", async () => {
    fs.writeFileSync(
      path.join(tmpRoot, "settings.json"),
      JSON.stringify({
        commandsEnabled: false,
        hooksEnabled: true,
        unknownField: 42,
      })
    );
    const loader = new AIFetchlyConfigLoader(tmpRoot);
    await loader.scanGlobalRoot();
    const s = loader.getSettings();
    expect(s.commandsEnabled).toBe(false); // overridden
    expect(s.hooksEnabled).toBe(true); // overridden
    expect(s.agentsEnabled).toBe(true); // default preserved
    expect(s.workspaceConfigEnabled).toBe(true); // default preserved
    expect(s.watchEnabled).toBe(true); // default preserved
  });

  it("CFG-06: valid AGENTS.md produces an instruction block with a SHA-256 contentHash", async () => {
    const content = "# User instructions\n- be concise";
    fs.writeFileSync(path.join(tmpRoot, "AGENTS.md"), content);
    const loader = new AIFetchlyConfigLoader(tmpRoot);
    const snap = await loader.scanGlobalRoot();
    expect(snap.instructions).toHaveLength(1);
    const block = snap.instructions[0];
    expect(block.id).toBe("user:instructions:AGENTS.md");
    expect(block.source).toBe("user");
    expect(block.sourceId).toBe("user");
    expect(block.relativePath).toBe("AGENTS.md");
    expect(block.content).toBe(content);
    expect(block.trusted).toBe(true); // global user-owned, always-on (TRS-01)
    const expectedHash = createHash("sha256").update(content).digest("hex");
    expect(block.contentHash).toBe(expectedHash);
    expect(snap.files[0].contentHash).toBe(expectedHash);
    expect(snap.files[0].kind).toBe("instructions");
  });

  it("DX-01: all emitted diagnostics use codes from the stable tuple and are source-specific", async () => {
    fs.writeFileSync(path.join(tmpRoot, "settings.json"), "not json");
    fs.writeFileSync(
      path.join(tmpRoot, "AGENTS.md"),
      Buffer.alloc(AIFETCHLY_CONFIG_LIMITS.agentsMdBytes + 1, 0x61)
    );
    const loader = new AIFetchlyConfigLoader(tmpRoot);
    const snap = await loader.scanGlobalRoot();
    const validCodes = new Set<string>([
      "file-too-large",
      "frontmatter-missing",
      "frontmatter-invalid",
      "command-name-invalid",
      "command-description-missing",
      "agent-name-invalid",
      "agent-tool-invalid",
      "settings-json-invalid",
      "path-outside-root",
      "unsupported-file",
      "workspace-untrusted",
      "scanner-io-error",
    ]);
    expect(snap.diagnostics.length).toBeGreaterThanOrEqual(2);
    for (const d of snap.diagnostics) {
      expect(
        validCodes.has(d.code),
        `diagnostic code '${d.code}' must be in the stable tuple`
      ).toBe(true);
      expect(d.source).toBe("user");
      expect(d.sourceId).toBe("user");
      expect(typeof d.message).toBe("string");
      expect(d.message.length).toBeGreaterThan(0);
    }
  });

  it("ignores unrelated files in the config folder", async () => {
    fs.writeFileSync(path.join(tmpRoot, "random.txt"), "ignore me");
    fs.mkdirSync(path.join(tmpRoot, "subdir"));
    const loader = new AIFetchlyConfigLoader(tmpRoot);
    const snap = await loader.scanGlobalRoot();
    expect(snap.files).toEqual([]);
    expect(snap.diagnostics).toEqual([]);
  });

  it("never throws from scanGlobalRoot when root is not a directory (emits scanner-io-error)", async () => {
    const fileAsRoot = path.join(tmpRoot, "i-am-a-file");
    fs.writeFileSync(fileAsRoot, "x");
    const loader = new AIFetchlyConfigLoader(fileAsRoot);
    const snap = await loader.scanGlobalRoot();
    expect(snap.source).toBe("user");
    expect(snap.files).toEqual([]);
    const ioDiag = snap.diagnostics.find((d) => d.code === "scanner-io-error");
    expect(ioDiag).toBeDefined();
    expect(ioDiag!.recoverable).toBe(true);
  });
});
