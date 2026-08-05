"use strict";

const fs = require("node:fs");
const os = require("node:os");
const { builtinModules } = require("node:module");
const path = require("node:path");
const asar = require("@electron/asar");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = process.env.AIFETCHLY_VERIFY_OUT_DIR
  ? path.resolve(process.env.AIFETCHLY_VERIFY_OUT_DIR)
  : path.join(PROJECT_ROOT, "out");
const REQUIRED_WORKERS = [
  "AiChatVoiceWorker.js",
  "ContactExtractionWorker.js",
  "GoogleMapsWorker.js",
  "HookExecutionWorker.js",
  "LocalEmbeddingWorker.js",
  "PythonRuntimeWorker.js",
  "SkillWorker.js",
  "WorkspaceConfigWatchWorker.js",
  "YandexMapsWorker.js",
  "YellowPagesScraperProcess.js",
  "googleProxyCheck.js",
  "websiteContentScraper.js",
  "YellowPagesScraper.js",
];
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

function walkDirectories(root, visitor) {
  if (!fs.existsSync(root)) {
    return;
  }

  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    visitor(current);

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      }
    }
  }
}

function findResourcesDirs() {
  const resourcesDirs = [];
  walkDirectories(OUT_DIR, (directory) => {
    if (
      path.basename(directory).toLowerCase() === "resources" &&
      resolvePackagedLayout(directory) !== null
    ) {
      resourcesDirs.push(directory);
    }
  });
  return resourcesDirs;
}

function resolvePackagedLayout(resourcesDir) {
  const unpackedRoot = path.join(resourcesDir, "app.asar.unpacked");
  if (fs.existsSync(unpackedRoot)) {
    return {
      diskRoot: unpackedRoot,
      asarPath: fs.existsSync(path.join(resourcesDir, "app.asar"))
        ? path.join(resourcesDir, "app.asar")
        : null,
    };
  }

  const plainAppRoot = path.join(resourcesDir, "app");
  if (fs.existsSync(plainAppRoot)) {
    return {
      diskRoot: plainAppRoot,
      asarPath: null,
    };
  }

  const asarPath = path.join(resourcesDir, "app.asar");
  if (fs.existsSync(asarPath)) {
    return {
      diskRoot: null,
      asarPath,
    };
  }

  return null;
}

function getWorkerDiskCandidates(resourcesDir, workerFile) {
  const layout = resolvePackagedLayout(resourcesDir);
  const roots = [];
  if (layout?.diskRoot) {
    roots.push(layout.diskRoot);
  }
  if (layout?.diskRoot !== path.join(resourcesDir, "app.asar.unpacked")) {
    roots.push(path.join(resourcesDir, "app.asar.unpacked"));
  }
  const plainAppRoot = path.join(resourcesDir, "app");
  if (layout?.diskRoot !== plainAppRoot) {
    roots.push(plainAppRoot);
  }

  const relativePaths = [
    path.join(".vite", "build", workerFile),
    path.join("dist", workerFile),
    path.join("dist", "childprocess", workerFile),
    path.join(".vite", "build", "childprocess", workerFile),
  ];

  const candidates = [];
  for (const root of roots) {
    for (const relativePath of relativePaths) {
      candidates.push(path.join(root, ...relativePath.split("/")));
    }
  }
  return candidates;
}

function listAsarEntries(asarPath) {
  if (!fs.existsSync(asarPath)) {
    return new Set();
  }

  return new Set(
    asar
      .listPackage(asarPath)
      .map((entry) => entry.replace(/\\/g, "/").replace(/^\/+/, ""))
  );
}

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
    NODE_BUILTINS.has(importId)
  ) {
    return null;
  }
  return getPackageRootName(importId);
}

function extractRuntimePackageRequires(source) {
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

function hasWorker(resourcesDir, workerFile) {
  const diskCandidates = getWorkerDiskCandidates(resourcesDir, workerFile);

  for (const candidate of diskCandidates) {
    if (fs.existsSync(candidate)) {
      return { found: true, location: candidate };
    }
  }

  const layout = resolvePackagedLayout(resourcesDir);
  const asarPath = layout?.asarPath ?? path.join(resourcesDir, "app.asar");
  const asarEntries = listAsarEntries(asarPath);
  const asarCandidates = [
    `.vite/build/${workerFile}`,
    `dist/${workerFile}`,
    `dist/childprocess/${workerFile}`,
    `.vite/build/childprocess/${workerFile}`,
  ];
  for (const candidate of asarCandidates) {
    if (asarEntries.has(candidate)) {
      return {
        found: true,
        location: path.join(resourcesDir, "app.asar", candidate),
      };
    }
  }

  return {
    found: false,
    location: diskCandidates.join(", "),
  };
}

function toPosixRelativePath(relativePath) {
  return relativePath.replace(/\\/g, "/");
}

function toAsarLookupPath(posixRelativePath) {
  // @electron/asar Filesystem.searchNodeFromDirectory splits on path.sep.
  // On Windows, forward-slash paths fail lookup even when listPackage entries
  // normalize to POSIX form, so convert to platform separators for extractFile.
  return posixRelativePath.split("/").join(path.sep);
}

function extractAsarFile(asarPath, posixRelativePath) {
  const lookupCandidates = [
    toAsarLookupPath(posixRelativePath),
    posixRelativePath,
  ];
  const tried = new Set();

  for (const candidate of lookupCandidates) {
    if (tried.has(candidate)) {
      continue;
    }
    tried.add(candidate);
    try {
      return asar.extractFile(asarPath, candidate);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      // Keep trying alternate separators / skip stub entries that are not
      // extractable from the archive body (e.g. unpacked placeholders).
    }
  }

  return null;
}

function readPackagedFile(resourcesDir, relativePath, asarEntries) {
  const normalizedRelativePath = toPosixRelativePath(relativePath);
  const layout = resolvePackagedLayout(resourcesDir);

  if (layout?.diskRoot) {
    const diskPath = path.join(
      layout.diskRoot,
      ...normalizedRelativePath.split("/")
    );
    if (fs.existsSync(diskPath)) {
      return {
        content: fs.readFileSync(diskPath, "utf-8"),
        location: diskPath,
      };
    }
  }

  const unpackedPath = path.join(
    resourcesDir,
    "app.asar.unpacked",
    ...normalizedRelativePath.split("/")
  );
  if (fs.existsSync(unpackedPath)) {
    return {
      content: fs.readFileSync(unpackedPath, "utf-8"),
      location: unpackedPath,
    };
  }

  const plainAppPath = path.join(
    resourcesDir,
    "app",
    ...normalizedRelativePath.split("/")
  );
  if (fs.existsSync(plainAppPath)) {
    return {
      content: fs.readFileSync(plainAppPath, "utf-8"),
      location: plainAppPath,
    };
  }

  const asarPath = layout?.asarPath ?? path.join(resourcesDir, "app.asar");
  if (fs.existsSync(asarPath) && asarEntries.has(normalizedRelativePath)) {
    const content = extractAsarFile(asarPath, normalizedRelativePath);
    if (content) {
      return {
        content: content.toString("utf-8"),
        location: path.join(asarPath, ...normalizedRelativePath.split("/")),
      };
    }
  }

  return null;
}

/* istanbul ignore next */
function hasPackagedNodeModule(resourcesDir, packageName, asarEntries) {
  const packageJsonPath = path
    .join("node_modules", ...packageName.split("/"), "package.json")
    .replace(/\\/g, "/");
  const unpackedPackageJsonPath = path.join(
    resourcesDir,
    "app.asar.unpacked",
    packageJsonPath
  );
  return (
    fs.existsSync(unpackedPackageJsonPath) || asarEntries.has(packageJsonPath)
  );
}

function getGeneratedBundleRelativePaths() {
  return ["taskCode.js", ...REQUIRED_WORKERS];
}

function getBundleCandidates(bundleFile) {
  // Keep POSIX-relative candidates so asar entry lookups stay consistent on
  // Windows (path.join would otherwise inject backslashes).
  return [
    `.vite/build/${bundleFile}`,
    `.vite/build/childprocess/${bundleFile}`,
    `dist/${bundleFile}`,
    `dist/childprocess/${bundleFile}`,
  ];
}

function resolvePackagedRequire(request, bundlePath, nodeModulePaths) {
  try {
    return require.resolve(request, {
      paths: [path.dirname(bundlePath), ...nodeModulePaths],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

function verifyRuntimeRequires(resourcesDir) {
  const layout = resolvePackagedLayout(resourcesDir);
  if (!layout) {
    console.error(`No packaged app layout found under ${resourcesDir}`);
    return false;
  }

  const asarPath = layout.asarPath ?? path.join(resourcesDir, "app.asar");
  const asarEntries = listAsarEntries(fs.existsSync(asarPath) ? asarPath : "");
  const missing = [];
  let checkedBundles = 0;
  let checkedRequires = 0;
  const extractedAsarRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "aifetchly-asar-")
  );

  try {
    if (layout.diskRoot) {
      fs.cpSync(layout.diskRoot, extractedAsarRoot, { recursive: true });
    } else if (fs.existsSync(asarPath)) {
      asar.extractAll(asarPath, extractedAsarRoot);
    }

    const packagedModuleSearchPaths = [
      extractedAsarRoot,
      path.join(resourcesDir, "app.asar.unpacked"),
      path.join(resourcesDir, "app"),
    ].filter(
      (candidate, index, all) =>
        fs.existsSync(candidate) && all.indexOf(candidate) === index
    );

    for (const bundleFile of getGeneratedBundleRelativePaths()) {
      const bundle = getBundleCandidates(bundleFile)
        .map((relativePath) =>
          readPackagedFile(resourcesDir, relativePath, asarEntries)
        )
        .find(Boolean);
      if (!bundle) {
        continue;
      }

      checkedBundles += 1;
      for (const packageName of extractRuntimePackageRequires(bundle.content)) {
        checkedRequires += 1;
        const result = resolvePackagedRequire(
          packageName,
          bundle.location,
          packagedModuleSearchPaths
        );
        if (typeof result === "object") {
          missing.push(
            `${bundle.location} requires ${packageName}: ${result.error}`
          );
        }
      }
    }
  } finally {
    fs.rmSync(extractedAsarRoot, { recursive: true, force: true });
  }

  if (checkedRequires === 0) {
    console.error(
      `No static runtime requires found in packaged bundles under ${resourcesDir}`
    );
    return false;
  }

  if (checkedBundles === 0) {
    console.error(
      `No generated runtime bundles found in packaged resources: ${resourcesDir}`
    );
    return false;
  }

  if (missing.length > 0) {
    console.error("Unresolvable packaged runtime dependencies:");
    for (const item of missing) {
      console.error(`- ${item}`);
    }
    return false;
  }

  console.log(
    `Resolved ${checkedRequires} static runtime require(s) across ${checkedBundles} generated bundle(s) in ${resourcesDir}`
  );
  return true;
}

function run() {
  const resourcesDirs = findResourcesDirs();
  if (resourcesDirs.length === 0) {
    console.error(`No packaged resources directories found under ${OUT_DIR}`);
    return 1;
  }

  let failed = false;
  const expectedWorkers = REQUIRED_WORKERS.filter(
    (workerFile) => workerFile !== "YellowPagesScraperProcess.js"
  );
  for (const workerFile of expectedWorkers) {
    const matches = resourcesDirs
      .map((resourcesDir) => hasWorker(resourcesDir, workerFile))
      .filter((result) => result.found);

    if (matches.length === 0) {
      failed = true;
      console.error(
        `Missing packaged child process worker: ${workerFile}. Checked ${resourcesDirs.length} resources directories.`
      );
      continue;
    }

    for (const match of matches) {
      console.log(`Found packaged child process worker: ${match.location}`);
    }
  }

  for (const resourcesDir of resourcesDirs) {
    if (!verifyRuntimeRequires(resourcesDir)) {
      failed = true;
    }
  }

  return failed ? 1 : 0;
}

process.exit(run());
