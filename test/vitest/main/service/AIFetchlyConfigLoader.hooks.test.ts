/**
 * HOK-01 (Phase 17 / Plan 02) — global loader hook-scan tests.
 *
 * AIFetchlyConfigLoader reads ~/.aifetchly/hooks/hooks.json (a SINGLE JSON
 * file), JSON.parses it, validates each entry via buildHookDefinition, and
 * fills snapshot.hooks with the resulting CommandHookDefinition[] (source
 * 'user', sourceId 'user'). Invalid JSON, shape failures, out-of-range
 * events, oversized files, and count-cap overflows each produce the correct
 * closed-set diagnostic code. Skill-ref entries register as documented
 * no-ops (no parse-time diagnostic).
 *
 * Integration-style: each test builds an ephemeral fake ~/.aifetchly under
 * os.tmpdir() and points the loader at it via the rootPath constructor arg.
 *
 * Mirrors AIFetchlyConfigLoader.agents.test.ts (the AGT-02 sibling).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { AIFetchlyConfigLoader } from "@/service/aifetchlyConfig/AIFetchlyConfigLoader";
import { AIFETCHLY_CONFIG_LIMITS } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import type { CommandHookDefinition } from "@/entityTypes/hookTypes";

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-hooks-"));
}

function writeHooks(root: string, content: string): void {
  const dir = path.join(root, "hooks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "hooks.json"), content, "utf8");
}

function hookDefs(snapshot: { hooks: readonly unknown[] }): CommandHookDefinition[] {
  return snapshot.hooks as CommandHookDefinition[];
}

function codes(snapshot: {
  diagnostics: readonly { code: string }[];
}): string[] {
  return snapshot.diagnostics.map((d) => d.code);
}

describe("AIFetchlyConfigLoader hook scan (HOK-01 / global user source)", () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  it("parses a valid hooks.json array into user:hook:* CommandHookDefinitions", async () => {
    const root = makeRoot();
    roots.push(root);
    writeHooks(
      root,
      JSON.stringify([
        { event: "PreToolUse", command: "echo pre", matcher: "shell_execute" },
        { event: "SessionStart", command: "echo start" },
      ])
    );

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();
    const hooks = hookDefs(snapshot);

    expect(hooks.map((h) => h.id)).toEqual(["user:hook:0", "user:hook:1"]);
    expect(hooks[0]).toMatchObject({
      id: "user:hook:0",
      eventName: "PreToolUse",
      source: "user",
      type: "command",
      command: "echo pre",
      matcher: "shell_execute",
      enabled: true,
      trusted: true,
      failureMode: "warn",
    });
    // The hooks file is recorded in the file snapshot.
    expect(snapshot.files.map((f) => f.kind)).toContain("hook");
    expect(codes(snapshot)).toEqual([]);
  });

  it("registers a skill-ref entry as a documented no-op (skill:<name> sentinel, no parse-time diagnostic)", async () => {
    const root = makeRoot();
    roots.push(root);
    writeHooks(root, JSON.stringify([{ event: "Stop", skill: "my-skill" }]));

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();
    const hooks = hookDefs(snapshot);

    expect(hooks.map((h) => h.id)).toEqual(["user:hook:0"]);
    expect(hooks[0]).toMatchObject({
      type: "command",
      command: "skill:my-skill",
      eventName: "Stop",
    });
    // No skill-registry-not-available diagnostic at parse time (Plan 03 emits it at fire).
    expect(codes(snapshot)).not.toContain("skill-registry-not-available");
    expect(codes(snapshot)).toEqual([]);
  });

  it("emits hooks-json-invalid and skips when hooks.json is not valid JSON", async () => {
    const root = makeRoot();
    roots.push(root);
    writeHooks(root, "{ not valid json");

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();

    expect(hookDefs(snapshot)).toEqual([]);
    expect(codes(snapshot)).toContain("hooks-json-invalid");
  });

  it("emits hooks-json-invalid for an entry missing both command and skill", async () => {
    const root = makeRoot();
    roots.push(root);
    writeHooks(root, JSON.stringify([{ event: "PreToolUse" }]));

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();

    expect(hookDefs(snapshot)).toEqual([]);
    expect(codes(snapshot)).toContain("hooks-json-invalid");
  });

  it("emits unsupported-event for an out-of-range event name", async () => {
    const root = makeRoot();
    roots.push(root);
    writeHooks(
      root,
      JSON.stringify([
        { event: "PermissionRequest", command: "echo p" },
        { event: "SessionStart", command: "echo ok" },
      ])
    );

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();

    // The bad entry is skipped; the good one still registers.
    expect(hookDefs(snapshot).map((h) => h.id)).toEqual(["user:hook:1"]);
    expect(codes(snapshot)).toContain("unsupported-event");
  });

  it("emits file-too-large and does not read an oversized hooks.json", async () => {
    const root = makeRoot();
    roots.push(root);
    // Build a JSON doc whose stat size exceeds hooksJsonBytes (128 KiB).
    const padding = "x".repeat(AIFETCHLY_CONFIG_LIMITS.hooksJsonBytes + 256);
    writeHooks(root, JSON.stringify([{ event: "Stop", command: padding }]));

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();

    expect(hookDefs(snapshot)).toEqual([]);
    expect(codes(snapshot)).toContain("file-too-large");
    expect(codes(snapshot)).not.toContain("hooks-json-invalid");
  });

  it("emits count-cap and drops surplus entries above maxHooksPerSource", async () => {
    const root = makeRoot();
    roots.push(root);
    const over = AIFETCHLY_CONFIG_LIMITS.maxHooksPerSource + 5;
    const entries = Array.from({ length: over }, (_, i) => ({
      event: "SessionStart",
      command: `echo ${i}`,
    }));
    writeHooks(root, JSON.stringify(entries));

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();
    const hooks = hookDefs(snapshot);

    expect(hooks.length).toBe(AIFETCHLY_CONFIG_LIMITS.maxHooksPerSource);
    expect(codes(snapshot)).toContain("count-cap");
  });

  it("treats a missing hooks/hooks.json as the happy path (no diagnostic)", async () => {
    const root = makeRoot();
    roots.push(root);
    // No hooks/ dir written.

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();

    expect(hookDefs(snapshot)).toEqual([]);
    expect(codes(snapshot)).toEqual([]);
  });
});
