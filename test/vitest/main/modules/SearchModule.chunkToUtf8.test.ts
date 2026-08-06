import { describe, expect, test, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { chunkToUtf8 } from "@/modules/SearchModule";

vi.mock("electron", () => ({
  utilityProcess: {
    fork: vi.fn(),
  },
  MessageChannelMain: class MessageChannelMain {
    port1 = {};
    port2 = {};
  },
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

vi.mock("@/modules/token", () => ({
  Token: class Token {
    getValue(): string {
      return "";
    }
  },
}));

describe("chunkToUtf8", () => {
  test("returns strings unchanged", () => {
    expect(chunkToUtf8("hello")).toBe("hello");
  });

  test("decodes Buffer chunks so ignore/substring checks work", () => {
    const buf = Buffer.from(
      "Most NODE_OPTIONs are not supported in packaged apps"
    );
    expect(chunkToUtf8(buf)).toContain("NODE_OPTIONs");
  });

  test("decodes Uint8Array chunks", () => {
    const bytes = new TextEncoder().encode("Debugger attached");
    expect(chunkToUtf8(bytes)).toBe("Debugger attached");
  });
});

describe("SearchModule stderr must not mark task Error", () => {
  test("runSearchTask stderr handler only logs (regression for Windows Chrome noise)", () => {
    const sourcePath = path.resolve(
      __dirname,
      "../../../../src/modules/SearchModule.ts"
    );
    const source = fs.readFileSync(sourcePath, "utf8");
    const marker = "stderr is diagnostic only";
    const commentIdx = source.indexOf(marker);
    expect(commentIdx).toBeGreaterThan(-1);
    const stderrIdx = source.indexOf('child.stderr?.on("data"', commentIdx);
    expect(stderrIdx).toBeGreaterThan(commentIdx);
    const exitIdx = source.indexOf('child.on("exit"', stderrIdx);
    expect(exitIdx).toBeGreaterThan(stderrIdx);
    const stderrBlock = source.slice(commentIdx, exitIdx);
    expect(stderrBlock).toContain("not failing task");
    expect(stderrBlock).not.toMatch(/updateTaskStatus\s*\(/);
  });
});
