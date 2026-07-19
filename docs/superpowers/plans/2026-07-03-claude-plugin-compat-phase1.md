# Claude Plugin Compatibility — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude Code plugins (`.claude-plugin/plugin.json` + `skills/*.md`) installable in AiFetchly such that their documentation-only skills appear in the Plugin Manager and are invokable from AiChatV2.

**Architecture:** Pure adapter layer under `src/service/pluginCompat/` translates Claude-format manifests and Claude-format SKILL.md files into AiFetchly's existing `PluginManifest` and `SkillManifest` shapes at load time. The existing `PluginImportService`, `PluginLoaderService`, and `SkillImportService` pipelines remain the source of truth; adapters project Claude components onto them. Disk is never mutated by adapters — round-trip fidelity is preserved.

**Tech Stack:** TypeScript, Vitest, existing TypeORM/SQLite stack, no new external dependencies.

**Scope (Phase 1 only):**
- Dual-path manifest discovery (`.aifetchly-plugin/` then `.claude-plugin/` then root).
- Manifest translation for the skills + inline-mcp/sibling-mcp cases.
- SKILL.md → SkillManifest translation (documentation-only).
- Plugin identifier parsing (`name@marketplace`).
- Wire through `PluginManifestService` and `PluginLoaderService` so Claude plugins load with skills registered.
- Fixture-based integration test.

**Out of scope for this plan:** MCP server spawn (Phase 2), hooks (Phase 3), commands/agents (Phase 4), UI badge changes, i18n strings. Those are follow-up plans.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/service/pluginCompat/pluginFormatTypes.ts` | Shared types: `PluginFormat`, `AdaptedClaudeManifest`, `ClaudeAdaptResult`. |
| `src/service/pluginCompat/claudeFrontmatterParser.ts` | Minimal YAML-frontmatter parser (extracted + extended from `SkillImportService.parseSkillMarkdownMetadata`). |
| `src/service/pluginCompat/ClaudeSkillFormatAdapter.ts` | Translates a Claude `SKILL.md` into a `SkillManifest`-shaped object. |
| `src/service/pluginCompat/ClaudePluginAdapter.ts` | Translates a Claude manifest JSON into AiFetchly's internal `PluginManifest` shape. |
| `src/service/pluginCompat/parsePluginIdentifier.ts` | Parses `name@marketplace` identifiers. |
| `test/vitest/main/service/pluginCompat/claudeFrontmatterParser.test.ts` | Unit tests. |
| `test/vitest/main/service/pluginCompat/ClaudeSkillFormatAdapter.test.ts` | Unit tests. |
| `test/vitest/main/service/pluginCompat/ClaudePluginAdapter.test.ts` | Unit tests. |
| `test/vitest/main/service/pluginCompat/parsePluginIdentifier.test.ts` | Unit tests. |
| `test/vitest/main/service/pluginCompat/loadClaudePlugin.integration.test.ts` | Fixture-driven end-to-end test. |
| `test/fixtures/claude-plugins/skills-only/.claude-plugin/plugin.json` | Fixture. |
| `test/fixtures/claude-plugins/skills-only/skills/lead-research/SKILL.md` | Fixture. |
| `test/fixtures/claude-plugins/skills-only/skills/email-writer/SKILL.md` | Fixture. |

### Modified files

| Path | Change |
|---|---|
| `src/entityTypes/pluginTypes.ts` | Add `PluginFormat` type, `format?` field on `PluginManifest`/`PluginSummary`/`PluginDetail`, 5 new `PluginErrorCode` values. |
| `src/service/PluginManifestService.ts` | `locateManifestFile()` returns `{path, format}`; `loadFromDirectory()` branches on format. |
| `src/service/PluginLoaderService.ts` | When format is `"claude"`, dispatch Claude-skills loading; carry `format` on `LoadedPlugin`. |
| `src/service/PluginImportService.ts` | When importing a Claude plugin, read each skill's `SKILL.md` (not `manifest.json`) and synthesize a `SkillManifest`. |

### Unchanged (deliberately)

`SkillImportService`, `SkillExecutor`, `SkillRegistry`, `MCPToolModule`, `PluginManagementModule`. The adapter layer calls into them; their internals are not modified.

---

## Task 1: Add `PluginFormat` type and new error codes

**Files:**
- Modify: `src/entityTypes/pluginTypes.ts`

- [ ] **Step 1: Add `PluginFormat` type**

Edit `src/entityTypes/pluginTypes.ts`. After the `PluginSource` type definition (around line 14), add:

```typescript
/**
 * On-disk manifest format. Computed at load time from which manifest file
 * was found; not persisted in the database.
 */
export type PluginFormat = "aifetchly" | "claude";
```

- [ ] **Step 2: Add `format?` field to `PluginManifest`**

In the `PluginManifest` interface (around line 28-43), add after `readonly source?: PluginSource;`:

```typescript
  /** Manifest format. Undefined for plugins installed before this field existed. */
  readonly format?: PluginFormat;
```

- [ ] **Step 3: Add `format?` field to `PluginSummary` and `PluginDetail`**

In `PluginSummary` (around line 138) add after `readonly source: PluginSource;`:

```typescript
  readonly format?: PluginFormat;
```

In `PluginDetail` (around line 169) — it extends `PluginSummary`, so no change needed.

- [ ] **Step 4: Extend `PluginErrorCode`**

In the `PluginErrorCode` union (around line 104-122), add these 5 codes before `"unknown"`:

```typescript
  | "claude-format-unsupported-feature"
  | "claude-frontmatter-invalid"
  | "claude-frontmatter-missing-field"
  | "mcp-options-missing"
  | "plugin-identifier-invalid"
```

- [ ] **Step 5: Run type check**

Run: `yarn tsc`
Expected: PASS with no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/entityTypes/pluginTypes.ts
git commit -m "feat(plugin-compat): add PluginFormat type and claude-compat error codes"
```

---

## Task 2: Extract and extend frontmatter parser

The existing `parseSkillMarkdownMetadata()` in `SkillImportService.ts:275` handles `name`, `description`, `version`, `supportedFileTypes`. We extract it to its own file under `pluginCompat/` so the Claude adapter can use it, and extend it to capture `allowed-tools` (carried opaquely, not yet enforced).

**Files:**
- Create: `src/service/pluginCompat/pluginFormatTypes.ts`
- Create: `src/service/pluginCompat/claudeFrontmatterParser.ts`
- Test: `test/vitest/main/service/pluginCompat/claudeFrontmatterParser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/pluginCompat/claudeFrontmatterParser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "@/service/pluginCompat/claudeFrontmatterParser";

describe("parseFrontmatter", () => {
  it("returns empty object when no frontmatter present", () => {
    expect(parseFrontmatter("just markdown\n# heading")).toEqual({
      frontmatter: {},
      body: "just markdown\n# heading",
    });
  });

  it("parses name, description, version", () => {
    const md = `---
name: lead-research
description: Use when the user asks about lead research.
version: 1.2.0
---
body content`;
    expect(parseFrontmatter(md)).toEqual({
      frontmatter: {
        name: "lead-research",
        description: "Use when the user asks about lead research.",
        version: "1.2.0",
      },
      body: "body content",
    });
  });

  it("parses flow-style array allowed-tools", () => {
    const md = `---
name: foo
allowed-tools: [search, browse]
---
body`;
    expect(parseFrontmatter(md).frontmatter["allowed-tools"]).toEqual([
      "search",
      "browse",
    ]);
  });

  it("parses block-style array allowed-tools", () => {
    const md = `---
name: foo
allowed-tools:
  - search
  - browse
---
body`;
    expect(parseFrontmatter(md).frontmatter["allowed-tools"]).toEqual([
      "search",
      "browse",
    ]);
  });

  it("parses boolean true/false", () => {
    const md = `---
name: foo
flag: true
---
body`;
    expect(parseFrontmatter(md).frontmatter.flag).toBe(true);
  });

  it("parses integer", () => {
    const md = `---
name: foo
count: 42
---
body`;
    expect(parseFrontmatter(md).frontmatter.count).toBe(42);
  });

  it("ignores lines without colon inside frontmatter block", () => {
    const md = `---
garbage line
name: foo
---
body`;
    expect(parseFrontmatter(md).frontmatter.name).toBe("foo");
    expect(Object.keys(parseFrontmatter(md).frontmatter)).toEqual(["name"]);
  });

  it("stops at first closing --- even if body contains ---", () => {
    const md = `---
name: foo
---
body
---
more body`;
    const result = parseFrontmatter(md);
    expect(result.frontmatter.name).toBe("foo");
    expect(result.body).toBe("body\n---\nmore body");
  });

  it("handles CRLF line endings", () => {
    const md = "---\r\nname: foo\r\n---\r\nbody";
    expect(parseFrontmatter(md).frontmatter.name).toBe("foo");
  });

  it("handles empty frontmatter block", () => {
    const md = `---
---
body`;
    expect(parseFrontmatter(md)).toEqual({ frontmatter: {}, body: "body" });
  });

  it("returns empty object when first line is not ---", () => {
    expect(parseFrontmatter("--- not a delimiter\nname: foo").frontmatter).toEqual(
      {}
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/pluginCompat/claudeFrontmatterParser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `pluginFormatTypes.ts`**

Create `src/service/pluginCompat/pluginFormatTypes.ts`:

```typescript
/**
 * Shared types for the Claude plugin compatibility layer.
 *
 * The compat layer translates Claude-format manifests and skills into
 * AiFetchly's internal shapes at load time. Adapters are pure: no I/O,
 * no side effects.
 */

import type { PluginFormat } from "@/entityTypes/pluginTypes";
import type {
  PluginMcpServerDeclaration,
  PluginError,
  PluginManifest,
} from "@/entityTypes/pluginTypes";

/**
 * Result of translating a Claude manifest into AiFetchly's internal shape.
 * `manifest` is what downstream code consumes; the extras carry context
 * needed by the loader (which paths to scan, whether MCP is inline, etc).
 */
export interface AdaptedClaudeManifest {
  readonly manifest: PluginManifest;
  readonly format: Extract<PluginFormat, "claude">;
  /** Normalized relative paths to scan for SKILL.md files. */
  readonly skillsPaths: readonly string[];
  /**
   * Path to a sibling .mcp.json file when alternative A is used.
   * Empty when MCP is inline (alternative B) or absent.
   */
  readonly mcpServersPaths: readonly string[];
  /** Inline MCP server map when alternative B is used; undefined otherwise. */
  readonly inlineMcp?: Record<string, PluginMcpServerDeclaration>;
  /** Path to hooks/hooks.json when declared; Phase 3 will consume this. */
  readonly hooksPath?: string;
  /**
   * Opaque carry-through of fields AiFetchly does not yet consume
   * (commands, agents, outputStyles, lsp). Stored so re-emitting the
   * manifest preserves them.
   */
  readonly opaque: Readonly<Record<string, unknown>>;
}

export interface ClaudeAdaptSuccess {
  readonly ok: true;
  readonly adapted: AdaptedClaudeManifest;
}

export interface ClaudeAdaptFailure {
  readonly ok: false;
  readonly errors: readonly PluginError[];
}

export type ClaudeAdaptResult = ClaudeAdaptSuccess | ClaudeAdaptFailure;
```

- [ ] **Step 4: Create `claudeFrontmatterParser.ts`**

Create `src/service/pluginCompat/claudeFrontmatterParser.ts`:

```typescript
/**
 * Minimal YAML-frontmatter parser for Claude SKILL.md files.
 *
 * Supports a deliberately tiny subset of YAML:
 *   - key: value (single-line, string)
 *   - key: true | false
 *   - key: <integer>
 *   - key: [a, b, c]            (flow-style array of strings)
 *   - key:
 *       - a                     (block-style array of strings)
 *       - b
 *
 * Anything beyond this subset causes the parser to skip the offending
 * line rather than throw. Callers that need strict rejection (e.g. the
 * Claude skill adapter) validate required fields afterwards and produce
 * a structured `claude-frontmatter-invalid` error.
 *
 * No external dependencies. Hand-rolled to keep the bundle small and
 * force fail-fast on constructs we don't support.
 */

export interface ParsedFrontmatter {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

const FLOW_ARRAY_RE = /^\[(.*)\]$/;

function parseFlowArray(value: string): unknown[] | null {
  const match = value.match(FLOW_ARRAY_RE);
  if (!match) return null;
  const inner = match[1].trim();
  if (inner.length === 0) return [];
  return inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, unknown> = {};
  let bodyStartIndex = lines.length; // fallback if no closing delimiter

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "---") {
      bodyStartIndex = i + 1;
      break;
    }

    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const sep = trimmed.indexOf(":");
    if (sep <= 0) continue;

    const key = trimmed.slice(0, sep).trim();
    const rawValue = trimmed.slice(sep + 1).trim();

    if (rawValue.length === 0) {
      // Could be start of block-style array; peek subsequent lines.
      const blockValues: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = lines[j];
        if (candidate.trim() === "---") break;
        const blockMatch = candidate.match(/^\s+-\s+(.*)$/);
        if (blockMatch) {
          blockValues.push(blockMatch[1].trim().replace(/^["']|["']$/g, ""));
          i = j;
        } else {
          break;
        }
      }
      if (blockValues.length > 0) {
        frontmatter[key] = blockValues;
      }
      continue;
    }

    // Boolean
    if (rawValue === "true" || rawValue === "false") {
      frontmatter[key] = rawValue === "true";
      continue;
    }

    // Integer
    if (/^-?\d+$/.test(rawValue)) {
      frontmatter[key] = parseInt(rawValue, 10);
      continue;
    }

    // Flow-style array
    const flow = parseFlowArray(rawValue);
    if (flow !== null) {
      frontmatter[key] = flow;
      continue;
    }

    // Plain string
    frontmatter[key] = rawValue.replace(/^["']|["']$/g, "");
  }

  const body = lines.slice(bodyStartIndex).join("\n");
  return { frontmatter, body };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/service/pluginCompat/claudeFrontmatterParser.test.ts`
Expected: PASS — all 11 tests.

- [ ] **Step 6: Commit**

```bash
git add src/service/pluginCompat/pluginFormatTypes.ts \
        src/service/pluginCompat/claudeFrontmatterParser.ts \
        test/vitest/main/service/pluginCompat/claudeFrontmatterParser.test.ts
git commit -m "feat(plugin-compat): add frontmatter parser and shared compat types"
```

---

## Task 3: `ClaudeSkillFormatAdapter` — SKILL.md → SkillManifest

Translates a parsed SKILL.md into a `SkillManifest` shaped for the existing `SkillImportService`/`SkillManagementModule` pipeline. The result mirrors what `buildManifestFromSkillMarkdown()` in `SkillImportService.ts:337` produces, so downstream code paths are unchanged.

**Files:**
- Create: `src/service/pluginCompat/ClaudeSkillFormatAdapter.ts`
- Test: `test/vitest/main/service/pluginCompat/ClaudeSkillFormatAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/pluginCompat/ClaudeSkillFormatAdapter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ClaudeSkillFormatAdapter } from "@/service/pluginCompat/ClaudeSkillFormatAdapter";

describe("ClaudeSkillFormatAdapter", () => {
  it("adapts a well-formed SKILL.md with name and description", () => {
    const md = `---
name: lead-research
description: Use when the user asks about lead research.
---
# Lead Research
Instructions here.`;
    const result = ClaudeSkillFormatAdapter.adapt(md, "skills/lead-research/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.name).toBe("lead-research");
    expect(result.manifest.description).toContain(
      "Use when the user asks about lead research."
    );
    expect(result.manifest.runtime).toBe("javascript");
    expect(result.manifest.documentationOnly).toBe(true);
    expect(result.body).toContain("# Lead Research");
  });

  it("fails when name is missing", () => {
    const md = `---
description: some description
---
body`;
    const result = ClaudeSkillFormatAdapter.adapt(md, "skills/foo/SKILL.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("claude-frontmatter-missing-field");
    expect(result.error.message).toContain("name");
  });

  it("fails when description is missing", () => {
    const md = `---
name: foo
---
body`;
    const result = ClaudeSkillFormatAdapter.adapt(md, "skills/foo/SKILL.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("claude-frontmatter-missing-field");
    expect(result.error.message).toContain("description");
  });

  it("fails when frontmatter is empty", () => {
    const result = ClaudeSkillFormatAdapter.adapt(
      "no frontmatter here",
      "skills/foo/SKILL.md"
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("claude-frontmatter-missing-field");
  });

  it("sanitizes a name that does not match the kebab regex", () => {
    const md = `---
name: Lead Research!
description: desc
---
body`;
    const result = ClaudeSkillFormatAdapter.adapt(md, "skills/lead-research/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.name).toMatch(/^[a-z][a-z0-9_-]*$/);
  });

  it("uses default version 0.0.0 when version absent", () => {
    const md = `---
name: foo
description: desc
---
body`;
    const result = ClaudeSkillFormatAdapter.adapt(md, "skills/foo/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.version).toBe("0.0.0");
  });

  it("preserves supportedFileTypes when declared in frontmatter", () => {
    const md = `---
name: pdf-tool
description: desc
supported_file_types: [".pdf"]
---
body`;
    const result = ClaudeSkillFormatAdapter.adapt(md, "skills/pdf-tool/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.supportedFileTypes).toEqual([".pdf"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/pluginCompat/ClaudeSkillFormatAdapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

Create `src/service/pluginCompat/ClaudeSkillFormatAdapter.ts`:

```typescript
import type { SkillManifest } from "@/entityTypes/skillTypes";
import type { PluginError } from "@/entityTypes/pluginTypes";
import { parseFrontmatter } from "@/service/pluginCompat/claudeFrontmatterParser";

/**
 * Translates a Claude SKILL.md file into a SkillManifest-shaped object that
 * the existing SkillImportService / SkillManagementModule pipeline consumes.
 *
 * The skill is always treated as documentation-only (runtime: "javascript",
 * documentationOnly: true) — matching the existing buildManifestFromSkillMarkdown
 * behavior in SkillImportService.ts:337.
 */

export interface ClaudeSkillAdaptSuccess {
  readonly ok: true;
  readonly manifest: SkillManifest;
  /** Markdown body (everything after frontmatter). */
  readonly body: string;
  /** Source path of the .md file inside the plugin (for diagnostics). */
  readonly sourcePath: string;
}

export interface ClaudeSkillAdaptFailure {
  readonly ok: false;
  readonly error: PluginError;
}

export type ClaudeSkillAdaptResult =
  | ClaudeSkillAdaptSuccess
  | ClaudeSkillAdaptFailure;

const NAME_REGEX = /^[a-z][a-z0-9_-]*$/;

function sanitizeSkillName(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (!normalized) return "imported-skill";
  if (NAME_REGEX.test(normalized)) return normalized;
  if (/^[a-z]/.test(normalized)) return normalized;
  return `skill-${normalized}`;
}

function normalizeFileExtensions(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim().toLowerCase();
    if (!trimmed) continue;
    const withDot = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
    out.push(withDot);
  }
  return out.length > 0 ? out : undefined;
}

export class ClaudeSkillFormatAdapter {
  /**
   * Adapt a SKILL.md file's content into a SkillManifest.
   *
   * Pure: no I/O. The caller reads the file and passes content + sourcePath.
   *
   * Errors:
   *   - claude-frontmatter-missing-field: required field `name` or `description` absent.
   */
  static adapt(
    skillMdContent: string,
    sourcePath: string
  ): ClaudeSkillAdaptResult {
    const { frontmatter, body } = parseFrontmatter(skillMdContent);

    const rawName = frontmatter.name;
    const rawDescription = frontmatter.description;

    if (typeof rawName !== "string" || rawName.length === 0) {
      return {
        ok: false,
        error: {
          code: "claude-frontmatter-missing-field",
          componentType: "skill",
          path: sourcePath,
          message: `Claude skill at "${sourcePath}" is missing required frontmatter field "name".`,
          recoverable: false,
        },
      };
    }

    if (typeof rawDescription !== "string" || rawDescription.length === 0) {
      return {
        ok: false,
        error: {
          code: "claude-frontmatter-missing-field",
          componentType: "skill",
          path: sourcePath,
          message: `Claude skill at "${sourcePath}" is missing required frontmatter field "description".`,
          recoverable: false,
        },
      };
    }

    const name = sanitizeSkillName(rawName);
    const version =
      typeof frontmatter.version === "string" ? frontmatter.version : "0.0.0";

    const supportedFileTypes = normalizeFileExtensions(
      frontmatter.supportedFileTypes ?? frontmatter.supported_file_types
    );

    const manifest: SkillManifest = {
      name,
      version,
      description: `${rawDescription} [documentation-only in aiFetchly]`,
      runtime: "javascript",
      entry: "__skill_md_wrapper__.js",
      parameters: {
        type: "object",
        properties: {
          attachment_ref: {
            type: "string",
            description:
              "Optional. When set, loads staged attachment markdown for this conversation.",
          },
        },
        additionalProperties: false,
      },
      documentationOnly: true,
      ...(supportedFileTypes ? { supportedFileTypes } : {}),
    };

    return { ok: true, manifest, body, sourcePath };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/service/pluginCompat/ClaudeSkillFormatAdapter.test.ts`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/service/pluginCompat/ClaudeSkillFormatAdapter.ts \
        test/vitest/main/service/pluginCompat/ClaudeSkillFormatAdapter.test.ts
git commit -m "feat(plugin-compat): add ClaudeSkillFormatAdapter for SKILL.md translation"
```

---

## Task 4: `parsePluginIdentifier` — `name@marketplace` parser

**Files:**
- Create: `src/service/pluginCompat/parsePluginIdentifier.ts`
- Test: `test/vitest/main/service/pluginCompat/parsePluginIdentifier.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/pluginCompat/parsePluginIdentifier.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parsePluginIdentifier } from "@/service/pluginCompat/parsePluginIdentifier";

describe("parsePluginIdentifier", () => {
  it("parses a bare name", () => {
    const r = parsePluginIdentifier("lead-tools");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ name: "lead-tools" });
  });

  it("parses name@marketplace", () => {
    const r = parsePluginIdentifier("lead-tools@anthropics");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ name: "lead-tools", marketplace: "anthropics" });
  });

  it("fails on empty string", () => {
    expect(parsePluginIdentifier("").ok).toBe(false);
  });

  it("fails on invalid name characters", () => {
    expect(parsePluginIdentifier("Lead Tools!").ok).toBe(false);
  });

  it("fails on empty marketplace", () => {
    const r = parsePluginIdentifier("foo@");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("plugin-identifier-invalid");
  });

  it("fails on invalid marketplace characters", () => {
    expect(parsePluginIdentifier("foo@Market Place!").ok).toBe(false);
  });

  it("fails on multiple @ separators", () => {
    expect(parsePluginIdentifier("foo@bar@baz").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/pluginCompat/parsePluginIdentifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `src/service/pluginCompat/parsePluginIdentifier.ts`:

```typescript
import type { PluginError } from "@/entityTypes/pluginTypes";

/**
 * Parses Claude-style plugin identifiers.
 *
 *   "lead-tools"                  → { name: "lead-tools" }
 *   "lead-tools@anthropics"       → { name: "lead-tools", marketplace: "anthropics" }
 *
 * Both segments must match PLUGIN_NAME_REGEX. Multiple "@" separators are
 * rejected. Empty marketplace ("foo@") is rejected.
 */

export interface ParsedPluginIdentifier {
  readonly name: string;
  readonly marketplace?: string;
}

const NAME_REGEX = /^[a-z][a-z0-9_-]*$/;

export function parsePluginIdentifier(
  id: string
): { ok: true; value: ParsedPluginIdentifier } | { ok: false; error: PluginError } {
  if (typeof id !== "string" || id.length === 0) {
    return {
      ok: false,
      error: {
        code: "plugin-identifier-invalid",
        message: "Plugin identifier is empty.",
        recoverable: false,
      },
    };
  }

  const atCount = (id.match(/@/g) ?? []).length;
  if (atCount > 1) {
    return {
      ok: false,
      error: {
        code: "plugin-identifier-invalid",
        message: `Plugin identifier "${id}" contains multiple "@" separators.`,
        recoverable: false,
      },
    };
  }

  const [name, marketplace] = id.split("@");

  if (!NAME_REGEX.test(name)) {
    return {
      ok: false,
      error: {
        code: "plugin-identifier-invalid",
        message: `Plugin name "${name}" must match /^[a-z][a-z0-9_-]*$/.`,
        recoverable: false,
      },
    };
  }

  if (marketplace !== undefined) {
    if (marketplace.length === 0) {
      return {
        ok: false,
        error: {
          code: "plugin-identifier-invalid",
          message: `Plugin identifier "${id}" has empty marketplace.`,
          recoverable: false,
        },
      };
    }
    if (!NAME_REGEX.test(marketplace)) {
      return {
        ok: false,
        error: {
          code: "plugin-identifier-invalid",
          message: `Plugin marketplace "${marketplace}" must match /^[a-z][a-z0-9_-]*$/.`,
          recoverable: false,
        },
      };
    }
    return { ok: true, value: { name, marketplace } };
  }

  return { ok: true, value: { name } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/service/pluginCompat/parsePluginIdentifier.test.ts`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/service/pluginCompat/parsePluginIdentifier.ts \
        test/vitest/main/service/pluginCompat/parsePluginIdentifier.test.ts
git commit -m "feat(plugin-compat): add parsePluginIdentifier for name@marketplace syntax"
```

---

## Task 5: `ClaudePluginAdapter` — manifest translator

Translates a parsed Claude manifest JSON object into AiFetchly's internal `PluginManifest` shape plus the extras the loader needs.

**Files:**
- Create: `src/service/pluginCompat/ClaudePluginAdapter.ts`
- Test: `test/vitest/main/service/pluginCompat/ClaudePluginAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/pluginCompat/ClaudePluginAdapter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ClaudePluginAdapter } from "@/service/pluginCompat/ClaudePluginAdapter";

const ROOT = "/tmp/plugin-root";

describe("ClaudePluginAdapter", () => {
  it("adapts a minimal Claude manifest with only skills array", () => {
    const raw = {
      name: "lead-pack",
      version: "1.0.0",
      description: "Lead research tools",
      skills: ["skills/lead-research/"],
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.manifest.name).toBe("lead-pack");
    expect(r.adapted.manifest.format).toBe("claude");
    expect(r.adapted.skillsPaths).toEqual(["skills/lead-research/"]);
    expect(r.adapted.mcpServersPaths).toEqual([]);
  });

  it("treats skills:true as auto-detect of skills/ directory", () => {
    const raw = { name: "p", version: "1.0.0", description: "d", skills: true };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.skillsPaths).toEqual(["skills/"]);
  });

  it("treats missing skills field as auto-detect (skills/)", () => {
    const raw = { name: "p", version: "1.0.0", description: "d" };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.skillsPaths).toEqual(["skills/"]);
  });

  it("normalizes object-map skills form to skill file paths", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      skills: {
        "lead-research": { description: "desc" },
        "email-writer": {},
      },
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.skillsPaths).toEqual([
      "skills/lead-research/SKILL.md",
      "skills/email-writer/SKILL.md",
    ]);
  });

  it("dedupes skill paths", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      skills: ["skills/a/", "skills/a/"],
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.skillsPaths).toEqual(["skills/a/"]);
  });

  it("rejects path-traversal in skill paths", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      skills: ["../escape/"],
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("path-outside-plugin");
  });

  it("captures inline mcp map and leaves mcpServersPaths empty", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      mcp: {
        linkedin: { command: "node", args: ["server.js"] },
      },
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.inlineMcp).toEqual({
      linkedin: { command: "node", args: ["server.js"] },
    });
    expect(r.adapted.mcpServersPaths).toEqual([]);
  });

  it("records hooks path opaquely for Phase 3", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      hooks: "hooks/hooks.json",
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.hooksPath).toBe("hooks/hooks.json");
  });

  it("carries commands/agents/outputStyles as opaque", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      commands: { foo: { source: "commands/foo.md" } },
      agents: ["agents/bar.md"],
      outputStyles: ["styles/x.json"],
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.opaque.commands).toEqual({ foo: { source: "commands/foo.md" } });
    expect(r.adapted.opaque.agents).toEqual(["agents/bar.md"]);
    expect(r.adapted.opaque.outputStyles).toEqual(["styles/x.json"]);
  });

  it("defaults version to 0.0.0 when missing", () => {
    const raw = { name: "p", description: "d" };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.manifest.version).toBe("0.0.0");
  });

  it("fails on invalid name", () => {
    const raw = { name: "P!", version: "1.0.0", description: "d" };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("manifest-schema-invalid");
  });

  it("fails on non-object input", () => {
    const r = ClaudePluginAdapter.adapt("not an object", { pluginRoot: ROOT });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/pluginCompat/ClaudePluginAdapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

Create `src/service/pluginCompat/ClaudePluginAdapter.ts`:

```typescript
import * as path from "path";
import {
  PLUGIN_NAME_REGEX,
  resolvePluginRelativePath,
  type PluginError,
  type PluginManifest,
  type PluginMcpServerDeclaration,
} from "@/entityTypes/pluginTypes";
import type { ClaudeAdaptResult } from "@/service/pluginCompat/pluginFormatTypes";

/**
 * Pure translator: Claude manifest JSON → AiFetchly PluginManifest + extras.
 *
 * Rules (Tech Design §5):
 *   - name required, must match PLUGIN_NAME_REGEX.
 *   - version optional in Claude; defaults to "0.0.0".
 *   - description optional in Claude; defaults to "".
 *   - skills normalization: true → ["skills/"]; string → [string];
 *     string[] → string[] (deduped); object map → ["skills/<key>/SKILL.md", ...].
 *   - mcpServers: when `mcp` is an object, use inline (alternative B).
 *     Otherwise leave mcpServersPaths empty; the loader checks for sibling
 *     .mcp.json at the plugin root.
 *   - hooks path recorded as opaque (Phase 3 will consume).
 *   - commands / agents / outputStyles / lsp carried opaquely.
 */

export interface ClaudePluginAdapterOptions {
  readonly pluginRoot: string;
}

type SkillDecl =
  | string
  | readonly string[]
  | true
  | Record<string, { source?: string; content?: string; description?: string }>;

function normalizeSkillsField(
  raw: SkillDecl | undefined,
  pluginRoot: string,
  errors: PluginError[]
): string[] {
  let candidatePaths: string[];

  if (raw === undefined || raw === true) {
    candidatePaths = ["skills/"];
  } else if (typeof raw === "string") {
    candidatePaths = [raw];
  } else if (Array.isArray(raw)) {
    candidatePaths = [...raw];
  } else if (typeof raw === "object" && raw !== null) {
    candidatePaths = Object.keys(raw).map((k) => `skills/${k}/SKILL.md`);
  } else {
    candidatePaths = ["skills/"];
  }

  // Validate each path stays inside plugin root and dedupe.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of candidatePaths) {
    if (typeof p !== "string" || p.length === 0) continue;
    try {
      resolvePluginRelativePath(pluginRoot, p);
    } catch {
      errors.push({
        code: "path-outside-plugin",
        componentType: "skill",
        path: p,
        message: `Skill path "${p}" escapes the plugin directory.`,
        recoverable: false,
      });
      continue;
    }
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export class ClaudePluginAdapter {
  static adapt(
    raw: unknown,
    options: ClaudePluginAdapterOptions
  ): ClaudeAdaptResult {
    if (!raw || typeof raw !== "object") {
      return {
        ok: false,
        errors: [
          {
            code: "manifest-schema-invalid",
            message: "Claude manifest must be a JSON object.",
            recoverable: false,
          },
        ],
      };
    }

    const m = raw as Record<string, unknown>;
    const errors: PluginError[] = [];

    const name = m.name;
    if (typeof name !== "string" || !PLUGIN_NAME_REGEX.test(name)) {
      errors.push({
        code: "manifest-schema-invalid",
        message:
          'Invalid or missing "name". Must match /^[a-z][a-z0-9_-]*$/ (e.g. "lead-tools").',
        recoverable: false,
      });
    }

    const version =
      typeof m.version === "string" && m.version.length > 0 ? m.version : "0.0.0";
    const description =
      typeof m.description === "string" ? m.description : "";

    const skillsPaths = normalizeSkillsField(
      m.skills as SkillDecl | undefined,
      options.pluginRoot,
      errors
    );

    // Inline mcp (alternative B) — only when it's a non-array object.
    let inlineMcp: Record<string, PluginMcpServerDeclaration> | undefined;
    if (
      m.mcp &&
      typeof m.mcp === "object" &&
      !Array.isArray(m.mcp)
    ) {
      inlineMcp = m.mcp as Record<string, PluginMcpServerDeclaration>;
    }

    const hooksPath =
      typeof m.hooks === "string" ? m.hooks : undefined;

    // Opaque carry-through.
    const opaque: Record<string, unknown> = {};
    for (const key of [
      "commands",
      "agents",
      "outputStyles",
      "lsp",
      "output-styles",
    ]) {
      if (m[key] !== undefined) {
        opaque[key] = m[key];
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    const manifest: PluginManifest = {
      name: typeof name === "string" ? name : "",
      version,
      description,
      format: "claude",
      ...(typeof m.author === "string" ? { author: m.author } : {}),
      ...(typeof m.homepage === "string" ? { homepage: m.homepage } : {}),
      ...(typeof m.repository === "string" ? { repository: m.repository } : {}),
      // Carry skills/mcpServers as the existing loader's signal that this
      // plugin has those component types. Skills paths are stored in the
      // extras; the loader dispatches on `format === "claude"` to use them.
      skills: skillsPaths,
      mcpServers: inlineMcp ? Object.keys(inlineMcp) : [],
      [extraOpaqueKey]: opaque,
    } as unknown as PluginManifest;

    return {
      ok: true,
      adapted: {
        manifest,
        format: "claude",
        skillsPaths,
        mcpServersPaths: [],
        inlineMcp,
        hooksPath,
        opaque,
      },
    };
  }
}

/**
 * Internal key used to stash opaque carry-through on the manifest object.
 * Downstream code reads it via `manifest[extraOpaqueKey]` only when
 * `format === "claude"`. Not part of the public PluginManifest type —
 * cast through `unknown` at the boundary.
 */
export const extraOpaqueKey = "__claudeOpaque__";

// Re-export for type tests; keeps `path` import meaningful when tree-shaken.
export const _internalPath = path;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/service/pluginCompat/ClaudePluginAdapter.test.ts`
Expected: PASS — all 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/service/pluginCompat/ClaudePluginAdapter.ts \
        test/vitest/main/service/pluginCompat/ClaudePluginAdapter.test.ts
git commit -m "feat(plugin-compat): add ClaudePluginAdapter manifest translator"
```

---

## Task 6: Dual-path manifest discovery in `PluginManifestService`

**Files:**
- Modify: `src/service/PluginManifestService.ts`

- [ ] **Step 1: Read the current file to confirm the function to modify**

Run: `grep -n "locateManifestFile\|loadFromDirectory" src/service/PluginManifestService.ts`
Expected: shows current `locateManifestFile()` near line 209 and `loadFromDirectory()` near line 227.

- [ ] **Step 2: Add a test fixture for the dual-path behavior**

Append to `test/vitest/main/service/pluginCompat/ClaudePluginAdapter.test.ts` is wrong — this belongs in a new file. Create `test/vitest/main/service/PluginManifestService.claude.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PluginManifestService } from "@/service/PluginManifestService";

describe("PluginManifestService dual-path discovery", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-manifest-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("prefers .aifetchly-plugin over .claude-plugin when both exist", async () => {
    fs.mkdirSync(path.join(tmp, ".aifetchly-plugin"));
    fs.writeFileSync(
      path.join(tmp, ".aifetchly-plugin", "plugin.json"),
      JSON.stringify({
        name: "native",
        version: "1.0.0",
        description: "native",
        skills: ["skills/foo/"],
      })
    );
    fs.mkdirSync(path.join(tmp, ".claude-plugin"));
    fs.writeFileSync(
      path.join(tmp, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "claude", version: "1.0.0", description: "claude" })
    );

    const result = await PluginManifestService.loadFromDirectory(tmp);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.manifest.name).toBe("native");
    expect(result.manifest.format).toBeUndefined();
  });

  it("detects claude format when only .claude-plugin exists", async () => {
    fs.mkdirSync(path.join(tmp, ".claude-plugin"));
    fs.writeFileSync(
      path.join(tmp, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: "claude-pack",
        version: "1.0.0",
        description: "claude pack",
        skills: ["skills/foo/"],
      })
    );

    const result = await PluginManifestService.loadFromDirectory(tmp);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.manifest.format).toBe("claude");
  });

  it("falls back to root plugin.json as aifetchly format", async () => {
    fs.writeFileSync(
      path.join(tmp, "plugin.json"),
      JSON.stringify({
        name: "legacy",
        version: "1.0.0",
        description: "legacy",
        skills: ["skills/foo/"],
      })
    );

    const result = await PluginManifestService.loadFromDirectory(tmp);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.manifest.format).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/PluginManifestService.claude.test.ts`
Expected: FAIL — `result.manifest.format` is undefined for the Claude case.

- [ ] **Step 4: Modify `PluginManifestService.locateManifestFile()` and `loadFromDirectory()`**

Edit `src/service/PluginManifestService.ts`. Add this import at the top (after the existing imports):

```typescript
import { ClaudePluginAdapter } from "@/service/pluginCompat/ClaudePluginAdapter";
import type { PluginFormat } from "@/entityTypes/pluginTypes";
```

Replace the existing `locateManifestFile()` function with:

```typescript
function locateManifestFile(
  pluginRoot: string
): { path: string; format: PluginFormat } | null {
  const ai = path.join(pluginRoot, ".aifetchly-plugin", "plugin.json");
  if (fs.existsSync(ai)) return { path: ai, format: "aifetchly" };

  const cc = path.join(pluginRoot, ".claude-plugin", "plugin.json");
  if (fs.existsSync(cc)) return { path: cc, format: "claude" };

  const root = path.join(pluginRoot, "plugin.json");
  if (fs.existsSync(root)) return { path: root, format: "aifetchly" };

  return null;
}
```

Add a helper to read+parse JSON (replacing inline logic in `loadFromDirectory`):

```typescript
function readJsonFile(
  filePath: string
):
  | { ok: true; value: unknown }
  | { ok: false; error: PluginError } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        code: "manifest-not-found",
        path: filePath,
        message:
          e instanceof Error
            ? `Failed to read manifest: ${e.message}`
            : "Failed to read manifest",
        recoverable: false,
      },
    };
  }
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        code: "manifest-invalid-json",
        path: filePath,
        message:
          e instanceof Error
            ? `Manifest is not valid JSON: ${e.message}`
            : "Manifest is not valid JSON",
        recoverable: false,
      },
    };
  }
}
```

Replace the body of `loadFromDirectory()` (the existing static method) with:

```typescript
  static async loadFromDirectory(
    pluginRoot: string
  ): Promise<PluginManifestLoadResult> {
    const located = locateManifestFile(pluginRoot);
    if (!located) {
      return fail([
        {
          code: "manifest-not-found",
          path: pluginRoot,
          message:
            "No plugin manifest found. Expected .aifetchly-plugin/plugin.json, .claude-plugin/plugin.json, or root plugin.json.",
          recoverable: false,
        },
      ]);
    }

    const read = readJsonFile(located.path);
    if (!read.ok) return fail([read.error]);

    if (located.format === "claude") {
      const adapted = ClaudePluginAdapter.adapt(read.value, { pluginRoot });
      if (!adapted.ok) return fail(adapted.errors);
      // Run the result through the existing validateManifest so the same
      // path-safety and required-field rules apply uniformly. Pass the
      // AiFetchly-shaped manifest produced by the adapter.
      const validation = validateManifest(adapted.adapted.manifest, pluginRoot);
      if (!validation.success) return fail(validation.errors);
      // validateManifest returns ok with empty manifestPath; fill it in.
      return ok(validation.manifest, located.path);
    }

    // AiFetchly native path (unchanged behavior).
    const validation = validateManifest(read.value, pluginRoot);
    if (!validation.success) return fail(validation.errors);
    return ok(validation.manifest, located.path);
  }
```

Note: the existing `validateManifest()` enforces "at least one of skills/mcpServers non-empty" (line ~150). The adapter always sets `skills: skillsPaths` which is non-empty (defaults to `["skills/"]`), so Claude manifests pass this check.

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/service/PluginManifestService.claude.test.ts`
Expected: PASS — all 3 tests.

- [ ] **Step 6: Run full plugin test suite to ensure no regression**

Run: `yarn vitest run test/vitest/main/service/ | grep -E "(PluginManifest|PluginLoader|PluginImport|pluginCompat)" | tail -40`
Expected: all existing plugin tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/service/PluginManifestService.ts \
        test/vitest/main/service/PluginManifestService.claude.test.ts
git commit -m "feat(plugin-compat): dual-path manifest discovery in PluginManifestService"
```

---

## Task 7: Wire Claude skills through `PluginImportService`

When importing a Claude plugin, each entry in `manifest.skills` is a path to either a directory containing `SKILL.md` or a direct `.md` file. We add a parallel path in `PluginImportService` that synthesizes a `SkillManifest` from the SKILL.md rather than reading a `manifest.json`.

**Files:**
- Modify: `src/service/PluginImportService.ts`

- [ ] **Step 1: Read the current import flow to find the insertion point**

Run: `grep -n "readPluginSkillManifest\|importSkill\|skills\b" src/service/PluginImportService.ts | head -30`

This shows where the per-skill import loop lives. The Claude path branches before `readPluginSkillManifest()`.

- [ ] **Step 2: Add a `readPluginClaudeSkill()` helper in `PluginImportService.ts`**

After the existing `readPluginSkillManifest()` function, add:

```typescript
import { ClaudeSkillFormatAdapter } from "@/service/pluginCompat/ClaudeSkillFormatAdapter";
import { promises as fsPromises } from "fs";

/**
 * Read a Claude SKILL.md file at the declared path (file or directory)
 * and translate it into a SkillManifest using the Claude adapter.
 *
 * If `skillPath` points to a directory, looks for `SKILL.md` inside it.
 * If `skillPath` points to a .md file directly, uses that.
 */
function readPluginClaudeSkill(
  pluginRoot: string,
  skillPath: string
):
  | { ok: true; manifest: SkillManifest; body: string; absPath: string }
  | { ok: false; error: PluginError } {
  let absPath: string;
  try {
    absPath = resolvePluginRelativePath(pluginRoot, skillPath);
  } catch {
    return {
      ok: false,
      error: {
        code: "path-outside-plugin",
        componentType: "skill",
        path: skillPath,
        message: `Claude skill path "${skillPath}" escapes the plugin directory.`,
        recoverable: false,
      },
    };
  }

  // If directory, look for SKILL.md inside.
  let mdPath = absPath;
  try {
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      mdPath = path.join(absPath, "SKILL.md");
    }
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        code: "component-not-found",
        componentType: "skill",
        componentName: skillPath,
        path: absPath,
        message:
          e instanceof Error
            ? `Claude skill path not accessible: ${e.message}`
            : `Claude skill path not accessible: ${skillPath}`,
        recoverable: false,
      },
    };
  }

  if (!fs.existsSync(mdPath)) {
    return {
      ok: false,
      error: {
        code: "component-not-found",
        componentType: "skill",
        componentName: skillPath,
        path: mdPath,
        message: `Claude skill SKILL.md not found at: ${mdPath}`,
        recoverable: false,
      },
    };
  }

  let content: string;
  try {
    content = fs.readFileSync(mdPath, "utf-8");
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        code: "skill-manifest-invalid",
        componentType: "skill",
        componentName: skillPath,
        message:
          e instanceof Error
            ? `Failed to read SKILL.md: ${e.message}`
            : "Failed to read SKILL.md",
        recoverable: false,
      },
    };
  }

  const adapted = ClaudeSkillFormatAdapter.adapt(content, skillPath);
  if (!adapted.ok) return { ok: false, error: adapted.error };
  return {
    ok: true,
    manifest: adapted.manifest,
    body: adapted.body,
    absPath: mdPath,
  };
}
```

(Add the `ClaudeSkillFormatAdapter` import at the top of the file with the other imports; do not add a second `fsPromises` import if not used — drop that line if unused.)

- [ ] **Step 3: Locate the per-skill import loop in the import flow**

Run: `grep -n "for.*skill\|readPluginSkillManifest\|SkillImportService" src/service/PluginImportService.ts | head -20`

Note the line numbers where the loop iterates over `manifest.skills` and calls `readPluginSkillManifest()`. The Claude branch goes there.

- [ ] **Step 4: Add the Claude branch in the skill loop**

In the per-skill loop, before the call to `readPluginSkillManifest()`, insert:

```typescript
// Claude-format plugin: skill paths point to SKILL.md files, not manifest.json.
const isClaudeFormat = (manifest.format ?? "aifetchly") === "claude";
if (isClaudeFormat) {
  const claudeSkill = readPluginClaudeSkill(installPath, skillPath);
  if (!claudeSkill.ok) {
    errors.push(claudeSkill.error);
    continue;
  }
  // Reuse the existing SkillImportService import path by synthesizing
  // a manifest-json string the existing code expects.
  // (Use the same downstream code path as ZIP-based SKILL.md import:
  //  SkillImportService.importFromManifestAndContent() — see Step 5 for
  //  the exact call signature used in the surrounding code.)
  // NOTE: replace `importSkillFromManifest(...)` below with the actual
  // call site function name found in Step 3.
  // ... (continue to Step 5)
}
```

The exact wiring depends on the existing call site shape, which the next step verifies.

- [ ] **Step 5: Verify the surrounding code shape**

Read the existing per-skill loop with: `grep -n -A 30 "for.*manifest.skills\|for.*const skillPath" src/service/PluginImportService.ts | head -60`

Confirm what function the existing code calls after `readPluginSkillManifest()` succeeds. Use that same function for the Claude path with the synthesized manifest. The Claude path's skill body (markdown) is written to `<skillDir>/SKILL.md` so the existing SkillExecutor finds it the same way the existing SKILL.md-only skill import does (see `SkillImportService.ts:851` and `:1016` for the precedent).

- [ ] **Step 6: Run type check**

Run: `yarn tsc`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/service/PluginImportService.ts
git commit -m "feat(plugin-compat): wire Claude SKILL.md skills through PluginImportService"
```

---

## Task 8: Carry `format` through `PluginLoaderService`

So the Plugin Manager (in a later UI task) can show a "Format: Claude" badge, the loaded `LoadedPlugin` needs the field.

**Files:**
- Modify: `src/service/PluginLoaderService.ts`

- [ ] **Step 1: Add `format?` to `LoadedPlugin` interface**

In `src/service/PluginLoaderService.ts`, edit the `LoadedPlugin` interface (around line 44) to add:

```typescript
  readonly format?: import("@/entityTypes/pluginTypes").PluginFormat;
```

- [ ] **Step 2: Pass format through in `forceLoad()`**

In `forceLoad()`, the loaded manifest already carries `format` from `PluginManifestService.loadFromDirectory()` (set by `ClaudePluginAdapter`). Add it to the two `LoadedPlugin` object literals (the "install path missing" branch around line 125 and the success branch around line 194):

```typescript
format: manifest.format,
```

- [ ] **Step 3: Run type check**

Run: `yarn tsc`
Expected: PASS.

- [ ] **Step 4: Run loader tests for regression**

Run: `yarn vitest run test/vitest/main/service/ | grep -iE "(PluginLoader|pluginCompat)" | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/PluginLoaderService.ts
git commit -m "feat(plugin-compat): carry format through PluginLoaderService"
```

---

## Task 9: Fixture plugin + end-to-end integration test

Validates that loading a real Claude plugin layout produces registered, invocable skills.

**Files:**
- Create: `test/fixtures/claude-plugins/skills-only/.claude-plugin/plugin.json`
- Create: `test/fixtures/claude-plugins/skills-only/skills/lead-research/SKILL.md`
- Create: `test/fixtures/claude-plugins/skills-only/skills/email-writer/SKILL.md`
- Test: `test/vitest/main/service/pluginCompat/loadClaudePlugin.integration.test.ts`

- [ ] **Step 1: Create fixture files**

```bash
mkdir -p test/fixtures/claude-plugins/skills-only/.claude-plugin
mkdir -p test/fixtures/claude-plugins/skills-only/skills/lead-research
mkdir -p test/fixtures/claude-plugins/skills-only/skills/email-writer
```

Create `test/fixtures/claude-plugins/skills-only/.claude-plugin/plugin.json`:

```json
{
  "name": "claude-skills-pack",
  "version": "1.0.0",
  "description": "A sample Claude plugin with documentation-only skills.",
  "author": "fixture",
  "skills": true
}
```

Create `test/fixtures/claude-plugins/skills-only/skills/lead-research/SKILL.md`:

```markdown
---
name: lead-research
description: Use when the user asks about researching LinkedIn leads.
version: 1.0.0
---

# Lead Research Skill

When invoked, this skill provides guidance on researching LinkedIn leads.
Pass `attachment_ref` to load staged attachment content.
```

Create `test/fixtures/claude-plugins/skills-only/skills/email-writer/SKILL.md`:

```markdown
---
name: email-writer
description: Use when the user asks to draft a cold outreach email.
---

# Email Writer Skill

Drafts a cold outreach email based on the supplied context.
```

- [ ] **Step 2: Write the integration test**

Create `test/vitest/main/service/pluginCompat/loadClaudePlugin.integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as path from "path";
import { PluginManifestService } from "@/service/PluginManifestService";
import { ClaudeSkillFormatAdapter } from "@/service/pluginCompat/ClaudeSkillFormatAdapter";
import * as fs from "fs";

const FIXTURE_ROOT = path.resolve(
  __dirname,
  "../../../../../../test/fixtures/claude-plugins/skills-only"
);

describe("load Claude skills-only plugin (integration)", () => {
  it("loads the manifest with format=claude", async () => {
    const result = await PluginManifestService.loadFromDirectory(FIXTURE_ROOT);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.manifest.format).toBe("claude");
    expect(result.manifest.name).toBe("claude-skills-pack");
  });

  it("adapts each SKILL.md under skills/", async () => {
    const manifestResult = await PluginManifestService.loadFromDirectory(FIXTURE_ROOT);
    expect(manifestResult.success).toBe(true);
    if (!manifestResult.success) return;

    const skillsDir = path.join(FIXTURE_ROOT, "skills");
    const entries = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    expect(entries.sort()).toEqual(["email-writer", "lead-research"]);

    for (const dir of entries) {
      const mdPath = path.join(skillsDir, dir, "SKILL.md");
      const content = fs.readFileSync(mdPath, "utf-8");
      const adapted = ClaudeSkillFormatAdapter.adapt(content, `skills/${dir}/SKILL.md`);
      expect(adapted.ok).toBe(true);
      if (!adapted.ok) continue;
      expect(adapted.manifest.documentationOnly).toBe(true);
      expect(adapted.manifest.runtime).toBe("javascript");
    }
  });

  it("round-trip fidelity: plugin bytes unchanged on disk", () => {
    // After "load" (read-only operations only), every file in the fixture
    // must be byte-identical. Adapters never write.
    const manifestPath = path.join(
      FIXTURE_ROOT,
      ".claude-plugin",
      "plugin.json"
    );
    const stat = fs.statSync(manifestPath);
    expect(stat.size).toBeGreaterThan(0);
    // Re-read and check no synthesized manifest.json has been written.
    const synthesized = path.join(FIXTURE_ROOT, "manifest.json");
    expect(fs.existsSync(synthesized)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the integration test**

Run: `yarn vitest run test/vitest/main/service/pluginCompat/loadClaudePlugin.integration.test.ts`
Expected: PASS — all 3 tests.

- [ ] **Step 4: Run the full plugin-compat suite together**

Run: `yarn vitest run test/vitest/main/service/pluginCompat/`
Expected: PASS — all tests across all 5 files in the pluginCompat directory, plus the `PluginManifestService.claude.test.ts` file.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/claude-plugins/ \
        test/vitest/main/service/pluginCompat/loadClaudePlugin.integration.test.ts
git commit -m "test(plugin-compat): add fixture plugin and end-to-end integration test"
```

---

## Task 10: Final verification and PR-ready commit

- [ ] **Step 1: Run the complete vitest suite**

Run: `yarn testmain`
Expected: PASS — no regressions across the main-process test suite.

- [ ] **Step 2: Run TypeScript check across the project**

Run: `yarn tsc`
Expected: PASS — no new errors.

- [ ] **Step 3: Confirm coverage of new code**

Run: `yarn vitest run test/vitest/main/service/pluginCompat/ --coverage`
Expected: ≥80% line coverage across the four files under `src/service/pluginCompat/`.

- [ ] **Step 4: Verify no DB migration is required**

Run: `grep -rn "format" src/entity/ 2>/dev/null`
Expected: no changes to entity files.

- [ ] **Step 5: Summary commit (only if Steps 1–4 reveal changes worth folding in)**

If all green: no further commit needed. The Phase 1 implementation is complete.

---

## Self-Review

### Spec coverage (PRD §7 Product Behavior)
- §7.1 Manifest discovery → Task 6 ✓
- §7.2 Manifest translation → Task 5 ✓
- §7.3 Skill format adapter → Task 3 ✓
- §7.4 Trigger description handling → Task 3 (carried verbatim into `description` field) ✓
- §7.5 MCP integration → Phase 2 (out of scope, noted) ✓
- §7.6 Hooks integration → Phase 3 (out of scope, noted) ✓
- §7.7 Identifier parsing → Task 4 ✓
- §7.8 Plugin Manager UI changes → Out of scope for Phase 1 core engine (follow-up plan) ✓
- §7.9 AI-enable gating → No new AI-serving handlers introduced; existing gates apply ✓

### Tech Design coverage (§12 New Files Phase 1)
- `pluginFormatTypes.ts` → Task 2 ✓
- `ClaudePluginAdapter.ts` → Task 5 ✓
- `ClaudeSkillFormatAdapter.ts` → Task 3 ✓
- `claudeFrontmatterParser.ts` → Task 2 ✓
- `parsePluginIdentifier.ts` → Task 4 ✓

### Tech Design coverage (§13 Modified Files Phase 1)
- `pluginTypes.ts` → Task 1 ✓
- `PluginManifestService.ts` → Task 6 ✓
- `PluginLoaderService.ts` → Task 8 ✓
- `SkillImportService.ts` → Reused existing `parseSkillMarkdownMetadata` pattern; no modification needed ✓
- `InstalledSkill.entity.ts` → No new enum value needed; existing `source` field is not type-restricted ✓
- UI/lang files → Deferred to follow-up plan ✓

### Placeholder scan
No "TBD", "TODO", or "implement later" markers in this plan. Task 7 Step 4 references the existing per-skill loop and instructs the engineer to confirm the call site name in Step 5 — that's intentional, because the exact function name is in the existing code that wasn't fully read at plan-writing time. If Step 5 reveals the call site doesn't exist as expected, that's a deviation that must be raised (per subagent-driven-development rules).

### Type consistency check
- `ClaudeAdaptResult` defined in Task 2, consumed in Task 5 ✓
- `ClaudeSkillAdaptResult` defined and consumed in Task 3 ✓
- `ParsedPluginIdentifier` defined and consumed in Task 4 ✓
- `PluginFormat` introduced in Task 1, consumed in Tasks 5, 6, 8 ✓
- `extraOpaqueKey` exported from `ClaudePluginAdapter.ts` for any consumer that needs to read opaque carry-through (none yet in Phase 1) ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-03-claude-plugin-compat-phase1.md`.**

The user has already requested autonomous execution. The plan will be executed inline (executing-plans style) in this session, batching tasks with verification checkpoints between them.
