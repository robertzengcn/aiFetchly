import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemSettingGroupDisplay } from "@/entityTypes/systemsettingType";
import { ui_chat_font_size, ui_font_scale } from "@/config/settinggroupInit";
import { getSystemSettinglist } from "@/views/api/systemsetting";
import { initializeSavedFontScale } from "@/views/utils/initializeFontScale";
import {
  applyUiChatFontSize,
  applyUiFontScale,
  getAppliedUiChatFontSize,
  getAppliedUiFontScale,
  normalizeUiChatFontSize,
  normalizeUiFontScale,
  parseUiChatFontSizeInput,
  stepUiFontScale,
  writeStoredUiChatFontSize,
  writeStoredUiFontScale,
} from "@/views/utils/fontScale";

vi.mock("@/views/api/systemsetting", () => ({
  getSystemSettinglist: vi.fn(),
  updateSystemSetting: vi.fn(),
  updateSystemSettingWithValidation: vi.fn(),
}));

function fontGroup(value: string): SystemSettingGroupDisplay[] {
  return [
    {
      id: 1,
      name: "user_preferences",
      items: [
        {
          id: 2,
          key: ui_font_scale,
          value,
          type: "stepper",
        },
      ],
    },
  ];
}

describe("ui font scale", () => {
  const memoryStorage = new Map<string, string>();

  beforeEach(() => {
    memoryStorage.clear();
    vi.stubGlobal("localStorage", {
      get length(): number {
        return memoryStorage.size;
      },
      clear(): void {
        memoryStorage.clear();
      },
      getItem(key: string): string | null {
        return memoryStorage.get(key) ?? null;
      },
      key(index: number): string | null {
        return [...memoryStorage.keys()][index] ?? null;
      },
      removeItem(key: string): void {
        memoryStorage.delete(key);
      },
      setItem(key: string, value: string): void {
        memoryStorage.set(key, value);
      },
    });
    vi.clearAllMocks();
    applyUiFontScale("1");
    applyUiChatFontSize("14");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes unknown values to the default step", () => {
    expect(normalizeUiFontScale(null)).toBe("1");
    expect(normalizeUiFontScale("2")).toBe("1");
    expect(normalizeUiFontScale("1.25")).toBe("1.25");
  });

  it("stops at the ends of the step list", () => {
    expect(stepUiFontScale("0.875", -1)).toBe("0.875");
    expect(stepUiFontScale("1.5", 1)).toBe("1.5");
    expect(stepUiFontScale("1", 1)).toBe("1.125");
    expect(stepUiFontScale("1", -1)).toBe("0.875");
  });

  it("applies the signed-in user's saved scale", async () => {
    vi.mocked(getSystemSettinglist).mockResolvedValue(fontGroup("1.5"));

    await initializeSavedFontScale();

    expect(getAppliedUiFontScale()).toBe("1.5");
  });

  it("keeps a newer local change when the settings read finishes late", async () => {
    let release: (groups: SystemSettingGroupDisplay[]) => void = () => {
      throw new Error("settings read was not released");
    };
    vi.mocked(getSystemSettinglist).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );

    const pending = initializeSavedFontScale();
    writeStoredUiFontScale("1.25");
    release(fontGroup("1"));
    await pending;

    expect(getAppliedUiFontScale()).toBe("1.25");
  });

  it("keeps the stored scale when settings cannot be loaded", async () => {
    writeStoredUiFontScale("1.125");
    vi.mocked(getSystemSettinglist).mockRejectedValue(new Error("no database"));

    await initializeSavedFontScale();

    expect(getAppliedUiFontScale()).toBe("1.125");
  });
});

describe("ui chat font size", () => {
  const memoryStorage = new Map<string, string>();

  beforeEach(() => {
    memoryStorage.clear();
    vi.stubGlobal("localStorage", {
      get length(): number {
        return memoryStorage.size;
      },
      clear(): void {
        memoryStorage.clear();
      },
      getItem(key: string): string | null {
        return memoryStorage.get(key) ?? null;
      },
      key(index: number): string | null {
        return [...memoryStorage.keys()][index] ?? null;
      },
      removeItem(key: string): void {
        memoryStorage.delete(key);
      },
      setItem(key: string, value: string): void {
        memoryStorage.set(key, value);
      },
    });
    vi.clearAllMocks();
    applyUiChatFontSize("14");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts whole pixels from 10 to 32 and rejects everything else", () => {
    expect(parseUiChatFontSizeInput("18")).toBe(18);
    expect(parseUiChatFontSizeInput("10")).toBe(10);
    expect(parseUiChatFontSizeInput("32")).toBe(32);
    expect(parseUiChatFontSizeInput("9")).toBeNull();
    expect(parseUiChatFontSizeInput("33")).toBeNull();
    expect(parseUiChatFontSizeInput("14.5")).toBeNull();
    expect(parseUiChatFontSizeInput("abc")).toBeNull();
    expect(parseUiChatFontSizeInput("")).toBeNull();
    expect(normalizeUiChatFontSize("nope")).toBe(14);
  });

  it("applies a saved chat size without changing the layout scale", async () => {
    vi.mocked(getSystemSettinglist).mockResolvedValue([
      {
        id: 1,
        name: "user_preferences",
        items: [
          {
            id: 2,
            key: ui_font_scale,
            value: "1.25",
            type: "stepper",
          },
          {
            id: 3,
            key: ui_chat_font_size,
            value: "20",
            type: "number",
          },
        ],
      },
    ]);

    await initializeSavedFontScale();

    expect(getAppliedUiFontScale()).toBe("1.25");
    expect(getAppliedUiChatFontSize()).toBe(20);
    expect(memoryStorage.get("aifetchly.ui_chat_font_size")).toBe("20");
  });

  it("keeps a newer chat size when the settings read finishes late", async () => {
    let release: (groups: SystemSettingGroupDisplay[]) => void = () => {
      throw new Error("settings read was not released");
    };
    vi.mocked(getSystemSettinglist).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );

    const pending = initializeSavedFontScale();
    writeStoredUiChatFontSize("22");
    release([
      {
        id: 1,
        name: "user_preferences",
        items: [
          {
            id: 3,
            key: ui_chat_font_size,
            value: "14",
            type: "number",
          },
        ],
      },
    ]);
    await pending;

    expect(getAppliedUiChatFontSize()).toBe(22);
  });
});
