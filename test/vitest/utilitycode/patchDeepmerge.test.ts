import { describe, expect, it, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { patchFile } from "../../../scripts/patch-deepmerge.js";

/**
 * Guards the deepmerge prototype-poisoning hardening (scripts/
 * patch-deepmerge.js, Dependabot alert #320 — no upstream fix released).
 *
 * The patch rewrites node_modules/deepmerge in place at postinstall. A
 * silent failure there is invisible: installs stay green while the
 * poisoning vector remains. These tests pin the four behaviors the review
 * found unpinned — idempotency, shape-mismatch skip, poison neutralization,
 * benign-merge preservation — plus one CI-level assertion that the REAL
 * installed copy actually carries the guard (postinstall ran).
 */

const GUARD =
  "if (key === '__proto__' || key === 'constructor' || key === 'prototype') { return }";

/** Real deepmerge@4.3.1 build output, copied into a throwaway dir per test. */
function copyFreshDeepmergeFixture(): string {
  const source = path.resolve(__dirname, "../../../node_modules/deepmerge");
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepmerge-fixture-"));
  const target = path.join(fixtureDir, "deepmerge");
  fs.mkdirSync(path.join(target, "dist"), { recursive: true });
  const LOOP_ANCHOR = "forEach(function(key) {";
  const GUARD =
    "if (key === '__proto__' || key === 'constructor' || key === 'prototype') { return }";
  for (const rel of ["index.js", "dist/cjs.js", "dist/umd.js"]) {
    const dest = path.join(target, rel);
    fs.copyFileSync(path.join(source, rel), dest);
    // The installed copy is already patched (postinstall ran), so reverse
    // the deterministic injection to reconstruct pristine v4.3.1 bytes.
    const pristine = fs
      .readFileSync(dest, "utf8")
      .split(`${LOOP_ANCHOR} ${GUARD}`)
      .join(LOOP_ANCHOR);
    fs.writeFileSync(dest, pristine);
  }
  fs.writeFileSync(
    path.join(target, "package.json"),
    JSON.stringify({ name: "deepmerge", version: "4.3.1", main: "dist/cjs.js" })
  );
  return target;
}

afterEach(() => {
  for (const dir of fs.readdirSync(os.tmpdir())) {
    if (dir.startsWith("deepmerge-fixture-")) {
      fs.rmSync(path.join(os.tmpdir(), dir), { recursive: true, force: true });
    }
  }
});

describe("patchFile (deepmerge prototype-poisoning hardening)", () => {
  it("patches a fresh v4.3.1 build exactly twice per file (both key loops)", () => {
    const target = copyFreshDeepmergeFixture();
    const cjs = path.join(target, "dist", "cjs.js");
    expect(patchFile(cjs)).toBe("patched");
    const patched = fs.readFileSync(cjs, "utf8");
    expect(patched.split(GUARD).length - 1).toBe(2);
  });

  it("is idempotent: a second run leaves the file byte-identical", () => {
    const target = copyFreshDeepmergeFixture();
    const cjs = path.join(target, "dist", "cjs.js");
    expect(patchFile(cjs)).toBe("patched");
    const first = fs.readFileSync(cjs, "utf8");
    expect(patchFile(cjs)).toBe("already");
    expect(fs.readFileSync(cjs, "utf8")).toBe(first);
  });

  it("skips files whose shape differs from expected v4.3.1 without throwing", () => {
    const target = copyFreshDeepmergeFixture();
    const cjs = path.join(target, "dist", "cjs.js");
    fs.writeFileSync(cjs, "module.exports = { merge: function () {} };");
    expect(patchFile(cjs)).toBe("skipped");
  });

  it("flags a half-patched file instead of injecting a duplicate guard", () => {
    const target = copyFreshDeepmergeFixture();
    const cjs = path.join(target, "dist", "cjs.js");
    expect(patchFile(cjs)).toBe("patched");
    // Simulate torn state: strip one guard.
    const content = fs.readFileSync(cjs, "utf8");
    fs.writeFileSync(cjs, content.replace(GUARD, ""));
    expect(patchFile(cjs)).toBe("failed");
    // The remaining guard must not have been duplicated.
    expect(fs.readFileSync(cjs, "utf8").split(GUARD).length - 1).toBe(1);
  });

  it("patched deepmerge resists __proto__ poisoning via JSON-parsed targets", () => {
    const target = copyFreshDeepmergeFixture();
    const cjs = path.join(target, "dist", "cjs.js");
    expect(patchFile(cjs)).toBe("patched");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const merge = require(cjs);
    const evil = JSON.parse('{"__proto__": {"isAdmin": true}}');
    const out = merge(evil, {});
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect("isAdmin" in out).toBe(false);
    expect("polluted" in {}).toBe(false);
  });

  it("patched deepmerge preserves benign merge semantics", () => {
    const target = copyFreshDeepmergeFixture();
    const cjs = path.join(target, "dist", "cjs.js");
    expect(patchFile(cjs)).toBe("patched");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const merge = require(cjs);
    expect(merge({ a: 1, x: { y: 1 } }, { b: 2, x: { z: 2 } })).toEqual({
      a: 1,
      b: 2,
      x: { y: 1, z: 2 },
    });
    // 4.x array semantics (concat) must survive the guard.
    expect(merge({ args: ["--a"] }, { args: ["--b"] })).toEqual({
      args: ["--a", "--b"],
    });
  });
});

describe("installed deepmerge hardening (postinstall ran)", () => {
  it("real node_modules copy carries the guard in both key loops", () => {
    // Catches an install where postinstall was skipped (yarn --ignore-scripts)
    // or a future deepmerge upgrade silently changed shape.
    const installed = path.resolve(
      __dirname,
      "../../../node_modules/deepmerge/dist/cjs.js"
    );
    const contents = fs.readFileSync(installed, "utf8");
    expect(contents.split(GUARD).length - 1).toBe(2);
  });
});
