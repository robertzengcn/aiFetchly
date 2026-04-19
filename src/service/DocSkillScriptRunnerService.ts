/**
 * DocSkillScriptRunnerService — runs pre-packaged Python scripts from
 * documentation-only (SKILL.md) skills that ship a `scripts/` directory.
 *
 * Claude Code / Claude.ai can execute smithery skills because the AI has a
 * built-in code-execution sandbox: it reads SKILL.md as guidance, generates
 * Python, and runs it directly.  aiFetchly uses a structured skill pipeline
 * that requires hash-pinned venvs — which documentation-only imports never
 * create.  This service bridges the gap by:
 *
 *   1. Creating a lightweight `.sandbox_env` venv in the skill directory on
 *      first use (no hash pinning — acceptable for user-installed skills).
 *   2. Auto-installing missing packages when a `ModuleNotFoundError` is
 *      detected (same auto-repair pattern as PythonSkillRuntimeService).
 *   3. Running the requested script with the standard
 *      `python script.py <input_file> <output_dir>` calling convention that
 *      smithery scripts already follow.
 */

import * as child_process from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { AIChatAttachmentModule } from "@/modules/AIChatAttachmentModule";
import { DocumentService } from "@/service/DocumentService";
import { getElectronUserDataPath } from "@/service/SkillEnvironmentManager";
import { PythonRuntimeWorkerClient } from "@/service/PythonRuntimeWorkerClient";
import { SkillManagementModule } from "@/modules/SkillManagementModule";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SANDBOX_DIR_NAME = ".sandbox_env";
const SCRIPT_SUBDIR = "scripts";
const PYTHON_SCRIPT_TIMEOUT_MS = 120_000;
const PIP_INSTALL_TIMEOUT_MS = 300_000;
const PYTHON_PROBE_TIMEOUT_MS = 10_000;

/**
 * Well-known import→pip-package mappings for common skill dependencies.
 * Keeps the auto-install heuristic from guessing wrong package names.
 */
const IMPORT_TO_PIP: Record<string, string> = {
  pdf2image: "pdf2image",
  pypdf: "pypdf",
  pypdf2: "PyPDF2",
  pdfplumber: "pdfplumber",
  PIL: "Pillow",
  PIL_Image: "Pillow",
  reportlab: "reportlab",
  pytesseract: "pytesseract",
  fitz: "pymupdf",
  docx: "python-docx",
  openpyxl: "openpyxl",
  pandas: "pandas",
  numpy: "numpy",
  cv2: "opencv-python",
};

// ---------------------------------------------------------------------------
// Internal helpers — all child-process calls are async (non-blocking).
// ---------------------------------------------------------------------------

/**
 * Run a command in a child process. Resolves with exit code, stdout, stderr.
 * Never blocks the main process event loop.
 */
function runChildProcess(
  cmd: string,
  args: readonly string[],
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = child_process.spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      proc.kill();
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}\n[Timeout after ${timeoutMs}ms]`,
      });
    }, timeoutMs);
    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

/**
 * Find the first Python interpreter available on PATH.
 * Runs non-blocking in a child process.
 */
async function findBasePython(): Promise<string> {
  const fromEnv = process.env.PYTHON_BIN?.trim();
  const candidates = fromEnv
    ? [fromEnv, "python3", "python"]
    : ["python3", "python"];
  for (const c of candidates) {
    const r = await runChildProcess(c, ["--version"], PYTHON_PROBE_TIMEOUT_MS);
    if (r.code === 0) return c;
  }
  throw new Error(
    "No Python interpreter found. Install Python 3 or set the PYTHON_BIN environment variable."
  );
}

function sandboxPythonPath(skillDir: string): string {
  return process.platform === "win32"
    ? path.join(skillDir, SANDBOX_DIR_NAME, "Scripts", "python.exe")
    : path.join(skillDir, SANDBOX_DIR_NAME, "bin", "python");
}

function sandboxPipPath(skillDir: string): string {
  return process.platform === "win32"
    ? path.join(skillDir, SANDBOX_DIR_NAME, "Scripts", "pip.exe")
    : path.join(skillDir, SANDBOX_DIR_NAME, "bin", "pip");
}

/**
 * Creates `.sandbox_env` venv in the skill dir if it does not exist.
 * Runs `python -m venv` in a child process — never blocks the main thread.
 * Returns the path to the Python executable inside the venv.
 */
async function ensureSandboxVenv(skillDir: string): Promise<string> {
  const pythonBin = sandboxPythonPath(skillDir);
  if (fs.existsSync(pythonBin)) {
    return pythonBin;
  }
  const basePython = await findBasePython();
  const venvTarget = path.join(skillDir, SANDBOX_DIR_NAME);
  const r = await runChildProcess(
    basePython,
    ["-m", "venv", venvTarget],
    60_000
  );
  if (r.code !== 0) {
    throw new Error(
      `Failed to create sandbox venv for skill at ${skillDir}: ${r.stderr}`
    );
  }
  if (!fs.existsSync(pythonBin)) {
    throw new Error(
      `Sandbox venv was created but Python binary not found at expected path: ${pythonBin}`
    );
  }
  return pythonBin;
}

/**
 * Attempts to pip-install a missing package detected from stderr.
 * Runs pip in a child process — never blocks the main thread.
 * Returns true when installation succeeded.
 */
async function tryInstallMissingPackage(
  skillDir: string,
  stderr: string
): Promise<boolean> {
  const moduleMatch = /ModuleNotFoundError: No module named '([^']+)'/.exec(
    stderr
  );
  if (!moduleMatch) return false;

  // Strip sub-module paths: "pdf2image.foo" → "pdf2image"
  const importRoot = (moduleMatch[1] ?? "").split(".")[0] ?? "";
  if (!importRoot) return false;

  const pipPackage = IMPORT_TO_PIP[importRoot] ?? importRoot;
  const pipBin = sandboxPipPath(skillDir);
  if (!fs.existsSync(pipBin)) {
    return false;
  }

  console.log(
    `[DocSkillScriptRunner] Auto-installing "${pipPackage}" into sandbox venv…`
  );

  const r = await runChildProcess(
    pipBin,
    ["install", pipPackage],
    PIP_INSTALL_TIMEOUT_MS
  );
  return r.code === 0;
}

function sanitizeScriptName(input: string): string {
  const base = path.basename(input);
  const noExt = base.endsWith(".py") ? base : `${base}.py`;
  // Only allow safe characters in script file names
  return noExt.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function sanitizeFileName(input: string): string {
  const base = path.basename(input);
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "attachment.bin";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunSkillScriptParams {
  readonly skillName: string;
  readonly scriptName: string;
  readonly attachmentRef?: string;
  readonly conversationId?: string;
}

export interface RunSkillScriptResult {
  readonly success: boolean;
  readonly result: Record<string, unknown>;
}

/**
 * Run a script from a documentation-only skill's `scripts/` directory.
 *
 * Creates a sandboxed venv in the skill directory on first use (without
 * hash-pinned requirements) and auto-installs missing packages when
 * a ModuleNotFoundError is detected.
 *
 * Scripts must follow the smithery convention:
 *   `python <script>.py <input_file_or_empty> <output_dir>`
 */
async function runSkillScript(
  params: RunSkillScriptParams
): Promise<RunSkillScriptResult> {
  const { skillName, scriptName, attachmentRef, conversationId } = params;

  // Resolve skill directory from DB
  const module = new SkillManagementModule();
  const row = await module.getSkillByName(skillName);
  if (!row) {
    return {
      success: false,
      result: { error: `Skill not found: ${skillName}` },
    };
  }

  // Skill must have a scripts/ directory
  const skillDir = path.join(
    getElectronUserDataPath(),
    "installed_skills",
    skillName
  );
  const scriptsDir = path.join(skillDir, SCRIPT_SUBDIR);

  const safeScript = sanitizeScriptName(scriptName);
  const scriptPath = path.join(scriptsDir, safeScript);

  if (!fs.existsSync(scriptPath)) {
    const available = fs.existsSync(scriptsDir)
      ? fs
          .readdirSync(scriptsDir)
          .filter((f) => f.endsWith(".py"))
          .map((f) => path.basename(f, ".py"))
      : [];
    return {
      success: false,
      result: {
        error: `Script "${safeScript}" not found in ${skillName}/scripts/`,
        available_scripts: available,
        hint:
          available.length > 0
            ? `Use one of: ${available.join(", ")}`
            : "No Python scripts found in this skill's scripts/ directory.",
      },
    };
  }

  // Ensure sandbox venv exists
  let pythonBin: string;
  try {
    pythonBin = await ensureSandboxVenv(skillDir);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      result: {
        error: `Could not create Python sandbox environment: ${msg}`,
        hint: "Ensure Python 3 is installed on this system.",
      },
    };
  }

  // Prepare I/O directories
  const outputRoot = path.join(
    getElectronUserDataPath(),
    "skill-runtime-output"
  );
  const runId = `${Date.now()}-${crypto.randomUUID()}`;
  const runDir = path.join(outputRoot, skillName, runId);
  const inputDir = path.join(runDir, "input");
  const outputDir = path.join(runDir, "output");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  // Stage input file
  let inputPath: string;
  let inputFileName = "";

  if (attachmentRef && conversationId) {
    const docService = new DocumentService();
    let staged;
    try {
      staged = await docService.readStagedAttachment(
        conversationId,
        attachmentRef
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        result: {
          error: `Could not read staged attachment: ${msg}`,
          hint: "Ensure the file was attached in this conversation and attachment_ref matches.",
        },
      };
    }

    if (!staged.sha256 || staged.sha256.length === 0) {
      return {
        success: false,
        result: {
          error: "Attachment is missing SHA256 binding. Re-upload the file.",
          mode: "skill_script_error",
        },
      };
    }
    const attachModule = new AIChatAttachmentModule();
    const stored = await attachModule.getLatestAttachmentBySha256(
      conversationId,
      staged.sha256
    );
    if (!stored) {
      return {
        success: false,
        result: {
          error: `Original attachment bytes not found for "${staged.fileName}". Re-upload the file.`,
          mode: "skill_script_error",
        },
      };
    }
    inputPath = path.join(inputDir, sanitizeFileName(staged.fileName));
    fs.writeFileSync(inputPath, stored.contentBlob);
    inputFileName = staged.fileName;
  } else {
    // No attachment — provide empty placeholder so scripts with optional
    // attachment support don't crash on missing argv
    inputPath = path.join(inputDir, "_no_attachment");
    fs.writeFileSync(inputPath, Buffer.alloc(0));
  }

  // Execute the script; auto-install and retry once on ModuleNotFoundError
  const executeOnce = async (): Promise<{
    ok: boolean;
    stdout: string;
    stderr: string;
  }> => {
    try {
      const workerResult =
        await PythonRuntimeWorkerClient.getInstance().execute(
          pythonBin,
          scriptPath,
          [inputPath, outputDir],
          PYTHON_SCRIPT_TIMEOUT_MS
        );
      return {
        ok: true,
        stdout: workerResult.stdout,
        stderr: workerResult.stderr,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const stderrMatch = /stderr:\s*([\s\S]*)$/m.exec(msg);
      const stderr = stderrMatch ? stderrMatch[1].trim() : msg;
      return { ok: false, stdout: "", stderr };
    }
  };

  let runOutput = await executeOnce();

  if (!runOutput.ok && runOutput.stderr.includes("ModuleNotFoundError")) {
    const installed = await tryInstallMissingPackage(
      skillDir,
      runOutput.stderr
    );
    if (installed) {
      runOutput = await executeOnce();
    }
  }

  const outputFiles = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).sort((a, b) => a.localeCompare(b))
    : [];

  const outputDirectoryHint = path.join(
    "skill-runtime-output",
    skillName,
    runId,
    "output"
  );

  if (!runOutput.ok) {
    return {
      success: false,
      result: {
        error: runOutput.stderr || "Script execution failed",
        mode: "skill_script_error",
        skillName,
        scriptName: safeScript,
        stdout: runOutput.stdout,
        stderr: runOutput.stderr,
        hint: "If packages are missing, they should auto-install on next run. Check stderr for details.",
      },
    };
  }

  return {
    success: true,
    result: {
      mode: "skill_script_executed",
      skillName,
      scriptName: safeScript,
      inputFileName: inputFileName.length > 0 ? inputFileName : undefined,
      runId,
      outputDirectoryHint,
      outputFiles,
      outputCount: outputFiles.length,
      stdout: runOutput.stdout,
      stderr: runOutput.stderr,
    },
  };
}

/**
 * List Python scripts available in a skill's `scripts/` directory.
 */
function listAvailableScripts(skillName: string): string[] {
  const skillDir = path.join(
    getElectronUserDataPath(),
    "installed_skills",
    skillName
  );
  const scriptsDir = path.join(skillDir, SCRIPT_SUBDIR);
  if (!fs.existsSync(scriptsDir)) return [];
  return fs
    .readdirSync(scriptsDir)
    .filter((f) => f.endsWith(".py"))
    .map((f) => path.basename(f, ".py"))
    .sort();
}

export const DocSkillScriptRunnerService = {
  runSkillScript,
  listAvailableScripts,
} as const;
