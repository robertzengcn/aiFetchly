import * as fs from "fs";
import * as path from "path";
import {
  resolvePluginRelativePath,
  type PluginError,
  type PluginManifest,
  type PluginAgentDeclaration,
} from "@/entityTypes/pluginTypes";
import type {
  ParsedPluginAgentDefinition,
  PluginAgentParseResult,
} from "@/entityTypes/agentTypes";
import { ClaudeAgentFormatAdapter } from "@/service/pluginCompat/ClaudeAgentFormatAdapter";

export interface ParsePluginAgentsInput {
  readonly pluginRoot: string;
  readonly manifest: PluginManifest;
}

/**
 * Pure-ish parser (reads files, writes nothing): resolves the plugin's agent
 * declarations, walks directories for .md, parses each via
 * ClaudeAgentFormatAdapter, and detects duplicate IDs. Returns parsed
 * definitions + warnings; never persists.
 *
 * Resolution rules (design §9, §10):
 *  - native `agents`: string[] of plugin-relative files/dirs.
 *  - Claude `agents === true`: default `agents/`.
 *  - Claude `agents` string: single path.
 *  - Claude `agents` object map: `agents/<key>.md` unless a value has `source`.
 *  - Claude with no `agents` but an existing `agents/` dir: auto-detect.
 */
export class PluginAgentImportService {
  static parsePluginAgents(input: ParsePluginAgentsInput): PluginAgentParseResult {
    const { pluginRoot, manifest } = input;
    const errors: PluginError[] = [];
    const warnings: PluginError[] = [];

    const declared = resolveAgentDeclaration(manifest, pluginRoot);
    if (declared === undefined) {
      return { ok: true, agents: [], warnings };
    }

    // Collect (absPath, relPath, namespaceSegments) for every .md file.
    const files: Array<{
      abs: string;
      rel: string;
      namespaceSegments: string[];
    }> = [];

    for (const { relPath, agentRoot } of declared) {
      let abs: string;
      try {
        abs = resolvePluginRelativePath(pluginRoot, relPath);
      } catch {
        errors.push({
          code: "agent-path-invalid",
          componentType: "agent",
          path: relPath,
          message: `Agent path "${relPath}" escapes the plugin directory.`,
          recoverable: false,
        });
        continue;
      }
      if (!fs.existsSync(abs)) {
        errors.push({
          code: "agent-manifest-invalid",
          componentType: "agent",
          path: relPath,
          message: `Declared agent path not found: ${relPath}`,
          recoverable: false,
        });
        continue;
      }
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        for (const found of walkMarkdownFiles(abs)) {
          files.push({
            abs: found,
            rel: path.relative(pluginRoot, found).replace(/\\/g, "/"),
            namespaceSegments: segmentsBetween(agentRoot, found),
          });
        }
      } else if (stat.isFile() && abs.toLowerCase().endsWith(".md")) {
        files.push({
          abs,
          rel: path.relative(pluginRoot, abs).replace(/\\/g, "/"),
          namespaceSegments: segmentsBetween(agentRoot, abs),
        });
      }
      // Non-markdown files are ignored.
    }

    if (errors.length > 0) return { ok: false, errors };

    // Sort for deterministic import order.
    files.sort((a, b) => a.rel.localeCompare(b.rel));

    const agents: ParsedPluginAgentDefinition[] = [];
    const seenIds = new Set<string>();
    for (const f of files) {
      const content = fs.readFileSync(f.abs, "utf-8");
      const adapted = ClaudeAgentFormatAdapter.adapt(content, {
        pluginName: manifest.name,
        sourcePath: f.rel,
        namespaceSegments: f.namespaceSegments,
      });
      if (!adapted.ok) {
        errors.push(...adapted.errors);
        continue;
      }
      if (seenIds.has(adapted.definition.id)) {
        errors.push({
          code: "agent-name-conflict",
          componentType: "agent",
          componentName: adapted.definition.id,
          path: f.rel,
          message: `Duplicate plugin agent id "${adapted.definition.id}".`,
          recoverable: false,
        });
        continue;
      }
      seenIds.add(adapted.definition.id);
      warnings.push(...adapted.warnings);
      agents.push({
        definition: adapted.definition,
        pluginName: manifest.name,
        componentPath: f.rel,
        manifest: adapted.manifest,
        warnings: adapted.warnings,
      });
    }

    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, agents, warnings };
  }
}

/**
 * Resolve the manifest `agents` field to a list of {relPath, agentRoot}.
 * Returns undefined when nothing is declared and no default agents/ dir exists.
 */
function resolveAgentDeclaration(
  manifest: PluginManifest,
  pluginRoot: string
): Array<{ relPath: string; agentRoot: string }> | undefined {
  const raw = manifest.agents as PluginAgentDeclaration | undefined;
  const hasDefaultDir = fs.existsSync(path.join(pluginRoot, "agents"));

  // Native (aifetchly) format: array of strings.
  if (Array.isArray(raw)) {
    return raw
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .map((p) => ({ relPath: p, agentRoot: dirRootFor(p) }));
  }

  if (raw === true) {
    return [{ relPath: "agents", agentRoot: "agents" }];
  }

  if (typeof raw === "string") {
    return [{ relPath: raw, agentRoot: dirRootFor(raw) }];
  }

  if (raw && typeof raw === "object") {
    const out: Array<{ relPath: string; agentRoot: string }> = [];
    for (const [key, val] of Object.entries(raw)) {
      const v = val as { source?: string } | undefined;
      const p =
        v && typeof v.source === "string" ? v.source : `agents/${key}.md`;
      out.push({ relPath: p, agentRoot: dirRootFor(p) });
    }
    return out;
  }

  // undefined: auto-detect agents/ for Claude plugins only.
  if (manifest.format === "claude" && hasDefaultDir) {
    return [{ relPath: "agents", agentRoot: "agents" }];
  }
  return undefined;
}

/** The agent root is the declared path if it's a directory, else its parent dir. */
function dirRootFor(relPath: string): string {
  const clean = relPath.replace(/\\/g, "/").replace(/\/$/, "");
  return clean.toLowerCase().endsWith(".md")
    ? path.posix.dirname(clean)
    : clean;
}

/** Directory segments between agentRoot and the file's parent dir. */
function segmentsBetween(agentRoot: string, absFile: string): string[] {
  const cleanRoot = agentRoot.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const fileDir = path.dirname(absFile).replace(/\\/g, "/");
  const idx = fileDir.indexOf(`/${cleanRoot}`);
  if (idx === -1) return [];
  const after = fileDir.slice(idx + cleanRoot.length + 1);
  return after
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
}

/** Depth-first, sorted walk for .md files (no glob dep). */
function walkMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}
