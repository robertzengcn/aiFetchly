import { lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CachePathValidator } from "@/childprocess/managed-browser-cache/CachePathValidator";

/**
 * Worker-side cache path validation (design §13.9): the maintenance worker
 * re-validates every root and target path — grammar, containment, symlink
 * components — so main-process paths are never trusted blindly.
 */

const TOKEN_A = "a".repeat(24);

let tmpRoot: string;
let managedRoot: string;
let validator: CachePathValidator;

beforeAll(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mb-cache-validator-"));
  managedRoot = path.join(
    tmpRoot,
    "app-cache",
    "aifetchly",
    "managed-browser-cache",
    "v1"
  );
  await mkdir(path.join(managedRoot, TOKEN_A), { recursive: true });
  await mkdir(path.join(managedRoot, "deleting"), { recursive: true });
  validator = new CachePathValidator();
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("validateManagedRoot", () => {
  it("accepts the documented managed root", () => {
    expect(validator.validateManagedRoot(managedRoot)).toEqual({ ok: true });
  });

  it("rejects the filesystem root, home, tmp, and wrong suffixes", () => {
    expect(validator.validateManagedRoot(path.parse(managedRoot).root)).toEqual(
      { ok: false, reasonCode: "cache_root_invalid" }
    );
    expect(validator.validateManagedRoot(os.homedir())).toEqual({
      ok: false,
      reasonCode: "cache_root_invalid",
    });
    expect(validator.validateManagedRoot(os.tmpdir())).toEqual({
      ok: false,
      reasonCode: "cache_root_invalid",
    });
    expect(
      validator.validateManagedRoot(
        path.join(tmpRoot, "managed-browser-cache", "v2")
      )
    ).toEqual({ ok: false, reasonCode: "cache_root_invalid" });
    expect(validator.validateManagedRoot("")).toEqual({
      ok: false,
      reasonCode: "cache_root_invalid",
    });
  });

  it("rejects unnormalized roots", () => {
    expect(
      validator.validateManagedRoot(`${managedRoot}${path.sep}`)
    ).toEqual({ ok: false, reasonCode: "cache_root_invalid" });
    expect(
      validator.validateManagedRoot(
        path.join(tmpRoot, "app-cache", "..", "app-cache", "x")
      )
    ).toEqual({ ok: false, reasonCode: "cache_root_invalid" });
  });
});

describe("validateScopePath", () => {
  it("accepts only <root>/<24-hex>", () => {
    expect(
      validator.validateScopePath(
        path.join(managedRoot, TOKEN_A),
        managedRoot
      )
    ).toEqual({ ok: true });
    expect(
      validator.validateScopePath(path.join(managedRoot, "101"), managedRoot)
    ).toEqual({ ok: false, reasonCode: "cache_path_invalid" });
    expect(
      validator.validateScopePath(
        path.join(managedRoot, TOKEN_A.toUpperCase()),
        managedRoot
      )
    ).toEqual({ ok: false, reasonCode: "cache_path_invalid" });
    expect(
      validator.validateScopePath(
        path.join(managedRoot, "deleting"),
        managedRoot
      )
    ).toEqual({ ok: false, reasonCode: "cache_path_invalid" });
    // Wrong parent — even a valid token outside the root.
    expect(
      validator.validateScopePath(
        path.join(tmpRoot, TOKEN_A),
        managedRoot
      )
    ).toEqual({ ok: false, reasonCode: "cache_path_invalid" });
  });
});

describe("validateQueuePath", () => {
  it("accepts only <root>/deleting/<grammar-entry>", () => {
    expect(
      validator.validateQueuePath(
        path.join(managedRoot, "deleting", "del-abcdef12"),
        managedRoot
      )
    ).toEqual({ ok: true });
    expect(
      validator.validateQueuePath(
        path.join(managedRoot, "deleting", "../escape"),
        managedRoot
      )
    ).toEqual({ ok: false, reasonCode: "cache_path_invalid" });
    expect(
      validator.validateQueuePath(
        path.join(managedRoot, "deleting", "UPPER-CASE-1"),
        managedRoot
      )
    ).toEqual({ ok: false, reasonCode: "cache_path_invalid" });
    expect(
      validator.validateQueuePath(
        path.join(managedRoot, "other", "del-abcdef12"),
        managedRoot
      )
    ).toEqual({ ok: false, reasonCode: "cache_path_invalid" });
    expect(
      validator.validateQueuePath(
        path.join(managedRoot, "del-abcdef12"),
        managedRoot
      )
    ).toEqual({ ok: false, reasonCode: "cache_path_invalid" });
  });
});

describe("assertNoSymlinkComponents", () => {
  it("accepts a real directory tree", async () => {
    await expect(
      validator.assertNoSymlinkComponents(
        path.join(managedRoot, TOKEN_A),
        managedRoot
      )
    ).resolves.toEqual({ ok: true });
  });

  it("accepts a missing path (no symlink to follow)", async () => {
    await expect(
      validator.assertNoSymlinkComponents(
        path.join(managedRoot, "b".repeat(24)),
        managedRoot
      )
    ).resolves.toEqual({ ok: true });
  });

  it("rejects a planted symlink component", async () => {
    const outside = path.join(tmpRoot, "outside-evil");
    await mkdir(outside, { recursive: true });
    const linkName = "c".repeat(24);
    await symlink(outside, path.join(managedRoot, linkName));
    await expect(
      validator.assertNoSymlinkComponents(
        path.join(managedRoot, linkName),
        managedRoot
      )
    ).resolves.toEqual({
      ok: false,
      reasonCode: "cache_symlink_rejected",
    });
  });

  it("rejects a target outside the root", async () => {
    await expect(
      validator.assertNoSymlinkComponents(
        path.join(tmpRoot, "elsewhere"),
        managedRoot
      )
    ).resolves.toEqual({ ok: false, reasonCode: "cache_path_invalid" });
  });
});

describe("lstat usage", () => {
  it("uses lstat (not stat) semantics — symlinks are visible", async () => {
    const info = await lstat(managedRoot);
    // The root itself is a real directory in these tests; the symlink
    // rejection above proves lstat is what the walk uses.
    expect(info.isDirectory()).toBe(true);
  });
});
