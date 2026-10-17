export interface ContactLinkCandidate {
  href: string;
  text: string;
  aria: string;
}

/** How many anchors to send back over CDP. */
export const CONTACT_LINK_SCAN_LIMIT = 1500;

/** Always include this many anchors from the end so footer contact links survive. */
export const CONTACT_LINK_TAIL = 500;

/**
 * Collect contact-link candidates inside the page.
 *
 * Passed to `page.evaluate`, so this function must stay self-contained.
 * `innerText` and `offsetWidth` force a document-wide reflow and are what
 * make `Runtime.callFunctionOn` hit Puppeteer's protocol timeout.
 */
export function readContactLinkCandidates(
  maxAnchors: number,
  tailCount: number
): ContactLinkCandidate[] {
  const anchors = document.querySelectorAll("a");
  const total = anchors.length;
  const indexes: number[] = [];
  if (total <= maxAnchors) {
    for (let index = 0; index < total; index += 1) {
      indexes.push(index);
    }
  } else {
    const tail = Math.min(Math.max(tailCount, 0), maxAnchors);
    const head = maxAnchors - tail;
    for (let index = 0; index < head; index += 1) {
      indexes.push(index);
    }
    for (let index = total - tail; index < total; index += 1) {
      indexes.push(index);
    }
  }

  const result: ContactLinkCandidate[] = [];
  for (const index of indexes) {
    const anchor = anchors[index];
    if (!anchor) {
      continue;
    }
    const href = anchor.href;
    if (!href || href.startsWith("javascript")) {
      continue;
    }
    const text = (anchor.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const aria = (anchor.getAttribute("aria-label") ?? "").toLowerCase();
    result.push({ href, text, aria });
  }
  return result;
}

/**
 * Clip rendered page text for the AI extractor.
 * Passed to `page.evaluate`, so this function must stay self-contained.
 */
export function readPageText(maxChars: number): string {
  document
    .querySelectorAll("script, style, img, svg, nav, footer")
    .forEach((node) => {
      node.remove();
    });
  const text = document.body?.textContent ?? "";
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}
