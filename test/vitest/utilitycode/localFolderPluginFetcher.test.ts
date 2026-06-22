import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LocalFolderPluginFetcher } from "@/service/pluginSources/LocalFolderPluginFetcher";
import { getPluginsRoot } from "@/service/pluginPaths";

describe("LocalFolderPluginFetcher", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "folder-src-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("accepts a real folder and returns it as localRoot", async () => {
    fs.writeFileSync(path.join(tmp, "marker"), "x");
    const r = await new LocalFolderPluginFetcher().acquire({
      kind: "local-folder",
      folderPath: tmp,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.source.localRoot).toBe(tmp);
      await r.source.cleanup();
    }
  });

  it("rejects a missing folder", async () => {
    const r = await new LocalFolderPluginFetcher().acquire({
      kind: "local-folder",
      folderPath: path.join(tmp, "does-not-exist"),
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.code).toBe("component-not-found");
    }
  });

  it("rejects a file path (not a directory)", async () => {
    const file = path.join(tmp, "file.txt");
    fs.writeFileSync(file, "x");
    const r = await new LocalFolderPluginFetcher().acquire({
      kind: "local-folder",
      folderPath: file,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a folder inside the plugins cache root", async () => {
    const inside = path.join(getPluginsRoot(), "x");
    fs.mkdirSync(inside, { recursive: true });
    const r = await new LocalFolderPluginFetcher().acquire({
      kind: "local-folder",
      folderPath: inside,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.code).toBe("path-outside-plugin");
    }
    fs.rmSync(inside, { recursive: true, force: true });
  });
});
