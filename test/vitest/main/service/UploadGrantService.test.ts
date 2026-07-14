"use strict";
import { describe, test, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  UploadGrantService,
  isPathUnderDir,
} from "@/service/UploadGrantService";

describe("UploadGrantService", () => {
  let svc: UploadGrantService;

  beforeEach(() => {
    // Fresh instance with a 1-hour TTL so expiry is deterministic only in
    // the dedicated expiry test.
    svc = new UploadGrantService(60 * 60 * 1000);
  });

  test("issue then consume returns true exactly once (one-shot)", () => {
    const p = path.join(os.tmpdir(), "grant-target.txt");
    svc.issue(p);
    expect(svc.consume(p)).toBe(true);
    // One-shot: second consume must fail.
    expect(svc.consume(p)).toBe(false);
  });

  test("consume without issue returns false", () => {
    const p = path.join(os.tmpdir(), "never-issued.txt");
    expect(svc.consume(p)).toBe(false);
  });

  test("expired grant cannot be consumed", async () => {
    const shortTtl = new UploadGrantService(40);
    const p = path.join(os.tmpdir(), "expires-soon.txt");
    shortTtl.issue(p);
    await new Promise((r) => setTimeout(r, 60));
    expect(shortTtl.consume(p)).toBe(false);
  });

  test("grants are scoped by operation", () => {
    const p = path.join(os.tmpdir(), "scoped.txt");
    svc.issue(p, "rag-upload");
    // A different operation must not cross-consume.
    expect(svc.consume(p, "other-op" as never)).toBe(false);
    // Correct operation still consumes.
    expect(svc.consume(p, "rag-upload")).toBe(true);
  });

  test("issueForPaths grants each path", () => {
    const a = path.join(os.tmpdir(), "a.txt");
    const b = path.join(os.tmpdir(), "b.txt");
    svc.issueForPaths([a, b]);
    expect(svc.consume(a)).toBe(true);
    expect(svc.consume(b)).toBe(true);
  });

  test("realpath canonicalization matches equivalent paths", () => {
    // Create a real file and a symlink to it. The grant issued for the real
    // path must be consumable via the symlink (canonicalization collapses both
    // to the same realpath key).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grant-"));
    const realFile = path.join(dir, "real.txt");
    const linkFile = path.join(dir, "link.txt");
    fs.writeFileSync(realFile, "x");
    try {
      fs.symlinkSync(realFile, linkFile);
    } catch {
      // Symlinks may be unavailable on some CI runners; skip gracefully.
      return;
    }

    const local = new UploadGrantService();
    local.issue(realFile);
    // Consuming via the symlink must succeed — both resolve to realFile.
    expect(local.consume(linkFile)).toBe(true);
  });

  test("clear() wipes outstanding grants", () => {
    const p = path.join(os.tmpdir(), "cleared.txt");
    svc.issue(p);
    svc.clear();
    expect(svc.consume(p)).toBe(false);
  });
});

describe("isPathUnderDir", () => {
  test("returns true for a path nested under root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nested-"));
    const target = path.join(root, "sub", "file.txt");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "x");
    expect(isPathUnderDir(target, root)).toBe(true);
  });

  test("returns false for a sibling path outside root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "root-a-"));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "root-b-"));
    const target = path.join(outsideRoot, "file.txt");
    fs.writeFileSync(target, "x");
    expect(isPathUnderDir(target, root)).toBe(false);
  });

  test("rejects traversal attempts with ..", () => {
    const root = path.join(os.tmpdir(), " uploads");
    const target = `${root}/../../etc/passwd`;
    expect(isPathUnderDir(target, root)).toBe(false);
  });

  test("returns false for non-existent target", () => {
    const root = os.tmpdir();
    const target = path.join(root, "definitely-missing-" + Date.now() + ".txt");
    expect(isPathUnderDir(target, root)).toBe(false);
  });

  test("returns true for an existing file that resolves under root", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "under-"));
    const file = path.join(dir, "nested.txt");
    fs.writeFileSync(file, "x");
    expect(isPathUnderDir(file, dir)).toBe(true);
  });
});
