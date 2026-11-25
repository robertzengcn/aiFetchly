/**
 * Local AI Runtime — Mach-O loader path patcher for build scripts.
 *
 * Rewrites dynamic library dependencies in Mach-O binaries (.node addons and .dylib files)
 * from `@rpath/...` to `@loader_path/...`.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const FAT_CIGAM = 0xbebafeca;

const LC_LOAD_DYLIB = 0x0c;
const LC_LOAD_WEAK_DYLIB = 0x18 | 0x80000000;

export function patchMachOBinaryBuffer(buf) {
  let replacements = 0;

  function patchSlice(sliceBuf) {
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

          let newStr = null;
          if (str.startsWith("@rpath/libsherpa-onnx-")) {
            newStr = "@loader_path/" + str.slice(7);
          } else if (str.startsWith("@rpath/libonnxruntime.")) {
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

export function resignMachOAdHoc(filePath) {
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

export function patchMachOFile(filePath) {
  let buf;
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

export function patchSherpaNativeOnnxInDirSync(rootDir) {
  const modifiedFiles = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries = [];
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
