/**
 * @vitest-environment happy-dom
 *
 * Google Maps result cards live in a virtualized feed. After the scroll-to-load
 * loop the feed is at the bottom, so card 1 has no viewport box
 * ("Node is either not clickable or not an Element"). Clicking a later card
 * calls scrollIntoView, Maps recycles that node, and Puppeteer throws
 * "Node is detached from document".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ElementHandle, Page } from "puppeteer";
import {
  MAPS_RESULT_CARD_SELECTORS,
  countMapsResultCards,
  isStaleMapsCardClickError,
  openMapsResultCard,
  queryMapsResultCards,
  revealMapsResultCard,
} from "@/childprocess/google-maps/mapsResultsReady";

const PLACE_HREF = "https://maps.example/place/acme";

function feedMarkup(): string {
  return `
    <div id="feed" role="feed">
      <div>
        <div id="sentinel" jsaction="mouseover:pane.wfvdle17"></div>
      </div>
      <a class="hfpxzc" id="place-a" href="${PLACE_HREF}">Acme Software</a>
      <a class="hfpxzc" id="place-b" href="https://maps.example/place/beta">Beta Labs</a>
    </div>
  `;
}

function stubRect(element: Element, top: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: top,
      top,
      left: 0,
      right: 320,
      bottom: top + height,
      width: 320,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = feedMarkup();
  const feed = document.getElementById("feed");
  const place = document.getElementById("place-a");
  if (!feed || !place) {
    throw new Error("fixture missing feed or place anchor");
  }
  stubRect(feed, 100, 600);
  stubRect(place, 900, 100);
  feed.scrollTop = 0;
});

describe("result card selectors", () => {
  it("counts place links instead of the leading jsaction wrapper", async () => {
    const page = {
      evaluate: async (
        fn: (selectors: string[]) => number,
        selectors: string[]
      ) => fn(selectors),
    } as unknown as Page;

    await expect(countMapsResultCards(page)).resolves.toBe(2);
  });

  it("queries place anchors when a non-clickable jsaction wrapper is also present", async () => {
    const page = {
      $$: async (selector: string) => {
        const nodes = Array.from(document.querySelectorAll(selector));
        if (nodes.length === 0) return [];
        return nodes.map(
          () =>
            ({
              dispose: async () => undefined,
            }) as unknown as ElementHandle<Element>
        );
      },
    } as unknown as Page;

    const handles = await queryMapsResultCards(page);
    expect(handles).toHaveLength(2);
    expect(MAPS_RESULT_CARD_SELECTORS[0]).toBe(
      'div[role="feed"] a.hfpxzc'
    );
  });
});

describe("revealMapsResultCard", () => {
  it("scrolls the off-screen place anchor into the feed and returns its URL", () => {
    const revealed = revealMapsResultCard(0, [...MAPS_RESULT_CARD_SELECTORS]);
    const feed = document.getElementById("feed");

    expect(revealed.found).toBe(true);
    expect(revealed.href).toBe(PLACE_HREF);
    expect(feed?.scrollTop).toBe(900 - 100 - 48);
  });

  it("returns found=false when the index is past the place links", () => {
    const revealed = revealMapsResultCard(5, [...MAPS_RESULT_CARD_SELECTORS]);
    expect(revealed).toEqual({ href: null, found: false });
  });

  it("stays self-contained so Puppeteer can run it inside the page", () => {
    const source = revealMapsResultCard.toString();
    expect(source).toContain("querySelectorAll");
    expect(source).not.toContain("MAPS_RESULT_CARD_SELECTORS");
  });
});

describe("isStaleMapsCardClickError", () => {
  it("matches Puppeteer's not-clickable and detached-node errors", () => {
    expect(
      isStaleMapsCardClickError(
        new Error("Node is either not clickable or not an Element")
      )
    ).toBe(true);
    expect(
      isStaleMapsCardClickError(new Error("Node is detached from document"))
    ).toBe(true);
    expect(isStaleMapsCardClickError(new Error("Navigation timeout"))).toBe(
      false
    );
  });
});

describe("openMapsResultCard", () => {
  it("clicks the place anchor after scrolling it into view", async () => {
    const clicked: Element[] = [];
    const page = makePage({
      click(element: Element): Promise<void> {
        clicked.push(element);
        return Promise.resolve();
      },
    });

    await expect(openMapsResultCard(page, 0, { sleep })).resolves.toBe(
      "clicked"
    );
    expect(clicked[0]?.id).toBe("place-a");
    expect(document.getElementById("feed")?.scrollTop).toBe(900 - 100 - 48);
  });

  it("clicks a visible card with the mouse so Puppeteer does not scrollIntoView", async () => {
    const mouseClick = vi.fn(async () => undefined);
    const handleClick = vi.fn(async () => {
      throw new Error("Node is detached from document");
    });
    const page = {
      evaluate: async () => ({ found: true, href: PLACE_HREF }),
      viewport: () => ({ width: 1280, height: 800 }),
      mouse: { click: mouseClick },
      $$: async (selector: string) => {
        const nodes = Array.from(document.querySelectorAll(selector));
        if (nodes.length === 0) return [];
        return nodes.map(() => ({
          click: handleClick,
          dispose: async () => undefined,
          evaluate: async () => true,
          boundingBox: async () => ({
            x: 40,
            y: 120,
            width: 300,
            height: 80,
          }),
        }));
      },
    } as unknown as Page;

    await expect(openMapsResultCard(page, 0, { sleep })).resolves.toBe(
      "clicked"
    );
    expect(mouseClick).toHaveBeenCalledWith(190, 160);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("re-queries after a detached node and clicks the fresh anchor", async () => {
    let attempts = 0;
    const page = makePage({
      click(): Promise<void> {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new Error("Node is detached from document"));
        }
        return Promise.resolve();
      },
    });
    const goto = vi.fn(async () => undefined);

    await expect(
      openMapsResultCard(page, 0, { sleep, goto })
    ).resolves.toBe("clicked");
    expect(attempts).toBe(2);
    expect(goto).not.toHaveBeenCalled();
  });

  it("opens the original place URL when the node never becomes clickable", async () => {
    let revealCount = 0;
    const page = makePage({
      click(): Promise<void> {
        return Promise.reject(
          new Error("Node is either not clickable or not an Element")
        );
      },
      evaluate: async () => {
        revealCount += 1;
        return {
          found: true,
          href:
            revealCount === 1
              ? PLACE_HREF
              : "https://maps.example/place/replaced-by-virtualization",
        };
      },
    });
    const goto = vi.fn(async () => undefined);

    await expect(
      openMapsResultCard(page, 0, { sleep, goto, maxAttempts: 3 })
    ).resolves.toBe("navigated");
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith(PLACE_HREF);
  });
});

function sleep(): Promise<void> {
  return Promise.resolve();
}

interface CardEvaluate {
  (
    pageFunction: (
      cardIndex: number,
      selectors: readonly string[]
    ) => { href: string | null; found: boolean },
    cardIndex: number,
    selectors: readonly string[]
  ): Promise<{ href: string | null; found: boolean }>;
}

function makePage(options: {
  click: (element: Element) => Promise<void>;
  evaluate?: CardEvaluate;
}): Page {
  const evaluate: CardEvaluate =
    options.evaluate ??
    (async (fn, cardIndex, selectors) => fn(cardIndex, selectors));

  return {
    evaluate,
    $$: async (selector: string) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length === 0) return [];
      return nodes.map((element) => ({
        click: () => options.click(element),
        dispose: async () => undefined,
      }));
    },
  } as unknown as Page;
}
