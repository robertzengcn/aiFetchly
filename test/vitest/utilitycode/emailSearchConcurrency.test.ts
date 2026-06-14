import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_SEARCH_CONCURRENCY,
  MAX_EMAIL_SEARCH_CONCURRENCY,
  normalizeEmailSearchConcurrency,
} from "@/childprocess/emailSearch";
import { shouldBlockEmailSearchResource } from "@/childprocess/emailScraper";

describe("email search concurrency", () => {
  it("uses a parallel default when no concurrency is provided", () => {
    expect(normalizeEmailSearchConcurrency(undefined)).toBe(
      DEFAULT_EMAIL_SEARCH_CONCURRENCY
    );
  });

  it("parses numeric strings from the renderer form", () => {
    expect(normalizeEmailSearchConcurrency("4")).toBe(4);
  });

  it("caps browser workers to the supported maximum", () => {
    expect(normalizeEmailSearchConcurrency(99)).toBe(
      MAX_EMAIL_SEARCH_CONCURRENCY
    );
  });

  it("keeps an explicit single-worker setting valid", () => {
    expect(normalizeEmailSearchConcurrency(1)).toBe(1);
  });
});

describe("email search asset blocking", () => {
  it("blocks heavy page assets that are not needed for email extraction", () => {
    expect(shouldBlockEmailSearchResource("image")).toBe(true);
    expect(shouldBlockEmailSearchResource("stylesheet")).toBe(true);
    expect(shouldBlockEmailSearchResource("font")).toBe(true);
    expect(shouldBlockEmailSearchResource("media")).toBe(true);
  });

  it("keeps documents and scripts available for pages that render links dynamically", () => {
    expect(shouldBlockEmailSearchResource("document")).toBe(false);
    expect(shouldBlockEmailSearchResource("script")).toBe(false);
    expect(shouldBlockEmailSearchResource("xhr")).toBe(false);
  });
});
