/**
 * FileToolService — core execution logic for AI file tools.
 *
 * Provides a single `execute()` dispatch method that routes to
 * private implementations for each tool.  All tools share a
 * FilePathGuard instance for path safety enforcement.
 *
 * ToolExecutor calls `FileToolService.execute(toolName, args)`.
 */

import * as fs from "fs";
import * as path from "path";
import { isBinaryFile } from "isbinaryfile";
import fg from "fast-glob";
import writeFileAtomic from "write-file-atomic";
import * as diff from "diff";
import { FilePathGuard } from "@/service/FilePathGuard";
import {
  getDefaultWorkspaceRoots,
  DEFAULT_IGNORE_PATTERNS,
  FILE_TOOL_SIZE_LIMITS,
} from "@/config/fileToolConfig";
import type {
  FileReadParams,
  FileWriteParams,
  FileEditParams,
  GlobFilesParams,
  GrepFilesParams,
  FileReadResult,
  FileWriteResult,
  FileEditResult,
  GlobFilesResult,
  GrepFilesResult,
  GrepContentMatch,
  GrepCountEntry,
} from "@/entityTypes/fileToolTypes";

export class FileToolService {
  private readonly guard: FilePathGuard;

  constructor(roots?: readonly string[]) {
    this.guard = new FilePathGuard(roots ?? getDefaultWorkspaceRoots());
  }

  /**
   * Dispatch a file tool by name.  Returns a structured result object.
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (toolName) {
      case "file_read":
        return this.executeFileRead(
          args as unknown as FileReadParams
        ) as unknown as Record<string, unknown>;
      case "file_write":
        return this.executeFileWrite(
          args as unknown as FileWriteParams
        ) as unknown as Record<string, unknown>;
      case "file_edit":
        return this.executeFileEdit(
          args as unknown as FileEditParams
        ) as unknown as Record<string, unknown>;
      case "glob_files":
        return this.executeGlobFiles(
          args as unknown as GlobFilesParams
        ) as unknown as Record<string, unknown>;
      case "grep_files":
        return this.executeGrepFiles(
          args as unknown as GrepFilesParams
        ) as unknown as Record<string, unknown>;
      default:
        return { success: false, error: `Unknown file tool: ${toolName}` };
    }
  }

  // ---------------------------------------------------------------------------
  // file_read
  // ---------------------------------------------------------------------------

  private async executeFileRead(
    params: FileReadParams
  ): Promise<FileReadResult> {
    const validation = this.guard.validate(params.path);
    if (!validation.safe) {
      return {
        success: false,
        error: validation.error,
        truncated: false,
        path: params.path,
      };
    }

    const filePath = validation.resolvedPath;

    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `File not found: ${params.path}`,
        truncated: false,
        path: params.path,
      };
    }

    // Binary detection
    const stat = fs.statSync(filePath);
    const isBinary = await isBinaryFile(filePath).catch(() => false);

    if (isBinary) {
      return {
        success: true,
        path: params.path,
        isBinary: true,
        binaryMetadata: { size: stat.size },
        truncated: false,
      };
    }

    // H5 fix — reject files that exceed the read size limit
    const maxReadBytes = FILE_TOOL_SIZE_LIMITS.maxReadBytes;
    if (stat.size > maxReadBytes * 2) {
      return {
        success: false,
        error: `File is too large to read (${stat.size} bytes). Maximum is ${
          maxReadBytes * 2
        } bytes.`,
        truncated: false,
        path: params.path,
      };
    }

    // Read text content
    const encoding = params.encoding ?? "utf-8";
    const rawContent = fs.readFileSync(filePath, {
      encoding: encoding as BufferEncoding,
    });
    const lines = rawContent.split("\n");
    const totalLines = lines.length;

    // Apply offset/limit (1-based offset)
    const offset = Math.max(1, params.offset ?? 1);
    const limit = params.limit ?? totalLines;
    const startIdx = offset - 1;
    const endIdx = Math.min(startIdx + limit, totalLines);
    const selectedLines = lines.slice(startIdx, endIdx);

    // Size cap enforcement — truncate at line boundaries to avoid
    // splitting multi-byte UTF-8 characters (C1 fix).
    const maxBytes = FILE_TOOL_SIZE_LIMITS.maxReadBytes;
    const numberedLines = selectedLines.map(
      (line, idx) => `${startIdx + idx + 1}: ${line}`
    );
    let truncated = false;

    let content: string;
    if (
      Buffer.byteLength(numberedLines.join("\n"), encoding as BufferEncoding) >
      maxBytes
    ) {
      // Remove lines from the end until we fit within the byte limit
      let fitLines = numberedLines.length;
      while (fitLines > 0) {
        const candidate = numberedLines.slice(0, fitLines).join("\n");
        if (
          Buffer.byteLength(candidate, encoding as BufferEncoding) <= maxBytes
        ) {
          break;
        }
        fitLines--;
      }
      content = numberedLines.slice(0, Math.max(1, fitLines)).join("\n");
      truncated = true;
    } else {
      content = numberedLines.join("\n");
      if (endIdx < totalLines) {
        truncated = true;
      }
    }

    return {
      success: true,
      path: params.path,
      content,
      truncated,
      totalLines,
      linesShown: selectedLines.length,
    };
  }

  // ---------------------------------------------------------------------------
  // file_write
  // ---------------------------------------------------------------------------

  private async executeFileWrite(
    params: FileWriteParams
  ): Promise<FileWriteResult> {
    const validation = this.guard.validate(params.path);
    if (!validation.safe) {
      return {
        success: false,
        error: validation.error,
        path: params.path,
        bytesWritten: 0,
        mode: "created",
      };
    }

    const filePath = validation.resolvedPath;
    const mode = params.mode ?? "create";

    // Check existing file for create mode
    if (mode === "create" && fs.existsSync(filePath)) {
      return {
        success: false,
        error: `File already exists: ${params.path} (use mode 'overwrite' to replace)`,
        path: params.path,
        bytesWritten: 0,
        mode: "created",
      };
    }

    // Create parent directories within allowed root only (C2 fix — use guard.validate)
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      // Validate the parent directory path is within workspace root
      const dirValidation = this.guard.validate(dir + path.sep);
      if (!dirValidation.safe) {
        return {
          success: false,
          error: "Parent directory is outside allowed workspace",
          path: params.path,
          bytesWritten: 0,
          mode: "created",
        };
      }
      fs.mkdirSync(dir, { recursive: true });
    }

    // H1 fix — enforce write size limit
    const content = params.content;
    const contentBytes = Buffer.byteLength(content, "utf-8");
    if (contentBytes > FILE_TOOL_SIZE_LIMITS.maxWriteBytes) {
      return {
        success: false,
        error: `Content exceeds maximum write size (${FILE_TOOL_SIZE_LIMITS.maxWriteBytes} bytes)`,
        path: params.path,
        bytesWritten: 0,
        mode: "created",
      };
    }

    // C3 fix — check overwrite BEFORE the atomic write, not after
    const isOverwrite = mode === "overwrite" && fs.existsSync(filePath);

    // Atomic write
    writeFileAtomic.sync(filePath, content);

    const bytesWritten = contentBytes;

    return {
      success: true,
      path: params.path,
      bytesWritten,
      mode: isOverwrite ? "overwritten" : "created",
    };
  }

  // ---------------------------------------------------------------------------
  // file_edit
  // ---------------------------------------------------------------------------

  private async executeFileEdit(
    params: FileEditParams
  ): Promise<FileEditResult> {
    const validation = this.guard.validate(params.path);
    if (!validation.safe) {
      return {
        success: false,
        error: validation.error,
        path: params.path,
        replacements: 0,
      };
    }

    const filePath = validation.resolvedPath;

    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `File not found: ${params.path}`,
        path: params.path,
        replacements: 0,
      };
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const replaceAll = params.replace_all ?? false;

    // Count matches
    let matchCount = 0;
    let searchIdx = 0;
    let idx: number;
    while ((idx = content.indexOf(params.old_string, searchIdx)) !== -1) {
      matchCount++;
      searchIdx = idx + 1;
    }

    if (matchCount === 0) {
      return {
        success: false,
        error: "No match found for old_string in file",
        path: params.path,
        replacements: 0,
      };
    }

    if (!replaceAll && matchCount > 1) {
      return {
        success: false,
        error: `Multiple matches (${matchCount}) found. Use replace_all=true to replace all occurrences.`,
        path: params.path,
        replacements: 0,
      };
    }

    // Perform replacement
    let newContent: string;
    if (replaceAll) {
      newContent = content.split(params.old_string).join(params.new_string);
    } else {
      newContent = content.replace(params.old_string, params.new_string);
    }

    // Generate optional diff summary
    const patch = diff.createPatch(params.path, content, newContent);
    const diffLines = patch
      .split("\n")
      .filter((line) => line.startsWith("+") || line.startsWith("-"))
      .slice(0, 20);

    // Atomic write
    writeFileAtomic.sync(filePath, newContent);

    return {
      success: true,
      path: params.path,
      replacements: replaceAll ? matchCount : 1,
      diff: diffLines.join("\n"),
    };
  }

  // ---------------------------------------------------------------------------
  // glob_files
  // ---------------------------------------------------------------------------

  private async executeGlobFiles(
    params: GlobFilesParams
  ): Promise<GlobFilesResult> {
    const cwd = params.cwd ? this.guard.validate(params.cwd) : null;

    if (params.cwd && !cwd?.safe) {
      return {
        success: false,
        error: cwd?.error,
        matches: [],
        total: 0,
        truncated: false,
      };
    }

    const searchCwd =
      cwd?.resolvedPath ?? this.guard.getRoots()[0] ?? process.cwd();
    const headLimit =
      params.head_limit ?? FILE_TOOL_SIZE_LIMITS.defaultHeadLimit;
    const ignore = [...DEFAULT_IGNORE_PATTERNS, ...(params.ignore ?? [])];

    const allMatches = fg.sync(params.pattern, {
      cwd: searchCwd,
      ignore,
      dot: false,
      onlyFiles: true,
    }) as string[];

    const total = allMatches.length;
    const truncated = total > headLimit;
    const matches = allMatches.slice(0, headLimit);

    return { success: true, matches, total, truncated };
  }

  // ---------------------------------------------------------------------------
  // grep_files
  // ---------------------------------------------------------------------------

  private async executeGrepFiles(
    params: GrepFilesParams
  ): Promise<GrepFilesResult> {
    const cwd = params.path ? this.guard.validate(params.path) : null;

    if (params.path && !cwd?.safe) {
      return {
        success: false,
        error: cwd?.error,
        outputMode: params.output_mode ?? "content",
        matches: [],
        total: 0,
        truncated: false,
      };
    }

    const searchPath =
      cwd?.resolvedPath ?? this.guard.getRoots()[0] ?? process.cwd();
    const outputMode = params.output_mode ?? "content";
    const headLimit =
      params.head_limit ?? FILE_TOOL_SIZE_LIMITS.defaultHeadLimit;

    // Validate regex pattern
    let regex: RegExp;
    try {
      regex = new RegExp(params.pattern, params.case_insensitive ? "gi" : "g");
    } catch {
      return {
        success: false,
        error: `Invalid regex pattern: ${params.pattern}`,
        outputMode,
        matches: [],
        total: 0,
        truncated: false,
      };
    }

    // Find files to search using glob (M6 fix — include params.ignore)
    const globPattern = params.glob ?? "**/*";
    const grepIgnore = [...DEFAULT_IGNORE_PATTERNS, ...(params.ignore ?? [])];
    const files = fg.sync(globPattern, {
      cwd: searchPath,
      ignore: grepIgnore,
      dot: false,
      onlyFiles: true,
    }) as string[];

    const contextBefore = params.context_before ?? 0;
    const contextAfter = params.context_after ?? 0;

    // Maximum individual file size for grep (H2 fix — skip files > maxReadBytes)
    const maxGrepFileBytes = FILE_TOOL_SIZE_LIMITS.maxReadBytes;

    // Node.js fallback grep implementation
    const results: GrepContentMatch[] = [];
    const fileMatches: string[] = [];
    const countEntries: GrepCountEntry[] = [];
    let totalMatches = 0;

    for (const file of files) {
      if (totalMatches >= headLimit) break;

      const fullPath = path.join(searchPath, file);

      // H2 fix — skip files that are too large to read safely
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.size > maxGrepFileBytes) continue;

      // H3 fix — use isbinaryFile for reliable binary detection
      if (await isBinaryFile(fullPath).catch(() => false)) continue;

      let fileContent: string;
      try {
        fileContent = fs.readFileSync(fullPath, "utf-8");
      } catch {
        continue; // Skip unreadable files
      }

      const lines = fileContent.split("\n");
      let fileCount = 0;

      regex.lastIndex = 0;

      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          fileCount++;
          totalMatches++;

          if (outputMode === "content" && results.length < headLimit) {
            const match: GrepContentMatch = {
              file,
              line: i + 1,
              content: lines[i],
              ...(contextBefore > 0 && {
                contextBefore: lines.slice(Math.max(0, i - contextBefore), i),
              }),
              ...(contextAfter > 0 && {
                contextAfter: lines.slice(i + 1, i + 1 + contextAfter),
              }),
            };

            results.push(match);
          }
        }
      }

      if (fileCount > 0) {
        fileMatches.push(file);
        if (outputMode === "count") {
          countEntries.push({ file, count: fileCount });
        }
      }
    }

    const truncated = totalMatches > headLimit;

    switch (outputMode) {
      case "files_with_matches":
        return {
          success: true,
          outputMode,
          matches: fileMatches.slice(0, headLimit),
          total: fileMatches.length,
          truncated,
        };
      case "count":
        return {
          success: true,
          outputMode,
          matches: countEntries,
          total: totalMatches,
          truncated,
        };
      default:
        return {
          success: true,
          outputMode: "content",
          matches: results,
          total: totalMatches,
          truncated,
        };
    }
  }
}
