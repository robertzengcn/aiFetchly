/**
 * Tests for SkillPackageInspectionService instruction merging (audit R5 +
 * review ticket: nested instruction qualification / per-candidate cwd).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SkillPackageInspectionService } from "@/service/SkillPackageInspectionService";

let root: string;

function writeCandidate(
  name: string,
  installText: string
): void {
  const dir = path.join(root, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# Usage\n\nDo things.`
  );
  fs.writeFileSync(path.join(dir, "install.md"), installText);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-inspect-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("nested instruction qualification", () => {
  it("both candidates' same-named install.md files survive the merge, with qualified paths", () => {
    writeCandidate(
      "nested-a",
      "pip install -r requirements-a.txt\nAPI_KEY_A="
    );
    writeCandidate(
      "nested-b",
      "node b-setup.js\nAPI_KEY_B="
    );
    const result = new SkillPackageInspectionService().inspect(root, undefined);
    const paths = result.instructionFiles.map((f) => f.relativePath);
    expect(paths).toContain("skills/nested-a/install.md");
    expect(paths).toContain("skills/nested-b/install.md");
    // The CONTENTS are distinguishable (the old bare-relativePath dedup
    // silently dropped the second candidate's file).
    const contents = result.instructionFiles.map((f) => f.content).join("\n");
    expect(contents).toContain("requirements-a.txt");
    expect(contents).toContain("b-setup.js");
  });
});
