import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { applyDirectoryLimits } from "@/service/pluginSources/pluginSourceLimits";

describe("applyDirectoryLimits", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lim-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("passes for a small tree", () => {
    fs.writeFileSync(path.join(tmp, "a.txt"), "x");
    fs.mkdirSync(path.join(tmp, "sub"));
    fs.writeFileSync(path.join(tmp, "sub", "b.txt"), "y");
    const r = applyDirectoryLimits(tmp);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fileCount).toBe(2);
    }
  });

  it("fails when file count exceeds maxFiles", () => {
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(tmp, `f${i}`), "x");
    }
    const r = applyDirectoryLimits(tmp, {
      maxFiles: 5,
      maxExtractedBytes: 10n ** 9n,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("too-many-files");
    }
  });

  it("fails when total size exceeds maxExtractedBytes", () => {
    fs.writeFileSync(path.join(tmp, "big.bin"), Buffer.alloc(2 * 1024 * 1024));
    const r = applyDirectoryLimits(tmp, {
      maxFiles: 5000,
      maxExtractedBytes: 1024n,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("too-large");
    }
  });

  it("walks nested directories", () => {
    fs.mkdirSync(path.join(tmp, "a", "b", "c"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "a", "b", "c", "deep.txt"), "x");
    const r = applyDirectoryLimits(tmp);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fileCount).toBe(1);
  });
});
