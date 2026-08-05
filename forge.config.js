const path = require("path");
const dotenv = require("dotenv");
const { spawnSync } = require("node:child_process");
const {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
} = require("node:fs");
const { builtinModules } = require("node:module");
const { join, normalize } = require("node:path");
const { Walker, DepType } = require("flora-colossus");
let nativeModuleDependenciesToPackage = [];
/** @type {Set<string>} */
let allowedPackagedModules = new Set();
/** @type {Set<string>} */
let allowedScopedDirectories = new Set();

function rebuildPackagerAllowLists(moduleNames) {
  allowedPackagedModules = new Set(moduleNames);
  allowedScopedDirectories = new Set();
  for (const dep of allowedPackagedModules) {
    if (dep.startsWith("@")) {
      allowedScopedDirectories.add(dep.split("/")[0]);
    }
  }
}

/**
 * O(1) keep/ignore decision for electron-packager's ignore filter.
 * The previous implementation scanned the full dependency list for every file
 * under node_modules (100k+ calls × hundreds of deps), which hung CI packaging.
 */
function shouldKeepPackagedPath(filePath) {
  if (filePath === "") return true;
  if (filePath === "/package.json") return true;
  if (filePath === "/node_modules") return true;
  if (filePath === "/.vite" || filePath.startsWith("/.vite/")) return true;
  if (filePath === "/dist") return true;
  if (
    filePath === "/dist/childprocess" ||
    filePath.startsWith("/dist/childprocess/")
  ) {
    return true;
  }

  if (!filePath.startsWith("/node_modules/")) return false;

  const relPath = filePath.slice("/node_modules/".length).replace(/\/$/, "");
  if (relPath === "") return true;

  const segments = relPath.split("/").filter(Boolean);
  if (segments[0].startsWith("@")) {
    if (segments.length === 1) {
      return allowedScopedDirectories.has(segments[0]);
    }
    return allowedPackagedModules.has(`${segments[0]}/${segments[1]}`);
  }
  return allowedPackagedModules.has(segments[0]);
}

function createPackagerIgnoreFilter() {
  const logKeeps = process.env.FORGE_PACKAGER_LOG_KEEPS === "1";
  return (file) => {
    const keep = shouldKeepPackagedPath(file.toLowerCase());
    if (keep && logKeeps) {
      console.log("Keeping:", file);
    }
    return !keep;
  };
}
const EXTERNAL_DEPENDENCIES = [
  "electron-store",
  "realm",
  "electron-squirrel-startup",
  "update-electron-app",
  "better-sqlite3",
  "sqlite-vec",
  "chokidar",
  "puppeteer-cluster",
  "lodash",
  "winston",
  "user-agents",
  "puppeteer",
  "puppeteer-extra",
  "puppeteer-extra-plugin-stealth",
  //'puppeteer-extra-plugin-adblocker',
  "puppeteer-extra-plugin-recaptcha",
  "@lem0-packages/puppeteer-page-proxy",
  "nodemailer",
  "decamelize",
  "camelcase",
  "js-tiktoken",
  "p-retry",
  "langsmith",
  "@cfworker/json-schema",
  "mustache",
  "openai",
  "typeorm",
  "cheerio",
  "sanitize-html",
  "html-to-text",
  "sqlite-vec",
  "canvas",
  "@napi-rs/canvas",
  "reflect-metadata",
  "@mixmark-io/domino",
  "electron-log",
  // Phase 9 slim installer: local-AI inference packages are excluded from the
  // base app — they ship as downloadable runtimes (PRD FR-16, design §26.7).
  // "@xenova/transformers", "onnxruntime-node", "onnxruntime-common",
  // "sharp", "sherpa-onnx-node"
  // Runtime deps required by the packaged ContactExtractionWorker bundle
  // (vite.contactExtractionWorker.config.mjs keeps node_modules external).
  // The worker is spawned with Electron's RUN_AS_NODE runtime, so these must
  // be present in app.asar/node_modules. Keep in sync with the bundle's
  // runtime requires (verified by verifyGeneratedRuntimeRequires).
  "uuid",
  "adm-zip",
  "chardet",
  "cron",
  "cron-validator",
  "debug",
  "diff",
  "dotenv",
  "fast-glob",
  "form-data",
  "iconv-lite",
  "imapflow",
  "isbinaryfile",
  "mailparser",
  "mammoth",
  "node-fetch",
  "node-machine-id",
  "papaparse",
  "pdf-lib",
  "pdf2md-ts",
  "picomatch",
  "turndown",
  "write-file-atomic",
  "ws",
  "xlsx",
  "zod",
  "@puppeteer/browsers",
  // Runtime dependencies emitted by the main and copied Windows bundles.
  "ajv",
  "ajv-formats",
  "puppeteer-core",
  "winreg",
  "ejs",
  "plist",
  "isolated-vm",
];
// Generated bundles may emit runtime `require(...)` calls for external packages.
// packageAfterPrune discovers every generated JavaScript bundle instead of relying
// on a hand-maintained worker allow-list.
function getGeneratedRuntimeRequireBundles(buildPath) {
  const bundleRoots = [
    join(buildPath, ".vite", "build"),
    join(buildPath, "dist", "childprocess"),
  ];
  const bundles = [];

  function collectBundles(directoryPath) {
    if (!existsSync(directoryPath)) {
      return;
    }

    for (const fileName of readdirSync(directoryPath)) {
      const filePath = join(directoryPath, fileName);
      if (statSync(filePath).isDirectory()) {
        collectBundles(filePath);
      } else if (fileName.endsWith(".js")) {
        bundles.push(filePath);
      }
    }
  }

  for (const bundleRoot of bundleRoots) {
    collectBundles(bundleRoot);
  }

  return bundles;
}
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

function getPackageRootName(packageName) {
  if (packageName.startsWith("@")) {
    const [scope, name] = packageName.split("/");
    return name ? `${scope}/${name}` : packageName;
  }
  return packageName.split("/")[0];
}

function getRuntimePackageName(importId) {
  if (
    importId.startsWith(".") ||
    importId.startsWith("/") ||
    importId === "electron" ||
    importId.startsWith("@/") ||
    NODE_BUILTINS.has(importId)
  ) {
    return null;
  }
  return getPackageRootName(importId);
}

function extractRuntimePackageRequires(filePath) {
  const source = readFileSync(filePath, "utf-8");
  const requirePattern = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  const packageNames = new Set();
  let match = requirePattern.exec(source);
  while (match !== null) {
    const packageName = getRuntimePackageName(match[1]);
    if (packageName) {
      packageNames.add(packageName);
    }
    match = requirePattern.exec(source);
  }
  return packageNames;
}

function hasPackagedNodeModule(buildPath, packageName) {
  return existsSync(
    join(buildPath, "node_modules", ...packageName.split("/"), "package.json")
  );
}

function verifyGeneratedRuntimeRequires(buildPath) {
  const missing = [];

  for (const bundlePath of getGeneratedRuntimeRequireBundles(buildPath)) {
    const bundleFile = path.basename(bundlePath);
    for (const packageName of extractRuntimePackageRequires(bundlePath)) {
      if (!hasPackagedNodeModule(buildPath, packageName)) {
        missing.push(`${bundleFile}: ${packageName}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Packaged app is missing runtime dependencies required by generated bundles: ${missing.join(
        ", "
      )}. Add the package root to EXTERNAL_DEPENDENCIES in forge.config.js.`
    );
  }
}

//import { ForgeConfig } from '@electron-forge/shared-types';
// import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
// Base .env (CI writes this), then mode-specific overrides e.g. .env.test for NODE_ENV=test.
// Previously only `.env.${NODE_ENV}` was loaded, so `make-win:test` never saw vars from `.env`.
dotenv.config({ path: path.resolve(__dirname, ".env") });
const env = process.env.NODE_ENV || "development";
dotenv.config({ path: path.resolve(__dirname, `.env.${env}`) });

const isProductionBuild = env === "production";
const shouldBuildMacDmg = process.env.MAKE_MAC_DMG !== "false";
const windowsCertificatePath = path.resolve(__dirname, "cert.pfx");

function requireProductionEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Production packaging requires the ${name} environment variable.`
    );
  }
  return value;
}

if (isProductionBuild && process.platform === "win32") {
  if (!existsSync(windowsCertificatePath)) {
    throw new Error(
      "Production Windows packaging requires cert.pfx. Restore it from a CI secret before running Electron Forge."
    );
  }
  requireProductionEnv("CERTIFICATE_PASSWORD");
}

function ensureBetterSqliteElectronBinary() {
  const scriptPath = join(__dirname, "scripts", "rebuild-better-sqlite.js");
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: __dirname,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `better-sqlite3 Electron rebuild failed with exit code ${result.status}`
    );
  }
}

/**
 * Patches node-abi's abi_registry.json with missing Electron ABI entries
 * (41-44) so @electron/rebuild can resolve Electron 43.x. See
 * scripts/patch-node-abi.js for the full rationale. Runs as a safety net in
 * the prePackage hook for cases where electron-forge is launched directly
 * (e.g. from VS Code/Cursor), bypassing the npm `prepackage` script.
 */
function ensureNodeAbiPatched() {
  const scriptPath = join(__dirname, "scripts", "patch-node-abi.js");
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: __dirname,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`node-abi patch failed with exit code ${result.status}`);
  }
}

function fixInteropNamespaceDefault(viteBuildDir) {
  const fs = require("fs");

  if (!existsSync(viteBuildDir)) {
    return;
  }

  const files = fs.readdirSync(viteBuildDir);
  for (const file of files) {
    if (file.startsWith("background") && file.endsWith(".js")) {
      const filePath = join(viteBuildDir, file);
      let content = fs.readFileSync(filePath, "utf-8");

      // Fix: d.get ? d : -> d && d.get ? d : (handles undefined property descriptors)
      const originalContent = content;
      content = content.replace(
        /Object\.defineProperty\((\w),(\w),(\w)\.get\?(\w):/g,
        "Object.defineProperty($1,$2,$3&&$3.get?$4:"
      );

      if (content !== originalContent) {
        fs.writeFileSync(filePath, content);
        console.log("Fixed _interopNamespaceDefault in:", filePath);
      }
    }
  }
}

function copyBuiltChildProcesses(buildPath) {
  const sourcePath = join(__dirname, "dist", "childprocess");
  if (!existsSync(sourcePath)) {
    console.warn(
      `No built childprocess directory found at ${sourcePath}; skipping package copy.`
    );
    return;
  }

  const targetPath = join(buildPath, "dist", "childprocess");
  cpSync(sourcePath, targetPath, { recursive: true });
  console.log(`Copied built childprocess files into package: ${targetPath}`);
}

module.exports = {
  packagerConfig: {
    icon: "./src/assets/images/icon",
    ...(isProductionBuild && process.platform === "darwin"
      ? {
          osxSign: {},
          osxNotarize: {
            appleId: requireProductionEnv("APPLE_ID"),
            appleIdPassword: requireProductionEnv(
              "APPLE_APP_SPECIFIC_PASSWORD"
            ),
            teamId: requireProductionEnv("APPLE_TEAM_ID"),
          },
        }
      : {}),
    ...(isProductionBuild && process.platform === "win32"
      ? {
          windowsSign: {
            certificateFile: windowsCertificatePath,
            certificatePassword: requireProductionEnv("CERTIFICATE_PASSWORD"),
          },
        }
      : {}),
    // asar: {
    //   // This ensures native modules are unpacked
    //   unpack: "**/node_modules/better-sqlite3/**",

    // },
    asar: {
      // .vite/build holds vec0.* copied by Vite; node_modules holds native deps — both must be real disk.
      // Phase 9 slim installer: only the database natives (better-sqlite3, sqlite-vec) are unpacked.
      // The AI inference natives (@xenova/transformers, onnxruntime-*, sharp, sherpa-onnx-*) are no
      // longer bundled — they ship as downloadable runtimes (PRD FR-16, design §26.7).
      //
      // IMPORTANT: @electron/asar matches unpackDir against the *directory* of each file
      // (path.dirname), not the file path. Patterns like "**/dist/childprocess/**" do NOT
      // match the directory "dist/childprocess" itself, so workers that live directly in
      // that folder stay packed. Include both the directory and its descendants.
      unpackDir:
        "{**/.vite/**,**/dist/childprocess,**/dist/childprocess/**,**/node_modules/better-sqlite3,**/node_modules/better-sqlite3/**,**/node_modules/sqlite-vec,**/node_modules/sqlite-vec/**}",
      unpack: "**/vec0.*",
    },
    ignore: createPackagerIgnoreFilter(),
    // ignore: [
    //   /node_modules\/(?!(better-sqlite3|bindings|file-uri-to-path)\/)/,
    // ],
    prune: true,
    overwrite: true,
  },
  rebuildConfig: {
    // isolated-vm@6.1.2 fails to compile against Electron 35 V8 13.5 headers
    // (known upstream issue: laverdet/isolated-vm#528). Exclude it from rebuild
    // so Forge startup is not blocked; the pre-built Node.js binary is used instead.
    onlyModules: ["better-sqlite3", "bufferutil", "utf-8-validate", "keytar"],
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: process.env.APP_NAME || "aiFetchly",
        ...(isProductionBuild && process.platform === "win32"
          ? {
              certificateFile: windowsCertificatePath,
              certificatePassword: requireProductionEnv("CERTIFICATE_PASSWORD"),
            }
          : {}),
        // iconUrl should be a valid HTTP/HTTPS URL, not a local path
        // iconUrl: './src/assets/images/icon.png',
        setupIcon: "./src/assets/images/icon.ico",
        // Custom installer options
        // loadingGif should be a valid HTTP/HTTPS URL, not a local path
        // loadingGif: './src/assets/images/installer-loading.gif', // Optional: Add a loading gif
        setupExe: "aiFetchlySetup.exe",
        // Allow users to choose installation directory
        allowDirectorySelection: true,
        // Create desktop shortcut
        createDesktopIcon: true,
        // Create start menu shortcut
        createStartMenuShortcut: true,
        // Install for all users (requires admin)
        installForAllUsers: false,
        // Custom installation directory
        defaultInstallLocation: "%LOCALAPPDATA%\\aiFetchly",
        // Additional options
        noMsi: true,
        // Custom installer text
        title: "aiFetchly Installer",
        description: "Install aiFetchly application",
        authors: "Robert Zeng",
        // Registry entries for uninstall
        registry: {
          key: "Software\\aiFetchly",
          name: "InstallLocation",
        },
        // Uninstall configuration
        uninstallIcon: "./src/assets/images/icon.ico",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    ...(shouldBuildMacDmg
      ? [
          {
            name: "@electron-forge/maker-dmg",
            config: {
              format: "ULFO",
              icon: "./src/assets/images/icon.icns",
              // Note: background image removed to prevent build failures
              // If needed, create src/assets/images/dmg-background.png and uncomment below
              // background: "./src/assets/images/dmg-background.png",
              // contents array removed - using electron-forge defaults
              // Defaults will place the app and a link to /Applications automatically
              window: {
                width: 540,
                height: 380,
              },
            },
          },
        ]
      : []),
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          icon: "./src/assets/images/icon.png",
          // Custom installer options for Linux
          maintainer: "Robert Zeng",
          homepage: "https://github.com/robertzengcn/aiFetchly",
          categories: ["Utility", "Network", "Web"],
          // Allow users to choose installation directory
          section: "utils",
          priority: "optional",
          // Create desktop shortcut
          desktop: {
            Name: "aiFetchly",
            Comment: "aiFetchly Application",
            GenericName: "aiFetchly",
            Categories: "Utility;Network;Web;",
            Keywords: "ai;marketing;automation;",
          },
          // Custom installation directory
          installDir: "/opt/aifetchly",
          // Additional options
          depends: [
            "nodejs",
            "libgtk-3-0",
            "libnotify4",
            "libnss3",
            "libxss1",
            "libxtst6",
            "xdg-utils",
            "libatspi2.0-0",
            "libdrm2",
            "libxkbcommon0",
            "libxcomposite1",
            "libxdamage1",
            "libxfixes3",
            "libxrandr2",
            "libgbm1",
            "libasound2",
          ],
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          icon: "./src/assets/images/icon.png",
          // Custom installer options for RPM
          maintainer: "Robert Zeng",
          homepage: "https://github.com/robertzengcn/aiFetchly",
          categories: ["Utility", "Network", "Web"],
          // Allow users to choose installation directory
          section: "utils",
          priority: "optional",
          // Create desktop shortcut
          desktop: {
            Name: "aiFetchly",
            Comment: "aiFetchly Application",
            GenericName: "aiFetchly",
            Categories: "Utility;Network;Web;",
            Keywords: "social;marketing;automation;",
          },
          // Custom installation directory
          installDir: "/opt/aifetchly",
          // Additional options
          depends: [
            "nodejs",
            "gtk3",
            "libnotify",
            "nss",
            "libXScrnSaver",
            "libXtst",
            "xdg-utils",
            "atk",
            "libdrm",
            "libxkbcommon",
            "libXcomposite",
            "libXdamage",
            "libXfixes",
            "libXrandr",
            "mesa-libgbm",
            "alsa-lib",
          ],
        },
      },
    },
    {
      name: "@electron-forge/maker-wix",
      config: {
        ...(isProductionBuild && process.platform === "win32"
          ? {
              certificateFile: windowsCertificatePath,
              certificatePassword: requireProductionEnv("CERTIFICATE_PASSWORD"),
            }
          : {}),
        language: 1033,
        manufacturer: "Robert Zeng",
        icon: "./src/assets/images/icon.ico",
        // Custom UI template
        ui: {
          chooseDirectory: true,
          //template: './wix-ui-template.xml'
          // images:{
          //   infoIcon: './src/assets/images/icon.ico'
          // }
        },
        // Installation directory options
        installDir: "C:\\Program Files\\aiFetchly",
        // Create desktop shortcut
        createDesktopShortcut: true,
        // Create start menu shortcut
        createStartMenuShortcut: true,
        // Install for all users
        //perMachine: false,
        // Additional features
        features: {
          // Main application feature
          main: {
            title: "aiFetchly Application",
            description: "Main application files",
            level: 1,
          },
          // Desktop shortcut feature
          desktopShortcut: {
            title: "Desktop Shortcut",
            description: "Create a shortcut on the desktop",
            level: 1,
          },
          // Start menu shortcut feature
          startMenuShortcut: {
            title: "Start Menu Shortcut",
            description: "Create a shortcut in the start menu",
            level: 1,
          },
        },
      },
    },
  ],
  // GitHub Releases publisher for Forge-native publishing (`yarn publish` /
  // `electron-forge publish`). NOTE: CI does NOT use this — it builds with
  // `electron-forge make` and publishes via the publish-github-release job in
  // .github/workflows/release.yml for explicit artifact validation. This block
  // enables local/forge-native publishing to the same repo. `draft: true` keeps
  // new releases invisible to update.electronjs.org until manually published.
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "robertzengcn",
          name: "aiFetchly",
        },
        draft: true,
        prerelease: false,
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    {
      name: "@electron-forge/plugin-vite",
      config: {
        // By default plugin-vite runs every build target concurrently
        // (see @electron-forge/plugin-vite VitePlugin.js: `concurrent ?? true`).
        // On resource-constrained CI runners (2 vCPU / 7 GB) running 17 Vite
        // bundles in parallel exhausts memory, leaving the heaviest targets
        // (main, renderer, taskCode, and the puppeteer-bundling worker builds)
        // stuck — `yarn package` then hangs until the runner is shut down
        // (this started once the YellowPagesScraperProcess target was added,
        // pushing the concurrent count past what the runner can sustain).
        // Limit parallelism on CI; keep full concurrency for local dev where
        // host resources are typically ample. concurrent=4 still OOMs
        // ubuntu-latest (7 GB) during yarn package — runner shutdown mid-build.
        // Override with ELECTRON_FORGE_VITE_CONCURRENT when needed.
        concurrent: process.env.CI
          ? Number(process.env.ELECTRON_FORGE_VITE_CONCURRENT ?? 2)
          : true,
        // `build` can specify multiple entry builds, which can be
        // Main process, Preload scripts, Worker process, etc.
        build: [
          {
            // `entry` is an alias for `build.lib.entry`
            // in the corresponding file of `config`.
            entry: "src/background",
            config: "vite.main.config.mjs",
          },
          {
            entry: "src/preload.ts",
            config: "vite.preload.config.mjs",
          },
          // {
          //   entry: 'src/utilityCode.ts',
          //   config: 'vite.utilityCode.config.mjs'
          // },
          {
            entry: "src/taskCode.ts",
            config: "vite.taskCode.config.mjs",
          },
          {
            entry: "src/childprocess/YellowPagesScraper.ts",
            config: "vite.yellowPages.config.mjs",
          },
          {
            entry: "src/childprocess/YellowPagesScraperProcess.ts",
            config: "vite.yellowPagesScraperProcess.config.mjs",
          },
          {
            entry: "src/childprocess/websiteContentScraper.ts",
            config: "vite.websiteContentScraper.config.mjs",
          },
          {
            entry: "src/childprocess/googleProxyCheck.ts",
            config: "vite.googleProxyCheck.config.mjs",
          },
          {
            entry: "src/childprocess/SkillWorker.ts",
            config: "vite.skillWorker.config.mjs",
          },
          {
            entry: "src/childprocess/PythonRuntimeWorker.ts",
            config: "vite.pythonRuntimeWorker.config.mjs",
          },
          {
            entry:
              "src/childprocess/contact-extraction/ContactExtractionWorker.ts",
            config: "vite.contactExtractionWorker.config.mjs",
          },
          {
            entry:
              "src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts",
            config: "vite.aifetchlyConfigWorker.config.mjs",
          },
          {
            entry: "src/childprocess/hook-execution/HookExecutionWorker.ts",
            config: "vite.hookExecutionWorker.config.mjs",
          },
          {
            entry: "src/childprocess/google-maps/GoogleMapsWorker.ts",
            config: "vite.googleMapsWorker.config.mjs",
          },
          {
            entry: "src/childprocess/yandex-maps/YandexMapsWorker.ts",
            config: "vite.yandexMapsWorker.config.mjs",
          },
          // {
          //   entry: 'src/buckEmail.ts',
          //   config: 'vite.buckEmail.config.mjs'
          // },
          {
            entry: "src/childprocess/embedding/LocalEmbeddingWorker.ts",
            config: "vite.localEmbeddingWorker.config.mjs",
          },
          {
            entry: "src/childprocess/ai-chat-voice/AiChatVoiceWorker.ts",
            config: "vite.aiChatVoiceWorker.config.mjs",
          },
        ],
        renderer: [
          {
            name: "main_window",
            config: "vite.render.config.mjs",
          },
        ],
      },
    },
  ],
  hooks: {
    // VS Code/Cursor launch electron-forge directly, bypassing npm prestart/predev.
    preStart: async () => {
      ensureBetterSqliteElectronBinary();
    },
    prePackage: async () => {
      // Patch node-abi before @electron/rebuild runs so it can resolve
      // Electron 43.x. Safety net for direct electron-forge invocations.
      ensureNodeAbiPatched();

      const projectRoot = normalize(__dirname);

      const getExternalNestedDependencies = async (
        nodeModuleNames,
        includeNestedDeps = true
      ) => {
        const foundModules = new Set(nodeModuleNames);
        if (includeNestedDeps) {
          for (const external of nodeModuleNames) {
            /**
             * @template T
             * @typedef {Object.<keyof T, T[keyof T]>} MyPublicClass
             */
            /**
             * @typedef {MyPublicClass<Walker> & {modules: Module[], walkDependenciesForModule: (moduleRoot: string, depType: DepType) => Promise<void>}} MyPublicWalker
             */
            const moduleRoot = join(projectRoot, "node_modules", external);
            const walker = new Walker(moduleRoot);
            walker.modules = [];
            await walker.walkDependenciesForModule(moduleRoot, DepType.PROD);
            walker.modules
              .filter((dep) => dep.nativeModuleType === DepType.PROD)
              .map((dep) => getPackageRootName(dep.name))
              .forEach((name) => foundModules.add(name));
          }
        }
        return foundModules;
      };
      const nativeModuleDependencies = await getExternalNestedDependencies(
        EXTERNAL_DEPENDENCIES
      );
      nativeModuleDependenciesToPackage = Array.from(nativeModuleDependencies);
      rebuildPackagerAllowLists(nativeModuleDependenciesToPackage);
    },
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      fixInteropNamespaceDefault(join(buildPath, ".vite", "build"));
      copyBuiltChildProcesses(buildPath);
    },
    //   packageAfterPrune: async (_config, buildPath) => {
    //     const gypPath = path.join(
    //       buildPath,
    //       'node_modules',
    //       'bufferutil',
    //       'build',
    //       'node_gyp_bins'
    //     );
    //     await fs.rm(gypPath, {recursive: true, force: true});
    //     const utfPaht=path.join(
    //       buildPath,
    //       'node_modules',
    //       'utf-8-validate',
    //       'build',
    //       'node_gyp_bins'
    //     );
    //     await fs.rm(utfPaht, {recursive: true, force: true});

    //  }
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      function getItemsFromFolder(path, totalCollection = []) {
        try {
          const normalizedPath = normalize(path);
          const childItems = readdirSync(normalizedPath);
          const getItemStats = statSync(normalizedPath);
          if (getItemStats.isDirectory()) {
            totalCollection.push({
              path: normalizedPath,
              type: "directory",
              empty: childItems.length === 0,
            });
          }
          childItems.forEach((childItem) => {
            const childItemNormalizedPath = join(normalizedPath, childItem);
            const childItemStats = statSync(childItemNormalizedPath);
            if (childItemStats.isDirectory()) {
              getItemsFromFolder(childItemNormalizedPath, totalCollection);
            } else {
              totalCollection.push({
                path: childItemNormalizedPath,
                type: "file",
                empty: false,
              });
            }
          });
        } catch {
          return;
        }
        return totalCollection;
      }

      const getItems = getItemsFromFolder(buildPath) ?? [];
      for (const item of getItems) {
        const DELETE_EMPTY_DIRECTORIES = true;
        if (item.empty === true) {
          if (DELETE_EMPTY_DIRECTORIES) {
            const pathToDelete = normalize(item.path);
            // one last check to make sure it is a directory and is empty
            const stats = statSync(pathToDelete);
            if (!stats.isDirectory()) {
              // SKIPPING DELETION: pathToDelete is not a directory
              return;
            }
            const childItems = readdirSync(pathToDelete);
            if (childItems.length !== 0) {
              // SKIPPING DELETION: pathToDelete is not empty
              return;
            }
            rmdirSync(pathToDelete);
          }
        }
      }
      verifyGeneratedRuntimeRequires(buildPath);
    },
  },
};
