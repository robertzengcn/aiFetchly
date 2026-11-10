import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * MDI glyph guard: every `mdi-<name>` token used in `src/**` must exist in
 * the installed `@mdi/font` CSS. A name that is not in the font has NO
 * `.mdi-<name>::before { content: … }` rule, so the <v-icon> renders an
 * EMPTY pseudo-element — the icon is silently invisible to users
 * (root cause of the blank header sidebar toggle fixed 2026-10-26:
 * `panel-right[-close]` are not glyphs of @mdi/font 7.4.47).
 *
 * This fixture-pinned ruleset is @mdi/font 7.4.47; when the dependency
 * bumps, new names may appear for free — this test only guards against
 * names the CURRENT font does not ship.
 */

const SRC_ROOT = path.resolve(process.cwd(), "src");

/** Names that are Vuetify's own `mdi-*` helper classes, not glyph names. */
const ALLOWED_NON_GLYPHS = new Set([
  // Font-size helper classes (e.g. `mdi-36px`), see
  // https://github.com/Templated/MaterialDesign-Font — sizing, not glyphs.
  "24px",
  "36px",
  "48px",
]);

function listSourceFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Generated/vendor trees are not authored icon usage.
      if (entry === "node_modules" || entry === "dist") continue;
      listSourceFiles(full, into);
    } else if (/\.(vue|ts)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      into.push(full);
    }
  }
  return into;
}

function installedGlyphNames(): Set<string> {
  const cssFile = path.resolve(
    process.cwd(),
    "node_modules/@mdi/font/css/materialdesignicons.css"
  );
  const css = readFileSync(cssFile, "utf8");
  const names = new Set<string>();
  for (const match of css.matchAll(/\.mdi-([a-z0-9-]+)::?before/g)) {
    names.add(match[1]);
  }
  if (names.size < 1000) {
    // Sanity: the font css must really have been parsed; otherwise this
    // test would trivially pass on a broken environment.
    throw new Error(
      `Expected a full @mdi/font CSS (found ${names.size} glyphs) — is @mdi/font installed? (${cssFile})`
    );
  }
  return names;
}

function stripComments(text: string): string {
  // Block comments (JS/TS) and HTML comments (Vue templates) first —
  // clumsy across strings, but icon names never live inside block
  // comments or HTML comments. Line comments (//) second.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'])\/\/.*$/, "$1"))
    .join("\n");
}

function usedGlyphNames(): Map<string, Set<string>> {
  // name -> files that use it
  const usage = new Map<string, Set<string>>();
  for (const file of listSourceFiles(SRC_ROOT)) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const match of text.matchAll(/mdi[-:]([a-z0-9-]+)/g)) {
      const name = match[1];
      if (ALLOWED_NON_GLYPHS.has(name)) continue;
      if (!usage.has(name)) usage.set(name, new Set());
      usage.get(name)!.add(path.relative(process.cwd(), file));
    }
  }
  return usage;
}

describe("MDI glyph guard (icons render in @mdi/font)", () => {
  it("uses only glyph names shipped by the installed @mdi/font", () => {
    const installed = installedGlyphNames();
    const usage = usedGlyphNames();
    const missing: string[] = [];
    for (const [name, files] of [...usage.entries()].sort()) {
      if (!installed.has(name)) {
        missing.push(`${name}  <-  ${[...files].sort().join(", ")}`);
      }
    }
    expect(
      missing,
      "These mdi-* names are NOT glyphs of the installed @mdi/font —\n" +
        "their icons render BLANK (empty ::before). Replace each with a\n" +
        `glyph the font ships:\n${missing.join("\n")}`
    ).toEqual([]);
  });
});
