/**
 * Regression tests for security fixes from the /review pass.
 *
 * Each test pins a specific bypass that was identified in review and
 * closed in commit 48fc64f5. Failure of any test means a bypass has
 * reopened.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { FilePathGuard } from "@/service/FilePathGuard";
import { checkShellPermission } from "@/service/shellSecurity/bashPermissions";
import {
  lex,
  containsExpansion,
  PLACEHOLDERS,
} from "@/service/shellSecurity/ShellLexer";

describe("regression: ANSI-C / locale quoting bypass", () => {
  let guard: FilePathGuard;
  beforeEach(() => {
    guard = new FilePathGuard([process.cwd()], []);
  });

  it("flags $'...' as unanalyzable (escapes interpreted by bash)", () => {
    const v = checkShellPermission("echo $'\\x41'", guard);
    // Should NOT be allow — the bytes are unknowable
    expect(v.tier).not.toBe("allow");
    expect(v.code).toBe("UNANALYZABLE_CONSTRUCT");
  });

  it("does not let $'...' sail through path validation as literal", () => {
    // rm -rf $'\x2f' would decode to "rm -rf /" at runtime
    const v = checkShellPermission("rm -rf $'\\x2f'", guard);
    expect(v.tier).not.toBe("allow");
  });

  it('flags $"..." locale translation as unanalyzable', () => {
    const v = checkShellPermission('echo $"hello"', guard);
    expect(v.tier).not.toBe("allow");
  });

  it("containsExpansion detects ANSI-C placeholder", () => {
    expect(containsExpansion(`rm ${PLACEHOLDERS.ANSI_C_QUOTING}`)).toBe(true);
    expect(containsExpansion(`rm ${PLACEHOLDERS.LOCALE_QUOTING}`)).toBe(true);
  });
});

describe("regression: here-string and quoted heredoc", () => {
  let guard: FilePathGuard;
  beforeEach(() => {
    guard = new FilePathGuard([process.cwd()], []);
  });

  it("flags <<< here-string", () => {
    const v = checkShellPermission("cat <<< $(whoami)", guard);
    expect(v.tier).not.toBe("allow");
  });

  it("flags heredoc with quoted delimiter", () => {
    const v = checkShellPermission("cat <<'EOF'\nwhoami\nEOF", guard);
    expect(v.tier).toBe("deny");
    expect(v.code).toBe("HEREDOC_BLOCKED");
  });

  it("flags heredoc with double-quoted delimiter", () => {
    const v = checkShellPermission('cat <<"EOF"\nwhoami\nEOF', guard);
    expect(v.tier).toBe("deny");
    expect(v.code).toBe("HEREDOC_BLOCKED");
  });

  it("does not mis-tokenize <<< as << + <", () => {
    // If mis-tokenized, the third < would be treated as redirect-in and
    // the lexer would emit extra tokens. Verify lex-level the <<< is
    // flagged as heredoc-family.
    const r = lex("cmd <<< word");
    expect(r.hasHeredoc).toBe(true);
  });
});

describe("regression: >& FD-redirect tokenization", () => {
  it("consumes 2>&1 as a single op_redirect_fd token", () => {
    const r = lex("cmd 2>&1");
    const fdTokens = r.tokens.filter((t) => t.kind === "op_redirect_fd");
    // Should be exactly one token with text "2>&1"
    const matching = fdTokens.filter((t) => t.text === "2>&1");
    expect(matching.length).toBe(1);
  });

  it("consumes bare >&2 as a single op_redirect_fd token", () => {
    const r = lex("cmd >&2");
    const matching = r.tokens.filter(
      (t) => t.kind === "op_redirect_fd" && t.text === ">&2"
    );
    expect(matching.length).toBe(1);
  });

  it("does not emit stray op_background tokens for 2>&1", () => {
    const r = lex("cmd 2>&1");
    const bgTokens = r.tokens.filter((t) => t.kind === "op_background");
    expect(bgTokens.length).toBe(0);
  });

  it("handles 2>&- (close FD) without emitting stray &", () => {
    const r = lex("cmd 2>&-");
    const fdTokens = r.tokens.filter((t) => t.kind === "op_redirect_fd");
    expect(fdTokens.some((t) => t.text === "2>&-")).toBe(true);
    const bgTokens = r.tokens.filter((t) => t.kind === "op_background");
    expect(bgTokens.length).toBe(0);
  });
});

describe("regression: find -delete / -exec misclassification", () => {
  let guard: FilePathGuard;
  beforeEach(() => {
    guard = new FilePathGuard([process.cwd()], []);
  });

  it("denies find -delete", () => {
    const v = checkShellPermission("find . -delete", guard);
    expect(v.tier).toBe("deny");
    expect(v.code).toBe("FIND_DESTRUCTIVE");
  });

  it("denies find -exec rm", () => {
    const v = checkShellPermission("find . -exec rm {} \\;", guard);
    expect(v.tier).toBe("deny");
    expect(v.code).toBe("FIND_DESTRUCTIVE");
  });

  it("denies find -ok rm", () => {
    const v = checkShellPermission("find . -ok rm {} \\;", guard);
    expect(v.tier).toBe("deny");
    expect(v.code).toBe("FIND_DESTRUCTIVE");
  });

  it("denies find -execdir", () => {
    const v = checkShellPermission("find . -execdir touch x {}", guard);
    expect(v.tier).toBe("deny");
    expect(v.code).toBe("FIND_DESTRUCTIVE");
  });

  it("still allows find without destructive flags", () => {
    const v = checkShellPermission("find . -name '*.txt'", guard);
    expect(v.tier).toBe("allow");
  });
});

describe("regression: argv[0] wrapper bypass", () => {
  let guard: FilePathGuard;
  beforeEach(() => {
    guard = new FilePathGuard([process.cwd()], []);
  });

  it("asks on time wrapper", () => {
    const v = checkShellPermission("time ls", guard);
    expect(v.tier).toBe("ask");
  });

  it("asks on nice wrapper", () => {
    const v = checkShellPermission("nice -n 10 ls", guard);
    expect(v.tier).toBe("ask");
  });

  it("asks on command wrapper", () => {
    const v = checkShellPermission("command ls", guard);
    expect(v.tier).toBe("ask");
  });

  it("strips leading backslash from head (\\rm classifies as rm)", () => {
    // \\rm should be treated as rm for classification
    const v = checkShellPermission("\\rm /etc/passwd", guard);
    expect(v.tier).toBe("deny");
  });

  it("asks on strace wrapper", () => {
    const v = checkShellPermission("strace ls", guard);
    expect(v.tier).toBe("ask");
  });
});

describe("regression: destructive commands in PROFILES", () => {
  let guard: FilePathGuard;
  beforeEach(() => {
    guard = new FilePathGuard([process.cwd()], []);
  });

  it("asks on dd (ALWAYS_ASK_HEADS)", () => {
    const v = checkShellPermission("dd if=/dev/zero of=./out bs=1", guard);
    expect(v.tier).toBe("ask");
    expect(v.code).toBe("DESTRUCTIVE_COMMAND");
  });

  it("denies shred outside workspace", () => {
    const v = checkShellPermission("shred /etc/passwd", guard);
    expect(v.tier).toBe("deny");
  });

  it("denies tar extract targeting outside workspace", () => {
    const v = checkShellPermission("tar -xzf evil.tar -C /etc", guard);
    expect(v.tier).toBe("deny");
  });

  it("denies unzip outside workspace", () => {
    const v = checkShellPermission("unzip -o evil.zip -d /etc", guard);
    expect(v.tier).toBe("deny");
  });
});

describe("regression: critical paths expanded", () => {
  let guard: FilePathGuard;
  beforeEach(() => {
    guard = new FilePathGuard([process.cwd()], []);
  });

  // These paths are BOTH outside the workspace AND on the critical list.
  // The first check to fire wins — PATH_OUTSIDE_ROOTS (because guard.validate
  // fails first) or CRITICAL_PATH (if the path were inside the workspace but
  // also critical). Either deny is correct.
  const acceptableDenyCodes = ["PATH_OUTSIDE_ROOTS", "CRITICAL_PATH"];

  it("denies rm of ~/.ssh/known_hosts", () => {
    const v = checkShellPermission(
      `rm ${process.env.HOME ?? "/home/user"}/.ssh/known_hosts`,
      guard
    );
    expect(v.tier).toBe("deny");
    expect(acceptableDenyCodes).toContain(v.code);
  });

  it("denies rm of ~/.kube/config", () => {
    const v = checkShellPermission(
      `rm ${process.env.HOME ?? "/home/user"}/.kube/config`,
      guard
    );
    expect(v.tier).toBe("deny");
    expect(acceptableDenyCodes).toContain(v.code);
  });

  it("denies rm of ~/.npmrc", () => {
    const v = checkShellPermission(
      `rm ${process.env.HOME ?? "/home/user"}/.npmrc`,
      guard
    );
    expect(v.tier).toBe("deny");
    expect(acceptableDenyCodes).toContain(v.code);
  });

  it("denies rm of ~/.netrc", () => {
    const v = checkShellPermission(
      `rm ${process.env.HOME ?? "/home/user"}/.netrc`,
      guard
    );
    expect(v.tier).toBe("deny");
    expect(acceptableDenyCodes).toContain(v.code);
  });
});

describe("regression: non-literal detection uses lexer placeholders", () => {
  let guard: FilePathGuard;
  beforeEach(() => {
    guard = new FilePathGuard([process.cwd()], []);
  });

  it("denies rm with $VAR target", () => {
    const v = checkShellPermission("rm $EVIL", guard);
    expect(v.tier).toBe("deny");
    expect(v.code).toBe("PATH_NON_LITERAL");
  });

  it("denies rm with ${VAR} target", () => {
    const v = checkShellPermission("rm ${EVIL}", guard);
    expect(v.tier).toBe("deny");
    expect(v.code).toBe("PATH_NON_LITERAL");
  });

  it("containsExpansion covers all placeholder forms", () => {
    for (const placeholder of Object.values(PLACEHOLDERS)) {
      expect(containsExpansion(`prefix ${placeholder} suffix`)).toBe(true);
    }
  });

  it("does not false-positive on plain literal text", () => {
    expect(containsExpansion("just a regular path")).toBe(false);
    expect(containsExpansion("./local-file.txt")).toBe(false);
  });
});

describe("regression: fork-bomb detection broadened", () => {
  let guard: FilePathGuard;
  beforeEach(() => {
    guard = new FilePathGuard([process.cwd()], []);
  });

  it("denies canonical :(){ :|:& };:", () => {
    const v = checkShellPermission(":(){ :|:& };:", guard);
    expect(v.tier === "deny" || v.tier === "ask").toBe(true);
  });

  it("denies non-canonical fork bomb f(){ f|f& };f", () => {
    const v = checkShellPermission("f(){ f|f& };f", guard);
    // Caught by the generic fork-bomb regex in SHELL_DENYLIST_PATTERNS,
    // which runs on the full raw command (not per-segment).
    expect(v.tier).toBe("deny");
    expect(v.code).toBe("DENYLIST_MATCH");
  });
});
