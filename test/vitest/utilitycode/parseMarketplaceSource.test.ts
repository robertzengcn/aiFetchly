import { describe, it, expect } from "vitest";
import { parseMarketplaceSource } from "@/service/pluginMarketplaces/parseMarketplaceSource";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("parseMarketplaceSource", () => {
  it("owner/repo -> github", () => {
    const r = parseMarketplaceSource("owner/repo");
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("github");
  });

  it("https .git -> git", () => {
    const r = parseMarketplaceSource("https://gitlab.com/team/plugins.git");
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("git");
  });

  it("git@ -> git", () => {
    const r = parseMarketplaceSource("git@github.com:team/plugins.git");
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("git");
  });

  it("https marketplace.json -> url", () => {
    const r = parseMarketplaceSource("https://example.com/marketplace.json");
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("url");
  });

  it("local folder -> local-folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-src-"));
    const r = parseMarketplaceSource(dir);
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("local-folder");
  });

  it("local marketplace.json file -> local-file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-file-"));
    const file = path.join(dir, "marketplace.json");
    fs.writeFileSync(file, "{}");
    const r = parseMarketplaceSource(file);
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("local-file");
  });

  it("rejects http://", () => {
    expect(parseMarketplaceSource("http://insecure.com/m.json").success).toBe(false);
  });

  it("rejects CRLF", () => {
    expect(parseMarketplaceSource("owner/repo\r\n--config=evil").success).toBe(false);
  });

  it("rejects ambiguous https", () => {
    expect(parseMarketplaceSource("https://example.com/something").success).toBe(false);
  });

  it("threads optional ref", () => {
    const r = parseMarketplaceSource("owner/repo", "main");
    if (r.success) expect(r.source.ref).toBe("main");
  });
});
