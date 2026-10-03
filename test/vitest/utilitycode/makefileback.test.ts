"use strict";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SourceMapGenerator } from "source-map";
import { describe, expect, test, beforeAll, afterAll } from "vitest";

/**
 * findOriginalPosition reads a minified file's adjacent `.map`, builds a
 * SourceMapConsumer, and resolves a (line, column) in the minified file back
 * to its original source position (file + line + column) plus a small context
 * window. It is the helper behind the production "make file back" debug flow
 * that maps a packaged-stack line/column to its TypeScript source.
 *
 * The test previously hardcoded a transient build artifact path
 * (`.vite/build/background-<hash>.js`) + hand-tuned line/column numbers, and
 * had NO assertions — only console.log. It failed with ENOENT on any clean
 * checkout that lacked that exact stale build. It now generates a real
 * minified file + `.map` fixture in a temp dir via SourceMapGenerator and
 * asserts the helper maps the generated position back to the known original.
 */
describe("findOriginalPosition", () => {
  let tmp: string;
  let minifiedPath: string;

  // Original source fixture: three lines so the context window has neighbours.
  const originalFile = path.join("src", "fixture", "example.ts");
  const originalSource = [
    "export function add(a: number, b: number): number {",
    "  return a + b;",
    "}",
  ].join("\n");
  // The generated/minified file maps every original line to generated line 1.
  const generatedLine = 1;
  const originalLine = 2; // "  return a + b;"
  const originalColumn = 9; // position of "a" in "return a + b;"

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "makefileback-"));

    // Build a sourcemap that maps generated line 1 back to originalLine.
    const gen = new SourceMapGenerator({
      file: "background-fixture.js",
      sourceRoot: "",
    });
    gen.addMapping({
      generated: { line: generatedLine, column: 0 },
      original: { line: originalLine, column: originalColumn },
      source: originalFile,
      name: "add",
    });
    gen.setSourceContent(originalFile, originalSource);
    const rawMap = JSON.parse(gen.toString());

    // A trivial "minified" body whose sourceMappingURL points at the .map.
    const minifiedBody = `var a=1,b=2;return a+b;\n//# sourceMappingURL=background-fixture.js.map`;
    minifiedPath = path.join(tmp, "background-fixture.js");
    fs.writeFileSync(minifiedPath, minifiedBody, "utf8");
    fs.writeFileSync(`${minifiedPath}.map`, JSON.stringify(rawMap), "utf8");
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("maps a generated position back to the original source line", async () => {
    const result = await findOriginalPosition(minifiedPath, generatedLine, 0);

    expect(result).toBeDefined();
    expect(result?.source).toBe(originalFile);
    expect(result?.line).toBe(originalLine);
    expect(result?.column).toBe(originalColumn);
    expect(result?.name).toBe("add");
    // Context window includes the original source line.
    expect(result?.context).toContain("return a + b;");
  });
});

/**
 * The production helper: read `${minifiedFile}.map`, resolve (line, column)
 * to its original position, and return a small context window. Mirrors the
 * original findOriginalPosition shape but returns structured data instead of
 * console.log, so it is assertable.
 */
async function findOriginalPosition(
  minifiedFile: string,
  line: number,
  column: number
): Promise<
  | {
      source: string | null;
      line: number | null;
      column: number | null;
      name: string | null;
      context: string;
    }
  | undefined
> {
  const { SourceMapConsumer } = await import("source-map");
  const rawSourceMap = JSON.parse(
    fs.readFileSync(`${minifiedFile}.map`, "utf8")
  );
  const consumer = await new SourceMapConsumer(rawSourceMap);
  try {
    const position = consumer.originalPositionFor({ line, column });

    let sourceContext = "";
    if (position.source) {
      const sourceIndex = consumer.sources.indexOf(position.source);
      if (
        sourceIndex !== -1 &&
        consumer.sourcesContent &&
        consumer.sourcesContent[sourceIndex] &&
        position.line
      ) {
        const sourceLines = consumer.sourcesContent[sourceIndex].split("\n");
        const startLine = Math.max(0, position.line - 3);
        const endLine = Math.min(sourceLines.length, position.line + 3);
        sourceContext = sourceLines
          .slice(startLine, endLine)
          .map((l, i) => {
            const lineNumber = startLine + i + 1;
            const isErrorLine = lineNumber === position.line;
            return `${isErrorLine ? ">" : " "} ${lineNumber}: ${l}`;
          })
          .join("\n");
      }
    }

    return {
      source: position.source,
      line: position.line,
      column: position.column,
      name: position.name,
      context: sourceContext,
    };
  } finally {
    consumer.destroy();
  }
}
