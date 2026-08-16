import { beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const cookieMock = vi.hoisted(() => ({
  get: vi.fn<() => string | undefined>(),
  set: vi.fn<
    (key: string, value: string, options: { expires: number }) => void
  >(),
}));

const languageApiMock = vi.hoisted(() => ({
  getLanguagePreference: vi.fn<() => Promise<string>>(),
}));

vi.mock("js-cookie", () => ({
  default: cookieMock,
}));

vi.mock("@/views/api/language", () => ({
  getLanguagePreference: languageApiMock.getLanguagePreference,
}));

import { getLanguage, setLanguage } from "@/views/utils/cookies";
import { loadLanguagePreference } from "@/views/utils/languageLoader";

describe("language preference persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { language: "zh-CN" },
      configurable: true,
    });
  });

  it("stores the selected language in persistent localStorage as well as cookies", () => {
    setLanguage("en");

    expect(cookieMock.set).toHaveBeenCalledWith("language", "en", {
      expires: 365,
    });
    expect(localStorage.getItem("language")).toBe("en");
  });

  it("keeps the selected language after session cookies are gone", () => {
    localStorage.setItem("language", "en");
    cookieMock.get.mockReturnValue(undefined);

    expect(getLanguage()).toBe("en");
  });

  it("prefers the durable language marker over a stale cookie", () => {
    localStorage.setItem("language", "en");
    cookieMock.get.mockReturnValue("zh");

    expect(getLanguage()).toBe("en");
  });

  it("treats saved English as an explicit preference over Chinese browser language", async () => {
    languageApiMock.getLanguagePreference.mockResolvedValue("en");
    cookieMock.get.mockReturnValue(undefined);

    const result = await loadLanguagePreference();

    expect(result).toEqual({
      language: "en",
      source: "system_settings",
      success: true,
    });
  });
});
