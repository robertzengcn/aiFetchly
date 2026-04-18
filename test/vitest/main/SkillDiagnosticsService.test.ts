"use strict";
import { describe, expect, test } from "vitest";
import type { SkillManifest } from "@/entityTypes/skillTypes";
import { SkillDiagnosticsService } from "@/service/SkillDiagnosticsService";

describe("SkillDiagnosticsService", () => {
  test("diagnoses ModuleNotFoundError", () => {
    const r = SkillDiagnosticsService.diagnoseStderr(
      "Traceback...\nModuleNotFoundError: No module named 'pdf2image'\n",
      undefined
    );
    expect(r.cause).toBe("missing_python_module");
    expect(r.missing).toBe("pdf2image");
  });

  test("diagnoses pip hash mismatch", () => {
    const r = SkillDiagnosticsService.diagnoseStderr(
      "THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUIREMENTS FILE.",
      undefined
    );
    expect(r.cause).toBe("lock_hash_mismatch");
  });

  test("diagnoses interpreter missing", () => {
    const r = SkillDiagnosticsService.diagnoseStderr(
      "No Python interpreter satisfies '>=3.12'",
      undefined
    );
    expect(r.cause).toBe("interpreter_missing");
  });

  test("diagnoses interpreter missing - venv creation failure", () => {
    const r = SkillDiagnosticsService.diagnoseStderr(
      "Failed to create venv: Error: no python3 found",
      undefined
    );
    expect(r.cause).toBe("interpreter_missing");
  });

  test("diagnoses missing system dependency with manifest hint", () => {
    const manifest: SkillManifest = {
      name: "pdf-skill",
      version: "1.0.0",
      description: "d",
      runtime: "python",
      entry: "run.py",
      parameters: { type: "object", properties: {} },
      python: {
        version: ">=3.10",
        requirements_file: "requirements.txt",
        system: [
          {
            name: "poppler",
            probe: "pdftoppm",
            install_hint: {
              darwin: "brew install poppler",
              linux: "apt-get install poppler-utils",
            },
          },
        ],
      },
    };
    const r = SkillDiagnosticsService.diagnoseStderr(
      "Missing system dependency: pdftoppm not found",
      manifest
    );
    expect(r.cause).toBe("missing_system_tool");
    expect(r.install_hint).toBeTruthy();
  });

  test("diagnoses missing system dependency without manifest", () => {
    const r = SkillDiagnosticsService.diagnoseStderr(
      "Missing system dependency: pdftoppm not found",
      undefined
    );
    expect(r.cause).toBe("missing_system_tool");
    expect(r.install_hint).toBeUndefined();
  });

  test("returns unknown for unrecognized stderr", () => {
    const r = SkillDiagnosticsService.diagnoseStderr(
      "Something went wrong that we don't understand",
      undefined
    );
    expect(r.cause).toBe("unknown");
  });

  test("returns unknown for empty stderr", () => {
    const r = SkillDiagnosticsService.diagnoseStderr("  ", undefined);
    expect(r.cause).toBe("unknown");
  });
});
