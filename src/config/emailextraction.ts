export enum EmailExtractionTypes {
  ManualInputUrl = 1,
  SearchResult = 2,
  GoogleMaps = 3,
  YandexMaps = 4,
}

/**
 * Human-readable name for an extraction type id (stored in emailsearch_task.type_id).
 * Uses the enum's reverse mapping; returns "Unknown" for out-of-range values.
 * Pure — safe to call without a database connection (used by emailsearchTaskdb.convertType).
 */
export function emailExtractionTypeName(type: EmailExtractionTypes): string {
  return EmailExtractionTypes[type] ?? "Unknown";
}

/**
 * Convert a frontend extratype name string (the enum key) back to its numeric value.
 * Falls back to ManualInputUrl for unknown names.
 */
export function extratypeToEnum(extratype: string): EmailExtractionTypes {
  const value = EmailExtractionTypes[extratype as keyof typeof EmailExtractionTypes];
  return typeof value === "number"
    ? (value as EmailExtractionTypes)
    : EmailExtractionTypes.ManualInputUrl;
}
