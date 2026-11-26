/**
 * Local AI Runtime — Mach-O loader path patcher.
 *
 * Rewrites dynamic library dependencies in Mach-O binaries (.node addons and .dylib files)
 * from `@rpath/...` to `@loader_path/...`.
 *
 * Background:
 * On macOS, native packages like `sherpa-onnx-darwin-arm64` and `sherpa-onnx-darwin-x64`
 * are linked against companion shared libraries (`libsherpa-onnx-c-api.dylib`,
 * `libonnxruntime.dylib`) via `@rpath/...`. When loaded at runtime from dynamically
 * downloaded locations (e.g. userData/local-ai or staging), macOS `dyld` cannot resolve
 * these `@rpath` references unless `DYLD_LIBRARY_PATH` is set. However, modern macOS
 * System Integrity Protection (SIP) and Hardened Runtime strip `DYLD_LIBRARY_PATH` from
 * Electron processes and helper utilityProcesses.
 *
 * Rewriting `@rpath/...` to `@loader_path/...` enables the macOS dynamic linker to find
 * companion libraries directly in the same folder as the binary itself, eliminating any
 * reliance on `DYLD_LIBRARY_PATH` or rpath inheritance.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, promises as fsPromises } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MH_MAGIC_64 = 0xfeedfacf; // 64-bit Little Endian
const FAT_MAGIC = 0xcafebabe; // FAT binary Big Endian
const FAT_CIGAM = 0xbebafeca; // FAT binary Little Endian

const LC_LOAD_DYLIB = 0x0c;
const LC_LOAD_WEAK_DYLIB = 0x18 | 0x80000000;

export interface MachOPatchResult {
  modified: boolean;
  replacements: number;
}

/**
 * Patch Mach-O binary in-memory buffer, replacing `@rpath/...` with `@loader_path/...`
 * within load commands where the new string fits into the existing command payload.
 */
export function patchMachOBinaryBuffer(buf: Buffer): MachOPatchResult {
  let replacements = 0;

  function patchSlice(sliceBuf: Buffer): void {
    if (sliceBuf.length < 32) return;
    const magic = sliceBuf.readUInt32LE(0);
    if (magic !== MH_MAGIC_64) return;

    const ncmds = sliceBuf.readUInt32LE(16);
    let cmdOffset = 32;

    for (let i = 0; i < ncmds; i++) {
      if (cmdOffset + 8 > sliceBuf.length) break;
      const cmd = sliceBuf.readUInt32LE(cmdOffset);
      const cmdSize = sliceBuf.readUInt32LE(cmdOffset + 4);
      if (cmdSize < 8 || cmdOffset + cmdSize > sliceBuf.length) break;

      if (cmd === LC_LOAD_DYLIB || cmd === LC_LOAD_WEAK_DYLIB) {
        const strOffset = sliceBuf.readUInt32LE(cmdOffset + 8);
        if (strOffset < cmdSize) {
          const strMaxLen = cmdSize - strOffset;
          const str = sliceBuf
            .toString("utf8", cmdOffset + strOffset, cmdOffset + cmdSize)
            .replace(/\0.*$/, "");

          let newStr: string | null = null;
          if (str.startsWith("@rpath/libsherpa-onnx-")) {
            newStr = "@loader_path/" + str.slice(7);
          } else if (str.startsWith("@rpath/libonnxruntime.")) {
            // Target libonnxruntime.dylib in the same folder.
            newStr = "@loader_path/libonnxruntime.dylib";
          } else if (str.startsWith("@rpath/")) {
            const candidate = "@loader_path/" + str.slice(7);
            if (Buffer.byteLength(candidate + "\0") <= strMaxLen) {
              newStr = candidate;
            }
          }

          if (newStr) {
            const newBuf = Buffer.from(newStr + "\0", "utf8");
            if (newBuf.length <= strMaxLen) {
              newBuf.copy(sliceBuf, cmdOffset + strOffset);
              // Zero out the remaining padding in the command string buffer
              sliceBuf.fill(0, cmdOffset + strOffset + newBuf.length, cmdOffset + cmdSize);
              replacements++;
            }
          }
        }
      }
      cmdOffset += cmdSize;
    }
  }

  if (buf.length < 8) return { modified: false, replacements: 0 };
  const magic = buf.readUInt32LE(0);
  const magicBE = buf.readUInt32BE(0);

  if (magic === MH_MAGIC_64) {
    patchSlice(buf);
  } else if (magicBE === FAT_MAGIC || magicBE === FAT_CIGAM) {
    const isBe = magicBE === FAT_MAGIC;
    const nfatArch = isBe ? buf.readUInt32BE(4) : buf.readUInt32LE(4);
    for (let a = 0; a < nfatArch; a++) {
      const archOffset = 8 + a * 20;
      if (archOffset + 16 > buf.length) break;
      const offset = isBe ? buf.readUInt32BE(archOffset + 8) : buf.readUInt32LE(archOffset + 8);
      const size = isBe ? buf.readUInt32BE(archOffset + 12) : buf.readUInt32LE(archOffset + 12);
      if (offset + size <= buf.length) {
        patchSlice(buf.subarray(offset, offset + size));
      }
    }
  }

  return { modified: replacements > 0, replacements };
}

/**
 * Re-sign a patched binary with an ad-hoc signature on macOS so the kernel
 * code-signature check passes on Apple Silicon / macOS.
 */
export function resignMachOAdHoc(filePath: string): boolean {
  if (process.platform !== "darwin") {
    return true;
  }
  try {
    const res = spawnSync("/usr/bin/codesign", ["-f", "-s", "-", filePath], {
      stdio: "ignore",
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Patch a single Mach-O file on disk, re-signing it if modified.
 */
export function patchMachOFile(filePath: string): boolean {
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch {
    return false;
  }

  const { modified } = patchMachOBinaryBuffer(buf);
  if (!modified) {
    return false;
  }

  try {
    writeFileSync(filePath, buf);
    resignMachOAdHoc(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively find and patch any `.node` or `.dylib` Mach-O binaries in `rootDir`.
 * Returns the list of modified file paths.
 */
export function patchSherpaNativeOnnxInDirSync(rootDir: string): string[] {
  const modifiedFiles: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const name of entries) {
      const fullPath = path.join(current, name);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        stack.push(fullPath);
      } else if (stat.isFile()) {
        const lower = name.toLowerCase();
        if (lower.endsWith(".node") || lower.endsWith(".dylib")) {
          if (patchMachOFile(fullPath)) {
            modifiedFiles.push(fullPath);
          }
        }
      }
    }
  }

  return modifiedFiles;
}

/**
 * Asynchronous variant of `patchSherpaNativeOnnxInDirSync`.
 */
export async function patchSherpaNativeOnnxInDir(rootDir: string): Promise<string[]> {
  const modifiedFiles: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: string[] = [];
    try {
      entries = await fsPromises.readdir(current);
    } catch {
      continue;
    }

    for (const name of entries) {
      const fullPath = path.join(current, name);
      let stat;
      try {
        stat = await fsPromises.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        stack.push(fullPath);
      } else if (stat.isFile()) {
        const lower = name.toLowerCase();
        if (lower.endsWith(".node") || lower.endsWith(".dylib")) {
          if (patchMachOFile(fullPath)) {
            modifiedFiles.push(fullPath);
          }
        }
      }
    }
  }

  return modifiedFiles;
}
