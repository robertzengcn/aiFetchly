import type { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import type { YandexMapsSearchRecordEntity } from "@/entity/YandexMapsSearchRecord.entity";
import type { GoogleMapsBusinessResult } from "@/entityTypes/googleMapsTypes";
import type { YandexMapsBusinessResult } from "@/entityTypes/yandexMapsTypes";
import { isValidUrl } from "@/views/utils/function";

/**
 * Extract valid business `website` URLs from a Google Maps scraper record.
 * The record's `results` column is a JSON string of GoogleMapsBusinessResult[].
 * Returns [] for a null record, missing results, or malformed JSON.
 */
export function resolveGoogleMapsUrls(
  record: GoogleMapsSearchRecordEntity | null
): string[] {
  if (!record?.results) return [];
  let businesses: GoogleMapsBusinessResult[] = [];
  try {
    businesses = JSON.parse(record.results) as GoogleMapsBusinessResult[];
  } catch {
    return [];
  }
  return businesses
    .map((b) => (b.website ?? "").trim())
    .filter((url) => isValidUrl(url));
}

/**
 * Extract valid business `website` URLs from a Yandex Maps scraper record.
 * The record's `results` column is a JSON string of YandexMapsBusinessResult[].
 * Returns [] for a null record, missing results, or malformed JSON.
 */
export function resolveYandexMapsUrls(
  record: YandexMapsSearchRecordEntity | null
): string[] {
  if (!record?.results) return [];
  let businesses: YandexMapsBusinessResult[] = [];
  try {
    businesses = JSON.parse(record.results) as YandexMapsBusinessResult[];
  } catch {
    return [];
  }
  return businesses
    .map((b) => (b.website ?? "").trim())
    .filter((url) => isValidUrl(url));
}
