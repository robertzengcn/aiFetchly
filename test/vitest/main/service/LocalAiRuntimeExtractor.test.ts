import { describe, expect, test, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as CRC32 from "crc-32";
import AdmZip from "adm-zip";
import {
  extractRuntimeArchive,
  assertEntrySafe,
  validateExtractedPackage,
} from "@/service/localAiRuntime/LocalAiRuntimeExtractor";
import {
  LocalAiRuntimeError,
  type LocalAiRuntimeCatalogEntry,
  type LocalAiRuntimeTarget,
} from "@/entityTypes/localAiRuntimeTypes";

let tmpRoot: string;
let archivePath: string;
let stagingRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-extract-"));
  archivePath = path.join(tmpRoot, "test.zip");
  stagingRoot = path.join(tmpRoot, "staging");
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeZip(files: ReadonlyArray<readonly [string, string]>): void {
  const zip = new AdmZip();
  for (const [name, content] of files) {
    zip.addFile(name, Buffer.from(content, "utf-8"));
  }
  zip.writeZip(archivePath);
}

/**
 * Minimal STORE (uncompressed) ZIP builder that writes entry names and
 * external-file-attributes VERBATIM. adm-zip sanitizes unsafe names on write,
 * so we craft raw bytes to give yauzl genuinely adversarial archives.
 */
function writeRawStoreZip(
  entries: ReadonlyArray<{
    name: string;
    content?: string;
    externalAttrs?: number;
  }>
): void {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const data = Buffer.from(entry.content ?? "", "utf-8");
    const crc = CRC32.buf(data) >>> 0;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8); // STORE
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc >>> 0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); // STORE
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.externalAttrs ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centralParts);
  const cdOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  fs.writeFileSync(archivePath, Buffer.concat([...localParts, cd, eocd]));
}

describe("assertEntrySafe (unit)", () => {
  const ok = (fileName: string, attr = 0): void => {
    assertEntrySafe({
      fileName,
      uncompressedSize: 1,
      externalFileAttributes: attr,
    });
  };
  const bad = (fileName: string, attr = 0): void => {
    expect(() =>
      assertEntrySafe({
        fileName,
        uncompressedSize: 1,
        externalFileAttributes: attr,
      })
    ).toThrow(LocalAiRuntimeError);
  };

  test("accepts a plain file and a directory entry", () => {
    ok("worker.js");
    ok("node_modules/sherpa-onnx-node/package.json");
    ok("dir/");
  });
  test("rejects traversal, absolute, drive, UNC, device names, NUL", () => {
    bad("../escape");
    bad("a/../../b");
    bad("/etc/passwd");
    bad("C:\\boot.ini");
    bad("\\\\server\\share\\x");
    bad("CON.txt");
    bad("a\0b");
  });
  test("rejects symlink / device / socket entries by unix mode", () => {
    const S_IFLNK = 0o120000;
    const S_IFSOCK = 0o140000;
    const S_IFCHR = 0o020000;
    bad("link", (S_IFLNK | 0o777) << 16);
    bad("sock", (S_IFSOCK | 0o777) << 16);
    bad("dev", (S_IFCHR | 0o777) << 16);
  });
});

describe("extractRuntimeArchive (end-to-end)", () => {
  test("extracts a valid archive preserving structure", async () => {
    writeZip([
      ["manifest.json", "{}"],
      ["package.json", "{}"],
      ["node_modules/sherpa-onnx-node/package.json", "{}"],
    ]);
    const result = await extractRuntimeArchive(archivePath, stagingRoot);
    expect(result.entries.sort()).toEqual(
      [
        "manifest.json",
        "package.json",
        "node_modules/sherpa-onnx-node/package.json",
      ].sort()
    );
    expect(
      fs.existsSync(
        path.join(
          stagingRoot,
          "node_modules",
          "sherpa-onnx-node",
          "package.json"
        )
      )
    ).toBe(true);
  });

  test("rejects a traversal entry", async () => {
    writeRawStoreZip([
      { name: "evil.txt", content: "x" },
      { name: "../escape.txt", content: "pwned" },
    ]);
    await expect(
      extractRuntimeArchive(archivePath, stagingRoot)
    ).rejects.toThrow(LocalAiRuntimeError);
    // Staging must not have written the escaping file outside the root.
    expect(fs.existsSync(path.join(tmpRoot, "escape.txt"))).toBe(false);
  });

  test("rejects a duplicate normalized entry", async () => {
    writeRawStoreZip([
      { name: "dup.txt", content: "a" },
      { name: "dup.txt", content: "b" },
    ]);
    await expect(
      extractRuntimeArchive(archivePath, stagingRoot)
    ).rejects.toThrow(LocalAiRuntimeError);
  });

  test("rejects an absolute-path entry", async () => {
    writeRawStoreZip([{ name: "/etc/passwd", content: "x" }]);
    await expect(
      extractRuntimeArchive(archivePath, stagingRoot)
    ).rejects.toThrow(LocalAiRuntimeError);
  });

  test("rejects a symlink entry by unix mode", async () => {
    const S_IFLNK = 0o120000;
    writeRawStoreZip([
      {
        name: "link",
        content: "/etc/passwd",
        externalAttrs: ((S_IFLNK | 0o777) << 16) >>> 0,
      },
    ]);
    await expect(
      extractRuntimeArchive(archivePath, stagingRoot)
    ).rejects.toThrow(LocalAiRuntimeError);
  });
});

const TARGET: LocalAiRuntimeTarget = {
  platform: "darwin",
  arch: "arm64",
  electronVersion: "35.7.5",
  nodeModuleAbi: "135",
  appVersion: "1.5.0",
};

function manifestJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    runtimeId: "voice-sherpa",
    runtimeVersion: "1.0.0",
    platform: "darwin",
    arch: "arm64",
    electronVersion: "35.7.5",
    nodeModuleAbi: "135",
    entryModule: "sherpa-onnx-node",
    requiredFiles: [
      "package.json",
      "node_modules/sherpa-onnx-node/package.json",
    ],
    dependencies: { "sherpa-onnx-node": "1.13.4" },
    build: {
      commit: "abc",
      workflowRunId: "1",
      builtAt: "2026-07-30T00:00:00Z",
    },
  });
}

function catalogEntry(
  overrides: Partial<LocalAiRuntimeCatalogEntry>
): LocalAiRuntimeCatalogEntry {
  return {
    runtimeId: "voice-sherpa",
    runtimeVersion: "1.0.0",
    platform: "darwin",
    arch: "arm64",
    downloadUrl:
      "https://github.com/o/r/releases/download/v1/voice-runtime-darwin-arm64-1.0.0.zip",
    archiveFileName: "voice-runtime-darwin-arm64-1.0.0.zip",
    archiveSizeBytes: 100,
    installedSizeBytes: 200,
    sha256: "a".repeat(64),
    electronVersion: "35.7.5",
    nodeModuleAbi: "135",
    minAppVersion: "1.0.0",
    entryModule: "sherpa-onnx-node",
    requiredFiles: [
      "package.json",
      "node_modules/sherpa-onnx-node/package.json",
    ],
    dependencies: { "sherpa-onnx-node": "1.13.4" },
    ...overrides,
  };
}

describe("validateExtractedPackage", () => {
  test("ok when manifest matches catalog and required files present", async () => {
    writeZip([
      ["manifest.json", manifestJson()],
      ["package.json", "{}"],
      ["node_modules/sherpa-onnx-node/package.json", "{}"],
    ]);
    await extractRuntimeArchive(archivePath, stagingRoot);
    const result = await validateExtractedPackage(
      stagingRoot,
      catalogEntry({}),
      TARGET,
      200
    );
    expect(result.ok).toBe(true);
  });

  test("fails when manifest is missing", async () => {
    writeZip([["package.json", "{}"]]);
    await extractRuntimeArchive(archivePath, stagingRoot);
    const result = await validateExtractedPackage(
      stagingRoot,
      catalogEntry({}),
      TARGET,
      10
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("runtime_manifest_invalid");
  });

  test("fails on identity mismatch with catalog", async () => {
    writeZip([
      ["manifest.json", manifestJson()],
      ["package.json", "{}"],
      ["node_modules/sherpa-onnx-node/package.json", "{}"],
    ]);
    await extractRuntimeArchive(archivePath, stagingRoot);
    const result = await validateExtractedPackage(
      stagingRoot,
      catalogEntry({ runtimeVersion: "2.0.0" }),
      TARGET,
      200
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("runtime_manifest_invalid");
  });

  test("fails when a required file is missing", async () => {
    writeZip([
      ["manifest.json", manifestJson()],
      ["package.json", "{}"],
      // node_modules/sherpa-onnx-node/package.json intentionally absent
    ]);
    await extractRuntimeArchive(archivePath, stagingRoot);
    const result = await validateExtractedPackage(
      stagingRoot,
      catalogEntry({}),
      TARGET,
      200
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("runtime_required_file_missing");
  });
});
