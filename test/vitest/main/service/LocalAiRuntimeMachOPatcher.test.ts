import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  patchMachOBinaryBuffer,
  patchMachOFile,
  patchSherpaNativeOnnxInDirSync,
  patchSherpaNativeOnnxInDir,
} from "@/service/localAiRuntime/LocalAiRuntimeMachOPatcher";

/**
 * Builds a minimal valid 64-bit Mach-O (Little-Endian) buffer with one LC_LOAD_DYLIB command.
 */
function createSyntheticMachO64(
  dylibPath: string,
  cmdSize = 64,
  cmdOffset = 24
): Buffer {
  const headerSize = 32;
  const buf = Buffer.alloc(headerSize + cmdSize);

  // Mach-O 64-bit LE header
  buf.writeUInt32LE(0xfeedfacf, 0); // magic (MH_MAGIC_64)
  buf.writeUInt32LE(0x0100000c, 4); // cputype (ARM64)
  buf.writeUInt32LE(0x00000000, 8); // cpusubtype
  buf.writeUInt32LE(0x00000006, 12); // filetype (MH_DYLIB)
  buf.writeUInt32LE(1, 16); // ncmds = 1
  buf.writeUInt32LE(cmdSize, 20); // sizeofcmds
  buf.writeUInt32LE(0, 24); // flags
  buf.writeUInt32LE(0, 28); // reserved

  // Load command: LC_LOAD_DYLIB = 0x0c
  const cmdStart = headerSize;
  buf.writeUInt32LE(0x0000000c, cmdStart); // cmd
  buf.writeUInt32LE(cmdSize, cmdStart + 4); // cmdsize
  buf.writeUInt32LE(cmdOffset, cmdStart + 8); // offset to name
  buf.writeUInt32LE(0, cmdStart + 12); // timestamp
  buf.writeUInt32LE(0, cmdStart + 16); // current_version
  buf.writeUInt32LE(0, cmdStart + 20); // compatibility_version

  // Write dylibPath string
  buf.write(dylibPath, cmdStart + cmdOffset, "utf8");
  return buf;
}

/**
 * Builds a minimal FAT Mach-O binary containing multiple 64-bit slices.
 */
function createSyntheticFatMachO(sliceDylibPaths: string[]): Buffer {
  const fatHeaderSize = 8;
  const fatArchSize = 20;
  const numSlices = sliceDylibPaths.length;
  const sliceBuffers = sliceDylibPaths.map((p) => createSyntheticMachO64(p));

  const totalFatHeaderSize = fatHeaderSize + numSlices * fatArchSize;
  // Align slices to 8 bytes
  const alignedHeaderSize = Math.ceil(totalFatHeaderSize / 8) * 8;

  let currentOffset = alignedHeaderSize;
  const sliceOffsets: number[] = [];
  for (const s of sliceBuffers) {
    sliceOffsets.push(currentOffset);
    currentOffset += Math.ceil(s.length / 8) * 8;
  }

  const totalBuf = Buffer.alloc(currentOffset);

  // FAT magic (big-endian: 0xcafebabe)
  totalBuf.writeUInt32BE(0xcafebabe, 0);
  totalBuf.writeUInt32BE(numSlices, 4);

  for (let i = 0; i < numSlices; i++) {
    const archEntryOffset = fatHeaderSize + i * fatArchSize;
    totalBuf.writeUInt32BE(0x0100000c, archEntryOffset); // cputype
    totalBuf.writeUInt32BE(0, archEntryOffset + 4); // cpusubtype
    totalBuf.writeUInt32BE(sliceOffsets[i], archEntryOffset + 8); // offset
    totalBuf.writeUInt32BE(sliceBuffers[i].length, archEntryOffset + 12); // size
    totalBuf.writeUInt32BE(3, archEntryOffset + 16); // align

    sliceBuffers[i].copy(totalBuf, sliceOffsets[i]);
  }

  return totalBuf;
}

describe("LocalAiRuntimeMachOPatcher", () => {
  describe("patchMachOBinaryBuffer", () => {
    test("patches @rpath/libsherpa-onnx-c-api.dylib to @loader_path/libsherpa-onnx-c-api.dylib", () => {
      const orig = "@rpath/libsherpa-onnx-c-api.dylib";
      const buf = createSyntheticMachO64(orig, 64, 24);

      const result = patchMachOBinaryBuffer(buf);
      expect(result.modified).toBe(true);
      expect(result.replacements).toBe(1);

      // Verify the string in buffer
      const nameOffset = 32 + 24;
      const patchedStr = buf
        .toString("utf8", nameOffset, 32 + 64)
        .replace(/\0.*$/, "");
      expect(patchedStr).toBe("@loader_path/libsherpa-onnx-c-api.dylib");
    });

    test("patches @rpath/libonnxruntime.1.27.0.dylib to @loader_path/libonnxruntime.dylib", () => {
      const orig = "@rpath/libonnxruntime.1.27.0.dylib";
      const buf = createSyntheticMachO64(orig, 64, 24);

      const result = patchMachOBinaryBuffer(buf);
      expect(result.modified).toBe(true);
      expect(result.replacements).toBe(1);

      const nameOffset = 32 + 24;
      const patchedStr = buf
        .toString("utf8", nameOffset, 32 + 64)
        .replace(/\0.*$/, "");
      expect(patchedStr).toBe("@loader_path/libonnxruntime.dylib");
    });

    test("returns modified:false when no matching @rpath is found", () => {
      const buf = createSyntheticMachO64("/usr/lib/libSystem.B.dylib", 64, 24);
      const result = patchMachOBinaryBuffer(buf);
      expect(result.modified).toBe(false);
      expect(result.replacements).toBe(0);
    });

    test("returns modified:false for non-Mach-O buffer", () => {
      const buf = Buffer.from("MZ\x90\x00Not a Mach-O file at all");
      const result = patchMachOBinaryBuffer(buf);
      expect(result.modified).toBe(false);
      expect(result.replacements).toBe(0);
    });

    test("returns modified:false for too small buffer", () => {
      const buf = Buffer.alloc(4);
      const result = patchMachOBinaryBuffer(buf);
      expect(result.modified).toBe(false);
      expect(result.replacements).toBe(0);
    });

    test("patches FAT Mach-O binary containing multiple architecture slices", () => {
      const paths = [
        "@rpath/libsherpa-onnx-c-api.dylib",
        "@rpath/libonnxruntime.1.27.0.dylib",
      ];
      const fatBuf = createSyntheticFatMachO(paths);

      const result = patchMachOBinaryBuffer(fatBuf);
      expect(result.modified).toBe(true);
      expect(result.replacements).toBe(2);
    });

    test("skips patching when replacement would exceed allocated cmdsize space", () => {
      // cmdSize = 36, nameOffset = 24 -> available bytes = 36 - 24 = 12
      // Target string requires 39 bytes with null terminator, so it cannot fit
      const buf = createSyntheticMachO64("@rpath/x", 36, 24);
      const result = patchMachOBinaryBuffer(buf);
      // It should safely skip without corrupting memory
      expect(result.modified).toBe(false);
      expect(result.replacements).toBe(0);
    });
  });

  describe("patchMachOFile and directory scanning", () => {
    test("patches mach-o file on disk", () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "macho-patcher-test-")
      );
      try {
        const filePath = path.join(tmpDir, "sherpa-onnx.node");
        const buf = createSyntheticMachO64(
          "@rpath/libsherpa-onnx-c-api.dylib",
          64,
          24
        );
        fs.writeFileSync(filePath, buf);

        const patched = patchMachOFile(filePath);
        expect(patched).toBe(true);

        const readBack = fs.readFileSync(filePath);
        const nameOffset = 32 + 24;
        const str = readBack
          .toString("utf8", nameOffset, 32 + 64)
          .replace(/\0.*$/, "");
        expect(str).toBe("@loader_path/libsherpa-onnx-c-api.dylib");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("patchSherpaNativeOnnxInDirSync scans and patches matching files recursively", () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "macho-dir-patch-test-")
      );
      try {
        const subDir = path.join(
          tmpDir,
          "node_modules",
          "sherpa-onnx-darwin-arm64"
        );
        fs.mkdirSync(subDir, { recursive: true });

        const nodeFile = path.join(subDir, "sherpa-onnx.node");
        const dylibFile = path.join(subDir, "libsherpa-onnx-cxx-api.dylib");
        const txtFile = path.join(subDir, "README.txt");

        fs.writeFileSync(
          nodeFile,
          createSyntheticMachO64("@rpath/libsherpa-onnx-c-api.dylib")
        );
        fs.writeFileSync(
          dylibFile,
          createSyntheticMachO64("@rpath/libonnxruntime.1.27.0.dylib")
        );
        fs.writeFileSync(txtFile, "plain text file");

        const patched = patchSherpaNativeOnnxInDirSync(tmpDir);
        expect(patched.length).toBe(2);

        // A second pass should find 0 because they are already patched
        const patchedAgain = patchSherpaNativeOnnxInDirSync(tmpDir);
        expect(patchedAgain.length).toBe(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("patchSherpaNativeOnnxInDir async scans and patches matching files", async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "macho-async-patch-test-")
      );
      try {
        const nodeFile = path.join(tmpDir, "sherpa-onnx.node");
        fs.writeFileSync(
          nodeFile,
          createSyntheticMachO64("@rpath/libsherpa-onnx-c-api.dylib")
        );

        const patched = await patchSherpaNativeOnnxInDir(tmpDir);
        expect(patched.length).toBe(1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
