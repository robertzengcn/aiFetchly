/**
 * SkillPackageInspectionService — deterministic discovery, classification,
 * and instruction inspection over an acquired source tree
 * (design §5.2/§9.3, PRD §11.3/§12).
 *
 * Classification order:
 *   1. plugin descriptor (.claude-plugin/plugin.json etc.) → plugin
 *   2. valid manifest.json → executable
 *   3. root SKILL.md → prompt
 *   4. skills/<name>/SKILL.md children → prompt multi-package
 *   5. single wrapper directory containing one of the above
 *   6. conflicting/incomplete → ambiguous (user chooses; never guessed)
 *
 * Instruction precedence: user-named file → INSTALL.md variants → README
 * install section → SKILL.md. Reading an instruction file NEVER authorizes
 * its commands (§12.1).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type {
  DiscoveredSkillPackage,
  PortableSkillKind,
} from "@/entityTypes/skillInstallationTypes";
import { loadSkillMarkdownFile } from "@/service/PromptSkillLoader";

const INSTRUCTION_FILE_MAX_BYTES = 512 * 1024;
const HELPER_DIRS = ["helpers", "scripts", "references", "assets"];

export interface InspectionResult {
  readonly rootRelativePath: string;
  readonly discovered: readonly DiscoveredSkillPackage[];
  readonly instructionFiles: readonly InstructionFile[];
  readonly diagnostics: readonly string[];
}

export interface InstructionFile {
  readonly relativePath: string;
  readonly precedence: number;
  readonly content: string;
  readonly contentHash: string;
}

export interface UserConstraints {
  /** Files the user explicitly named, e.g. ["install.md"]. */
  readonly namedInstructionFiles?: readonly string[];
}

export class SkillPackageInspectionService {
  inspect(
    acquiredRoot: string,
    subdirectory: string | undefined,
    constraints: UserConstraints = {}
  ): InspectionResult {
    const diagnostics: string[] = [];
    const root = subdirectory
      ? path.join(acquiredRoot, subdirectory)
      : acquiredRoot;
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return {
        rootRelativePath: subdirectory ?? ".",
        discovered: [],
        instructionFiles: [],
        diagnostics: ["acquired root is not a directory"],
      };
    }

    const discovered = this.discoverAt(root, ".", diagnostics);
    const instructionFiles = this.readInstructionFiles(
      root,
      constraints,
      diagnostics
    );

    return {
      rootRelativePath: subdirectory ?? ".",
      discovered,
      instructionFiles,
      diagnostics,
    };
  }

  // -------------------------------------------------------------------------
  // Discovery / classification
  // -------------------------------------------------------------------------

  private discoverAt(
    dir: string,
    relativeRoot: string,
    diagnostics: string[]
  ): DiscoveredSkillPackage[] {
    const out: DiscoveredSkillPackage[] = [];

    // Plugin descriptor wins first (native plugin manifests, then
    // claude-compatible ones).
    if (this.hasPluginDescriptor(dir)) {
      return [
        {
          candidateId: `${relativeRoot}:plugin`,
          rootRelativePath: relativeRoot,
          kind: "plugin",
          name: path.basename(dir),
          description: "Plugin package (routes through PluginInstallService)",
          helperSummaryCount: this.countHelpers(dir),
          compatibilityWarnings: [],
        },
      ];
    }

    const hasManifest = fs.existsSync(path.join(dir, "manifest.json"));
    const manifestValid = hasManifest && this.isValidExecutableManifest(dir);

    if (manifestValid) {
      const pkg = this.describeExecutable(dir, relativeRoot);
      // §13.4: both SKILL.md and manifest.json → manifest semantics win for
      // execution; SKILL.md may remain invocation guidance.
      const alsoSkillMd = fs.existsSync(path.join(dir, "SKILL.md"));
      return [
        {
          ...pkg,
          compatibilityWarnings: alsoSkillMd
            ? [
                {
                  code: "ambiguous-manifest-plus-skill-md",
                  message:
                    "Directory contains both manifest.json and SKILL.md; " +
                    "executable manifest semantics take precedence and " +
                    "SKILL.md is retained as documentation.",
                },
              ]
            : [],
        },
      ];
    }

    if (fs.existsSync(path.join(dir, "SKILL.md"))) {
      const loaded = loadSkillMarkdownFile(dir);
      if (loaded.ok) {
        return [
          {
            candidateId: `${relativeRoot}:prompt`,
            rootRelativePath: relativeRoot,
            kind: "prompt",
            name: loaded.file.manifest.name,
            description: loaded.file.manifest.description,
            skillMarkdownPath: path.join(dir, "SKILL.md"),
            helperSummaryCount: this.countHelpers(dir),
            compatibilityWarnings: [],
          },
        ];
      }
      diagnostics.push(
        `SKILL.md at ${relativeRoot} failed validation: ${loaded.message}`
      );
    }

    // Recognized skills/<name>/SKILL.md children (multi-skill packages).
    const skillsDir = path.join(dir, "skills");
    if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const child = path.join(skillsDir, entry.name);
        if (!fs.existsSync(path.join(child, "SKILL.md"))) continue;
        const loaded = loadSkillMarkdownFile(child);
        if (loaded.ok) {
          out.push({
            candidateId: `skills/${entry.name}:prompt`,
            rootRelativePath: `skills/${entry.name}`,
            kind: "prompt",
            name: loaded.file.manifest.name,
            description: loaded.file.manifest.description,
            skillMarkdownPath: path.join(child, "SKILL.md"),
            helperSummaryCount: this.countHelpers(child),
            compatibilityWarnings: [],
          });
        }
      }
      if (out.length > 0) return out;
    }

    // Single wrapper directory containing one of the above.
    const subdirs = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== ".git");
    if (subdirs.length === 1) {
      const wrapper = path.join(dir, subdirs[0].name);
      const inner = this.discoverAt(wrapper, `${relativeRoot}/${subdirs[0].name}`, diagnostics);
      if (inner.length > 0) return inner;
    }

    // Incomplete/conflicting signals stay ambiguous — never guessed (§11.3).
    if (hasManifest && !manifestValid) {
      return [
        {
          candidateId: `${relativeRoot}:ambiguous`,
          rootRelativePath: relativeRoot,
          kind: "ambiguous",
          name: path.basename(dir),
          description: "manifest.json present but not a valid executable manifest",
          helperSummaryCount: this.countHelpers(dir),
          compatibilityWarnings: [
            {
              code: "manifest-invalid",
              message: "manifest.json failed executable validation.",
            },
          ],
        },
      ];
    }
    return out;
  }

  private hasPluginDescriptor(dir: string): boolean {
    const candidates = [
      path.join(dir, ".claude-plugin", "plugin.json"),
      path.join(dir, "plugin.json"),
    ];
    return candidates.some((p) => fs.existsSync(p));
  }

  private isValidExecutableManifest(dir: string): boolean {
    try {
      const raw = fs.readFileSync(path.join(dir, "manifest.json"), "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return (
        typeof parsed.name === "string" &&
        typeof parsed.version === "string" &&
        typeof parsed.runtime === "string" &&
        typeof parsed.entry === "string"
      );
    } catch {
      return false;
    }
  }

  private describeExecutable(
    dir: string,
    relativeRoot: string
  ): DiscoveredSkillPackage {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, "manifest.json"), "utf-8")
      ) as Record<string, unknown>;
      return {
        candidateId: `${relativeRoot}:executable`,
        rootRelativePath: relativeRoot,
        kind: "executable",
        name: String(parsed.name ?? path.basename(dir)),
        description: String(parsed.description ?? "Executable skill"),
        legacyManifestPath: path.join(dir, "manifest.json"),
        helperSummaryCount: this.countHelpers(dir),
        compatibilityWarnings: [],
      };
    } catch {
      return {
        candidateId: `${relativeRoot}:executable`,
        rootRelativePath: relativeRoot,
        kind: "executable",
        name: path.basename(dir),
        description: "Executable skill",
        helperSummaryCount: 0,
        compatibilityWarnings: [],
      };
    }
  }

  private countHelpers(dir: string): number {
    let count = 0;
    for (const name of HELPER_DIRS) {
      const helperDir = path.join(dir, name);
      if (!fs.existsSync(helperDir)) continue;
      try {
        count += fs
          .readdirSync(helperDir, { withFileTypes: true })
          .filter((e) => e.isFile()).length;
      } catch {
        /* unreadable helper dir contributes 0 */
      }
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Instruction inspection (§12.1 precedence)
  // -------------------------------------------------------------------------

  private readInstructionFiles(
    root: string,
    constraints: UserConstraints,
    diagnostics: string[]
  ): InstructionFile[] {
    const wanted: { file: string; precedence: number }[] = [];
    const named = (constraints.namedInstructionFiles ?? []).map((f) =>
      f.replace(/^[./\\]+/, "").toLowerCase()
    );
    for (const name of named) {
      wanted.push({ file: name, precedence: 0 });
    }
    wanted.push({ file: "install.md", precedence: 1 });
    wanted.push({ file: "setup.md", precedence: 2 });
    wanted.push({ file: "readme.md", precedence: 3 });
    wanted.push({ file: "skill.md", precedence: 4 });

    const found: InstructionFile[] = [];
    const seen = new Set<string>();
    for (const { file, precedence } of wanted) {
      if (seen.has(file)) continue;
      const abs = this.findCaseInsensitive(root, file);
      if (!abs) continue;
      seen.add(file);
      try {
        const stat = fs.statSync(abs);
        if (stat.size > INSTRUCTION_FILE_MAX_BYTES) {
          diagnostics.push(
            `${file} exceeds the ${INSTRUCTION_FILE_MAX_BYTES}-byte instruction limit; truncated read skipped`
          );
          continue;
        }
        const content = fs.readFileSync(abs, "utf-8");
        found.push({
          relativePath: path.relative(root, abs).split(path.sep).join("/"),
          precedence,
          content,
          contentHash: crypto
            .createHash("sha256")
            .update(content)
            .digest("hex"),
        });
      } catch (err) {
        diagnostics.push(
          `failed reading ${file}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    found.sort((a, b) => a.precedence - b.precedence);
    return found;
  }

  private findCaseInsensitive(root: string, fileName: string): string | null {
    const direct = path.join(root, fileName);
    if (fs.existsSync(direct)) return direct;
    try {
      for (const entry of fs.readdirSync(root)) {
        if (entry.toLowerCase() === fileName) {
          return path.join(root, entry);
        }
      }
    } catch {
      /* unreadable root */
    }
    return null;
  }
}

/** Classify a package kind for plan output (deterministic, pure). */
export function classifyPackageKind(
  discovered: readonly DiscoveredSkillPackage[]
): PortableSkillKind {
  if (discovered.length === 0) return "ambiguous";
  if (discovered.length === 1) return discovered[0].kind;
  const kinds = new Set(discovered.map((d) => d.kind));
  if (kinds.size === 1) return discovered[0].kind;
  return "ambiguous";
}
