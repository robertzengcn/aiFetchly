/**
 * Claude Code plugin-agent tool compatibility.
 *
 * Plugin agents declare Claude Code tool names (`Write`, `Edit`, `Bash`, …).
 * Those names are what the agent prompt and the model expect. This module
 * keeps the Claude name on the agent allowlist, exposes a Claude-shaped
 * parameter schema, and translates each call onto the AiFetchly tool that
 * actually runs.
 *
 * Tools Claude Code itself withholds from subagents are dropped quietly.
 * Tools Claude Code exposes but AiFetchly cannot run yet produce a
 * recoverable diagnostic and are not granted.
 */

export interface ClaudeAgentToolAlias {
  readonly claudeName: string;
  readonly aifetchlyName: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export type ClaudeAgentToolClass =
  | { readonly kind: "alias"; readonly alias: ClaudeAgentToolAlias }
  | { readonly kind: "omit" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "native"; readonly name: string };

export interface ClaudeAgentToolInvocation {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

const OMITTED_FOR_SUBAGENTS = new Set([
  "agent",
  "askuserquestion",
  "taskoutput",
  "taskstop",
  "enterplanmode",
  "exitplanmode",
  "workflow",
]);

const UNSUPPORTED_CLAUDE_TOOLS = new Set([
  "notebookedit",
  "todowrite",
  "enterworktree",
  "exitworktree",
  "toolsearch",
  "syntheticoutput",
  "taskcreate",
  "taskget",
  "tasklist",
  "taskupdate",
  "sendmessage",
  "croncreate",
  "crondelete",
  "cronlist",
  "listmcpresources",
  "readmcpresource",
  "bashoutput",
  "killshell",
]);

/**
 * Tools a Claude plugin agent receives when `tools` is omitted or `*`.
 * Matches the coding surface Claude Code gives custom agents, limited to
 * tools AiFetchly can execute.
 */
export const DEFAULT_CLAUDE_PLUGIN_AGENT_TOOLS: readonly string[] = [
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Bash",
  "WebFetch",
  "WebSearch",
  "Skill",
];

const FILE_PATH_SCHEMA = {
  type: "string",
  description:
    "Absolute path, or a path relative to the conversation workspace.",
};

function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[]
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required: [...required],
  };
}

const ALIASES: readonly ClaudeAgentToolAlias[] = [
  {
    claudeName: "Read",
    aifetchlyName: "file_read",
    description:
      "Read a file from the workspace. Returns text with line numbers. " +
      "Use offset and limit to read a slice of a long file.",
    parameters: objectSchema(
      {
        file_path: FILE_PATH_SCHEMA,
        offset: {
          type: "number",
          description: "1-based line number to start reading from.",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to return.",
        },
      },
      ["file_path"]
    ),
  },
  {
    claudeName: "Write",
    aifetchlyName: "file_write",
    description:
      "Write a file in the workspace. Creates the file when it is missing " +
      "and overwrites it when it already exists. Prefer Edit for small changes.",
    parameters: objectSchema(
      {
        file_path: FILE_PATH_SCHEMA,
        content: {
          type: "string",
          description: "Full contents to write.",
        },
      },
      ["file_path", "content"]
    ),
  },
  {
    claudeName: "Edit",
    aifetchlyName: "file_edit",
    description:
      "Replace an exact string in an existing workspace file. " +
      "old_string must match the file contents, including whitespace. " +
      "Fails when old_string matches more than once unless replace_all is true.",
    parameters: objectSchema(
      {
        file_path: FILE_PATH_SCHEMA,
        old_string: {
          type: "string",
          description: "Exact text to replace.",
        },
        new_string: {
          type: "string",
          description: "Replacement text.",
        },
        replace_all: {
          type: "boolean",
          description: "Replace every occurrence. Default false.",
        },
      },
      ["file_path", "old_string", "new_string"]
    ),
  },
  {
    claudeName: "MultiEdit",
    aifetchlyName: "file_edit",
    description:
      "Apply one or more exact string replacements to a workspace file. " +
      "Each edit uses old_string and new_string. Edits run in order.",
    parameters: objectSchema(
      {
        file_path: FILE_PATH_SCHEMA,
        edits: {
          type: "array",
          description: "Edits to apply in order.",
          items: {
            type: "object",
            properties: {
              old_string: { type: "string" },
              new_string: { type: "string" },
              replace_all: { type: "boolean" },
            },
            required: ["old_string", "new_string"],
          },
        },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      ["file_path"]
    ),
  },
  {
    claudeName: "Grep",
    aifetchlyName: "grep_files",
    description:
      "Search file contents with a regular expression inside the workspace.",
    parameters: objectSchema(
      {
        pattern: {
          type: "string",
          description: "Regular expression to search for.",
        },
        path: {
          type: "string",
          description: "File or directory to search. Defaults to the workspace.",
        },
        glob: {
          type: "string",
          description: "Glob that limits which files are searched.",
        },
        output_mode: {
          type: "string",
          enum: ["content", "files_with_matches", "count"],
          description:
            'Output mode. Defaults to "files_with_matches".',
        },
        "-A": { type: "number", description: "Lines of context after a match." },
        "-B": { type: "number", description: "Lines of context before a match." },
        "-C": {
          type: "number",
          description: "Lines of context before and after a match.",
        },
        "-i": { type: "boolean", description: "Case-insensitive search." },
        head_limit: { type: "number", description: "Maximum matches to return." },
        type: {
          type: "string",
          description: "File extension to search, such as ts or py.",
        },
      },
      ["pattern"]
    ),
  },
  {
    claudeName: "Glob",
    aifetchlyName: "glob_files",
    description: "Find files whose paths match a glob inside the workspace.",
    parameters: objectSchema(
      {
        pattern: {
          type: "string",
          description: "Glob pattern, for example **/*.ts.",
        },
        path: {
          type: "string",
          description: "Directory to search. Defaults to the workspace.",
        },
      },
      ["pattern"]
    ),
  },
  {
    claudeName: "LS",
    aifetchlyName: "glob_files",
    description: "List files under a workspace directory.",
    parameters: objectSchema(
      {
        path: {
          type: "string",
          description: "Directory to list. Defaults to the workspace.",
        },
      },
      []
    ),
  },
  {
    claudeName: "Bash",
    aifetchlyName: "shell_execute",
    description:
      "Run a shell command in the workspace. The command still requires " +
      "the user's shell permission. Do not use this to read or write files " +
      "when Read, Write, or Edit can do it.",
    parameters: objectSchema(
      {
        command: { type: "string", description: "Command to execute." },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds.",
        },
        description: {
          type: "string",
          description: "Short description of what the command does.",
        },
      },
      ["command"]
    ),
  },
  {
    claudeName: "WebFetch",
    aifetchlyName: "read_url_content",
    description:
      "Fetch a web page and return its content as markdown. " +
      "Apply the prompt yourself to the returned markdown.",
    parameters: objectSchema(
      {
        url: { type: "string", description: "HTTP or HTTPS URL to fetch." },
        prompt: {
          type: "string",
          description: "What to extract from the page. Applied by the model.",
        },
      },
      ["url"]
    ),
  },
  {
    claudeName: "WebSearch",
    aifetchlyName: "scrape_urls_from_search_engine",
    description:
      "Search the public web and return result titles and URLs. " +
      "Results come from Bing so no signed-in search account is required.",
    parameters: objectSchema(
      {
        query: { type: "string", description: "Search query." },
        allowed_domains: {
          type: "array",
          items: { type: "string" },
          description: "Accepted for Claude compatibility. Not applied.",
        },
        blocked_domains: {
          type: "array",
          items: { type: "string" },
          description: "Accepted for Claude compatibility. Not applied.",
        },
      },
      ["query"]
    ),
  },
  {
    claudeName: "Skill",
    aifetchlyName: "use_skill",
    description:
      "Load an installed skill's instructions for the current task. " +
      "Does not install or update skills.",
    parameters: objectSchema(
      {
        skill: {
          type: "string",
          description: "Skill name, for example commit or pdf.",
        },
        args: {
          type: "string",
          description: "Optional arguments passed to the skill.",
        },
      },
      ["skill"]
    ),
  },
];

const ALIAS_BY_LOWER = new Map<string, ClaudeAgentToolAlias>(
  ALIASES.map((alias) => [alias.claudeName.toLowerCase(), alias])
);

export function getClaudeAgentToolAlias(
  name: string
): ClaudeAgentToolAlias | undefined {
  return ALIAS_BY_LOWER.get(claudeToolBaseName(name).toLowerCase());
}

export function classifyClaudeAgentTool(raw: string): ClaudeAgentToolClass {
  const base = claudeToolBaseName(raw);
  const key = base.toLowerCase();
  if (OMITTED_FOR_SUBAGENTS.has(key)) return { kind: "omit" };
  const alias = ALIAS_BY_LOWER.get(key);
  if (alias) return { kind: "alias", alias };
  if (UNSUPPORTED_CLAUDE_TOOLS.has(key)) return { kind: "unsupported" };
  return { kind: "native", name: base };
}

/**
 * Runtime normalizer. Known Claude tools stay under their Claude name so the
 * model sees `Write` rather than `file_write`. Tools Claude withholds, and
 * tools AiFetchly cannot run, are dropped.
 */
export function normalizeClaudeAgentToolName(name: string): string | null {
  const classified = classifyClaudeAgentTool(name);
  if (classified.kind === "alias") return classified.alias.claudeName;
  if (classified.kind === "omit" || classified.kind === "unsupported") {
    return null;
  }
  return classified.name;
}

export function claudeToolBaseName(spec: string): string {
  const trimmed = spec.trim();
  const paren = trimmed.indexOf("(");
  if (paren <= 0) return trimmed;
  return trimmed.slice(0, paren).trim();
}

export function splitClaudeToolList(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) result.push(trimmed);
      current = "";
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail.length > 0) result.push(tail);
  return result;
}

export interface ParsedClaudeToolList {
  readonly tools: readonly string[];
  /** True when the declaration was `*`, omitted (Claude), or otherwise "all". */
  readonly wildcard: boolean;
}

/**
 * Parse a Claude `tools` / `disallowedTools` value.
 * A missing value is wildcard only when `missingMeansAll` is set, which is
 * how Claude Code treats an omitted agent `tools` field.
 */
export function parseClaudeToolField(
  value: unknown,
  missingMeansAll: boolean
): ParsedClaudeToolList {
  if (value === undefined || value === null) {
    return missingMeansAll
      ? { tools: DEFAULT_CLAUDE_PLUGIN_AGENT_TOOLS, wildcard: true }
      : { tools: [], wildcard: false };
  }
  if (value === true || value === "*") {
    return { tools: DEFAULT_CLAUDE_PLUGIN_AGENT_TOOLS, wildcard: true };
  }
  const rawItems: string[] = [];
  if (typeof value === "string") {
    rawItems.push(...splitClaudeToolList(value));
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim().length > 0) {
        rawItems.push(...splitClaudeToolList(item));
      }
    }
  }
  if (rawItems.length === 0) return { tools: [], wildcard: false };
  if (rawItems.some((item) => claudeToolBaseName(item) === "*")) {
    return { tools: DEFAULT_CLAUDE_PLUGIN_AGENT_TOOLS, wildcard: true };
  }
  return { tools: rawItems, wildcard: false };
}

export function translateClaudeAgentToolCall(
  name: string,
  args: Record<string, unknown>
): ClaudeAgentToolInvocation[] {
  const alias = getClaudeAgentToolAlias(name);
  if (!alias) return [{ name, args }];
  if (alias.claudeName === "MultiEdit") return expandMultiEdit(args);
  return [
    {
      name: alias.aifetchlyName,
      args: translateAliasArgs(alias.claudeName, args),
    },
  ];
}

function translateAliasArgs(
  claudeName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  switch (claudeName) {
    case "Read":
      return compact({
        path: filePath(args),
        offset: asNumber(args.offset),
        limit: asNumber(args.limit),
      });
    case "Write":
      return compact({
        path: filePath(args),
        content: asString(args.content) ?? "",
        mode: "overwrite",
      });
    case "Edit":
      return editArgs(filePath(args), args);
    case "Grep":
      return translateGrep(args);
    case "Glob":
      return compact({
        pattern: asString(args.pattern) ?? "",
        cwd: asString(args.path) ?? asString(args.cwd),
      });
    case "LS":
      return compact({
        pattern: "**/*",
        cwd: asString(args.path) ?? asString(args.cwd),
        head_limit: 200,
      });
    case "Bash":
      return compact({
        command: asString(args.command) ?? "",
        timeout_ms: asNumber(args.timeout) ?? asNumber(args.timeout_ms),
        cwd: asString(args.cwd),
      });
    case "WebFetch":
      return compact({
        url: asString(args.url) ?? "",
      });
    case "WebSearch":
      return compact({
        search_engine: "bing",
        query: asString(args.query) ?? "",
        num_results: 8,
      });
    case "Skill":
      return compact({
        skill: asString(args.skill) ?? "",
        arguments: asString(args.args) ?? asString(args.arguments),
      });
    default:
      return args;
  }
}

function expandMultiEdit(
  args: Record<string, unknown>
): ClaudeAgentToolInvocation[] {
  const fallbackPath = filePath(args);
  if (Array.isArray(args.edits)) {
    const calls: ClaudeAgentToolInvocation[] = [];
    for (const edit of args.edits) {
      if (!edit || typeof edit !== "object" || Array.isArray(edit)) continue;
      const record = edit as Record<string, unknown>;
      const path = filePath(record) || fallbackPath;
      calls.push({ name: "file_edit", args: editArgs(path, record) });
    }
    return calls;
  }
  return [{ name: "file_edit", args: editArgs(fallbackPath, args) }];
}

function editArgs(
  path: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  return compact({
    path,
    old_string: asString(args.old_string) ?? "",
    new_string: asString(args.new_string) ?? "",
    replace_all: asBoolean(args.replace_all),
  });
}

function translateGrep(args: Record<string, unknown>): Record<string, unknown> {
  const context = asNumber(args["-C"]) ?? asNumber(args.context);
  const before = asNumber(args["-B"]) ?? asNumber(args.context_before) ?? context;
  const after = asNumber(args["-A"]) ?? asNumber(args.context_after) ?? context;
  const typeName = asString(args.type);
  const glob =
    asString(args.glob) ??
    (typeName && /^[A-Za-z0-9_+-]+$/.test(typeName)
      ? `*.${typeName}`
      : undefined);
  const outputMode = asString(args.output_mode);
  return compact({
    pattern: asString(args.pattern) ?? "",
    path: asString(args.path),
    glob,
    output_mode:
      outputMode === "content" ||
      outputMode === "files_with_matches" ||
      outputMode === "count"
        ? outputMode
        : "files_with_matches",
    context_before: before,
    context_after: after,
    case_insensitive: asBoolean(args["-i"]) ?? asBoolean(args.case_insensitive),
    head_limit: asNumber(args.head_limit),
  });
}

function filePath(args: Record<string, unknown>): string {
  return asString(args.file_path) ?? asString(args.path) ?? "";
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function compact(
  input: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
