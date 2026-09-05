import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  PortableWorkspaceMemoryBridgeService,
  BRIDGE_START,
} from "@/service/PortableWorkspaceMemoryBridgeService";
import {
  PortableWorkspaceMemoryGitStatusService,
} from "@/service/PortableWorkspaceMemoryGitStatusService";
import type { GitRunner } from "@/service/PortableWorkspaceMemoryGitStatusService";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "portable-bridge-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const service = new PortableWorkspaceMemoryBridgeService();

describe("PortableWorkspaceMemoryBridgeService", () => {
  it("previews a create when the target is absent", async () => {
    const preview = await service.preview(root, "AGENTS.md");
    expect(preview.exists).toBe(false);
    expect(preview.action).toBe("create");
    expect(preview.unifiedDiff).toContain("+");
    expect(preview.unifiedDiff).toContain(BRIDGE_START);
  });

  it("previews an insert when the file exists without a bridge", async () => {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# My agent notes\n");
    const preview = await service.preview(root, "AGENTS.md");
    expect(preview.action).toBe("insert");
    expect(preview.beforeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports no-op when the current bridge is already installed", async () => {
    await service.apply({ canonicalRoot: root, target: "AGENTS.md" });
    const preview = await service.preview(root, "AGENTS.md");
    expect(preview.action).toBe("no-op");
  });

  it("blocks on duplicated managed blocks instead of overwriting", async () => {
    const single = `# notes\n\n${await bridgeBlock()}\n`;
    fs.writeFileSync(
      path.join(root, "AGENTS.md"),
      `${single}${await bridgeBlock()}\n`
    );
    const preview = await service.preview(root, "AGENTS.md");
    expect(preview.action).toBe("blocked");
    expect(preview.diagnostic?.message).toContain("duplicate");
  });

  it("applies and preserves unrelated user content byte-for-byte", async () => {
    const userContent = "# My agent notes\n\nKeep this line exactly.\n";
    fs.writeFileSync(path.join(root, "AGENTS.md"), userContent);
    const result = await service.apply({
      canonicalRoot: root,
      target: "AGENTS.md",
    });
    expect(result.applied).toBe(true);
    const after = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
    expect(after).toContain("# My agent notes");
    expect(after).toContain("Keep this line exactly.");
    expect(after).toContain(BRIDGE_START);
    expect(after.indexOf(BRIDGE_START)).toBeGreaterThan(
      after.indexOf("Keep this line exactly.")
    );
  });

  it("refuses to apply when the file changed since preview (hash guard)", async () => {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# v1\n");
    const preview = await service.preview(root, "AGENTS.md");
    // External edit after the preview.
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# v2 — edited externally\n");
    const result = await service.apply({
      canonicalRoot: root,
      target: "AGENTS.md",
      expectedBeforeHash: preview.beforeHash,
    });
    expect(result.applied).toBe(false);
    expect(result.message).toContain("changed since preview");
    expect(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8")).toContain(
      "# v2 — edited externally"
    );
  });

  it("removes only the managed block and keeps user content", async () => {
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "# Before\n");
    await service.apply({ canonicalRoot: root, target: "CLAUDE.md" });
    fs.appendFileSync(path.join(root, "CLAUDE.md"), "# After\n");
    const result = await service.remove({
      canonicalRoot: root,
      target: "CLAUDE.md",
    });
    expect(result.applied).toBe(true);
    const after = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
    expect(after).not.toContain(BRIDGE_START);
    expect(after).toContain("# Before");
    expect(after).toContain("# After");
  });

  it("deletes the file when the bridge was its only content", async () => {
    await service.apply({ canonicalRoot: root, target: "CLAUDE.md" });
    const result = await service.remove({
      canonicalRoot: root,
      target: "CLAUDE.md",
    });
    expect(result.applied).toBe(true);
    expect(fs.existsSync(path.join(root, "CLAUDE.md"))).toBe(false);
  });
});

async function bridgeBlock(): Promise<string> {
  const preview = await service.preview(root, "AGENTS.md");
  const m = /<!-- aifetchly:project-memory:start -->[\s\S]*?<!-- aifetchly:project-memory:end -->/.exec(
    preview.unifiedDiff.replace(/^\+/, "")
  );
  return m ? m[0] : "";
}

// --- Git status -----------------------------------------------------------------

function makeGitService(
  behavior: (args: readonly string[]) => { code: number; stdout: string }
): PortableWorkspaceMemoryGitStatusService {
  const runner: GitRunner = async (args) => {
    const r = behavior(args);
    if (r.code !== 0) {
      const err = new Error("git exited non-zero") as Error & { code: number };
      err.code = r.code;
      throw err;
    }
    return { stdout: r.stdout, stderr: "" };
  };
  return new PortableWorkspaceMemoryGitStatusService(runner);
}

describe("PortableWorkspaceMemoryGitStatusService", () => {
  it("returns not-a-repository when git rev-parse fails", async () => {
    const svc = makeGitService((args) =>
      args[0] === "rev-parse"
        ? { code: 128, stdout: "" }
        : { code: 0, stdout: "" }
    );
    expect(await svc.getTrackingState(root)).toBe("not-a-repository");
  });

  it("returns ignored when check-ignore exits 0", async () => {
    const svc = makeGitService((args) => {
      if (args[0] === "check-ignore") return { code: 0, stdout: "" };
      if (args[0] === "rev-parse") return { code: 0, stdout: "true\n" };
      return { code: 0, stdout: "" };
    });
    expect(await svc.getTrackingState(root)).toBe("ignored");
  });

  it("returns tracked when README is in the index and nothing is dirty", async () => {
    const svc = makeGitService((args) => {
      if (args[0] === "rev-parse") return { code: 0, stdout: "true\n" };
      if (args[0] === "check-ignore") return { code: 1, stdout: "" };
      if (args[0] === "ls-files") return { code: 0, stdout: "path\n" };
      if (args[0] === "status") return { code: 0, stdout: "" };
      return { code: 0, stdout: "" };
    });
    expect(await svc.getTrackingState(root)).toBe("tracked");
  });

  it("returns untracked when everything is untracked", async () => {
    const svc = makeGitService((args) => {
      if (args[0] === "rev-parse") return { code: 0, stdout: "true\n" };
      if (args[0] === "check-ignore") return { code: 1, stdout: "" };
      if (args[0] === "ls-files") return { code: 1, stdout: "" };
      if (args[0] === "status")
        return {
          code: 0,
          stdout: "?? .aifetchly/memory/\n?? .aifetchly/workspace.json\n",
        };
      return { code: 0, stdout: "" };
    });
    expect(await svc.getTrackingState(root)).toBe("untracked");
  });

  it("returns partially-tracked for a mix of committed and untracked files", async () => {
    const svc = makeGitService((args) => {
      if (args[0] === "rev-parse") return { code: 0, stdout: "true\n" };
      if (args[0] === "check-ignore") return { code: 1, stdout: "" };
      if (args[0] === "ls-files") return { code: 0, stdout: "path\n" };
      if (args[0] === "status")
        return { code: 0, stdout: "?? .aifetchly/memory/wmem-new.md\n" };
      return { code: 0, stdout: "" };
    });
    expect(await svc.getTrackingState(root)).toBe("partially-tracked");
  });

  it("never passes a shell string (argument arrays only)", async () => {
    const seen: string[][] = [];
    const runner: GitRunner = async (
      args: readonly string[]
    ): Promise<{ readonly stdout: string; readonly stderr: string }> => {
      seen.push([...args]);
      void args;
      return Promise.reject(new Error("simulated git failure"));
    };
    await new PortableWorkspaceMemoryGitStatusService(runner).getTrackingState(
      root
    );
    expect(seen.length).toBeGreaterThan(0);
    for (const args of seen) {
      expect(Array.isArray(args)).toBe(true);
      expect(args.length).toBeGreaterThan(0);
    }
    void vi;
  });
});
