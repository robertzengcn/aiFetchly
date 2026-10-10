/**
 * Unit tests for the tool-output storage root override (T18 isolation).
 *
 * The E2E bootstrap redirects preserved tool-output artifacts into the per-test
 * temp root via `AIFETCHLY_TOOL_OUTPUT_ROOT`. Production code reads the root
 * through `getToolResultStorageRoot()`, which must honor the override ONLY when
 * it points to an existing directory — so a stale or malformed value never
 * silently relocates outputs to a nonexistent path, and the real
 * `~/.aifetchly/tool-outputs` remains the default in production.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getToolResultStorageRoot,
  TOOL_OUTPUT_ROOT_ENV,
} from "@/service/toolResult/toolResultRoot";

const ORIGINAL = process.env[TOOL_OUTPUT_ROOT_ENV];

describe("getToolResultStorageRoot override", () => {
  let created: string[] = [];

  beforeEach(() => {
    created = [];
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env[TOOL_OUTPUT_ROOT_ENV];
    } else {
      process.env[TOOL_OUTPUT_ROOT_ENV] = ORIGINAL;
    }
    for (const dir of created) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("returns the home-directory default when the override is unset", () => {
    delete process.env[TOOL_OUTPUT_ROOT_ENV];
    expect(getToolResultStorageRoot()).toBe(
      path.join(os.homedir(), ".aifetchly", "tool-outputs")
    );
  });

  it("honors the override when it points to an existing directory", () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tool-result-root-override-")
    );
    created.push(dir);
    process.env[TOOL_OUTPUT_ROOT_ENV] = dir;
    expect(getToolResultStorageRoot()).toBe(path.resolve(dir));
  });

  it("falls back to the default when the override points to a nonexistent path", () => {
    process.env[TOOL_OUTPUT_ROOT_ENV] = path.join(
      os.tmpdir(),
      "definitely-does-not-exist-" + process.pid
    );
    expect(getToolResultStorageRoot()).toBe(
      path.join(os.homedir(), ".aifetchly", "tool-outputs")
    );
  });

  it("falls back to the default when the override points to a file (not a directory)", () => {
    const file = path.join(
      os.tmpdir(),
      `tool-result-root-file-${process.pid}.txt`
    );
    fs.writeFileSync(file, "not a directory", "utf8");
    created.push(file);
    process.env[TOOL_OUTPUT_ROOT_ENV] = file;
    expect(getToolResultStorageRoot()).toBe(
      path.join(os.homedir(), ".aifetchly", "tool-outputs")
    );
  });
});
