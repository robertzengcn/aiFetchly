import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import AdmZip from "adm-zip";
import { LocalZipPluginFetcher } from "@/service/pluginSources/LocalZipPluginFetcher";

describe("LocalZipPluginFetcher", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zip-src-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("extracts a valid zip", async () => {
    const zip = new AdmZip();
    zip.addFile("hello.txt", Buffer.from("hi"));
    const zipPath = path.join(tmp, "pkg.zip");
    zip.writeZip(zipPath);
    const r = await new LocalZipPluginFetcher().acquire({
      kind: "local-zip",
      zipPath,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(fs.existsSync(path.join(r.source.localRoot, "hello.txt"))).toBe(
        true
      );
      await r.source.cleanup();
    }
  });

  it("rejects a missing zip path", async () => {
    const r = await new LocalZipPluginFetcher().acquire({
      kind: "local-zip",
      zipPath: path.join(tmp, "nope.zip"),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty request (no zipPath)", async () => {
    const r = await new LocalZipPluginFetcher().acquire({ kind: "local-zip" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.code).toBe("install-io-failed");
    }
  });
});
