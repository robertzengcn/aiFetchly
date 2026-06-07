"use strict";
import { describe, expect, test } from "vitest";
import {
  buildEmailResultDisplay,
  buildEmailSearchResultEntity,
} from "@/modules/emailSearchResultMapper";
import { EmailSearchResultEntity } from "@/entity/EmailSearchResult.entity";

describe("emailSearchResultMapper", () => {
  test("maps AI enrichment into result entity fields", () => {
    const entity = buildEmailSearchResultEntity(42, {
      url: "https://example.com/contact",
      pageTitle: "Contact Example",
      filteredLinks: [],
      emails: [],
      aiEnrichment: {
        phone: "+1 555 123 4567",
        address: "123 Main St",
        socialLinks: ["https://linkedin.com/company/example"],
        status: "completed",
        confidence: 0.91,
      },
    });

    expect(entity.task_id).toBe(42);
    expect(entity.url).toBe("example.com");
    expect(entity.title).toBe("Contact Example");
    expect(entity.phone).toBe("+1 555 123 4567");
    expect(entity.address).toBe("123 Main St");
    expect(entity.socialLinks).toBe(
      JSON.stringify(["https://linkedin.com/company/example"])
    );
    expect(entity.aiEnrichmentStatus).toBe("completed");
    expect(entity.aiConfidence).toBe(0.91);
  });

  test("maps stored AI enrichment fields into result display", () => {
    const entity = new EmailSearchResultEntity();
    entity.id = 7;
    entity.task_id = 42;
    entity.url = "example.com";
    entity.title = "Contact Example";
    entity.phone = "+1 555 123 4567";
    entity.address = "123 Main St";
    entity.socialLinks = JSON.stringify([
      "https://linkedin.com/company/example",
    ]);
    entity.aiEnrichmentStatus = "completed";
    entity.aiConfidence = 0.91;
    entity.createdAt = new Date("2026-06-07T10:20:30Z");

    const display = buildEmailResultDisplay(entity, ["hello@example.com"], {
      formatDateTime: () => "06/07/2026, 10:20:30 AM",
    });

    expect(display.id).toBe(7);
    expect(display.emails).toEqual(["hello@example.com"]);
    expect(display.phone).toBe("+1 555 123 4567");
    expect(display.address).toBe("123 Main St");
    expect(display.socialLinks).toEqual([
      "https://linkedin.com/company/example",
    ]);
    expect(display.aiEnrichmentStatus).toBe("completed");
    expect(display.aiConfidence).toBe(0.91);
  });
});
