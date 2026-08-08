// Reusable production main-process Vite configuration shared by:
//   - vite.main.config.mjs            (Forge production/dev main build)
//   - vite.e2e.main.config.mjs        (Playwright Electron E2E main build)
//
// Keeping the externals list, resolve aliases, and platform copy/fix plugins in
// one place guarantees the E2E main bundle is bundled with the exact same native
// module / TypeORM rules as the production main bundle (design §6.4). Duplicating
// these long lists risks forgetting an external (e.g. electron-store, sqlite-vec)
// and silently breaking the E2E runtime.
//
// NOTE: This module is imported by Vite config files. Vite shims `__dirname` for
// the *config* file it loads, but NOT for modules imported from it. We therefore
// derive the project root from `import.meta.url` so the aliases resolve the same
// directory regardless of how the config is loaded.

import alias from "@rollup/plugin-alias";
import * as path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { builtinModules } from "node:module";

export const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Puppeteer packages use lazy require() patterns (clone-deep, merge-deep) that
// break when Vite/Rolldown bundles them. Keep in sync with forge.config.js
// EXTERNAL_DEPENDENCIES puppeteer entries.
export const PUPPETEER_EXTERNALS = [
  "puppeteer",
  "puppeteer-core",
  "puppeteer-extra",
  "puppeteer-extra-plugin-stealth",
  "puppeteer-extra-plugin-recaptcha",
  "@puppeteer/browsers",
  "@lem0-packages/puppeteer-page-proxy",
];

export const NODE_BUILTINS = [
  "electron",
  "electron/main",
  "electron/common",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export const MAIN_PROCESS_EXTERNALS = [
  ...NODE_BUILTINS,
  "sqlite3",
  "better-sqlite3",
  "bindings",
  "typeorm",
  "sqlite-vec",
  "canvas",
  "@napi-rs/canvas",
  "isolated-vm",
  // Already listed in forge EXTERNAL_DEPENDENCIES. Keep it out of the main
  // bundle so pdf-lib's ESM+tslib graph is never Vite-rewritten into a
  // ScheduleManager/startup CJS chunk.
  "pdf-lib",
  // Keep a single node_modules copy so electron-store's module-level IPC init
  // flag is shared (avoids stacking electron-store-get-data listeners across
  // Vite chunks/HMR).
  "electron-store",
  ...PUPPETEER_EXTERNALS,
];

// Create an empty module plugin
export function emptyModulesPlugin() {
  const emptyModules = [
    "@sap/hana-client/extension/Stream",
    "@sap/hana-client",
    "typeorm-aurora-data-api-driver",
    "@google-cloud/spanner",
    "mysql",
    "mysql2",
    "pg",
    "pg-query-stream",
    "pg-native",
    "mongodb",
    "mssql",
    "oracledb",
    "hdb-pool",
    "redis",
    "ioredis",
    "sql.js",
  ];

  return {
    name: "empty-modules",
    resolveId(id) {
      if (
        emptyModules.includes(id) ||
        emptyModules.some((m) => id.startsWith(`${m}/`))
      ) {
        return { id: "virtual:empty-module", external: false };
      }
      return null;
    },
    load(id) {
      if (id === "virtual:empty-module") {
        return "export default {}; export const Stream = {}; export const Readable = {}; export const Writable = {}; export const PassThrough = {}; export const createCanvas = () => ({}); export const loadImage = () => ({});";
      }
      return null;
    },
  };
}

// Fix _interopNamespaceDefault to handle undefined property descriptors
export function fixInteropNamespacePlugin() {
  return {
    name: "fix-interop-namespace",
    renderChunk(code, chunk, options) {
      let fixedCode = code;

      fixedCode = fixedCode.replace(
        /(\w+)\.get\s*\?\s*\1:/g,
        "$1&&$1.get?$1:"
      );

      fixedCode = fixedCode.replace(
        /(\w+)\.get\s+\?\s*\1\s+:/g,
        "$1 && $1.get ? $1 :"
      );

      if (fixedCode === code) return null;
      return { code: fixedCode, map: null };
    },
  };
}

// Custom platform-aware copy plugin. Copies icons, sqlite-vec native extension,
// and platform protocol-registry templates into the build output directory so
// the bundled main process can locate them at runtime (mirrors production).
export function platformCopyPlugin({ outDir = ".vite/build" } = {}) {
  return {
    name: "platform-copy",
    buildStart() {
      console.log("Platform detected:", process.platform);

      const templatesDir = path.join(outDir, "templates");
      if (!fs.existsSync(templatesDir)) {
        fs.mkdirSync(templatesDir, { recursive: true });
      }
      const iconSourceDir = "src/assets/images";
      const iconDestDir = outDir;

      if (!fs.existsSync(iconDestDir)) {
        fs.mkdirSync(iconDestDir, { recursive: true });
      }

      // Copy sqlite-vec native extension to build directory.
      console.log("Copying sqlite-vec native extension to build folder...");
      try {
        const arch = process.arch;
        const archMap = {
          x64: "x64",
          arm64: process.platform === "darwin" ? "arm64" : "aarch64",
          ia32: "x86",
        };
        const sqliteVecArch = archMap[arch] || arch;
        const os =
          process.platform === "win32"
            ? "windows"
            : process.platform === "darwin"
            ? "darwin"
            : "linux";
        const extensionName =
          process.platform === "win32"
            ? "vec0.dll"
            : process.platform === "darwin"
            ? "vec0.dylib"
            : "vec0.so";

        const packageNames = [
          `sqlite-vec-${os}-${sqliteVecArch}`,
          ...(sqliteVecArch !== arch ? [`sqlite-vec-${os}-${arch}`] : []),
        ];

        const destPath = path.join(iconDestDir, extensionName);
        let copied = false;

        for (const packageName of packageNames) {
          const sourcePath = path.join("node_modules", packageName, extensionName);
          if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, destPath);
            console.log(
              `Copied sqlite-vec extension: ${extensionName} from ${packageName} to ${destPath}`
            );
            copied = true;
            break;
          }
        }

        if (!copied) {
          console.warn(
            `sqlite-vec extension not found. Tried packages: ${packageNames.join(", ")}`
          );
          console.warn(`Platform: ${process.platform}, Arch: ${arch}`);
        }
      } catch (error) {
        console.error("Failed to copy sqlite-vec extension:", error);
      }

      // Copy platform-specific icons
      if (process.platform === "win32") {
        if (fs.existsSync(`${iconSourceDir}/icon.ico`)) {
          fs.copyFileSync(`${iconSourceDir}/icon.ico`, `${iconDestDir}/icon.ico`);
          console.log("Copied Windows icon (icon.ico)");
        }
      } else if (process.platform === "darwin") {
        if (fs.existsSync(`${iconSourceDir}/icon.icns`)) {
          fs.copyFileSync(`${iconSourceDir}/icon.icns`, `${iconDestDir}/icon.icns`);
          console.log("Copied macOS icon (icon.icns)");
        }
      } else if (process.platform === "linux") {
        if (fs.existsSync(`${iconSourceDir}/icon.png`)) {
          fs.copyFileSync(`${iconSourceDir}/icon.png`, `${iconDestDir}/icon.png`);
          console.log("Copied Linux icon (icon.png)");
        }
      }

      // Copy platform-specific protocol-registry templates (guarded for worktree
      // environments where node_modules may be sparse).
      if (process.platform === "linux") {
        console.log("Copying Linux templates...");
        const linuxFiles = [
          [
            "node_modules/protocol-registry/src/linux/templates/desktop.ejs",
            path.join(outDir, "templates/desktop.ejs"),
          ],
          [
            "node_modules/protocol-registry/src/linux/templates/script.ejs",
            path.join(outDir, "templates/script.ejs"),
          ],
          [
            "node_modules/protocol-registry/src/linux/index.js",
            path.join(outDir, "index.js"),
          ],
          [
            "node_modules/protocol-registry/src/linux/postinstall.js",
            path.join(outDir, "postinstall.js"),
          ],
        ];
        for (const [src, dest] of linuxFiles) {
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
          } else {
            console.warn(`Skipping copy: ${src} not found`);
          }
        }
      } else if (process.platform === "darwin") {
        console.log("Copying macOS templates...");
        fs.copyFileSync(
          "node_modules/protocol-registry/src/macos/templates/script.ejs",
          path.join(outDir, "templates/script.ejs")
        );
        fs.copyFileSync(
          "node_modules/protocol-registry/src/macos/templates/app.ejs",
          path.join(outDir, "templates/app.ejs")
        );
        fs.copyFileSync(
          "node_modules/protocol-registry/src/macos/templates/url-app.ejs",
          path.join(outDir, "templates/url-app.ejs")
        );
        fs.copyFileSync(
          "node_modules/protocol-registry/src/macos/defaultAppExist.sh",
          path.join(outDir, "defaultAppExist.sh")
        );
        fs.copyFileSync(
          "node_modules/protocol-registry/src/macos/index.js",
          path.join(outDir, "index.js")
        );
        fs.copyFileSync(
          "node_modules/protocol-registry/src/macos/plistMutator.js",
          path.join(outDir, "plistMutator.js")
        );
      } else if (process.platform === "win32") {
        console.log("Copying Windows templates...");
        fs.copyFileSync(
          "node_modules/protocol-registry/src/windows/templates/app-script.ejs",
          path.join(outDir, "templates/app-script.ejs")
        );
        fs.copyFileSync(
          "node_modules/protocol-registry/src/windows/index.js",
          path.join(outDir, "index.js")
        );
        fs.copyFileSync(
          "node_modules/protocol-registry/src/windows/registry.js",
          path.join(outDir, "registry.js")
        );
      }
    },
  };
}

// Shared resolve.alias map for the main process bundle.
export const MAIN_PROCESS_RESOLVE_ALIAS = {
  "@": path.resolve(projectRoot, "./src"),
  "@sap/hana-client/extension/Stream": path.resolve(
    projectRoot,
    "./src/utils/typeorm-shim.ts"
  ),
  "@sap/hana-client": path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  "typeorm-aurora-data-api-driver": path.resolve(
    projectRoot,
    "./src/utils/typeorm-shim.ts"
  ),
  "@google-cloud/spanner": path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  mysql: path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  mysql2: path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  pg: path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  "pg-query-stream": path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  mongodb: path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  mssql: path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  oracledb: path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  "hdb-pool": path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  "pg-native": path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  redis: path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  ioredis: path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  "sql.js": path.resolve(projectRoot, "./src/utils/typeorm-shim.ts"),
  canvas: "@napi-rs/canvas",
  // Force tslib's CJS entry. Vite resolves `import … from "tslib"` to
  // tslib/modules/index.js (package "exports"."import"."node"), which
  // default-imports tslib.js and destructures `{ __extends }`. Under Electron CJS
  // output that becomes `.default` === undefined and crashes packaged code.
  tslib: path.resolve(projectRoot, "./node_modules/tslib/tslib.js"),
};

// The base plugin set every main-process build uses (alias resolution, empty
// db-driver shims, sqlite-vec/icon copies, interop fix). Config files add their
// own extras (ClosePlugin, vite-plugin-checker) on top.
export function createMainBasePlugins({ outDir } = {}) {
  return [
    alias(),
    emptyModulesPlugin(),
    platformCopyPlugin({ outDir }),
    fixInteropNamespacePlugin(),
  ];
}
