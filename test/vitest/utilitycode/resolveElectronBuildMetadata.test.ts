import { describe, expect, it } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isDirectExecution as isRuntimeBuildDirectExecution } from "../../../scripts/build-local-ai-runtime.mjs";
import { isDirectExecution as isInstallerSizeDirectExecution } from "../../../scripts/check-installer-size.mjs";
import { isDirectExecution as isMetadataDirectExecution } from "../../../scripts/resolve-electron-build-metadata.mjs";

const scripts = [
  {
    name: "resolve-electron-build-metadata",
    path: "scripts/resolve-electron-build-metadata.mjs",
    isDirectExecution: isMetadataDirectExecution,
  },
  {
    name: "build-local-ai-runtime",
    path: "scripts/build-local-ai-runtime.mjs",
    isDirectExecution: isRuntimeBuildDirectExecution,
  },
  {
    name: "check-installer-size",
    path: "scripts/check-installer-size.mjs",
    isDirectExecution: isInstallerSizeDirectExecution,
  },
];

describe("release script entrypoint detection", () => {
  it.each(scripts)(
    "detects direct execution from a filesystem path for $name",
    ({ path: scriptRelativePath, isDirectExecution }) => {
      const scriptPath = path.resolve(process.cwd(), scriptRelativePath);

      expect(isDirectExecution(pathToFileURL(scriptPath).href, scriptPath)).toBe(
        true
      );
    }
  );

  it.each(scripts)(
    "rejects imports from a different file URL for $name",
    ({ path: scriptRelativePath, isDirectExecution }) => {
      const scriptPath = path.resolve(process.cwd(), scriptRelativePath);
      const importerPath = path.resolve(process.cwd(), "scripts/importer.mjs");

      expect(
        isDirectExecution(pathToFileURL(importerPath).href, scriptPath)
      ).toBe(false);
    }
  );
});
