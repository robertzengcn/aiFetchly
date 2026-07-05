import sanitizeHtml from "sanitize-html";
import { convert } from "html-to-text";

/**
 * Safe HTML for email display: no scripts, no event handlers, no forms,
 * no iframes. Tracking pixels (1x1 images) are stripped. Remote images are
 * retained so the UI can decide whether to load them (disabled by default).
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "em", "u", "s", "a", "ul", "ol", "li",
    "blockquote", "hr", "table", "thead", "tbody", "tr", "th", "td",
    "h1", "h2", "h3", "h4", "h5", "h6", "img", "div", "span", "pre", "code",
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    "*": ["style"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" },
    }),
  },
  // Exclude 1x1 tracking pixels.
  exclusiveFilter: (frame) => {
    if (frame.tag !== "img") return false;
    const w = parseInt(String(frame.attribs.width ?? ""), 10);
    const h = parseInt(String(frame.attribs.height ?? ""), 10);
    if (w === 1 && h === 1) return true;
    const src = String(frame.attribs.src ?? "").toLowerCase();
    return TRACKING_PIXEL_MARKERS.some((m) => src.includes(m));
  },
};

/** Substrings that indicate a tracking-pixel image URL. */
const TRACKING_PIXEL_MARKERS = [
  "pixel.mail",
  "open.pixel",
  "track.pixel",
  "email-pixel",
  "track.open",
  "/pixel/",
  "pixel.gif",
];

/** Sanitize untrusted inbound HTML for safe storage and display. */
export function sanitizeEmailHtml(html: string | null | undefined): string | null {
  if (!html || html.trim().length === 0) return null;
  try {
    return sanitizeHtml(html, SANITIZE_OPTIONS);
  } catch {
    // If sanitization fails, fall back to escaped text rather than dropping it.
    return sanitizeHtml(html, {
      allowedTags: [],
      allowedAttributes: {},
    });
  }
}

/** Convert HTML to plain text for AI prompts and snippets. */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html || html.trim().length === 0) return "";
  try {
    return convert(html, {
      wordwrap: 130,
      selectors: [
        { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
        { selector: "img", format: "skip" },
      ],
    }).trim();
  } catch {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
}
