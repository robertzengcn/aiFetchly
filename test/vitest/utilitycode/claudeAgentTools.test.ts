import { describe, expect, it } from "vitest";
import {
  parseClaudeToolField,
  translateClaudeAgentToolCall,
} from "@/service/pluginCompat/claudeAgentTools";
import { pluginHealthForLoadErrors } from "@/service/pluginCompat/pluginLoadHealth";
import type { PluginError } from "@/entityTypes/pluginTypes";

function warning(code: PluginError["code"]): PluginError {
  return {
    code,
    componentType: "agent",
    message: code,
    recoverable: true,
  };
}

describe("claude agent tool translation", () => {
  it("translates Write onto file_write overwrite", () => {
    expect(
      translateClaudeAgentToolCall("Write", {
        file_path: "posts/hello.md",
        content: "hello",
      })
    ).toEqual([
      {
        name: "file_write",
        args: {
          path: "posts/hello.md",
          content: "hello",
          mode: "overwrite",
        },
      },
    ]);
  });

  it("translates Edit and expands MultiEdit in order", () => {
    expect(
      translateClaudeAgentToolCall("Edit", {
        file_path: "a.md",
        old_string: "old",
        new_string: "new",
        replace_all: true,
      })
    ).toEqual([
      {
        name: "file_edit",
        args: {
          path: "a.md",
          old_string: "old",
          new_string: "new",
          replace_all: true,
        },
      },
    ]);

    expect(
      translateClaudeAgentToolCall("MultiEdit", {
        file_path: "a.md",
        edits: [
          { old_string: "one", new_string: "1" },
          { old_string: "two", new_string: "2", replace_all: false },
        ],
      })
    ).toEqual([
      {
        name: "file_edit",
        args: { path: "a.md", old_string: "one", new_string: "1" },
      },
      {
        name: "file_edit",
        args: {
          path: "a.md",
          old_string: "two",
          new_string: "2",
          replace_all: false,
        },
      },
    ]);
  });

  it("translates Grep and Bash using Claude argument names", () => {
    expect(
      translateClaudeAgentToolCall("Grep", {
        pattern: "TODO",
        path: "src",
        "-i": true,
        "-A": 2,
      })
    ).toEqual([
      {
        name: "grep_files",
        args: {
          pattern: "TODO",
          path: "src",
          output_mode: "files_with_matches",
          context_after: 2,
          case_insensitive: true,
        },
      },
    ]);

    expect(
      translateClaudeAgentToolCall("Bash", {
        command: "git status",
        timeout: 1000,
      })
    ).toEqual([
      {
        name: "shell_execute",
        args: { command: "git status", timeout_ms: 1000 },
      },
    ]);
  });

  it("parses Claude tool lists, wildcards, and parenthesized specs", () => {
    expect(parseClaudeToolField("Write, Edit, Bash(git:*)", false).tools).toEqual(
      ["Write", "Edit", "Bash(git:*)"]
    );
    expect(parseClaudeToolField("*", false).wildcard).toBe(true);
    expect(parseClaudeToolField(undefined, true).tools).toContain("Write");
    expect(parseClaudeToolField(undefined, false).tools).toEqual([]);
  });
});

describe("pluginHealthForLoadErrors", () => {
  it("keeps a plugin healthy when the only diagnostics are agent warnings", () => {
    expect(
      pluginHealthForLoadErrors([warning("agent-unsupported-field")])
    ).toBe("healthy");
    expect(pluginHealthForLoadErrors([])).toBe("healthy");
  });

  it("marks real component failures as partial_load", () => {
    expect(pluginHealthForLoadErrors([warning("mcp-config-invalid")])).toBe(
      "partial_load"
    );
  });

  it("keeps dependency failures as needs_configuration", () => {
    expect(
      pluginHealthForLoadErrors(
        [warning("dependency-unsatisfied"), warning("agent-unsupported-field")],
        "partial_load"
      )
    ).toBe("needs_configuration");
  });

  it("does not repair invalid or missing plugin files", () => {
    expect(
      pluginHealthForLoadErrors([], "missing_files")
    ).toBe("missing_files");
    expect(pluginHealthForLoadErrors([], "invalid")).toBe("invalid");
  });
});
