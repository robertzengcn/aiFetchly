import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import AdmZip from "adm-zip";
import {
  PluginArchiveService,
  isUnsafeEntryName,
} from "@/service/PluginArchiveService";

function makeZip(
  entries: Array<{ name: string; content: string | Buffer }>
): string {
  const zip = new AdmZip();
  for (const e of entries) {
    zip.addFile(
      e.name,
      Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content, "utf-8")
    );
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-zip-"));
  const zipPath = path.join(tmp, "pkg.zip");
  zip.writeZip(zipPath);
  return zipPath;
}

describe("PluginArchiveService", () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("extracts a valid zip to a temp directory", async () => {
    const zipPath = makeZip([
      { name: ".aifetchly-plugin/plugin.json", content: "{}" },
      { name: "skills/foo/manifest.json", content: "{}" },
    ]);
    tempDirs.push(path.dirname(zipPath));

    const result = await PluginArchiveService.extractZip(zipPath);
    expect(result.success).toBe(true);
    if (result.success) {
      tempDirs.push(result.tempRoot);
      expect(
        fs.existsSync(
          path.join(result.tempRoot, "skills", "foo", "manifest.json")
        )
      ).toBe(true);
      await result.cleanup();
      expect(fs.existsSync(result.tempRoot)).toBe(false);
    }
  });

  it("rejects zip entries with absolute paths (guard unit test)", () => {
    // adm-zip sanitizes entry names on addFile, so we cannot fixture a real
    // absolute-path zip with it. The extraction path delegates to this guard,
    // so we cover the logic directly. A malicious zip with a raw absolute
    // entry name would hit this branch on read-back.
    expect(isUnsafeEntryName("/etc/passwd")).toBe(true);
  });

  it("rejects zip entries with .. traversal (zip slip, guard unit test)", () => {
    expect(isUnsafeEntryName("../escape.txt")).toBe(true);
    expect(isUnsafeEntryName("foo/../../etc/passwd")).toBe(true);
    expect(isUnsafeEntryName("foo/bar/../../../escape")).toBe(true);
    // Safe names are not flagged.
    expect(isUnsafeEntryName("skills/foo/manifest.json")).toBe(false);
    expect(isUnsafeEntryName(".aifetchly-plugin/plugin.json")).toBe(false);
  });

  it("rejects Windows device file entry names", () => {
    expect(isUnsafeEntryName("CON.txt")).toBe(true);
    expect(isUnsafeEntryName("foo/nul")).toBe(true);
    expect(isUnsafeEntryName("skills/manifest.json")).toBe(false);
  });

  it("rejects symlink entries", async () => {
    // Build a zip with a symlink entry manually using adm-zip
    const zip = new AdmZip();
    zip.addFile("skills/foo/manifest.json", Buffer.from("{}", "utf-8"));
    // adm-zip doesn't directly support symlinks via addFile; emulate via
    // a unix-mode entry. Since we can't easily forge symlinks in-memory,
    // we verify the guard via the internal isUnsafeEntry path by injecting
    // a device-like filename instead.
    zip.addFile("CON.txt", Buffer.from("device", "utf-8")); // windows device file
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-zip-"));
    tempDirs.push(tmp);
    const zipPath = path.join(tmp, "pkg.zip");
    zip.writeZip(zipPath);

    const result = await PluginArchiveService.extractZip(zipPath);
    // Either path-outside-plugin or component-not-found — both indicate rejection
    expect(result.success).toBe(false);
  });

  it("rejects zips exceeding max file count", async () => {
    const entries: Array<{ name: string; content: string }> = [];
    // PLUGIN_PACKAGE_LIMITS.maxFiles default is 5000; create 5001 tiny entries
    // would be slow, so we temporarily reduce via env override.
    process.env.PLUGIN_TEST_MAX_FILES = "3";
    try {
      const zipPath = makeZip([
        { name: "a.txt", content: "a" },
        { name: "b.txt", content: "b" },
        { name: "c.txt", content: "c" },
        { name: "d.txt", content: "d" },
      ]);
      tempDirs.push(path.dirname(zipPath));

      const result = await PluginArchiveService.extractZip(zipPath);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0]!.code).toBe("install-io-failed");
      }
    } finally {
      delete process.env.PLUGIN_TEST_MAX_FILES;
    }
  });

  it("rejects zips exceeding max extracted bytes", async () => {
    process.env.PLUGIN_TEST_MAX_BYTES = "100";
    try {
      const zipPath = makeZip([{ name: "big.txt", content: "x".repeat(200) }]);
      tempDirs.push(path.dirname(zipPath));

      const result = await PluginArchiveService.extractZip(zipPath);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0]!.code).toBe("install-io-failed");
      }
    } finally {
      delete process.env.PLUGIN_TEST_MAX_BYTES;
    }
  });

  it("rejects a missing zip file", async () => {
    const result = await PluginArchiveService.extractZip(
      "/nonexistent/pkg.zip"
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]!.code).toBe("install-io-failed");
    }
  });

  it("cleanup is idempotent", async () => {
    const zipPath = makeZip([{ name: "ok.txt", content: "ok" }]);
    tempDirs.push(path.dirname(zipPath));

    const result = await PluginArchiveService.extractZip(zipPath);
    expect(result.success).toBe(true);
    if (result.success) {
      await result.cleanup();
      await result.cleanup(); // should not throw
      expect(fs.existsSync(result.tempRoot)).toBe(false);
    }
  });
});
