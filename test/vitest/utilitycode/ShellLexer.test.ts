/**
 * Tests for ShellLexer — character-aware shell tokenizer.
 *
 * Covers the structural hazards that the layered permission model relies on:
 * quote tracking, operator recognition, and detection of unanalyzable
 * constructs (command substitution, process substitution, heredocs, etc.).
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/service/shellSecurity/ShellLexer";

describe("ShellLexer", () => {
  describe("simple commands", () => {
    it("lexes a bare command", () => {
      const r = lex("ls -la /tmp");
      expect(r.unanalyzable).toEqual([]);
      expect(r.hasHeredoc).toBe(false);
      const words = r.tokens.filter((t) => t.kind === "word").map((t) => t.text);
      expect(words).toEqual(["ls", "-la", "/tmp"]);
    });

    it("marks plain words as literal", () => {
      const r = lex("cat foo.txt");
      const words = r.tokens.filter((t) => t.kind === "word");
      expect(words.every((w) => w.literal)).toBe(true);
      expect(words.every((w) => w.expanded)).toBe(false);
    });
  });

  describe("operators", () => {
    it("recognizes && and ||", () => {
      const r = lex("a && b || c");
      const ops = r.tokens.filter((t) => t.kind === "op_and" || t.kind === "op_or");
      expect(ops).toHaveLength(2);
      expect(ops[0].kind).toBe("op_and");
      expect(ops[1].kind).toBe("op_or");
    });

    it("recognizes pipe and semicolon", () => {
      const r = lex("a | b ; c");
      expect(r.tokens.find((t) => t.kind === "op_pipe")).toBeTruthy();
      expect(r.tokens.find((t) => t.kind === "op_semi")).toBeTruthy();
    });

    it("recognizes >> append redirect", () => {
      const r = lex("echo hi >> out.log");
      const redirect = r.tokens.find((t) => t.kind === "op_redirect_out");
      expect(redirect).toBeTruthy();
      expect(redirect?.text).toBe(">>");
    });

    it("recognizes FD-prefixed redirect 2>", () => {
      const r = lex("cmd 2> err.log");
      const fdRedirect = r.tokens.find((t) => t.kind === "op_redirect_fd");
      expect(fdRedirect).toBeTruthy();
      expect(fdRedirect?.text).toContain("2>");
    });
  });

  describe("quote tracking", () => {
    it("does not split operators inside single quotes", () => {
      const r = lex("echo 'a && b'");
      const words = r.tokens.filter((t) => t.kind === "word");
      expect(words).toHaveLength(2);
      expect(words[1].text).toBe("a && b");
      expect(words[1].quoted).toBe(true);
      expect(words[1].literal).toBe(true);
    });

    it("does not split operators inside double quotes", () => {
      const r = lex('echo "a | b"');
      const words = r.tokens.filter((t) => t.kind === "word");
      expect(words[1].text).toBe("a | b");
      expect(words[1].quoted).toBe(true);
    });

    it("treats single-quoted content as literal even with $ inside", () => {
      const r = lex("echo '$HOME'");
      const word = r.tokens.filter((t) => t.kind === "word")[1];
      expect(word.literal).toBe(true);
      expect(word.expanded).toBe(false);
    });
  });

  describe("unanalyzable constructs", () => {
    it("flags $(...) command substitution", () => {
      const r = lex("echo $(whoami)");
      expect(r.unanalyzable).toContain("command substitution $(...)");
    });

    it("flags backtick command substitution", () => {
      const r = lex("echo `whoami`");
      expect(r.unanalyzable.some((s) => s.includes("backtick"))).toBe(true);
    });

    it("flags process substitution >(...)", () => {
      const r = lex("cat <(curl http://evil)");
      expect(r.unanalyzable.some((s) => s.includes("process substitution"))).toBe(true);
    });

    it("flags $(...) inside double quotes", () => {
      const r = lex('echo "rm -rf $(echo /)"');
      expect(r.unanalyzable.some((s) => s.includes("command substitution"))).toBe(true);
    });

    it("flags heredoc", () => {
      const r = lex("cat <<EOF\nhello\nEOF");
      expect(r.hasHeredoc).toBe(true);
      expect(r.unanalyzable).toContain("heredoc (<<)");
    });

    it("flags arithmetic expansion $((...))", () => {
      const r = lex("echo $((1+1))");
      expect(r.unanalyzable.some((s) => s.includes("arithmetic"))).toBe(true);
    });

    it("marks bare $VAR as non-literal but analyzable", () => {
      const r = lex("echo $HOME");
      const word = r.tokens.filter((t) => t.kind === "word")[1];
      expect(word.literal).toBe(false);
      expect(word.expanded).toBe(true);
      expect(r.unanalyzable).toEqual([]);
    });
  });

  describe("tricky bypass attempts", () => {
    it("does not flag quoted operators that look like hazards", () => {
      const r = lex("echo 'eval is fine in a string'");
      expect(r.unanalyzable).toEqual([]);
    });

    it("flags $VAR containing command substitution", () => {
      const r = lex("$(rm -rf /)");
      expect(r.unanalyzable.length).toBeGreaterThan(0);
    });

    it("handles backslash escapes outside quotes", () => {
      const r = lex("echo a\\ b");
      const words = r.tokens.filter((t) => t.kind === "word");
      // The escaped space should not split the word
      expect(words).toHaveLength(2);
    });

    it("handles nested quotes", () => {
      const r = lex("echo \"it's a test\"");
      const words = r.tokens.filter((t) => t.kind === "word");
      expect(words).toHaveLength(2);
      expect(words[1].quoted).toBe(true);
    });
  });
});
