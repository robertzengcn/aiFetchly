import { describe, expect, test } from "vitest";
import {
  EmailExtractionTypes,
  emailExtractionTypeName,
  extratypeToEnum,
} from "@/config/emailextraction";

describe("emailExtractionTypeName", () => {
  test("returns the name for every enum value", () => {
    expect(emailExtractionTypeName(EmailExtractionTypes.ManualInputUrl)).toBe("ManualInputUrl");
    expect(emailExtractionTypeName(EmailExtractionTypes.SearchResult)).toBe("SearchResult");
    expect(emailExtractionTypeName(EmailExtractionTypes.GoogleMaps)).toBe("GoogleMaps");
    expect(emailExtractionTypeName(EmailExtractionTypes.YandexMaps)).toBe("YandexMaps");
  });

  test("returns Unknown for an out-of-range value", () => {
    expect(emailExtractionTypeName(999 as EmailExtractionTypes)).toBe("Unknown");
  });
});

describe("extratypeToEnum", () => {
  test("maps each extratype name to its enum value", () => {
    expect(extratypeToEnum("ManualInputUrl")).toBe(EmailExtractionTypes.ManualInputUrl);
    expect(extratypeToEnum("SearchResult")).toBe(EmailExtractionTypes.SearchResult);
    expect(extratypeToEnum("GoogleMaps")).toBe(EmailExtractionTypes.GoogleMaps);
    expect(extratypeToEnum("YandexMaps")).toBe(EmailExtractionTypes.YandexMaps);
  });

  test("falls back to ManualInputUrl for an unknown name", () => {
    expect(extratypeToEnum("Nope")).toBe(EmailExtractionTypes.ManualInputUrl);
  });
});
