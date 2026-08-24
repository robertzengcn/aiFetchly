import { describe, expect, it } from "vitest";
import type {
  ChatV2GeneratedImage,
  ChatV2MessageView,
} from "@/entityTypes/aiChatV2Types";
import {
  FUSION_PHRASES,
  NUMBERED_PHRASES,
  PLURAL_ALL_PHRASES,
  SINGULAR_PHRASES,
  inferGeneratedImageReferences,
  isFusionWording,
  type InferenceLanguageCode,
} from "@/views/components/aiChatV2/generatedImageReferenceInference";

type MessageFixture = Pick<ChatV2MessageView, "id" | "role" | "metadata">;

const LANGUAGE_CODES: readonly InferenceLanguageCode[] = [
  "en",
  "zh",
  "es",
  "fr",
  "de",
  "ja",
];

function makeImage(fileName?: string): ChatV2GeneratedImage {
  return fileName === undefined
    ? { type: "image" }
    : { type: "image", file_name: fileName };
}

function assistantWithImages(id: string, images: ChatV2GeneratedImage[]): MessageFixture {
  return { id, role: "assistant", metadata: { source: "chat-v2", generatedImages: images } };
}

function userMessage(id: string): MessageFixture {
  return { id, role: "user" };
}

function oneImageMessages(): MessageFixture[] {
  return [assistantWithImages("assistant-1", [makeImage("solo.png")]), userMessage("user-1")];
}

function threeImageMessages(): MessageFixture[] {
  return [
    assistantWithImages("assistant-1", [
      makeImage("alpha.png"),
      makeImage("beta.png"),
      makeImage(),
    ]),
    userMessage("user-1"),
  ];
}

function sixImageMessages(): MessageFixture[] {
  return [
    assistantWithImages("gen6", [
      makeImage(),
      makeImage(),
      makeImage(),
      makeImage(),
      makeImage(),
      makeImage(),
    ]),
    userMessage("user-1"),
  ];
}

describe("generatedImageReferenceInference - explicit selection", () => {
  it("explicit selection wins even with contradictory reference text", () => {
    const result = inferGeneratedImageReferences({
      text: "actually change this image instead",
      messages: threeImageMessages(),
      explicitSelection: [{ messageId: "assistant-1", imageIndex: 2 }],
    });
    expect(result).toEqual({
      kind: "resolved",
      references: [{ messageId: "assistant-1", imageIndex: 2 }],
    });
  });
});

describe("generatedImageReferenceInference - singular phrases", () => {
  it("resolves the single group image for a singular phrase", () => {
    const result = inferGeneratedImageReferences({
      text: "can you sharpen this photo?",
      messages: oneImageMessages(),
      explicitSelection: [],
    });
    expect(result).toEqual({
      kind: "resolved",
      references: [{ messageId: "assistant-1", imageIndex: 0 }],
    });
  });

  it("returns ambiguous candidates for a multi-image group", () => {
    const result = inferGeneratedImageReferences({
      text: "make this image brighter",
      messages: threeImageMessages(),
      explicitSelection: [],
    });
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.candidates).toEqual([
      { reference: { messageId: "assistant-1", imageIndex: 0 }, fileName: "alpha.png" },
      { reference: { messageId: "assistant-1", imageIndex: 1 }, fileName: "beta.png" },
      { reference: { messageId: "assistant-1", imageIndex: 2 } },
    ]);
  });
});

describe("generatedImageReferenceInference - numbered phrases", () => {
  it("resolves mentioned indices in mention order", () => {
    const result = inferGeneratedImageReferences({
      text: "please fix image 3 then image 1",
      messages: threeImageMessages(),
      explicitSelection: [],
    });
    expect(result).toEqual({
      kind: "resolved",
      references: [
        { messageId: "assistant-1", imageIndex: 2 },
        { messageId: "assistant-1", imageIndex: 0 },
      ],
    });
  });

  it("dedupes repeated mentions while keeping order", () => {
    const result = inferGeneratedImageReferences({
      text: "edit image 2, then image 2 again, then image 1",
      messages: threeImageMessages(),
      explicitSelection: [],
    });
    expect(result).toEqual({
      kind: "resolved",
      references: [
        { messageId: "assistant-1", imageIndex: 1 },
        { messageId: "assistant-1", imageIndex: 0 },
      ],
    });
  });

  it("requires batch confirmation when more than directLimit distinct indices", () => {
    const result = inferGeneratedImageReferences({
      text: "redo image 1, image 2, image 3, and image 4",
      messages: sixImageMessages(),
      explicitSelection: [],
    });
    expect(result).toEqual({
      kind: "batch_confirmation",
      references: [
        { messageId: "gen6", imageIndex: 0 },
        { messageId: "gen6", imageIndex: 1 },
        { messageId: "gen6", imageIndex: 2 },
        { messageId: "gen6", imageIndex: 3 },
      ],
    });
  });

  it("ignores invalid indices that fall outside the group", () => {
    const result = inferGeneratedImageReferences({
      text: "what about image 9?",
      messages: threeImageMessages(),
      explicitSelection: [],
    });
    expect(result).toEqual({ kind: "none" });
  });

  it("honors a custom directLimit", () => {
    const result = inferGeneratedImageReferences({
      text: "redo image 1 and image 2",
      messages: threeImageMessages(),
      explicitSelection: [],
      directLimit: 1,
    });
    expect(result.kind).toBe("batch_confirmation");
  });
});

describe("generatedImageReferenceInference - plural all phrases", () => {
  it("resolves the whole bounded group in display order", () => {
    const result = inferGeneratedImageReferences({
      text: "enhance all of them",
      messages: [
        assistantWithImages("gen2", [makeImage(), makeImage()]),
        userMessage("user-1"),
      ],
      explicitSelection: [],
    });
    expect(result).toEqual({
      kind: "resolved",
      references: [
        { messageId: "gen2", imageIndex: 0 },
        { messageId: "gen2", imageIndex: 1 },
      ],
    });
  });

  it("requires batch confirmation when the whole group exceeds directLimit", () => {
    const result = inferGeneratedImageReferences({
      text: "process all of them now",
      messages: sixImageMessages(),
      explicitSelection: [],
    });
    expect(result.kind).toBe("batch_confirmation");
    if (result.kind !== "batch_confirmation") return;
    expect(result.references).toHaveLength(6);
    expect(result.references[5]).toEqual({ messageId: "gen6", imageIndex: 5 });
  });
});

describe("generatedImageReferenceInference - no match", () => {
  it("returns none when there are no generated images", () => {
    const result = inferGeneratedImageReferences({
      text: "edit this image",
      messages: [userMessage("u"), assistantWithImages("a", [])],
      explicitSelection: [],
    });
    expect(result).toEqual({ kind: "none" });
  });

  it("returns none when text has no matching phrasing", () => {
    const result = inferGeneratedImageReferences({
      text: "hello there friend",
      messages: threeImageMessages(),
      explicitSelection: [],
    });
    expect(result).toEqual({ kind: "none" });
  });
});

const SINGULAR_FIXTURES: Record<InferenceLanguageCode, string> = {
  en: "refine this picture",
  zh: "把这张图换成夜景",
  es: "mejora la imagen por favor",
  fr: "retouche cette image",
  de: "verbessere das Bild",
  ja: "この画像を明るくして",
};

const NUMBERED_FIXTURES: Record<InferenceLanguageCode, string> = {
  en: "fix image 2 please",
  zh: "改一下第2张",
  es: "cambia imagen 2",
  fr: "change image 2",
  de: "ändere bild 2",
  ja: "2番目の画像を直して",
};

const PLURAL_FIXTURES: Record<InferenceLanguageCode, string> = {
  en: "use all of them",
  zh: "两张都保留",
  es: "mejora ambas fotos",
  fr: "garde les deux versions",
  de: "nutze beide bilder weiter",
  ja: "両方とも残して",
};

const FUSION_FIXTURES: Record<InferenceLanguageCode, string> = {
  en: "combine these two shots",
  zh: "把这两张融合起来",
  es: "quiero combinar las dos fotos",
  fr: "je voudrais fusionner les deux photos",
  de: "ich möchte beide bilder kombinieren",
  ja: "二枚の画像を組み合わせたい",
};

describe("generatedImageReferenceInference - language phrase tables", () => {
  it("every table covers all six languages", () => {
    const tables = [
      SINGULAR_PHRASES,
      NUMBERED_PHRASES,
      PLURAL_ALL_PHRASES,
      FUSION_PHRASES,
    ];
    for (const table of tables) {
      expect(Object.keys(table).sort()).toEqual([...LANGUAGE_CODES].sort());
    }
  });

  it.each(LANGUAGE_CODES)("singular table matches fixture for %s", (code) => {
    expect(SINGULAR_PHRASES[code].test(SINGULAR_FIXTURES[code])).toBe(true);
  });

  it.each(LANGUAGE_CODES)("numbered table matches fixture for %s", (code) => {
    expect(NUMBERED_PHRASES[code].test(NUMBERED_FIXTURES[code])).toBe(true);
  });

  it.each(LANGUAGE_CODES)("plural-all table matches fixture for %s", (code) => {
    expect(PLURAL_ALL_PHRASES[code].test(PLURAL_FIXTURES[code])).toBe(true);
  });

  it.each(LANGUAGE_CODES)("fusion table matches fixture for %s", (code) => {
    expect(FUSION_PHRASES[code].test(FUSION_FIXTURES[code])).toBe(true);
  });
});

describe("generatedImageReferenceInference - isFusionWording", () => {
  it.each(LANGUAGE_CODES)("detects fusion wording in %s", (code) => {
    expect(isFusionWording(FUSION_FIXTURES[code])).toBe(true);
  });

  it("rejects neutral text without fusion verbs", () => {
    expect(isFusionWording("tell me about marketing trends today")).toBe(false);
    expect(isFusionWording("sharpen the picture")).toBe(false);
  });
});
