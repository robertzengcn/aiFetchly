import AdmZip from "adm-zip";
import { DOMParser } from "@xmldom/xmldom";
import * as path from "path";
import * as fs from "fs";

/** DrawingML namespace used by pptx text elements. */
const DRAWINGML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
/** PresentationML namespace used by the slide-id list. */
const PRESENTATIONML_NS =
  "http://schemas.openxmlformats.org/presentationml/2006/main";
/** OPC package relationships namespace used by .rels <Relationship> elements. */
const PACKAGE_RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
/** OfficeDocument relationships namespace for r:id attributes and rel types. */
const OFFICE_DOC_RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/** Relationship type that marks a slide in presentation.xml.rels. */
const SLIDE_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";

/** One slide's extracted text, keyed by its slide-number-indexed file. */
export interface ExtractedSlide {
  /** Display order of this slide (1-based), per presentation.xml sldIdLst. */
  order: number;
  /** Filename inside the package, e.g. slides/slide3.xml. */
  slideFileName: string;
  /** Concatenated text of the slide's paragraphs (runs joined within a paragraph). */
  text: string;
}

export interface PptxExtractionResult {
  /** Slides in display order. */
  slides: ExtractedSlide[];
  /** Joined presentation text (slides separated by `--- Slide N ---`). */
  content: string;
  /** Number of slides (in display order) that had text. */
  contentSlideCount: number;
}

/** Characters that are illegal in XML 1.0 and must be stripped. */
const INVALID_XML_RE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;

/**
 * Shared PPTX text extraction used by both the RAG chunking pipeline and the
 * chat-attachment markdown conversion. PptxTextExtractor must be the single
 * source of truth for how .pptx files are turned into ingestible text.
 *
 * Extraction rules:
 *  - Text runs (<a:r><a:t>) within one paragraph (<a:p>) are joined with a
 *    single space — PowerPoint frequently splits words across multiple runs.
 *  - Paragraphs are separated by newlines.
 *  - XML entities (&amp;, &lt;, &#8217;, …) are decoded by the XML parser.
 *  - Slide display order comes from presentation.xml <p:sldIdLst> (via the
 *    presentation rels), not from slideN.xml filenames, so decks saved after
 *    reordering present slides in the correct order.
 */
export class PptxTextExtractor {
  /**
   * Extract text from a .pptx file on disk.
   * @returns null when the file is missing, not a valid pptx zip, or has no
   *   slide text.
   */
  static extractFile(filePath: string): PptxExtractionResult | null {
    if (!filePath || !fs.existsSync(filePath)) {
      console.warn(`PPTX file not found: ${filePath}`);
      return null;
    }
    try {
      const zip = new AdmZip(filePath);
      return PptxTextExtractor.extractZip(zip, path.basename(filePath));
    } catch (error) {
      console.error(`Error extracting PPTX content from ${filePath}:`, error);
      return null;
    }
  }

  /** Extract text from an already-opened AdmZip (kept public for tests). */
  static extractZip(
    zip: AdmZip,
    displayName = "pptx"
  ): PptxExtractionResult | null {
    try {
      const entries = zip.getEntries();

      // Map slide file base name (e.g. slide3.xml) -> entry.
      const slideEntries = new Map<
        string,
        ReturnType<AdmZip["getEntries"]>[0]
      >();
      for (const entry of entries) {
        if (
          entry.entryName.startsWith("ppt/slides/slide") &&
          entry.entryName.endsWith(".xml")
        ) {
          const base = path.basename(entry.entryName);
          if (!/^slide\d+\.xml$/.test(base)) continue;
          slideEntries.set(base, entry);
        }
      }
      if (slideEntries.size === 0) {
        console.warn(`No slides found in PPTX: ${displayName}`);
        return null;
      }

      const slideNamesInOrder = PptxTextExtractor.resolveSlideOrder(
        zip,
        slideEntries
      );

      // 2) Extract each slide's paragraphs.
      const slides: ExtractedSlide[] = [];
      let order = 1;
      for (const slideName of slideNamesInOrder) {
        const entry = slideEntries.get(slideName);
        if (!entry) continue;
        const text = PptxTextExtractor.extractSlideText(
          entry.getData().toString("utf-8")
        );
        if (!text) continue; // Slides with no text are skipped entirely.
        slides.push({
          order,
          slideFileName: slideName,
          text,
        });
        order++;
      }

      if (slides.length === 0) {
        console.warn(`No text content extracted from PPTX: ${displayName}`);
        return null;
      }

      const content = slides
        .map((slide) => `--- Slide ${slide.order} ---\n${slide.text}`)
        .join("\n\n")
        .trim();

      console.log(
        `Successfully extracted PPTX content: ${content.length} characters from ${slides.length}/${slideNamesInOrder.length} slides`
      );
      return { slides, content, contentSlideCount: slides.length };
    } catch (error) {
      console.error(`Error extracting PPTX content:`, error);
      return null;
    }
  }

  /**
   * Resolve slides in display order. Prefers presentation.xml <p:sldIdLst>
   * (via the presentation rels); falls back to numeric slideN filename sort
   * when the rels are missing or malformed.
   */
  private static resolveSlideOrder(
    zip: AdmZip,
    slideEntries: Map<string, unknown>
  ): string[] {
    try {
      const pres = zip.getEntry("ppt/presentation.xml");
      const presRels = zip.getEntry("ppt/_rels/presentation.xml.rels");
      if (!pres || !presRels) {
        return PptxTextExtractor.sortBySlideNumber(slideEntries);
      }

      const presDoc = new DOMParser().parseFromString(
        PptxTextExtractor.sanitizeXml(pres.getData().toString("utf-8")),
        "text/xml"
      );
      const relsDoc = new DOMParser().parseFromString(
        PptxTextExtractor.sanitizeXml(presRels.getData().toString("utf-8")),
        "text/xml"
      );

      // Build rId -> slide target (e.g. slides/slide5.xml) map. The <Relationship>
      // elements carry the OPC *package* relationships namespace; the
      // r:id attributes in presentation.xml use the OfficeDocument
      // relationships namespace.
      const relIdToTarget = new Map<string, string>();
      const rels = relsDoc.getElementsByTagNameNS(
        PACKAGE_RELATIONSHIPS_NS,
        "Relationship"
      );
      for (let i = 0; i < rels.length; i++) {
        const rel = rels[i];
        const relId = rel.getAttribute("Id");
        const type = rel.getAttribute("Type") || "";
        const target = rel.getAttribute("Target") || "";
        if (relId && type === SLIDE_REL_TYPE && target) {
          relIdToTarget.set(relId, target.replace(/^\/+/, ""));
        }
      }

      const orderedNames: string[] = [];
      const sldIdLst = presDoc.getElementsByTagNameNS(
        PRESENTATIONML_NS,
        "sldIdLst"
      );
      if (sldIdLst.length > 0) {
        const sldIds = sldIdLst[0].getElementsByTagNameNS(
          PRESENTATIONML_NS,
          "sldId"
        );
        for (let i = 0; i < sldIds.length; i++) {
          const sldIdEl = sldIds[i];
          const rid =
            sldIdEl.getAttribute("r:id") ||
            sldIdEl.getAttributeNS(OFFICE_DOC_RELATIONSHIPS_NS, "id") ||
            "";
          const target = rid ? relIdToTarget.get(rid) : undefined;
          if (!target) continue;
          // target may be "slides/slide3.xml" — map to slide3.xml
          const base = path.basename(target);
          if (slideEntries.has(base)) {
            orderedNames.push(base);
          }
        }
      }

      if (orderedNames.length === 0) {
        // The sldIdLst wasn't resolvable — fall back to filename ordering.
        return PptxTextExtractor.sortBySlideNumber(slideEntries);
      }
      return orderedNames;
    } catch {
      return PptxTextExtractor.sortBySlideNumber(slideEntries);
    }
  }

  private static sortBySlideNumber(
    slideEntries: Map<string, unknown>
  ): string[] {
    return Array.from(slideEntries.keys()).sort((a, b) => {
      const aNum = parseInt(a.match(/slide(\d+)/)?.[1] || "0", 10);
      const bNum = parseInt(b.match(/slide(\d+)/)?.[1] || "0", 10);
      return aNum - bNum;
    });
  }

  /**
   * Extract paragraphs from a single slide's XML. Every <a:p> paragraph's
   * <a:t> runs are concatenated (single space separator — PowerPoint splits
   * words across runs), then paragraphs are joined by newlines in document
   * order.
   */
  private static extractSlideText(xmlContent: string): string {
    const doc = new DOMParser().parseFromString(
      PptxTextExtractor.sanitizeXml(xmlContent),
      "text/xml"
    );

    // getElementsByTagNameNS(DRAWINGML_NS, "p") uniquely matches <a:p>
    // paragraphs (local name "p" in the DrawingML namespace). Presentation
    // shapes are <p:sp>/<p:pic> etc., which have different local names.
    const paragraphs = doc.getElementsByTagNameNS(DRAWINGML_NS, "p");
    const lines: string[] = [];
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      // Runs are concatenated verbatim — PowerPoint stores the space between
      // words *inside* the run text (e.g. "Quarterl"+"y Results"), so adding a
      // synthetic separator would split words like "Quarterly Results" into
      // "Quarterl y Results". Whitespace is preserved from the source.
      const runs = para.getElementsByTagNameNS(DRAWINGML_NS, "t");
      let line = "";
      for (let j = 0; j < runs.length; j++) {
        line += runs[j].textContent || "";
      }
      if (line.trim()) {
        lines.push(line.trim());
      }
    }
    return lines.join("\n");
  }

  /** Replace control chars that would make DOMParser throw. */
  private static sanitizeXml(xml: string): string {
    return xml.replace(INVALID_XML_RE, "");
  }
}
