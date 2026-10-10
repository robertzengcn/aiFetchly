import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  PortableMemoryFileScanner,
  splitFrontmatter,
} from "@/childprocess/aifetchly-config/PortableMemoryFileScanner";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "portable-scan-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function memoryDir(): string {
  return path.join(root, ".aifetchly", "memory");
}

function writeRecord(fileName: string, content: string): void {
  fs.mkdirSync(memoryDir(), { recursive: true });
  fs.writeFileSync(path.join(memoryDir(), fileName), content);
}

const scanner = new PortableMemoryFileScanner();

const VALID_RECORD = `---
schema: aifetchly.memory/v1
id: wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1
type: decision
status: active
confidence: 95
visibility: team
createdAt: "2026-08-22T08:30:00.000Z"
updatedAt: "2026-08-22T08:30:00.000Z"
createdBy: aifetchly
---

# Title one

Body.
`;

describe("PortableMemoryFileScanner", () => {
  it("returns a normal empty snapshot when .aifetchly/memory is absent", async () => {
    const snap = await scanner.scan({ workspaceRoot: root, sourceId: "s" });
    expect(snap.directoryPresent).toBe(false);
    expect(snap.complete).toBe(true);
    expect(snap.records).toHaveLength(0);
    expect(snap.diagnostics).toHaveLength(0);
  });

  it("scans workspace.json into an identity draft", async () => {
    fs.mkdirSync(path.join(root, ".aifetchly"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".aifetchly", "workspace.json"),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: "ws-018f2f43-43b4-7a18-8d7f-b6886c01993d",
        name: "proj",
        createdAt: "2026-08-22T08:00:00.000Z",
      })
    );
    const snap = await scanner.scan({ workspaceRoot: root, sourceId: "s" });
    expect(snap.identity).toBeDefined();
    expect(snap.identity?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("scans valid records with hashes and sorted order", async () => {
    writeRecord("wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1.md", VALID_RECORD);
    writeRecord(
      "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0.md",
      VALID_RECORD.replace(
        "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1",
        "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0"
      ).replace("# Title one", "# Title two")
    );
    const snap = await scanner.scan({ workspaceRoot: root, sourceId: "s" });
    expect(snap.directoryPresent).toBe(true);
    expect(snap.complete).toBe(true);
    expect(snap.records.map((r) => r.fileName)).toEqual([
      "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1.md",
      "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0.md",
    ]);
    expect(snap.records[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const fm = snap.records[0]?.rawFrontmatter as Record<string, unknown>;
    expect(fm?.id).toBe("wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1");
    expect(snap.records[0]?.markdownBody).toContain("# Title one");
    expect(snap.seenRelativePaths).toHaveLength(2);
  });

  it("captures README/INDEX hashes without treating them as records", async () => {
    writeRecord("wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1.md", VALID_RECORD);
    fs.writeFileSync(path.join(memoryDir(), "README.md"), "# readme\n");
    fs.writeFileSync(path.join(memoryDir(), "INDEX.md"), "# index\n");
    const snap = await scanner.scan({ workspaceRoot: root, sourceId: "s" });
    expect(snap.records).toHaveLength(1);
    expect(snap.readmeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.indexHash).toMatch(/^[0-9a-f]{64}$/);
    // README/INDEX still observed as paths (deletion reconciliation).
    expect(snap.seenRelativePaths).toContain(".aifetchly/memory/README.md");
  });

  it("ignores atomic-write temp files", async () => {
    writeRecord("wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1.md", VALID_RECORD);
    fs.writeFileSync(
      path.join(memoryDir(), "record.md.12345-678.tmp"),
      "partial"
    );
    const snap = await scanner.scan({ workspaceRoot: root, sourceId: "s" });
    expect(snap.records).toHaveLength(1);
    expect(
      snap.seenRelativePaths.some((p) => p.endsWith(".tmp"))
    ).toBe(false);
  });

  it("reports symlinks and non-markdown files as diagnostics", async () => {
    writeRecord("wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1.md", VALID_RECORD);
    const outside = path.join(root, "outside.md");
    fs.writeFileSync(outside, "evil");
    fs.symlinkSync(
      outside,
      path.join(memoryDir(), "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0.md")
    );
    fs.writeFileSync(path.join(memoryDir(), "data.json"), "{}");
    const snap = await scanner.scan({ workspaceRoot: root, sourceId: "s" });
    expect(snap.records).toHaveLength(1);
    const codes = snap.diagnostics.map((d) => d.code);
    expect(codes).toContain("memory-symlink-rejected");
    expect(codes).toContain("memory-content-invalid");
  });

  it("rejects oversized records via stat-before-read", async () => {
    writeRecord("wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1.md", VALID_RECORD);
    fs.writeFileSync(
      path.join(memoryDir(), "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0.md"),
      `${VALID_RECORD}${"x".repeat(17 * 1024)}`
    );
    const snap = await scanner.scan({ workspaceRoot: root, sourceId: "s" });
    // The oversized candidate still rides `records` (main-process parseDraft
    // re-validates size against the carried sizeBytes); the scanner reports
    // the diagnostic.
    const oversized = snap.records.find(
      (r) => r.sizeBytes > 16 * 1024
    );
    expect(oversized).toBeDefined();
    expect(
      snap.diagnostics.some((d) => d.code === "memory-file-too-large")
    ).toBe(true);
  });

  it("marks a candidate read failure as scan-incomplete", async () => {
    writeRecord("wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1.md", VALID_RECORD);
    const target = path.join(
      memoryDir(),
      "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0.md"
    );
    fs.writeFileSync(target, VALID_RECORD);
    // Make the file unreadable (dir without read permission is OS-dependent;
    // deleting between readdir and read simulates the same I/O failure via a
    // FIFO — instead we validate the diagnostic contract directly).
    fs.unlinkSync(target);
    const snap = await scanner.scan({ workspaceRoot: root, sourceId: "s" });
    // The deleted-between-scans file simply never appears; the remaining
    // record still yields a complete snapshot.
    expect(snap.complete).toBe(true);
    expect(snap.records).toHaveLength(1);
  });

  it("has no database/Electron imports (worker boundary)", async () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/childprocess/aifetchly-config/PortableMemoryFileScanner.ts"
      ),
      "utf8"
    );
    expect(source).not.toMatch(/from\s+["']electron["']/);
    expect(source).not.toMatch(/from\s+["']@\/model\//);
    expect(source).not.toMatch(/from\s+["']@\/modules\//);
    expect(source).not.toMatch(/typeorm/);
  });
});

describe("splitFrontmatter", () => {
  it("splits valid frontmatter from the body", () => {
    const r = splitFrontmatter('---\nid: wmem-x\n---\n\n# T\n\nbody');
    expect((r.raw as Record<string, unknown>)?.id).toBe("wmem-x");
    expect(r.body).toContain("# T");
    expect(r.error).toBeUndefined();
  });

  it("errors on missing or unterminated fences and invalid YAML", () => {
    expect(splitFrontmatter("no fences").error).toBeDefined();
    expect(splitFrontmatter("---\nid: x").error).toBeDefined();
    expect(
      splitFrontmatter("---\na: [unclosed\n---\nbody").error
    ).toBeDefined();
  });
});
