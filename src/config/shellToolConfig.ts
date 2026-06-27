/**
 * Configuration for the Shell Execution Skill.
 *
 * Centralises denylist patterns, output size caps, timeout defaults,
 * environment allowlist, and rate limits so the ShellToolService
 * has a single source of truth for all security controls.
 */

// ---------------------------------------------------------------------------
// Timeout defaults
// ---------------------------------------------------------------------------

/** Default command timeout in milliseconds (60 seconds). */
export const SHELL_DEFAULT_TIMEOUT_MS = 60_000;

/** Maximum allowed command timeout in milliseconds (10 minutes). */
export const SHELL_MAX_TIMEOUT_MS = 600_000;

/** Minimum allowed command timeout in milliseconds. */
export const SHELL_MIN_TIMEOUT_MS = 1_000;

/**
 * When true, AI-invoked shell commands that exceed the timeout are moved
 * into the BackgroundShellRegistry instead of being killed. The AI can
 * then poll for completion via the check_shell_status tool.
 *
 * Default: true — preserves work that would otherwise be lost on timeout.
 */
export const SHELL_AUTO_BACKGROUND_DEFAULT = true;

// ---------------------------------------------------------------------------
// Output size caps
// ---------------------------------------------------------------------------

/** Maximum stdout size in characters (256K chars). */
export const SHELL_STDOUT_MAX_CHARS = 256 * 1024;

/** Maximum stderr size in characters (256K chars). */
export const SHELL_STDERR_MAX_CHARS = 256 * 1024;

// ---------------------------------------------------------------------------
// Command length limit
// ---------------------------------------------------------------------------

/** Maximum command string length in characters. */
export const SHELL_MAX_COMMAND_LENGTH = 10_000;

// ---------------------------------------------------------------------------
// Destructive command denylist
// ---------------------------------------------------------------------------

/**
 * Regex patterns for commands that are always blocked.
 *
 * These are checked BEFORE any execution, regardless of user consent.
 * Patterns are matched against the full command string (case-insensitive).
 *
 * IMPORTANT: This denylist is a best-effort safety net for obvious accidents,
 * NOT a security boundary. Since the command is interpreted by bash, indirection
 * (variables, command substitution, eval, base64 pipes) can bypass these patterns.
 * The user-facing permission prompt (showing the exact command) is the primary
 * defense. Do NOT rely on this list for security-critical decisions.
 */
export const SHELL_DENYLIST_PATTERNS: readonly DenylistEntry[] = [
  // Filesystem destruction
  {
    pattern:
      /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|.*--no-preserve-root.*)(\/|\/home|\/etc|\/usr|\/var|\/opt|\/boot|\/sys|\/proc)\b/i,
    description: "Recursive force delete of system directories",
  },
  {
    pattern: /\bmkfs\b/i,
    description: "Filesystem format command",
  },
  {
    pattern: /\bdd\s+.*of=\/dev\//i,
    description: "Raw device write (dd to device)",
  },
  {
    pattern: />\s*\/dev\/(sda|hda|nvme|mmcblk|loop|vd[a-z])/i,
    description: "Direct write to block device",
  },

  // Fork bombs and resource exhaustion
  {
    pattern: /:\(\)\{\s*:\|:&\s*\}/,
    description: "Bash fork bomb pattern",
  },
  {
    pattern: /\bwhile\s+true\s*;\s*do\s*/i,
    description: "Infinite loop pattern (potential resource exhaustion)",
  },

  // System shutdown/reboot
  {
    pattern: /\b(shutdown|reboot|poweroff|halt)\b/i,
    description: "System shutdown/reboot commands",
  },

  // Partition/disk operations
  {
    pattern: /\b(fdisk|parted|gparted|cfdisk)\b/i,
    description: "Partition management commands",
  },

  // Windows destructive patterns
  {
    pattern: /\bformat\s+[a-zA-Z]:/i,
    description: "Windows format drive command",
  },
  {
    pattern: /\bdel\s+\/[sS]\s+\/[qQ]\s+[a-zA-Z]:\\/i,
    description: "Windows recursive silent delete",
  },

  // Privilege escalation
  {
    pattern: /\bsudo\b/,
    description: "Privilege escalation via sudo",
  },

  // Indirection and eval (bypass vectors)
  {
    pattern: /\beval\s+/i,
    description: "eval command (can bypass denylist via string construction)",
  },
  {
    pattern: /\bexec\s+/i,
    description: "exec command (process replacement bypass)",
  },
];

/** A single denylist entry with pattern and description. */
export interface DenylistEntry {
  readonly pattern: RegExp;
  readonly description: string;
}

// ---------------------------------------------------------------------------
// Environment allowlist
// ---------------------------------------------------------------------------

/**
 * Environment variables that are safe to pass to child processes.
 *
 * Using an allowlist approach (rather than blacklist) to avoid
 * accidentally leaking secrets in environment variables.
 */
export const SHELL_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "TERM",
  "SHELL",
  "PWD",
  "OLDPWD",
  "HOSTNAME",
  "LOGNAME",
  "MAIL",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "TZ",
  "LOCALE",
  "LC_ALL",
  "LC_CTYPE",
  "LESSOPEN",
  "LESSCLOSE",
  "LS_COLORS",
  "COLORTERM",
  "DISPLAY",
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
];

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** Rate limit configuration for shell executions. */
export interface ShellRateLimitConfig {
  /** Maximum concurrent shell executions. */
  readonly maxConcurrent: number;
  /** Maximum executions per minute. */
  readonly maxPerMinute: number;
  /** Cooldown between executions in milliseconds. */
  readonly cooldownMs: number;
}

/** Rate limits for shell execution operations. */
export const SHELL_RATE_LIMITS: ShellRateLimitConfig = {
  maxConcurrent: 2,
  maxPerMinute: 15,
  cooldownMs: 500,
};

// ---------------------------------------------------------------------------
// Sensitive token redaction patterns (for audit logs)
// ---------------------------------------------------------------------------

/**
 * Patterns used to redact sensitive tokens from command text
 * before writing to audit logs.
 */
export const SHELL_REDACTION_PATTERNS: readonly RedactionPattern[] = [
  // OpenAI / Anthropic API keys
  {
    pattern: /\b(sk-[a-zA-Z0-9_-]{10,}|sk-ant-[a-zA-Z0-9_-]{10,})\b/g,
    replacement: "[REDACTED_API_KEY]",
  },
  // GitHub tokens
  {
    pattern: /\b(ghp_[a-zA-Z0-9]{10,}|gho_[a-zA-Z0-9]{10,})\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  // AWS access keys
  {
    pattern: /\b(AKIA[A-Z0-9]{16})\b/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  // Password assignments
  {
    pattern: /(--password[=\s]+|password[=:]\s*)[^\s"'&|;]+/gi,
    replacement: "$1[REDACTED_PASSWORD]",
  },
  // Token assignments
  {
    pattern: /(--token[=\s]+|token[=:]\s*|Bearer\s+)[^\s"'&|;]+/gi,
    replacement: "$1[REDACTED_TOKEN]",
  },
  // API key assignments
  {
    pattern: /(--api-key[=\s]+|api_key[=:]\s*|apikey[=:]\s*)[^\s"'&|;]+/gi,
    replacement: "$1[REDACTED_API_KEY]",
  },
  // Secret assignments
  {
    pattern: /(--secret[=\s]+|secret[=:]\s*)[^\s"'&|;]+/gi,
    replacement: "$1[REDACTED_SECRET]",
  },
  // URLs with embedded credentials (user:pass@host)
  {
    pattern: /([a-zA-Z]+:\/\/)([^\s:]+):([^\s@]+)@/g,
    replacement: "$1[REDACTED_USER]:[REDACTED_PASS]@",
  },
];

/** A single redaction pattern with replacement text. */
export interface RedactionPattern {
  readonly pattern: RegExp;
  readonly replacement: string;
}
