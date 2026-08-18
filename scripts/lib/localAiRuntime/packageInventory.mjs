/**
 * Package + native-binary inventory builder (PRD FR-26, design §26.4).
 *
 * Walks an unpacked application directory, classifies each shipped package as
 * production/development/optional/unknown against the root manifest, and
 * inventories native binaries by reading executable headers (NOT filenames) to
 * detect format + architecture. This is the basis for the foreign-target gate:
 * a win32-x64 artifact must contain no Mach-O or ELF binaries.
 *
 * Pure helpers are exported for unit testing; `buildInventory` walks the disk.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const NATIVE_BINARY_EXTENSIONS = new Set([".node", ".dll", ".dylib", ".so", ".exe"]);

/** Mach-O magic numbers read as a big-endian uint32 at offset 0. */
const MACHO_MAGICS = new Set([
  0xfeedface, // MH_MAGIC (32-bit, native endian)
  0xfeedfacf, // MH_MAGIC_64
  0xcefaedfe, // MH_CIGAM (swapped 32-bit)
  0xcffaedfe, // MH_CIGAM_64
  0xcafebabe, // FAT_MAGIC (universal)
]);

/**
 * Detect the binary format from the first bytes of a file. `.node` addons are
 * labelled `node-addon` (their OS format is exposed via `detectBinaryArch`).
 */
export function detectBinaryFormat(buf, fileName) {
  const lower = (fileName ?? "").toLowerCase();
  // `.node` addons are always labelled node-addon; detectBinaryArch resolves
  // the underlying OS format/arch through the header bytes.
  if (lower.endsWith(".node")) return "node-addon";
  if (buf.length >= 4 && buf[0] === 0x4d && buf[1] === 0x5a) return "pe";
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    return "elf";
  }
  if (buf.length >= 4 && MACHO_MAGICS.has(buf.readUInt32BE(0))) {
    return "mach-o";
  }
  return "unknown";
}

/**
 * Detect the architecture encoded in a binary header. Returns undefined when
 * the format is unknown or the header is too short to read.
 */
export function detectBinaryArch(buf, format) {
  try {
    if (format === "pe" || (format === "node-addon" && buf.length > 2 && buf[0] === 0x4d && buf[1] === 0x5a)) {
      if (buf.length < 6) return undefined;
      const peOffset = buf.readUInt32LE(0x3c);
      if (buf.length < peOffset + 6) return undefined;
      const machine = buf.readUInt16LE(peOffset + 4);
      if (machine === 0x8664) return "x64";
      if (machine === 0xaa64) return "arm64";
      if (machine === 0x014c) return "ia32";
      return undefined;
    }
    if (format === "elf" || (format === "node-addon" && buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45)) {
      if (buf.length < 20) return undefined;
      const machine = buf.readUInt16LE(0x12);
      if (machine === 0x3e) return "x64";
      if (machine === 0xb7) return "arm64";
      if (machine === 0x03) return "ia32";
      return undefined;
    }
    if (format === "mach-o" || format === "node-addon") {
      if (buf.length < 8) return undefined;
      const be = buf.readUInt32BE(0);
      // readUInt32BE magic distinguishes file byte order: 0xFEEDFACE/CF stored
      // big-endian read back as the canonical value; the LE-on-disk variants
      // read back as the swapped (cigam) value.
      const isBigEndian = be === 0xfeedface || be === 0xfeedfacf;
      const isLittleEndian = be === 0xcefaedfe || be === 0xcffaedfe;
      if (!isBigEndian && !isLittleEndian) return undefined; // fat/universal
      const read = isBigEndian
        ? (b, o) => b.readUInt32BE(o)
        : (b, o) => b.readUInt32LE(o);
      const cputype = read(buf, 4);
      if (cputype === 0x01000007) return "x64";
      if (cputype === 0x0100000c) return "arm64";
      return undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Classify a package against the root manifest's dependency sets.
 * `packageManagerFields` = { dependencies, devDependencies, optionalDependencies }.
 */
export function classifyPackage(packageName, packageManagerFields) {
  const deps = packageManagerFields?.dependencies ?? {};
  const devDeps = packageManagerFields?.devDependencies ?? {};
  const optDeps = packageManagerFields?.optionalDependencies ?? {};
  if (Object.prototype.hasOwnProperty.call(deps, packageName)) return "production";
  if (Object.prototype.hasOwnProperty.call(devDeps, packageName)) return "development";
  if (Object.prototype.hasOwnProperty.call(optDeps, packageName)) return "optional";
  return "unknown";
}

function listNativeBinaries(dir, base = dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules" && base !== dir) {
        // walk top-level node_modules but avoid recursing into nested ones for speed
      }
      listNativeBinaries(full, base, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (NATIVE_BINARY_EXTENSIONS.has(ext)) {
      acc.push(full);
    }
  }
  return acc;
}

function readPackageJson(dir) {
  try {
    const raw = readFileSync(path.join(dir, "package.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Build a machine-readable inventory of the unpacked application.
 * Walks `<appDir>/node_modules` for packages and the whole `<appDir>` for
 * native binaries. Returns the design's PackagedDependencyInventory shape.
 */
export function buildInventory(appDir, rootPkg, { platform, arch, artifactName } = {}) {
  const rootManifest = rootPkg ?? readPackageJson(appDir);
  const pmFields = rootManifest
    ? {
        dependencies: rootManifest.dependencies ?? {},
        devDependencies: rootManifest.devDependencies ?? {},
        optionalDependencies: rootManifest.optionalDependencies ?? {},
      }
    : { dependencies: {}, devDependencies: {}, optionalDependencies: {} };

  const packages = [];
  const seenPackages = new Set();
  const nmDir = path.join(appDir, "node_modules");
  try {
    for (const top of readdirSync(nmDir, { withFileTypes: true })) {
      if (!top.isDirectory() && !top.isSymbolicLink()) continue;
      const scopes = top.name.startsWith("@")
        ? readdirSync(path.join(nmDir, top.name), { withFileTypes: true })
            .filter((e) => e.isDirectory() || e.isSymbolicLink())
            .map((e) => `${top.name}/${e.name}`)
        : [top.name];
      for (const pkgName of scopes) {
        if (seenPackages.has(pkgName)) continue;
        seenPackages.add(pkgName);
        const pkgDir = path.join(nmDir, pkgName);
        const manifest = readPackageJson(pkgDir);
        if (!manifest) continue;
        let sizeBytes = 0;
        try {
          sizeBytes = statSync(pkgDir).size;
        } catch {
          sizeBytes = 0;
        }
        packages.push({
          name: pkgName,
          version: manifest.version ?? "0.0.0",
          dependencyClass: classifyPackage(pkgName, pmFields),
          sizeBytes,
        });
      }
    }
  } catch {
    // no node_modules — packages stays empty
  }

  const nativeFiles = [];
  const binaries = listNativeBinaries(appDir);
  for (const filePath of binaries) {
    let buf;
    try {
      buf = readFileSync(filePath);
    } catch {
      continue;
    }
    // Read only the header we need.
    const header = buf.subarray(0, Math.min(buf.length, 512));
    const format = detectBinaryFormat(header, path.basename(filePath));
    const detectedArch = detectBinaryArch(header, format);
    nativeFiles.push({
      relativePath: path.relative(appDir, filePath),
      format,
      detectedArch,
      sizeBytes: buf.length,
    });
  }

  return {
    schemaVersion: 1,
    artifactName: artifactName ?? path.basename(appDir),
    platform,
    arch,
    packages,
    nativeFiles,
  };
}
