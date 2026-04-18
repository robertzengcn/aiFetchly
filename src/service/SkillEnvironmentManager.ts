/**
 * Per-skill Python virtual environments for imported `runtime: "python"` skills.
 * Creates `.env/` under the skill install directory from a hash-pinned requirements file.
 */

import { spawn, spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type {
  SkillManifest,
  SkillPythonManifestBlock,
} from "@/entityTypes/skillTypes";

const ENV_DIR_NAME = ".env";
const ENV_STATE_FILE = ".env.state.json";
const PIP_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const PYTHON_PROBE_TIMEOUT_MS = 30_000;

export interface SkillEnvironmentStateFile {
  readonly requirementsHash: string;
  readonly pythonVersion: string;
  readonly baseInterpreter: string;
  readonly createdAt: string;
}

/**
 * Resolves Electron userData when running in the main process; falls back for
 * unit tests that import this module without Electron.
 */
export function getElectronUserDataPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const electron = require("electron") as typeof import("electron");
    if (electron?.app && typeof electron.app.getPath === "function") {
      return electron.app.getPath("userData");
    }
  } catch {
    // Vitest / non-Electron contexts
  }
  return path.join(process.cwd(), ".test-userData");
}

function getInstalledSkillRoot(skillName: string): string {
  return path.join(getElectronUserDataPath(), "installed_skills", skillName);
}

function sha256OfFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function ensurePathUnderSkillDir(
  skillDir: string,
  relativePath: string
): string {
  const resolved = path.resolve(path.join(skillDir, relativePath));
  const root = path.resolve(skillDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path "${relativePath}" escapes skill directory`);
  }
  return resolved;
}

function getBasePythonCandidates(): string[] {
  const fromEnv = process.env.PYTHON_BIN?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return [fromEnv, "python3", "python"];
  }
  return ["python3", "python"];
}

function getPythonVersionLine(executable: string): string | null {
  const result = spawnSync(
    executable,
    [
      "-c",
      "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')",
    ],
    {
      encoding: "utf-8",
      timeout: PYTHON_PROBE_TIMEOUT_MS,
      windowsHide: true,
    }
  );
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  return result.stdout.trim();
}

function versionTuple(versionLine: string): {
  major: number;
  minor: number;
  micro: number;
} {
  const parts = versionLine.split(".").map((p) => {
    const n = parseInt(p.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  });
  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    micro: parts[2] ?? 0,
  };
}

function meetsPythonVersionConstraint(
  versionLine: string,
  constraint: string
): boolean {
  const trimmed = constraint.trim();
  const ge = /^>=([0-9]+)\.([0-9]+)(?:\.([0-9]+))?$/.exec(trimmed);
  if (!ge) {
    console.warn(
      `[SkillEnvironmentManager] Unsupported Python version constraint "${trimmed}"; skipping version check. Only >=M.m[.p] is supported.`
    );
    return true;
  }
  const wantMajor = parseInt(ge[1], 10);
  const wantMinor = parseInt(ge[2], 10);
  const wantMicro = ge[3] !== undefined ? parseInt(ge[3], 10) : 0;
  const { major, minor, micro } = versionTuple(versionLine);
  if (major > wantMajor) {
    return true;
  }
  if (major < wantMajor) {
    return false;
  }
  if (minor > wantMinor) {
    return true;
  }
  if (minor < wantMinor) {
    return false;
  }
  return micro >= wantMicro;
}

function pickBasePython(pythonBlock: SkillPythonManifestBlock): {
  bin: string;
  versionLine: string;
} {
  const constraint = pythonBlock.version;
  for (const candidate of getBasePythonCandidates()) {
    const versionLine = getPythonVersionLine(candidate);
    if (!versionLine) {
      continue;
    }
    if (!meetsPythonVersionConstraint(versionLine, constraint)) {
      continue;
    }
    return { bin: candidate, versionLine };
  }
  throw new Error(
    `No Python interpreter satisfies "${constraint}". Set PYTHON_BIN or install Python 3.`
  );
}

function venvPythonPath(skillDir: string): string {
  if (process.platform === "win32") {
    return path.join(skillDir, ENV_DIR_NAME, "Scripts", "python.exe");
  }
  return path.join(skillDir, ENV_DIR_NAME, "bin", "python");
}

function readState(skillDir: string): SkillEnvironmentStateFile | null {
  const statePath = path.join(skillDir, ENV_STATE_FILE);
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as SkillEnvironmentStateFile).requirementsHash ===
        "string" &&
      typeof (parsed as SkillEnvironmentStateFile).pythonVersion === "string" &&
      typeof (parsed as SkillEnvironmentStateFile).baseInterpreter === "string"
    ) {
      return parsed as SkillEnvironmentStateFile;
    }
  } catch {
    return null;
  }
  return null;
}

function writeState(skillDir: string, state: SkillEnvironmentStateFile): void {
  fs.writeFileSync(
    path.join(skillDir, ENV_STATE_FILE),
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}

async function removeVenvArtifacts(skillDir: string): Promise<void> {
  const venvPath = path.join(skillDir, ENV_DIR_NAME);
  const statePath = path.join(skillDir, ENV_STATE_FILE);
  await Promise.all([
    fs.promises.rm(venvPath, { recursive: true, force: true }).catch(() => {
      /* ignore */
    }),
    fs.promises.unlink(statePath).catch(() => {
      /* ignore */
    }),
  ]);
}

async function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`
        )
      );
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function probeSystemCommand(probe: string): boolean {
  const result = spawnSync(probe, ["--version"], {
    encoding: "utf-8",
    timeout: 10_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
}

function platformKey(): "darwin" | "linux" | "win32" {
  if (process.platform === "darwin") {
    return "darwin";
  }
  if (process.platform === "win32") {
    return "win32";
  }
  return "linux";
}

export function assertRequirementsFileHasHashes(content: string): void {
  if (!content.includes("--hash=")) {
    throw new Error(
      "Python skill requirements must be hash-pinned (each package line must include --hash= from pip-compile or uv)."
    );
  }
}

function normalizePkgToken(token: string): string {
  return token.toLowerCase().replace(/[_-]/g, "");
}

export function requirementsLockReferencesModule(
  requirementsContent: string,
  moduleName: string
): boolean {
  const want = normalizePkgToken(moduleName);
  const lines = requirementsContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("\\")) {
      continue;
    }
    const pkgMatch = /^([a-z0-9_.-]+)/i.exec(trimmed);
    if (!pkgMatch) {
      continue;
    }
    const raw = pkgMatch[1].toLowerCase();
    if (normalizePkgToken(raw) === want) {
      return true;
    }
  }
  return false;
}

async function createVenv(basePython: string, skillDir: string): Promise<void> {
  const venvTarget = path.join(skillDir, ENV_DIR_NAME);
  const result = await runProcess(
    basePython,
    ["-m", "venv", venvTarget],
    skillDir,
    120_000
  );
  if (result.code !== 0) {
    throw new Error(`Failed to create venv: ${result.stderr}`);
  }
}

export const SkillEnvironmentManager = {
  getInstalledSkillRoot,

  async remove(skillDir: string): Promise<void> {
    await removeVenvArtifacts(skillDir);
  },

  async removeSkillDir(skillDir: string): Promise<void> {
    await fs.promises
      .rm(skillDir, { recursive: true, force: true })
      .catch(() => {
        /* ignore */
      });
  },

  async repair(skillDir: string, manifest: SkillManifest): Promise<void> {
    await removeVenvArtifacts(skillDir);
    await SkillEnvironmentManager.prepare(skillDir, manifest);
  },

  async prepare(skillDir: string, manifest: SkillManifest): Promise<void> {
    if (manifest.runtime !== "python" || !manifest.python) {
      throw new Error("prepare() requires a Python skill manifest");
    }
    const pythonBlock = manifest.python;
    const requirementsAbs = ensurePathUnderSkillDir(
      skillDir,
      pythonBlock.requirements_file
    );
    if (!fs.existsSync(requirementsAbs)) {
      throw new Error(
        `requirements file not found: ${pythonBlock.requirements_file}`
      );
    }
    const requirementsContent = fs.readFileSync(requirementsAbs, "utf-8");
    assertRequirementsFileHasHashes(requirementsContent);
    const hash = sha256OfFile(requirementsAbs);

    const existing = readState(skillDir);
    const venvPy = venvPythonPath(skillDir);
    if (
      existing &&
      existing.requirementsHash === hash &&
      fs.existsSync(venvPy)
    ) {
      return;
    }

    await removeVenvArtifacts(skillDir);

    const { bin: basePython, versionLine } = pickBasePython(pythonBlock);
    await createVenv(basePython, skillDir);

    if (!fs.existsSync(venvPy)) {
      throw new Error("venv python missing after venv creation");
    }

    const pipResult = await runProcess(
      venvPy,
      [
        "-m",
        "pip",
        "install",
        "--require-hashes",
        "--disable-pip-version-check",
        "--no-cache-dir",
        "-r",
        requirementsAbs,
      ],
      skillDir,
      PIP_INSTALL_TIMEOUT_MS
    );
    if (pipResult.code !== 0) {
      await removeVenvArtifacts(skillDir);
      throw new Error(
        `pip install failed (exit ${String(pipResult.code)}): ${
          pipResult.stderr
        }`
      );
    }

    const systemDeps = pythonBlock.system ?? [];
    for (const dep of systemDeps) {
      if (!probeSystemCommand(dep.probe)) {
        await removeVenvArtifacts(skillDir);
        const hint =
          dep.install_hint?.[platformKey()] ??
          dep.install_hint?.linux ??
          `Install "${dep.name}" so that "${dep.probe}" is on PATH.`;
        throw new Error(
          `Missing system dependency "${dep.name}" (probe: ${dep.probe}). ${hint}`
        );
      }
    }

    const state: SkillEnvironmentStateFile = {
      requirementsHash: hash,
      pythonVersion: versionLine,
      baseInterpreter: basePython,
      createdAt: new Date().toISOString(),
    };
    writeState(skillDir, state);
  },

  resolveInterpreter(skillDir: string): string {
    const venvPy = venvPythonPath(skillDir);
    if (!fs.existsSync(venvPy)) {
      throw new Error(
        "Python venv for this skill is missing. Re-import the skill or run skill_repair_environment."
      );
    }
    const state = readState(skillDir);
    if (!state) {
      throw new Error("Python environment state file missing; run repair.");
    }
    return venvPy;
  },
} as const;
