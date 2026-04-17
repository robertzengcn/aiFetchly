import * as crypto from "crypto";
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { AIChatAttachmentModule } from "@/modules/AIChatAttachmentModule";
import { DocumentService } from "@/service/DocumentService";
import { PythonRuntimeWorkerClient } from "@/service/PythonRuntimeWorkerClient";
import { CONVERT_PDF_TO_IMAGES_PY } from "@/service/python_runtimes/pdf/convertPdfToImagesScript";
import type {
  SkillExecutionContext,
  SkillExecutionResult,
} from "@/entityTypes/skillTypes";

const PYTHON_TIMEOUT_MS = 120_000;
const PYTHON_MAX_STDIO = 200_000;
const RUNTIME_OUTPUT_TTL_MS = 24 * 60 * 60 * 1000;
const PYTHON_ALLOWLIST: Readonly<Record<string, string>> = {
  pdf: "convert_pdf_to_images.py",
};

interface PythonRunOutput {
  readonly stdout: string;
  readonly stderr: string;
}

function truncateText(text: string): string {
  if (text.length <= PYTHON_MAX_STDIO) {
    return text;
  }
  return `${text.slice(0, PYTHON_MAX_STDIO)}...[truncated]`;
}

function sanitizeFileName(fileName: string): string {
  const baseName = path.basename(fileName);
  const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "input.pdf";
}

function ensureContainedPath(parentDir: string, childPath: string): string {
  const parentResolved = path.resolve(parentDir);
  const childResolved = path.resolve(childPath);
  if (!childResolved.startsWith(`${parentResolved}${path.sep}`)) {
    throw new Error("Resolved path escaped runtime directory");
  }
  return childResolved;
}

function resolveTrustedScriptSource(skillName: string): string | null {
  if (skillName === "pdf") {
    return CONVERT_PDF_TO_IMAGES_PY;
  }
  return null;
}

function cleanupRuntimeOutput(outputRoot: string): void {
  if (!fs.existsSync(outputRoot)) return;
  const now = Date.now();
  const skillDirs = fs.readdirSync(outputRoot);
  for (const skillDir of skillDirs) {
    const absSkillDir = path.join(outputRoot, skillDir);
    if (!fs.existsSync(absSkillDir) || !fs.statSync(absSkillDir).isDirectory()) {
      continue;
    }
    const runDirs = fs.readdirSync(absSkillDir);
    for (const runDir of runDirs) {
      const absRunDir = path.join(absSkillDir, runDir);
      if (!fs.existsSync(absRunDir)) continue;
      const stats = fs.statSync(absRunDir);
      if (now - stats.mtimeMs > RUNTIME_OUTPUT_TTL_MS) {
        fs.rmSync(absRunDir, { recursive: true, force: true });
      }
    }
  }
}

async function runPythonScript(
  scriptPath: string,
  args: readonly string[]
): Promise<PythonRunOutput> {
  const pythonBin = process.env.PYTHON_BIN || "python3";
  const workerResult = await PythonRuntimeWorkerClient.getInstance().execute(
    pythonBin,
    scriptPath,
    args,
    PYTHON_TIMEOUT_MS
  );
  return {
    stdout: truncateText(workerResult.stdout),
    stderr: truncateText(workerResult.stderr),
  };
}

function isPdfFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".pdf");
}

async function executePdfConvertToImages(
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<SkillExecutionResult> {
  const attachmentRef =
    typeof args.attachment_ref === "string" ? args.attachment_ref.trim() : "";
  if (!attachmentRef) {
    return {
      success: false,
      result: {
        error:
          "attachment_ref is required for python runtime execution of the pdf skill.",
        mode: "python_skill_runtime_error",
      },
    };
  }

  const conversationId = context.conversationId?.trim() ?? "";
  if (!conversationId) {
    return {
      success: false,
      result: {
        error:
          "conversationId is required for python runtime execution of the pdf skill.",
        mode: "python_skill_runtime_error",
      },
    };
  }

  const documentService = new DocumentService();
  const staged = await documentService.readStagedAttachment(
    conversationId,
    attachmentRef
  );
  if (!isPdfFileName(staged.fileName)) {
    return {
      success: false,
      result: {
        error: `Python runtime adapter only supports PDF attachments. Received: ${staged.fileName}`,
        mode: "python_skill_runtime_error",
      },
    };
  }

  const attachmentModule = new AIChatAttachmentModule();
  if (!staged.sha256 || staged.sha256.length === 0) {
    return {
      success: false,
      result: {
        error:
          "Attachment reference is missing a SHA256 binding. Please re-upload the file and try again.",
        mode: "python_skill_runtime_error",
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
        error: `Original attachment bytes were not found for file "${staged.fileName}" in this conversation.`,
        mode: "python_skill_runtime_error",
      },
    };
  }

  const scriptSource = resolveTrustedScriptSource("pdf");
  if (!scriptSource) {
    return {
      success: false,
      result: {
        error:
          "Trusted pdf runtime script was not found in application runtime assets.",
        mode: "python_skill_runtime_error",
      },
    };
  }

  const outputRoot = path.join(app.getPath("userData"), "skill-runtime-output");
  const runId = `${Date.now()}-${crypto.randomUUID()}`;
  const runDir = path.join(outputRoot, "pdf", runId);
  const outputDir = path.join(runDir, "images");
  const scriptPath = ensureContainedPath(
    runDir,
    path.join(runDir, PYTHON_ALLOWLIST.pdf)
  );
  const inputPath = ensureContainedPath(
    runDir,
    path.join(runDir, sanitizeFileName(staged.fileName))
  );
  const outputDirResolved = ensureContainedPath(runDir, outputDir);

  try {
    cleanupRuntimeOutput(outputRoot);
    fs.mkdirSync(outputDirResolved, { recursive: true });
    fs.writeFileSync(scriptPath, scriptSource, "utf-8");
    fs.writeFileSync(inputPath, stored.contentBlob);

    const runOutput = await runPythonScript(scriptPath, [
      inputPath,
      outputDirResolved,
    ]);

    const generatedImages = fs
      .readdirSync(outputDirResolved)
      .filter((name) => name.toLowerCase().endsWith(".png"))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => name);

    return {
      success: true,
      result: {
        mode: "python_skill_executed",
        skillName: "pdf",
        operation: "convert_pdf_to_images",
        inputFileName: staged.fileName,
        runId,
        outputDirectoryHint: `skill-runtime-output/pdf/${runId}/images`,
        outputFiles: generatedImages,
        outputCount: generatedImages.length,
        stdout: runOutput.stdout,
        stderr: runOutput.stderr,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      result: {
        error: errorMessage,
        mode: "python_skill_runtime_error",
        skillName: "pdf",
        operation: "convert_pdf_to_images",
      },
    };
  }
}

async function executeDocumentationSkill(
  skillName: string,
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<SkillExecutionResult | null> {
  const attachmentRef =
    typeof args.attachment_ref === "string" ? args.attachment_ref.trim() : "";
  if (!attachmentRef) {
    return null;
  }

  const allowedScript = PYTHON_ALLOWLIST[skillName];
  if (!allowedScript) {
    return null;
  }

  if (skillName === "pdf") {
    return await executePdfConvertToImages(args, context);
  }

  return null;
}

export const PythonSkillRuntimeService = {
  executeDocumentationSkill,
} as const;
