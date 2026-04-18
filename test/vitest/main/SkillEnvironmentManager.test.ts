"use strict";
import { describe, expect, test } from "vitest";
import {
  assertRequirementsFileHasHashes,
  ensurePathUnderSkillDir,
  getElectronUserDataPath,
  requirementsLockReferencesModule,
} from "@/service/SkillEnvironmentManager";

describe("SkillEnvironmentManager helpers", () => {
  test("assertRequirementsFileHasHashes rejects content without hashes", () => {
    expect(() => assertRequirementsFileHasHashes("foo==1.0.0\n")).toThrow(
      "hash-pinned"
    );
  });

  test("assertRequirementsFileHasHashes accepts hash-pinned line", () => {
    expect(() =>
      assertRequirementsFileHasHashes(
        "pdf2image==1.17.0 --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
      )
    ).not.toThrow();
  });

  test("requirementsLockReferencesModule matches hyphenated package", () => {
    const lock =
      "pdf2image==1.17.0 \\\n" +
      "    --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
    expect(requirementsLockReferencesModule(lock, "pdf2image")).toBe(true);
    expect(requirementsLockReferencesModule(lock, "pdf2_image")).toBe(true);
  });

  test("requirementsLockReferencesModule returns false for absent module", () => {
    const lock =
      "pdf2image==1.17.0 \\\n" +
      "    --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
    expect(requirementsLockReferencesModule(lock, "requests")).toBe(false);
  });

  test("ensurePathUnderSkillDir accepts valid relative path", () => {
    const result = ensurePathUnderSkillDir(
      "/skills/my-skill",
      "requirements.txt"
    );
    expect(result).toContain("requirements.txt");
  });

  test("ensurePathUnderSkillDir rejects path traversal", () => {
    expect(() =>
      ensurePathUnderSkillDir("/skills/my-skill", "../../etc/passwd")
    ).toThrow("escapes skill directory");
  });

  test("ensurePathUnderSkillDir normalizes absolute-looking paths", () => {
    // path.join normalizes "/etc/passwd" to "etc/passwd" when joined with a base
    // This is correct behavior - the resulting path is under the skill dir
    const result = ensurePathUnderSkillDir("/skills/my-skill", "/etc/passwd");
    expect(result).toBe("/skills/my-skill/etc/passwd");
  });

  test("getElectronUserDataPath returns a string", () => {
    const result = getElectronUserDataPath();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
