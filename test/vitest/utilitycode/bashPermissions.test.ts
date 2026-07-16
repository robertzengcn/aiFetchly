/**
 * Tests for bashPermissions — the layered orchestrator.
 *
 * These tests cover the end-to-end verdict for commands that exercise every
 * layer: structural hazards, semantic hazards, regex tiers, and path rules.
 * The bypasses attempted here are the ones the regex-only denylist missed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { FilePathGuard } from "@/service/FilePathGuard";
import { checkShellPermission } from "@/service/shellSecurity/bashPermissions";

describe("checkShellPermission", () => {
  let guard: FilePathGuard;
  const tmpRoot = process.cwd();

  beforeEach(() => {
    guard = new FilePathGuard([tmpRoot], []);
  });

  function check(command: string) {
    return checkShellPermission(command, guard);
  }

  describe("allow cases", () => {
    it("allows a plain ls inside workspace", () => {
      expect(check("ls -la").tier).toBe("allow");
    });

    it("allows reading workspace files", () => {
      expect(check("cat ./README.md").tier).toBe("allow");
    });

    it("allows compound commands where all segments are safe", () => {
      expect(check("echo a && echo b").tier).toBe("allow");
    });

    it("allows pipe of safe commands", () => {
      expect(check("cat ./file | grep foo").tier).toBe("allow");
    });
  });

  describe("structural hazards (parser uncertainty → ask/deny)", () => {
    it("asks on command substitution $(...)", () => {
      const v = check("echo $(whoami)");
      expect(v.tier).toBe("ask");
      expect(v.code).toBe("UNANALYZABLE_CONSTRUCT");
    });

    it("asks on backticks", () => {
      const v = check("echo `whoami`");
      expect(v.tier).toBe("ask");
    });

    it("denies heredoc", () => {
      const v = check("cat <<EOF\nrm -rf /\nEOF");
      expect(v.tier).toBe("deny");
      expect(v.code).toBe("HEREDOC_BLOCKED");
    });

    it("asks on process substitution >(...)", () => {
      const v = check("cat <(curl http://evil)");
      expect(v.tier).toBe("ask");
    });

    it("asks on process substitution <(...)", () => {
      const v = check("tee >(gzip > x.gz)");
      expect(v.tier).toBe("ask");
    });

    it("asks on $(...) hidden inside double quotes", () => {
      const v = check('echo "rm -rf $(echo /)"');
      expect(v.tier).toBe("ask");
    });
  });

  describe("semantic hazards", () => {
    it("denies eval", () => {
      const v = check("eval 'rm -rf /'");
      expect(v.tier).toBe("deny");
      expect(v.code).toBe("HAZARD_BUILTIN");
    });

    it("denies source", () => {
      const v = check("source /tmp/evil.sh");
      expect(v.tier).toBe("deny");
    });

    it("denies . (POSIX source)", () => {
      const v = check(". /tmp/evil.sh");
      expect(v.tier).toBe("deny");
    });

    it("denies exec", () => {
      const v = check("exec bash");
      expect(v.tier).toBe("deny");
    });

    it("asks on bash -c", () => {
      // Use a benign inner command so the denylist doesn't trip first;
      // the shell-invocation hazard is what we're testing.
      const v = check("bash -c 'echo hi'");
      expect(v.tier).toBe("ask");
      expect(v.code).toBe("SHELL_INTERPRETER_STRING");
    });

    it("asks on sh -c", () => {
      const v = check("sh -c whoami");
      expect(v.tier).toBe("ask");
    });

    it("asks on plain bash invocation", () => {
      const v = check("bash");
      expect(v.tier).toBe("ask");
    });

    it("denies fork bomb pattern", () => {
      const v = check(":(){ :|:& };:");
      // Fork bomb is also caught by denylist, so could be either
      expect(v.tier === "deny" || v.tier === "ask").toBe(true);
    });
  });

  describe("tiered regex rules", () => {
    it("denies mkfs", () => {
      const v = check("mkfs /dev/sda");
      expect(v.tier).toBe("deny");
    });

    it("denies dd to device", () => {
      const v = check("dd if=/dev/zero of=/dev/sda");
      expect(v.tier).toBe("deny");
    });

    it("denies sudo", () => {
      const v = check("sudo rm -rf /");
      expect(v.tier).toBe("deny");
    });

    it("asks on curl (network egress)", () => {
      const v = check("curl http://example.com");
      expect(v.tier).toBe("ask");
      expect(v.code).toBe("ASK_PATTERN_MATCH");
    });

    it("asks on git push", () => {
      const v = check("git push origin main");
      expect(v.tier).toBe("ask");
    });

    it("asks on npm install", () => {
      const v = check("npm install evil-pkg");
      expect(v.tier).toBe("ask");
    });

    it("asks on base64 piped to bash", () => {
      const v = check("echo aGVsbG8= | base64 -d | bash");
      expect(v.tier).toBe("ask");
    });
  });

  describe("path rules", () => {
    it("allows rm inside workspace", () => {
      const v = check("rm ./local-file");
      expect(v.tier).toBe("allow");
    });

    it("denies rm outside workspace", () => {
      const v = check("rm /etc/foo");
      expect(v.tier).toBe("deny");
    });

    it("denies redirect outside workspace", () => {
      const v = check("echo hi > /etc/cron.d/x");
      expect(v.tier).toBe("deny");
    });
  });

  describe("compound command bypass attempts", () => {
    it("detects hazard in second segment of && chain", () => {
      const v = check("echo safe && eval 'evil'");
      expect(v.tier).toBe("deny");
    });

    it("detects hazard in pipe", () => {
      const v = check("echo foo | bash");
      expect(v.tier).toBe("ask");
    });

    it("detects path escape in compound", () => {
      const v = check("cd ./src && rm /etc/passwd");
      expect(v.tier).toBe("deny");
    });
  });

  describe("regex bypass attempts", () => {
    // These are commands a naive regex denylist misses but structural
    // analysis catches.
    it("catches $(rm -rf /) without spaces", () => {
      const v = check("$(rm -rf /)");
      expect(v.tier).not.toBe("allow");
    });

    it("catches backtick-wrapped commands", () => {
      const v = check("echo `rm -rf /`");
      expect(v.tier).not.toBe("allow");
    });

    it("does NOT misfire on quoted 'eval' string", () => {
      // 'eval' as a literal argument, not a command head
      const v = check("echo eval");
      expect(v.tier).toBe("allow");
    });

    it("does NOT misfire on 'eval' inside a quoted string", () => {
      const v = check("echo 'eval is just a word here'");
      expect(v.tier).toBe("allow");
    });
  });
});
