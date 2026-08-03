"use strict";

const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "out");
const REQUIRED_WORKERS = ["websiteContentScraper.js"];

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
    if (path.basename(directory) === "resources") {
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

function hasWorker(resourcesDir, workerFile) {
  const diskCandidates = [
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

  return failed ? 1 : 0;
}

process.exit(run());
