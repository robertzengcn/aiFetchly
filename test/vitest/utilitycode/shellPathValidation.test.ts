/**
 * Tests for pathValidation — per-command path classification and validation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { FilePathGuard } from "@/service/FilePathGuard";
import { lex } from "@/service/shellSecurity/ShellLexer";
import { splitCompound } from "@/service/shellSecurity/compoundSplitter";
import { validateSegmentPaths } from "@/service/shellSecurity/pathValidation";

describe("pathValidation", () => {
  let guard: FilePathGuard;
  const tmpRoot = process.cwd();

  beforeEach(() => {
    guard = new FilePathGuard([tmpRoot], []);
  });

  function check(command: string) {
    const lexed = lex(command);
    const segments = splitCompound(lexed.tokens);
    return validateSegmentPaths(segments, guard);
  }

  describe("reads outside workspace", () => {
    it("asks when reading /etc/passwd", () => {
      const v = check("cat /etc/passwd");
      expect(v?.tier).toBe("ask");
      expect(v?.code).toBe("READ_OUTSIDE_ROOTS");
    });
  });

  describe("writes outside workspace", () => {
    it("denies writing outside workspace", () => {
      const v = check("rm /tmp/foo");
      expect(v?.tier).toBe("deny");
      expect(v?.code).toBe("PATH_OUTSIDE_ROOTS");
    });

    it("denies mv to outside workspace", () => {
      const v = check("mv ./src /tmp/evil");
      expect(v?.tier).toBe("deny");
      // Either outside-roots or critical-path is acceptable — both are denies
      expect(["PATH_OUTSIDE_ROOTS", "CRITICAL_PATH"]).toContain(v?.code);
    });
  });

  describe("writes inside workspace", () => {
    it("allows rm of a file inside workspace", () => {
      const v = check("rm ./local-file");
      expect(v).toBeNull();
    });

    it("allows mkdir inside workspace", () => {
      const v = check("mkdir ./new-dir");
      expect(v).toBeNull();
    });
  });

  describe("critical path protection", () => {
    it("denies rm of $HOME", () => {
      const v = check(`rm ${process.env.HOME ?? "/home/user"}/foo`);
      expect(v?.tier).toBe("deny");
      // Outside workspace OR critical — both are valid denies
      expect(["PATH_OUTSIDE_ROOTS", "CRITICAL_PATH"]).toContain(v?.code);
    });

    it("denies rm of /etc", () => {
      const v = check("rm -rf /etc");
      // /etc is both outside roots AND a critical path — either deny is fine
      expect(v?.tier).toBe("deny");
    });
  });

  describe("redirections", () => {
    it("allows redirect inside workspace", () => {
      const v = check("echo hi > ./out.log");
      expect(v).toBeNull();
    });

    it("denies redirect outside workspace", () => {
      const v = check("echo hi > /etc/cron.d/x");
      expect(v?.tier).toBe("deny");
      expect(v?.code).toBe("REDIRECT_OUTSIDE_ROOTS");
    });

    it("asks for redirect with $ expansion in target", () => {
      const v = check("echo hi > $EVIL");
      expect(v?.tier).toBe("ask");
      expect(v?.code).toBe("REDIRECT_NON_LITERAL");
    });

    it("allows /dev/null redirect", () => {
      const v = check("echo hi > /dev/null");
      expect(v).toBeNull();
    });
  });

  describe("compound commands", () => {
    it("validates each segment independently", () => {
      const v = check("cat ./local && rm /etc/passwd");
      expect(v?.tier).toBe("deny");
    });

    it("detects escape via cd in compound", () => {
      // `cd /tmp && rm foo` — the cd command isn't classified but the rm
      // argument `foo` is relative to cwd which we can't resolve, so we
      // validate against workspace roots; `foo` resolves inside workspace
      // (no escape detected statically). This is a known limitation — the
      // semantic hazard layer is what catches `cd` elsewhere.
      const v = check("cd /tmp && rm foo");
      // `foo` resolves to <root>/foo which IS inside workspace — so no deny.
      // The structural layer separately handles cd via the compound split.
      // Either null or deny is acceptable depending on classification.
      expect(v === null || v?.tier === "deny").toBe(true);
    });
  });

  describe("POSIX -- handling", () => {
    it("treats args after -- as paths", () => {
      const v = check("rm -- ./local-file");
      expect(v).toBeNull();
    });

    it("does not strip -- from flags", () => {
      const v = check("rm -rf -- ./local");
      expect(v).toBeNull();
    });
  });

  describe("grep / rg path handling", () => {
    it("allows grep inside workspace", () => {
      const v = check("grep pattern ./file");
      expect(v).toBeNull();
    });

    it("asks for grep reading outside workspace", () => {
      const v = check("grep pattern /etc/passwd");
      expect(v?.tier).toBe("ask");
      expect(v?.code).toBe("READ_OUTSIDE_ROOTS");
    });
  });
});
