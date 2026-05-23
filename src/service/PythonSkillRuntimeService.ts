import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { AIChatAttachmentModule } from "@/modules/AIChatAttachmentModule";
import type {
  SkillExecutionContext,
  SkillExecutionResult,
  SkillManifest,
  SkillPythonManifestBlock,
} from "@/entityTypes/skillTypes";
import { DocumentService } from "@/service/DocumentService";
import {
  SkillEnvironmentManager,
  getElectronUserDataPath,
  ensurePathUnderSkillDir,
  requirementsLockReferencesModule,
} from "@/service/SkillEnvironmentManager";
import { SkillDiagnosticsService } from "@/service/SkillDiagnosticsService";
import { PythonRuntimeWorkerClient } from "@/service/PythonRuntimeWorkerClient";

const PYTHON_TIMEOUT_MS = 120_000;
const PYTHON_MAX_STDIO = 200_000;
const RUNTIME_OUTPUT_TTL_MS = 24 * 60 * 60 * 1000;

export interface ExecutePythonSkillParams {
  readonly manifest: SkillManifest;
  readonly skillDir: string;
  readonly args: Record<string, unknown>;
  readonly context: SkillExecutionContext;
}

interface PythonRunOutput {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

function isPythonSkillManifest(
  manifest: SkillManifest
): manifest is SkillManifest & {
  runtime: "python";
  python: SkillPythonManifestBlock;
} {
  return manifest.runtime === "python" && manifest.python !== undefined;
}

function validateArgsRequiredFields(
  parameters: Record<string, unknown>,
  args: Record<string, unknown>
): string | null {
  const required = parameters.required;
  if (!Array.isArray(required)) {
    return null;
  }
  for (const key of required) {
    if (typeof key === "string" && !(key in args)) {
      return `Missing required argument: ${key}`;
    }
  }
  return null;
}

function auditPythonAux(tool: string, payload: Record<string, unknown>): void {
  console.log(
    `[SkillAudit] ${JSON.stringify({
      tool,
      ...payload,
      timestamp: new Date().toISOString(),
    })}`
  );
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...[truncated]`;
}

function sanitizeFileName(fileName: string): string {
  const baseName = path.basename(fileName);
  const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "attachment.bin";
}

function ensureContainedPath(parentDir: string, childPath: string): string {
  const parentResolved = path.resolve(parentDir);
  const childResolved = path.resolve(childPath);
  if (
    childResolved !== parentResolved &&
    !childResolved.startsWith(`${parentResolved}${path.sep}`)
  ) {
    throw new Error("Resolved path escaped runtime directory");
  }
  return childResolved;
}

function cleanupRuntimeOutput(outputRoot: string): void {
  if (!fs.existsSync(outputRoot)) {
    return;
  }
  const now = Date.now();
  const skillDirs = fs.readdirSync(outputRoot);
  for (const skillDirName of skillDirs) {
    const absSkillDir = path.join(outputRoot, skillDirName);
    if (
      !fs.existsSync(absSkillDir) ||
      !fs.statSync(absSkillDir).isDirectory()
    ) {
      continue;
    }
    const runDirs = fs.readdirSync(absSkillDir);
    for (const runDir of runDirs) {
      const absRunDir = path.join(absSkillDir, runDir);
      if (!fs.existsSync(absRunDir)) {
        continue;
      }
      const stats = fs.statSync(absRunDir);
      if (now - stats.mtimeMs > RUNTIME_OUTPUT_TTL_MS) {
        fs.rmSync(absRunDir, { recursive: true, force: true });
      }
    }
  }
}

async function runPythonScript(
  pythonBin: string,
  scriptPath: string,
  scriptArgs: readonly string[]
): Promise<PythonRunOutput> {
  try {
    const workerResult = await PythonRuntimeWorkerClient.getInstance().execute(
      pythonBin,
      scriptPath,
      scriptArgs,
      PYTHON_TIMEOUT_MS
    );
    return {
      ok: true,
      stdout: truncateText(workerResult.stdout, PYTHON_MAX_STDIO),
      stderr: truncateText(workerResult.stderr, PYTHON_MAX_STDIO),
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const stderrMatch = /stderr:\s*([\s\S]*)$/m.exec(msg);
    const stderr = stderrMatch ? stderrMatch[1].trim() : msg;
    return {
      ok: false,
      stdout: "",
      stderr: truncateText(stderr, PYTHON_MAX_STDIO),
    };
  }
}

async function executePythonSkill(
  params: ExecutePythonSkillParams
): Promise<SkillExecutionResult> {
  const { manifest, skillDir, args, context } = params;
  if (!isPythonSkillManifest(manifest)) {
    return {
      success: false,
      result: {
        error:
          "executePythonSkill requires runtime python with a python manifest block.",
        mode: "python_skill_runtime_error",
      },
    };
  }

  const schemaError = validateArgsRequiredFields(manifest.parameters, args);
  if (schemaError) {
    return {
      success: false,
      result: {
        error: schemaError,
        mode: "python_skill_runtime_error",
      },
    };
  }

  const attachmentRef =
    typeof args.attachment_ref === "string" ? args.attachment_ref.trim() : "";

  const outputRoot = path.join(
    getElectronUserDataPath(),
    "skill-runtime-output"
  );
  const runId = `${Date.now()}-${crypto.randomUUID()}`;
  const runDir = path.join(outputRoot, manifest.name, runId);
  const inputDir = path.join(runDir, "input");
  const outputDir = path.join(runDir, "output");

  const scriptPathResolved = ensureContainedPath(
    skillDir,
    path.join(skillDir, manifest.entry)
  );
  if (!fs.existsSync(scriptPathResolved)) {
    return {
      success: false,
      result: {
        error: `Python entry not found: ${manifest.entry}`,
        mode: "python_skill_runtime_error",
        skillName: manifest.name,
      },
    };
  }

  let inputPath: string;
  let inputFileName = "";

  if (attachmentRef) {
    const conversationId = context.conversationId?.trim() ?? "";
    if (!conversationId) {
      return {
        success: false,
        result: {
          error:
            "conversationId is required when attachment_ref is set for Python skills.",
          mode: "python_skill_runtime_error",
          skillName: manifest.name,
        },
      };
    }
    const documentService = new DocumentService();
    const staged = await documentService.readStagedAttachment(
      conversationId,
      attachmentRef
    );
    const attachmentModule = new AIChatAttachmentModule();
    if (!staged.sha256 || staged.sha256.length === 0) {
      return {
        success: false,
        result: {
          error:
            "Attachment reference is missing a SHA256 binding. Please re-upload the file.",
          mode: "python_skill_runtime_error",
          skillName: manifest.name,
        },
      };
    }
    const stored = await attachmentModule.getLatestAttachmentBySha256(
      conversationId,
      staged.sha256
    );
    if (!stored) {
      return {
        success: false,
        result: {
          error: `Original attachment bytes were not found for "${staged.fileName}".`,
          mode: "python_skill_runtime_error",
          skillName: manifest.name,
        },
      };
    }
    fs.mkdirSync(inputDir, { recursive: true });
    inputPath = ensureContainedPath(
      inputDir,
      path.join(inputDir, sanitizeFileName(staged.fileName))
    );
    fs.writeFileSync(inputPath, stored.contentBlob);
    inputFileName = staged.fileName;
  } else {
    fs.mkdirSync(inputDir, { recursive: true });
    inputPath = ensureContainedPath(
      inputDir,
      path.join(inputDir, "_no_attachment")
    );
    fs.writeFileSync(inputPath, Buffer.alloc(0));
  }

  const outputDirResolved = ensureContainedPath(runDir, outputDir);
  fs.mkdirSync(outputDirResolved, { recursive: true });
  cleanupRuntimeOutput(outputRoot);

  let pythonBin = SkillEnvironmentManager.resolveInterpreter(skillDir);

  const runOnce = async (): Promise<PythonRunOutput> => {
    return await runPythonScript(pythonBin, scriptPathResolved, [
      inputPath,
      outputDirResolved,
    ]);
  };

  let runOutput = await runOnce();
  let retried = false;
  if (!runOutput.ok) {
    const diagnosis = SkillDiagnosticsService.diagnoseStderr(runOutput.stderr);
    if (diagnosis.cause === "missing_python_module" && diagnosis.missing) {
      const requirementsAbs = ensurePathUnderSkillDir(
        skillDir,
        manifest.python.requirements_file
      );
      if (fs.existsSync(requirementsAbs)) {
        const requirementsContent = fs.readFileSync(requirementsAbs, "utf-8");
        if (
          requirementsLockReferencesModule(
            requirementsContent,
            diagnosis.missing
          )
        ) {
          const repairStart = Date.now();
          auditPythonAux("python_skill_repair", {
            skill: manifest.name,
            missing: diagnosis.missing,
            args: {},
            success: false,
            durationMs: 0,
          });
          await SkillEnvironmentManager.repair(skillDir, manifest);
          pythonBin = SkillEnvironmentManager.resolveInterpreter(skillDir);
          retried = true;
          runOutput = await runOnce();
          auditPythonAux("python_skill_repair_retry", {
            skill: manifest.name,
            args: {},
            success: runOutput.ok,
            durationMs: Date.now() - repairStart,
          });
        }
      }
    }
  }

  const outputFiles = fs.existsSync(outputDirResolved)
    ? fs.readdirSync(outputDirResolved).sort((a, b) => a.localeCompare(b))
    : [];

  const outputDirectoryHint = path.join(
    "skill-runtime-output",
    manifest.name,
    runId,
    "output"
  );

  if (!runOutput.ok) {
    return {
      success: false,
      result: {
        error: runOutput.stderr || "Python script failed",
        mode: "python_skill_runtime_error",
        skillName: manifest.name,
        stdout: runOutput.stdout,
        stderr: runOutput.stderr,
        retried,
      },
    };
  }

  return {
    success: true,
    result: {
      mode: "python_skill_executed",
      skillName: manifest.name,
      inputFileName: inputFileName.length > 0 ? inputFileName : undefined,
      runId,
      outputDirectoryHint,
      outputFiles,
      outputCount: outputFiles.length,
      stdout: runOutput.stdout,
      stderr: runOutput.stderr,
      retried,
    },
  };
}

export const PythonSkillRuntimeService = {
  executePythonSkill,
} as const;
