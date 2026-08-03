import * as fs from "fs";
import * as path from "path";

const CONTACT_EXTRACTION_WORKER_FILE = "ContactExtractionWorker.js";

export interface ContactExtractionWorkerPathRuntime {
  dirname: string;
  cwd: string;
  resourcesPath?: string;
  existsSync: (candidate: string) => boolean;
}

export function mirrorAppAsarUnpackedPath(candidate: string): string {
  return candidate.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

export function getContactExtractionWorkerPathCandidates(
  runtime: ContactExtractionWorkerPathRuntime
): string[] {
  const candidates: string[] = [];
  const addCandidate = (candidate: string): void => {
    const normalized = path.normalize(candidate);
    const unpacked = mirrorAppAsarUnpackedPath(normalized);

    if (unpacked !== normalized && !candidates.includes(unpacked)) {
      candidates.push(unpacked);
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  addCandidate(path.join(runtime.dirname, CONTACT_EXTRACTION_WORKER_FILE));
  addCandidate(
    path.join(runtime.cwd, ".vite", "build", CONTACT_EXTRACTION_WORKER_FILE)
  );
  addCandidate(path.join(runtime.cwd, "dist", CONTACT_EXTRACTION_WORKER_FILE));
  addCandidate(
    path.join(
      runtime.cwd,
      "dist",
      "childprocess",
      "contact-extraction",
      CONTACT_EXTRACTION_WORKER_FILE
    )
  );

  if (runtime.resourcesPath) {
    addCandidate(
      path.join(
        runtime.resourcesPath,
        "app.asar.unpacked",
        "dist",
        CONTACT_EXTRACTION_WORKER_FILE
      )
    );
    addCandidate(
      path.join(
        runtime.resourcesPath,
        "app.asar.unpacked",
        ".vite",
        "build",
        CONTACT_EXTRACTION_WORKER_FILE
      )
    );
    addCandidate(
      path.join(
        runtime.resourcesPath,
        "app.asar",
        ".vite",
        "build",
        CONTACT_EXTRACTION_WORKER_FILE
      )
    );
  }

  return candidates;
}

export function resolveContactExtractionWorkerPath(
  runtime: ContactExtractionWorkerPathRuntime
): string | null {
  const candidates = getContactExtractionWorkerPathCandidates(runtime);

  for (const candidate of candidates) {
    if (runtime.existsSync(candidate)) {
      return candidate;
    }
  }

  console.warn(
    `Contact extraction worker file not found. Tried: ${candidates.join(", ")}`
  );
  return null;
}

export function getContactExtractionWorkerPath(): string | null {
  const electronProcess = process as NodeJS.Process & {
    resourcesPath?: string;
  };

  return resolveContactExtractionWorkerPath({
    dirname: __dirname,
    cwd: process.cwd(),
    resourcesPath: electronProcess.resourcesPath,
    existsSync: fs.existsSync,
  });
}
