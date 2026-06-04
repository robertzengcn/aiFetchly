export type MapScraperProvider = "google" | "yandex";

export interface MapScraperProviderMeta {
  value: MapScraperProvider;
  label: "Channel Alpha (Global)" | "Channel Beta (CIS Region)";
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
      label: "Channel Beta (CIS Region)",
      accountWhere: "Yandex",
      icon: "mdi-map-search-outline",
      filenamePrefix: "yandex-maps",
    };
  }

  return {
    value: "google",
    label: "Channel Alpha (Global)",
    accountWhere: "Google",
    icon: "mdi-map-marker-radius",
    filenamePrefix: "google-maps",
  };
}
