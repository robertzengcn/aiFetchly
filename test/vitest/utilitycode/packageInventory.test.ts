import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  detectBinaryFormat,
  detectBinaryArch,
  classifyPackage,
  buildInventory,
} from "../../../scripts/lib/localAiRuntime/packageInventory.mjs";

/** Minimal PE header: MZ, e_lfanew -> 0x40, PE\0\0 at 0x40, machine at 0x44. */
function peHeader(machine: number): Buffer {
  const b = Buffer.alloc(0x50, 0);
  b.write("MZ", 0, "ascii");
  b.writeUInt32LE(0x40, 0x3c);
  b.write("PE\0\0", 0x40, "ascii");
  b.writeUInt16LE(machine, 0x44);
  return b;
}
const PE_X64 = 0x8664;
const PE_ARM64 = 0xaa64;
const PE_IA32 = 0x014c;

/** Minimal ELF header: \x7fELF, e_machine at offset 0x12. */
function elfHeader(machine: number): Buffer {
  const b = Buffer.alloc(24, 0);
  b.write("\x7fELF", 0, "ascii");
  b.writeUInt16LE(machine, 0x12);
  return b;
}
const ELF_X64 = 0x3e;
const ELF_ARM64 = 0xb7;

/** Minimal Mach-O 64 header: magic 0xFEEDFACF (LE bytes CF FA ED FE), cputype at 4. */
function machoHeader(cputype: number): Buffer {
  const b = Buffer.alloc(12, 0);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(cputype, 4);
  return b;
}
const MACHO_X64 = 0x01000007;
const MACHO_ARM64 = 0x0100000c;

describe("detectBinaryFormat", () => {
  test("PE / ELF / Mach-O by magic bytes", () => {
    expect(detectBinaryFormat(peHeader(PE_X64), "x.dll")).toBe("pe");
    expect(detectBinaryFormat(elfHeader(ELF_X64), "lib.so")).toBe("elf");
    expect(detectBinaryFormat(machoHeader(MACHO_X64), "lib.dylib")).toBe(
      "mach-o"
    );
  });
  test(".node addon is labelled node-addon even over a Mach-O header", () => {
    expect(
      detectBinaryFormat(machoHeader(MACHO_ARM64), "better_sqlite3.node")
    ).toBe("node-addon");
    expect(detectBinaryFormat(peHeader(PE_X64), "addon.node")).toBe(
      "node-addon"
    );
  });
  test("unknown bytes → unknown", () => {
    expect(detectBinaryFormat(Buffer.from("hello world"), "note.txt")).toBe(
      "unknown"
    );
  });
});

describe("detectBinaryArch", () => {
  test("PE machine field", () => {
    expect(detectBinaryArch(peHeader(PE_X64), "pe")).toBe("x64");
    expect(detectBinaryArch(peHeader(PE_ARM64), "pe")).toBe("arm64");
    expect(detectBinaryArch(peHeader(PE_IA32), "pe")).toBe("ia32");
  });
  test("ELF e_machine field", () => {
    expect(detectBinaryArch(elfHeader(ELF_X64), "elf")).toBe("x64");
    expect(detectBinaryArch(elfHeader(ELF_ARM64), "elf")).toBe("arm64");
  });
  test("Mach-O cputype", () => {
    expect(detectBinaryArch(machoHeader(MACHO_X64), "mach-o")).toBe("x64");
    expect(detectBinaryArch(machoHeader(MACHO_ARM64), "mach-o")).toBe("arm64");
  });
  test("node-addon resolves arch through the underlying header", () => {
    expect(detectBinaryArch(peHeader(PE_X64), "node-addon")).toBe("x64");
    expect(detectBinaryArch(machoHeader(MACHO_ARM64), "node-addon")).toBe(
      "arm64"
    );
  });
});

describe("classifyPackage", () => {
  const fields = {
    dependencies: { "better-sqlite3": "^11.0.0", vue: "^3.0.0" },
    devDependencies: { vite: "^5.0.0" },
    optionalDependencies: { "sqlite-vec-windows-x64": "^0.1.9" },
  };
  test("production / development / optional / unknown", () => {
    expect(classifyPackage("better-sqlite3", fields)).toBe("production");
    expect(classifyPackage("vite", fields)).toBe("development");
    expect(classifyPackage("sqlite-vec-windows-x64", fields)).toBe("optional");
    expect(classifyPackage("mystery", fields)).toBe("unknown");
  });
});

describe("buildInventory", () => {
  test("walks node_modules + native binaries into an inventory", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-inv-"));
    try {
      const rootPkg = {
        name: "aifetchly",
        version: "1.0.0",
        dependencies: { "better-sqlite3": "^11.0.0" },
        devDependencies: { vite: "^5.0.0" },
      };
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(rootPkg));

      const nm = path.join(tmp, "node_modules", "better-sqlite3");
      fs.mkdirSync(nm, { recursive: true });
      fs.writeFileSync(
        path.join(nm, "package.json"),
        JSON.stringify({ name: "better-sqlite3", version: "11.9.1" })
      );
      fs.writeFileSync(path.join(nm, "better_sqlite3.node"), peHeader(PE_X64));

      // A foreign-format binary loose in the app dir.
      fs.writeFileSync(path.join(tmp, "stray.dylib"), machoHeader(MACHO_ARM64));

      const inventory = buildInventory(tmp, rootPkg, {
        platform: "win32",
        arch: "x64",
        artifactName: "test-app",
      });

      expect(inventory.schemaVersion).toBe(1);
      expect(inventory.platform).toBe("win32");
      const pkg = inventory.packages.find((p) => p.name === "better-sqlite3");
      expect(pkg?.dependencyClass).toBe("production");
      expect(pkg?.version).toBe("11.9.1");

      const node = inventory.nativeFiles.find((f) =>
        f.relativePath.endsWith("better_sqlite3.node")
      );
      expect(node?.format).toBe("node-addon");
      expect(node?.detectedArch).toBe("x64");

      const dylib = inventory.nativeFiles.find((f) =>
        f.relativePath.endsWith("stray.dylib")
      );
      expect(dylib?.format).toBe("mach-o");
      expect(dylib?.detectedArch).toBe("arm64");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
