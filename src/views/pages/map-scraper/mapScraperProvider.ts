export type MapScraperProvider = "google" | "yandex";

export interface MapScraperProviderMeta {
  value: MapScraperProvider;
  label: "Google Maps" | "Yandex Maps";
  accountWhere: "Google" | "Yandex";
  icon: string;
  filenamePrefix: string;
}

export function normalizeMapScraperProvider(
  provider: unknown
): MapScraperProvider {
  return provider === "yandex" ? "yandex" : "google";
}

export function getMapScraperProviderMeta(
  provider: MapScraperProvider
): MapScraperProviderMeta {
  if (provider === "yandex") {
    return {
      value: "yandex",
      label: "Yandex Maps",
      accountWhere: "Yandex",
      icon: "mdi-map-search-outline",
      filenamePrefix: "yandex-maps",
    };
  }

  return {
    value: "google",
    label: "Google Maps",
    accountWhere: "Google",
    icon: "mdi-map-marker-radius",
    filenamePrefix: "google-maps",
  };
}
