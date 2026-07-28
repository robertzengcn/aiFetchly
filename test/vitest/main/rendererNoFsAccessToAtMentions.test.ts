import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Boundary test (PRD AC-010 / SR-006): renderer @-mention code must never
 * import filesystem modules or main-process-only services. All file work
 * happens in the main process via IPC.
 */
const RENDERER_FILES = [
  "src/views/api/aiChatAtMentions.ts",
  "src/views/components/aiChatV2/AiChatV2AtMentionSuggestions.vue",
  "src/views/components/aiChatV2/AiChatV2Composer.vue",
];

const FORBIDDEN_IMPORTS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "fs", pattern: /from\s+["'](?:node:)?fs["']|require\(\s*["'](?:node:)?fs["']\)/ },
  { name: "path", pattern: /from\s+["'](?:node:)?path["']/ },
  { name: "os", pattern: /from\s+["'](?:node:)?os["']/ },
  { name: "fast-glob", pattern: /from\s+["']fast-glob["']/ },
  { name: "isbinaryfile", pattern: /from\s+["']isbinaryfile["']/ },
  { name: "WorkspaceResolver", pattern: /@\/service\/WorkspaceResolver/ },
  { name: "FilePathGuard", pattern: /@\/service\/FilePathGuard/ },
  { name: "FileToolService", pattern: /@\/service\/FileToolService/ },
  { name: "AtMentionSuggestionService", pattern: /@\/service\/aiChatAtMentions\/AtMentionSuggestionService/ },
  { name: "AtMentionResolutionService", pattern: /@\/service\/aiChatAtMentions\/AtMentionResolutionService/ },
];

const PROJECT_ROOT = path.resolve(__dirname, "../../..");

describe("renderer @-mention boundary (no filesystem access)", () => {
  for (const relPath of RENDERER_FILES) {
    describe(relPath, () => {
      const fullPath = path.join(PROJECT_ROOT, relPath);
      let source = "";
      it("file exists", () => {
        expect(fs.existsSync(fullPath)).toBe(true);
        source = fs.readFileSync(fullPath, "utf8");
      });

      for (const { name, pattern } of FORBIDDEN_IMPORTS) {
        it(`does not import forbidden module "${name}"`, () => {
          if (!source) source = fs.readFileSync(fullPath, "utf8");
          expect(pattern.test(source)).toBe(false);
        });
      }
    });
  }
});
