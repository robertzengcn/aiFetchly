"use strict";

const fs = require("node:fs");
const { builtinModules } = require("node:module");
const path = require("node:path");
const asar = require("@electron/asar");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = process.env.AIFETCHLY_VERIFY_OUT_DIR
  ? path.resolve(process.env.AIFETCHLY_VERIFY_OUT_DIR)
  : path.join(PROJECT_ROOT, "out");
const REQUIRED_WORKERS = [
  "websiteContentScraper.js",
  "ContactExtractionWorker.js",
  "AiChatVoiceWorker.js",
];
const GENERATED_RUNTIME_REQUIRE_BUNDLES = ["taskCode.js"];
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
    if (path.basename(directory).toLowerCase() === "resources") {
      resourcesDirs.push(directory);
    }
  });
  return resourcesDirs;
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
  const diskCandidates = [
    path.join(resourcesDir, "app.asar.unpacked", ".vite", "build", workerFile),
    path.join(
      resourcesDir,
      "app.asar.unpacked",
      "dist",
      "childprocess",
      workerFile
    ),
    path.join(
      resourcesDir,
      "app.asar.unpacked",
      ".vite",
      "build",
      "childprocess",
      workerFile
    ),
  ];

  for (const candidate of diskCandidates) {
    if (fs.existsSync(candidate)) {
      return { found: true, location: candidate };
    }
  }

  const asarEntries = listAsarEntries(path.join(resourcesDir, "app.asar"));
  const asarCandidates = [
    `.vite/build/${workerFile}`,
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

function readPackagedFile(resourcesDir, relativePath, asarEntries) {
  const unpackedPath = path.join(
    resourcesDir,
    "app.asar.unpacked",
    relativePath
  );
  if (fs.existsSync(unpackedPath)) {
    return {
      content: fs.readFileSync(unpackedPath, "utf-8"),
      location: unpackedPath,
    };
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, "/");
  const asarPath = path.join(resourcesDir, "app.asar");
  if (asarEntries.has(normalizedRelativePath)) {
    return {
      content: asar.extractFile(asarPath, normalizedRelativePath).toString(
        "utf-8"
      ),
      location: path.join(asarPath, normalizedRelativePath),
    };
  }

  return null;
}

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

function verifyRuntimeRequires(resourcesDir) {
  const asarEntries = listAsarEntries(path.join(resourcesDir, "app.asar"));
  const missing = [];
  let checkedBundles = 0;

  for (const bundleFile of GENERATED_RUNTIME_REQUIRE_BUNDLES) {
    const bundle = readPackagedFile(
      resourcesDir,
      path.join(".vite", "build", bundleFile),
      asarEntries
    );
    if (!bundle) {
      continue;
    }

    checkedBundles += 1;
    for (const packageName of extractRuntimePackageRequires(bundle.content)) {
      if (!hasPackagedNodeModule(resourcesDir, packageName, asarEntries)) {
        missing.push(`${bundle.location} requires ${packageName}`);
      }
    }
  }

  if (checkedBundles === 0) {
    console.error(
      `No generated runtime bundles found in packaged resources: ${resourcesDir}`
    );
    return false;
  }

  if (missing.length > 0) {
    console.error("Missing packaged runtime dependencies:");
    for (const item of missing) {
      console.error(`- ${item}`);
    }
    return false;
  }

  console.log(
    `Verified packaged runtime dependencies for ${checkedBundles} generated bundle(s) in ${resourcesDir}`
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
  for (const workerFile of REQUIRED_WORKERS) {
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
