import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserManager } from "@/modules/browserManager";
import {
  CONTACT_EXTRACTION_PROTOCOL_TIMEOUT_MS,
  PUPPETEER_DEFAULT_PROTOCOL_TIMEOUT_MS,
  contactViewportScreenshotOptions,
  finalizePuppeteerLaunchOptions,
  omitHeadlessRenderingBlockers,
} from "@/modules/puppeteerLaunchPolicy";
import {
  CONTACT_LINK_SCAN_LIMIT,
  CONTACT_LINK_TAIL,
  readContactLinkCandidates,
  readPageText,
} from "@/childprocess/contact-extraction/contactPageSnapshot";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

describe("headless puppeteer launch policy", () => {
  it("drops flags that stop headless Chrome from producing a frame", () => {
    const args = omitHeadlessRenderingBlockers([
      "--no-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-features=VizDisplayCompositor",
      "--disable-features=VizDisplayCompositor,TranslateUI",
      "--disable-features=IsolateOrigins,site-per-process",
      "--window-size=1920,1080",
    ]);

    expect(args).toEqual([
      "--no-sandbox",
      "--disable-features=TranslateUI",
      "--disable-features=IsolateOrigins,site-per-process",
      "--window-size=1920,1080",
    ]);
  });

  it("keeps those flags for headed launches and preserves protocolTimeout", () => {
    const headed = finalizePuppeteerLaunchOptions(
      {
        headless: false,
        args: ["--disable-gpu", "--no-sandbox"],
      },
      { protocolTimeout: CONTACT_EXTRACTION_PROTOCOL_TIMEOUT_MS }
    );
    expect(headed.headless).toBe(false);
    expect(headed.args).toContain("--disable-gpu");
    expect(headed.protocolTimeout).toBe(
      CONTACT_EXTRACTION_PROTOCOL_TIMEOUT_MS
    );

    const headless = finalizePuppeteerLaunchOptions(
      {
        headless: false,
        args: [
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--disable-features=VizDisplayCompositor",
          "--no-sandbox",
        ],
      },
      {
        headless: true,
        protocolTimeout: CONTACT_EXTRACTION_PROTOCOL_TIMEOUT_MS,
      }
    );
    expect(headless.headless).toBe(true);
    expect(headless.args).not.toContain("--disable-gpu");
    expect(headless.args).not.toContain("--disable-software-rasterizer");
    expect(
      headless.args?.some((arg) => arg.includes("VizDisplayCompositor"))
    ).toBe(false);
    expect(headless.args).toContain("--no-sandbox");
    expect(headless.protocolTimeout).toBeGreaterThan(
      PUPPETEER_DEFAULT_PROTOCOL_TIMEOUT_MS
    );
  });

  it("strips rendering blockers from BrowserManager headless stealth launches", () => {
    const manager = new BrowserManager();
    const options = manager.buildLaunchOptions({
      headless: true,
      protocolTimeout: CONTACT_EXTRACTION_PROTOCOL_TIMEOUT_MS,
    });

    expect(options.headless).toBe(true);
    expect(options.protocolTimeout).toBe(
      CONTACT_EXTRACTION_PROTOCOL_TIMEOUT_MS
    );
    expect(options.args).not.toContain("--disable-gpu");
    expect(options.args).not.toContain("--disable-software-rasterizer");
    expect(
      options.args?.some((arg) => arg.includes("VizDisplayCompositor"))
    ).toBe(false);
    expect(options.args).toContain("--no-sandbox");
  });
});

describe("contact page snapshot", () => {
  const previousDocument = globalThis.document;

  function installDocument(documentStub: Document): void {
    globalThis.document = documentStub;
  }

  function restoreDocument(): void {
    globalThis.document = previousDocument;
  }

  it("reads link text without layout-forcing DOM properties", () => {
    const source = readContactLinkCandidates.toString();
    expect(source).not.toContain("innerText");
    expect(source).not.toContain("offsetWidth");
    expect(source).not.toContain("offsetHeight");
    expect(source).toContain("textContent");
  });

  it("keeps footer contact links when the page has more anchors than the scan cap", () => {
    interface AnchorStub {
      href: string;
      textContent: string;
      getAttribute: (name: string) => string | null;
    }

    const anchors: AnchorStub[] = Array.from({ length: 20 }, (_, index) => ({
      href: `https://shop.example/page-${index}`,
      textContent: `Link ${index}`,
      getAttribute: () => null,
    }));
    anchors[19] = {
      href: "https://shop.example/contact",
      textContent: "  Contact   Us  ",
      getAttribute: (name: string) =>
        name === "aria-label" ? "Get in touch" : null,
    };
    anchors[3] = {
      href: "javascript:void(0)",
      textContent: "noop",
      getAttribute: () => null,
    };

    installDocument({
      querySelectorAll: () => anchors,
    } as unknown as Document);

    try {
      const links = readContactLinkCandidates(10, 3);
      expect(links.map((link) => link.href)).toContain(
        "https://shop.example/contact"
      );
      expect(links.map((link) => link.href)).not.toContain(
        "https://shop.example/page-10"
      );
      expect(links.map((link) => link.href)).not.toContain("javascript:void(0)");
      const contact = links.find(
        (link) => link.href === "https://shop.example/contact"
      );
      expect(contact?.text).toBe("contact us");
      expect(contact?.aria).toBe("get in touch");
    } finally {
      restoreDocument();
    }
  });

  it("uses textContent instead of innerText when clipping page text", () => {
    expect(readPageText.toString()).not.toContain("innerText");
    const removed: string[] = [];
    installDocument({
      querySelectorAll: () => [
        {
          remove: () => {
            removed.push("script");
          },
        },
      ],
      body: {
        textContent: "  Email   us at sales@example.com  ",
      },
    } as unknown as Document);

    try {
      expect(readPageText(15000)).toBe("Email us at sales@example.com");
      expect(readPageText(8)).toBe("Email us");
      expect(removed).toEqual(["script", "script"]);
    } finally {
      restoreDocument();
    }
  });
});

describe("contact extraction CDP budget", () => {
  it("captures a viewport jpeg instead of a full-page png", () => {
    const options = contactViewportScreenshotOptions();
    expect(options).toMatchObject({
      encoding: "base64",
      type: "jpeg",
      fullPage: false,
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    expect(options.quality).toBeGreaterThan(0);
    expect(options.quality).toBeLessThanOrEqual(100);
  });

  it("gives contact extraction a longer protocol timeout than Puppeteer's default", () => {
    expect(CONTACT_EXTRACTION_PROTOCOL_TIMEOUT_MS).toBeGreaterThan(
      PUPPETEER_DEFAULT_PROTOCOL_TIMEOUT_MS
    );
    expect(CONTACT_LINK_SCAN_LIMIT).toBeGreaterThan(CONTACT_LINK_TAIL);

    const discovery = readSource(
      "src/childprocess/contact-extraction/ContactDiscovery.ts"
    );
    expect(discovery).toContain("CONTACT_EXTRACTION_PROTOCOL_TIMEOUT_MS");
    expect(discovery).toContain("contactViewportScreenshotOptions()");
    expect(discovery).toContain("readContactLinkCandidates");
    expect(discovery).toContain("readPageText");
    expect(discovery).not.toContain("innerText");
    expect(discovery).not.toContain("offsetWidth");

    const browserManager = readSource("src/modules/browserManager.ts");
    expect(browserManager).toContain("finalizePuppeteerLaunchOptions");
  });
});
