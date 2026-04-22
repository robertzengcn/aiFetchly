/**
 * Configuration for AI File Tools.
 *
 * Centralises workspace roots, deny-list patterns, size limits,
 * and rate-limit buckets so every file tool shares the same policy.
 */

import type {
  DenyListConfig,
  FileToolRateLimitConfig,
  FileToolSizeLimits,
} from "@/entityTypes/fileToolTypes";
import * as path from "path";
import { app } from "electron";

// ---------------------------------------------------------------------------
// Default deny-list patterns
// ---------------------------------------------------------------------------

export const DEFAULT_DENY_LIST: readonly DenyListConfig[] = [
  {
    patterns: [".git/**"],
    description: "Version control internals",
  },
  {
    patterns: ["**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx"],
    description: "Cryptographic keys",
  },
  {
    patterns: ["**/.env", "**/.env.*"],
    description: "Environment variable files",
  },
  {
    patterns: ["**/credentials*", "**/secrets*"],
    description: "Credential and secret files",
  },
];

// ---------------------------------------------------------------------------
// Default ignore patterns (for glob/grep, not security deny-list)
// ---------------------------------------------------------------------------

export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  "out/**",
  ".next/**",
  "coverage/**",
  "__pycache__/**",
  ".DS_Store",
];

// ---------------------------------------------------------------------------
// Size limits
// ---------------------------------------------------------------------------

export const FILE_TOOL_SIZE_LIMITS: FileToolSizeLimits = {
  maxReadBytes: 1_000_000, // 1 MB
  maxGrepOutputBytes: 500_000, // 500 KB
  defaultHeadLimit: 100,
};

// ---------------------------------------------------------------------------
// Rate-limit buckets (consumed by ToolExecutor)
// ---------------------------------------------------------------------------

export const FILE_TOOL_RATE_LIMITS: {
  readonly fileRead: FileToolRateLimitConfig;
  readonly fileSearch: FileToolRateLimitConfig;
  readonly fileWrite: FileToolRateLimitConfig;
} = {
  fileRead: {
    maxPerMinute: 30,
    maxConcurrent: 5,
    cooldownMs: 200,
  },
  fileSearch: {
    maxPerMinute: 20,
    maxConcurrent: 3,
    cooldownMs: 500,
  },
  fileWrite: {
    maxPerMinute: 10,
    maxConcurrent: 1,
    cooldownMs: 1000,
  },
};

// ---------------------------------------------------------------------------
// Workspace roots
// ---------------------------------------------------------------------------

/**
 * Return the default list of allowed workspace roots.
 *
 * In production this returns the user's home directory so the AI can
 * explore projects.  Callers may pass additional roots at invocation time.
 */
export function getDefaultWorkspaceRoots(): readonly string[] {
  try {
    const home = app.getPath("home");
    const userData = app.getPath("userData");
    return [home, userData];
  } catch {
    // Fallback for test environments where Electron `app` is unavailable
    return [process.cwd()];
  }
}
