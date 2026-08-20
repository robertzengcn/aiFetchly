import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import AdmZip from "adm-zip";
import { PptxTextExtractor } from "@/service/PptxTextExtractor";

/** Minimal DrawingML slide fragment with the given paragraphs. */
function slideXml(paragraphXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody>${paragraphXml}</p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
}

function paragraph(runs: string[]): string {
  const runXml = runs.map((t) => `<a:r><a:t>${t}</a:t></a:r>`).join("");
  return `<a:p>${runXml}</a:p>`;
}

function buildPptx(slides: Record<string, string>, order?: string[]): string {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(slides)) {
    zip.addFile(`ppt/slides/${name}`, Buffer.from(content, "utf-8"));
  }
  // If order is given, emit a presentation.xml whose sldIdLst references
  // rel ids that resolve to the listed slide files in that order.
  if (order) {
    const sldIds = order
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
      .join("");
    zip.addFile(
      "ppt/presentation.xml",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>${sldIds}</p:sldIdLst>
</p:presentation>`,
        "utf-8"
      )
    );
    const rels = order
      .map(
        (name, i) =>
          `<Relationship Id="rId${
            i + 1
          }" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/${name}"/>`
      )
      .join("");
    zip.addFile(
      "ppt/_rels/presentation.xml.rels",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
        "utf-8"
      )
    );
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pptx-test-"));
  const zipPath = path.join(tmp, "deck.pptx");
  zip.writeZip(zipPath);
  return zipPath;
}

describe("PptxTextExtractor", () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it("joins text runs within a paragraph with a single space", () => {
    // 'Quarterl' + 'y Resu' + 'lts' must become 'Quarterly Results'.
    const xml = slideXml(paragraph(["Quarterl", "y Resu", "lts"]));
    const pptxPath = buildPptx({ "slide1.xml": xml });
    tempDirs.push(path.dirname(pptxPath));

    const result = PptxTextExtractor.extractFile(pptxPath);
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Quarterly Results");
    expect(result!.content).not.toContain("Quarterl\n");
  });

  it("decodes XML entities in extracted text", () => {
    // '&' is stored as &amp; in XML; '’' as &#8217;.
    const xml = slideXml(
      paragraph(["Sales &amp; Marketing", "it&#8217;s &lt;here&gt;"])
    );
    const pptxPath = buildPptx({ "slide1.xml": xml });
    tempDirs.push(path.dirname(pptxPath));

    const result = PptxTextExtractor.extractFile(pptxPath);
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Sales & Marketing");
    expect(result!.content).toContain("it’s <here>");
    expect(result!.content).not.toContain("&amp;");
    expect(result!.content).not.toContain("&#8217;");
  });

  it("emits Slide separators so the markdown chunker can break on them", () => {
    const xml1 = slideXml(paragraph(["First slide"]));
    const xml2 = slideXml(paragraph(["Second slide"]));
    const pptxPath = buildPptx({ "slide1.xml": xml1, "slide2.xml": xml2 });
    tempDirs.push(path.dirname(pptxPath));

    const result = PptxTextExtractor.extractFile(pptxPath);
    expect(result).not.toBeNull();
    expect(result!.content).toContain("--- Slide 1 ---");
    expect(result!.content).toContain("--- Slide 2 ---");
    expect(result!.content).toMatch(
      /--- Slide 1 ---\nFirst slide\n\n--- Slide 2 ---\nSecond slide/
    );
  });

  it("orders slides by presentation.xml sldIdLst when reordered", () => {
    // Files slide1.xml..slide3.xml but display order is 3,1,2. Use unique
    // deck content ("AAA", "BBB", "CCC") so it cannot collide with the
    // "--- Slide N ---" separator labels.
    const xml = (n: string) => slideXml(paragraph([n]));
    const pptxPath = buildPptx(
      {
        "slide1.xml": xml("AAA"),
        "slide2.xml": xml("BBB"),
        "slide3.xml": xml("CCC"),
      },
      ["slide3.xml", "slide1.xml", "slide2.xml"]
    );
    tempDirs.push(path.dirname(pptxPath));

    const result = PptxTextExtractor.extractFile(pptxPath);
    expect(result).not.toBeNull();
    expect(result!.slides.map((s) => s.text)).toEqual(["CCC", "AAA", "BBB"]);
    // The first displayed slide's content is CCC (from slide3.xml).
    expect(
      result!.content.indexOf("CCC") < result!.content.indexOf("AAA")
    ).toBe(true);
  });

  it("falls back to filename ordering when rels are missing", () => {
    const xml = (n: string) => slideXml(paragraph([`Slide ${n}`]));
    const pptxPath = buildPptx({
      "slide2.xml": xml("2"),
      "slide1.xml": xml("1"),
    });
    tempDirs.push(path.dirname(pptxPath));

    const result = PptxTextExtractor.extractFile(pptxPath);
    expect(result).not.toBeNull();
    expect(
      result!.content.indexOf("Slide 1") < result!.content.indexOf("Slide 2")
    ).toBe(true);
  });

  it("returns null for a missing file", () => {
    expect(
      PptxTextExtractor.extractFile("/definitely/not/here.pptx")
    ).toBeNull();
  });

  it("returns null for a corrupt zip", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pptx-corrupt-"));
    tempDirs.push(tmp);
    const corruptPath = path.join(tmp, "bad.pptx");
    fs.writeFileSync(corruptPath, "not a real zip file content");
    expect(PptxTextExtractor.extractFile(corruptPath)).toBeNull();
  });

  it("returns null when no slides have text", () => {
    const emptySlide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree></p:spTree></p:cSld>
</p:sld>`;
    const pptxPath = buildPptx({ "slide1.xml": emptySlide });
    tempDirs.push(path.dirname(pptxPath));
    expect(PptxTextExtractor.extractFile(pptxPath)).toBeNull();
  });

  it("skips slides without text but keeps slide numbering sequential", () => {
    const emptySlide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree></p:spTree></p:cSld>
</p:sld>`;
    // Slide 2 is empty; slide 1 and 3 have text.
    const pptxPath = buildPptx({
      "slide1.xml": slideXml(paragraph(["Alpha"])),
      "slide2.xml": emptySlide,
      "slide3.xml": slideXml(paragraph(["Beta"])),
    });
    tempDirs.push(path.dirname(pptxPath));

    const result = PptxTextExtractor.extractFile(pptxPath);
    expect(result).not.toBeNull();
    // contentSlideCount reflects only slides with text.
    expect(result!.contentSlideCount).toBe(2);
    // But the Slide separator numbering uses display order (1 and 2).
    expect(result!.content).toContain("--- Slide 1 ---");
    expect(result!.content).toContain("--- Slide 2 ---");
    expect(result!.slides.map((s) => s.text)).toEqual(["Alpha", "Beta"]);
  });
});
