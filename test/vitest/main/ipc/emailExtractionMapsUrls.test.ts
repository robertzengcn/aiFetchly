import { describe, expect, test } from "vitest";
import {
  resolveGoogleMapsUrls,
  resolveYandexMapsUrls,
} from "@/main-process/communication/emailExtractionMapsUrls";
import type { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import type { YandexMapsSearchRecordEntity } from "@/entity/YandexMapsSearchRecord.entity";

function makeGoogleRecord(results: string): GoogleMapsSearchRecordEntity {
  return {
    id: 1,
    query: "dentist",
    location: "New York",
    status: "completed",
    totalResults: 0,
    summary: "",
    results,
  } as GoogleMapsSearchRecordEntity;
}

function makeYandexRecord(results: string): YandexMapsSearchRecordEntity {
  return {
    id: 1,
    query: "dentist",
    location: "Moscow",
    status: "completed",
    totalResults: 0,
    summary: "",
    results,
  } as YandexMapsSearchRecordEntity;
}

describe("resolveGoogleMapsUrls", () => {
  test("extracts and trims valid website URLs, drops invalid/missing", () => {
    const record = makeGoogleRecord(
      JSON.stringify([
        { name: "A", website: " https://a-example.com " },
        { name: "B", website: "https://b-example.org/about" },
        { name: "C", website: "not-a-url" },
        { name: "D" },
      ])
    );
    expect(resolveGoogleMapsUrls(record)).toEqual([
      "https://a-example.com",
      "https://b-example.org/about",
    ]);
  });

  test("returns empty array when record is null", () => {
    expect(resolveGoogleMapsUrls(null)).toEqual([]);
  });

  test("returns empty array when results JSON is malformed", () => {
    expect(resolveGoogleMapsUrls(makeGoogleRecord("{not json"))).toEqual([]);
  });

  test("returns empty array when results is an empty array", () => {
    expect(resolveGoogleMapsUrls(makeGoogleRecord("[]"))).toEqual([]);
  });
});

describe("resolveYandexMapsUrls", () => {
  test("extracts valid website URLs, drops invalid/missing", () => {
    const record = makeYandexRecord(
      JSON.stringify([
        { name: "A", website: "https://a-example.com" },
        { name: "B", website: "no-protocol" },
        { name: "C" },
      ])
    );
    expect(resolveYandexMapsUrls(record)).toEqual(["https://a-example.com"]);
  });

  test("returns empty array when record is null", () => {
    expect(resolveYandexMapsUrls(null)).toEqual([]);
  });

  test("returns empty array when results JSON is malformed", () => {
    expect(resolveYandexMapsUrls(makeYandexRecord("{bad"))).toEqual([]);
  });
});
