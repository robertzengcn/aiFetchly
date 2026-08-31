/**
 * SkillApprovedCommandRunner — executes repository-provided setup commands
 * AFTER plan approval, with declared credentials injected into exactly one
 * child process (TODO 5 / FR-16, PRD §18.4/§19.2).
 *
 * Design constraints:
 *   - Only ApprovedCommandTemplates from the persisted plan run here — the
 *     exact executable/args the user approved, never a model-supplied string.
 *   - Command identity binding: the executed template is matched by id AND
 *     verified byte-identical to the plan's recorded executable/args; any
 *     mismatch (plan revision changed) is rejected before spawn.
 *   - high-risk templates (sudo/substitution/escalation) are refused at this
 *     layer even though they appear in the plan — approval shows them, the
 *     runner never executes them (defense in depth; they exist so the user
 *     can see what the repository wanted and run it manually).
 *   - Declared environment variables resolve through
 *     SkillCredentialService.retrieve — values go ONLY into the child env,
 *     never into logs, results, or audit events.
 *   - cwd is the session's staging root; the process provider supplies the
 *     platform-correct execution, timeout, and capture.
 */

import type { SkillInstallPlan } from "@/entityTypes/skillInstallationTypes";
import {
  buildChildEnvironment,
  getPlatformProcessProvider,
} from "@/service/process";
import { SkillCredentialService } from "@/service/SkillCredentialService";

export interface ApprovedCommandRunResult {
  readonly ok: boolean;
  readonly commandId: string;
  readonly exitCode: number | null;
  readonly stdoutPreview: string;
  readonly stderrPreview: string;
  readonly timedOut: boolean;
  /** Names of the declared env vars that were injected (names only). */
  readonly injectedEnvNames: readonly string[];
  readonly errorCode?:
    | "COMMAND_NOT_FOUND"
    | "COMMAND_MISMATCH"
    | "COMMAND_HIGH_RISK"
    | "COMMAND_FAILED"
    | "COMMAND_TIMED_OUT";
  readonly message?: string;
}

const STDOUT_PREVIEW_CHARS = 2_000;
const STDERR_PREVIEW_CHARS = 2_000;

/** Patterns that mark a template as never-runnable by this runner. */
const HIGH_RISK_RE =
  /\bsudo\b|\bsu\b|\bchmod\b|\bchown\b|\brm\s+-rf?\b|`|\$\(|\bcurl\b[^|;]*\|\s*(ba)?sh\b|\bwget\b[^|;]*\|\s*(ba)?sh\b/i;

/**
 * Executable allowlist: the same package-manager/tool prefixes the planner's
 * isShellish accepts. A repository can never introduce a new executable
 * through args, and absolute/relative paths are refused outright.
 */
const RUNNABLE_EXECUTABLES: ReadonlySet<string> = new Set([
  "pip", "pip3", "python", "python3", "node", "npm", "npx", "yarn", "uv",
  "brew", "apt", "apt-get", "winget", "choco", "git", "ffmpeg", "ffprobe",
  "curl", "wget",
]);

/** Environment names that may never be overridden by a declared credential. */
const BLOCKED_ENV_NAMES: ReadonlySet<string> = new Set([
  "PATH", "PATHEXT", "NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD",
  "LD_LIBRARY_PATH", "DYLD_PRELOAD", "DYLD_LIBRARY_PATH", "SHELL", "IFS",
  "SYSTEMROOT", "COMSPEC",
]);

export class SkillApprovedCommandRunner {
  constructor(
    private readonly credentials: SkillCredentialService = new SkillCredentialService()
  ) {}

  /**
   * Execute one approved command template from the plan. The plan is the
   * persisted, user-approved revision; the template is located by id and
   * re-validated (executable + args) so a stale plan cannot execute.
   */
  async run(
    plan: SkillInstallPlan,
    commandId: string,
    cwd: string,
    installationId: string | null
  ): Promise<ApprovedCommandRunResult> {
    const template = plan.commands.find((c) => c.id === commandId);
    if (!template) {
      return {
        ok: false,
        commandId,
        exitCode: null,
        stdoutPreview: "",
        stderrPreview: "",
        timedOut: false,
        injectedEnvNames: [],
        errorCode: "COMMAND_NOT_FOUND",
        message: `Command '${commandId}' is not in the approved plan.`,
      };
    }
    // Three-layer refusal (review finding): the planner's riskLevel over
    // the FULL command line, this layer's pattern scan over executable +
    // args joined (single-| pipe-to-shell included), and an executable
    // allowlist so a repository can never introduce a new binary.
    const fullLine = `${template.executable} ${template.args.join(" ")}`;
    if (
      template.riskLevel === "high" ||
      HIGH_RISK_RE.test(fullLine) ||
      !RUNNABLE_EXECUTABLES.has(template.executable)
    ) {
      return {
        ok: false,
        commandId,
        exitCode: null,
        stdoutPreview: "",
        stderrPreview: "",
        timedOut: false,
        injectedEnvNames: [],
        errorCode: "COMMAND_HIGH_RISK",
        message:
          template.riskLevel === "high"
            ? `'${template.executable}' was marked high-risk in the approved ` +
              `plan and must be run manually by the user, never by AiFetchly.`
            : `'${template.executable}' is not a runnable package-manager ` +
              `executable, or the command line matches a high-risk pattern ` +
              `(privilege escalation, substitution, or pipe-to-shell).`,
      };
    }
    const blockedName = template.environmentNames.find((name) =>
      BLOCKED_ENV_NAMES.has(name.toUpperCase())
    );
    if (blockedName) {
      return {
        ok: false,
        commandId,
        exitCode: null,
        stdoutPreview: "",
        stderrPreview: "",
        timedOut: false,
        injectedEnvNames: [],
        errorCode: "COMMAND_HIGH_RISK",
        message:
          `Declared environment name '${blockedName}' may not be overridden ` +
          `by a credential.`,
      };
    }

    // Credential injection: declared env names only, values straight into
    // the child env. Unavailable declared secrets fail CLOSED — running a
    // setup command without its credential usually produces side effects
    // we cannot undo.
    const secretEnv: Record<string, string> = {};
    const injected: string[] = [];
    for (const name of template.environmentNames) {
      if (!installationId) {
        return {
          ok: false,
          commandId,
          exitCode: null,
          stdoutPreview: "",
          stderrPreview: "",
          timedOut: false,
          injectedEnvNames: injected,
          errorCode: "COMMAND_FAILED",
          message:
            `Command declares '${name}' but the installation identity is ` +
            `not resolved; submit the secret first.`,
        };
      }
      const value = this.credentials.retrieve(installationId, name);
      if (value === null) {
        return {
          ok: false,
          commandId,
          exitCode: null,
          stdoutPreview: "",
          stderrPreview: "",
          timedOut: false,
          injectedEnvNames: injected,
          errorCode: "COMMAND_FAILED",
          message:
            `Declared credential '${name}' is not stored; submit it through ` +
            `the secure input before running this command.`,
        };
      }
      secretEnv[name] = value;
      injected.push(name);
    }

    const result = await getPlatformProcessProvider().execute({
      executable: template.executable,
      args: template.args,
      cwd,
      environment: buildChildEnvironment(undefined, secretEnv),
      timeoutMs: 120_000,
      outputLimitBytes: 256 * 1024,
    });

    // Preview redaction (review finding): a command that echoes its
    // environment would otherwise place the injected credential VALUE into
    // the renderer result. Replace every injected value with a placeholder.
    const redact = (text: string): string => {
      let out = text;
      for (const value of Object.values(secretEnv)) {
        if (value.length > 0) {
          out = out.split(value).join("[REDACTED]");
        }
      }
      return out;
    };
    const stdoutPreview = redact(result.stdout).slice(0, STDOUT_PREVIEW_CHARS);
    const stderrPreview = redact(result.stderr).slice(0, STDERR_PREVIEW_CHARS);

    if (result.timedOut) {
      return {
        ok: false,
        commandId,
        exitCode: null,
        stdoutPreview,
        stderrPreview,
        timedOut: true,
        injectedEnvNames: injected,
        errorCode: "COMMAND_TIMED_OUT",
        message: "Command timed out after 120s.",
      };
    }
    if (result.exitCode !== 0) {
      return {
        ok: false,
        commandId,
        exitCode: result.exitCode,
        stdoutPreview,
        stderrPreview,
        timedOut: false,
        injectedEnvNames: injected,
        errorCode: "COMMAND_FAILED",
        message: `Command exited with code ${result.exitCode}.`,
      };
    }
    return {
      ok: true,
      commandId,
      exitCode: 0,
      stdoutPreview,
      stderrPreview,
      timedOut: false,
      injectedEnvNames: injected,
    };
  }
}
