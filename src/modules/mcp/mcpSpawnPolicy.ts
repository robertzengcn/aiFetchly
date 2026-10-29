/**
 * Spawn policy shared by every MCP stdio launch path.
 *
 * Extracted from the legacy MCPClient (F1 fix) so the SDK-based transport and
 * any future consumer apply the identical environment sanitization and
 * shell-free argv rules (computer-use design §4.1: "assertStdioTrusted, env
 * allow/deny lists, cwd, shell-free argv, bounded message size, and
 * process-tree ownership stay in host code").
 */

/**
 * Minimal environment allowlist inherited by spawned MCP stdio children.
 * Keeps PATH/HOME/USER/locale essentials so binaries resolve, while keeping
 * tokens, cookies, DB paths, and Electron-internal secrets out of the child
 * environment.
 */
export const MCP_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "TERM",
  "SHELL",
  "PWD",
  "HOSTNAME",
  "LOGNAME",
  "TZ",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "SystemRoot",
  "COMSPEC",
];

/**
 * Env var names that must NEVER be inherited from caller-declared config.env.
 * These enable arbitrary code execution or process hijacking if layered on
 * top of the spawned stdio child.
 */
export const MCP_ENV_DENY_NAMES: ReadonlySet<string> = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_ENABLE_LOGGING",
  "UV_THREADPOOL_SIZE",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "PERL5OPT",
  "PERLLIB",
  "RUBYOPT",
  "RUBYLIB",
]);

/** Env var prefixes to block (case-insensitive). */
export const MCP_ENV_DENY_PREFIXES: readonly string[] = [
  "ELECTRON_",
  "AIFETCHLY_",
];

/**
 * Build the sanitized child environment: allowlisted `process.env` values
 * plus caller-declared extras that pass the deny rules. Never spreads the
 * whole parent environment.
 */
export function buildSanitizedChildEnv(
  extraEnv: Record<string, string> | undefined
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of MCP_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      childEnv[key] = process.env[key];
    }
  }
  if (extraEnv) {
    for (const [k, v] of Object.entries(extraEnv)) {
      if (typeof v !== "string") continue;
      if (isDeniedEnvName(k)) continue;
      childEnv[k] = v;
    }
  }
  return childEnv;
}

/** Deny check for a caller-declared env name (case-insensitive). */
export function isDeniedEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  if (MCP_ENV_DENY_NAMES.has(upper)) return true;
  return MCP_ENV_DENY_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * Validate a stdio command for a shell-free spawn: the command must be a
 * single executable path/name (no shell metacharacters) and args must be
 * non-empty strings when present. Prevents a bare command string from being
 * interpreted through a shell on any platform.
 */
export function assertShellFreeArgv(
  command: string,
  args: readonly string[]
): void {
  if (typeof command !== "string" || command.length === 0) {
    throw new Error("MCP stdio command must be a non-empty string.");
  }
  if (/[<>|;&`$()\n\r]/.test(command)) {
    throw new Error(
      "MCP stdio command must not contain shell metacharacters."
    );
  }
  for (const arg of args) {
    if (typeof arg !== "string" || arg.includes("\0")) {
      throw new Error("MCP stdio args must be strings without NUL bytes.");
    }
  }
}
