import type {
  ChatV2GeneratedImage,
  ChatV2GeneratedImageReference,
  ChatV2MessageView,
} from "@/entityTypes/aiChatV2Types";
import type { GeneratedImageReferenceView } from "./generatedImageReferenceView";

export type InferenceLanguageCode = "en" | "zh" | "es" | "fr" | "de" | "ja";

export type GeneratedImageInferenceResult =
  | { readonly kind: "none" }
  | {
      readonly kind: "resolved";
      readonly references: readonly ChatV2GeneratedImageReference[];
    }
  | {
      readonly kind: "ambiguous";
      readonly candidates: readonly GeneratedImageReferenceView[];
    }
  | {
      readonly kind: "batch_confirmation";
      readonly references: readonly ChatV2GeneratedImageReference[];
    };

export interface GeneratedImageReferenceInferenceInput {
  readonly text: string;
  readonly messages: ReadonlyArray<
    Pick<ChatV2MessageView, "id" | "role" | "metadata">
  >;
  readonly explicitSelection: readonly ChatV2GeneratedImageReference[];
  readonly directLimit?: number;
}

export const SINGULAR_PHRASES: Record<InferenceLanguageCode, RegExp> = {
  en: /\b(the|this|that)\s+(image|picture|photo|pic)\b|\bit\b/i,
  zh: /这[张个]图[像片]?|这张照片/,
  es: /\b(la|esta|esa)\s+(imagen|foto)\b/,
  fr: /\b(l'|cette)\s*(image|photo)/,
  de: /\b(das|dieses)\s+(Bild|Foto)\b/,
  ja: /この画像|その画像/,
};

export const NUMBERED_PHRASES: Record<InferenceLanguageCode, RegExp> = {
  en: /image\s*#?\s*(\d+)/gi,
  zh: /第\s*(\d+)\s*[张張个個图像片]|(?:画像|圖像|图片|圖片|图|圖)\s*(\d+)/g,
  es: /imagen\s*#?\s*(\d+)/gi,
  fr: /image\s*#?\s*(\d+)/gi,
  de: /(?:bild|foto)\s*#?\s*(\d+)/gi,
  ja: /(\d+)\s*番目の画像|画像\s*(\d+)/g,
};

export const PLURAL_ALL_PHRASES: Record<InferenceLanguageCode, RegExp> = {
  en: /\b(both|all of them|all)\b/i,
  zh: /全部|都|两张都|三张都/,
  es: /\b(todas|ambas)\b/,
  fr: /\b(toutes?|les deux)\b/,
  de: /\b(alle|beide)\b/,
  ja: /全部|すべて|両方/,
};

export const FUSION_PHRASES: Record<InferenceLanguageCode, RegExp> = {
  en: /\b(combine|merge|blend|fuse)\b/i,
  zh: /融合|合并|合成/,
  es: /\b(combinar|fusionar)\b/,
  fr: /\b(combiner|fusionner)\b/,
  de: /\b(kombinieren|verschmelzen)\b/,
  ja: /組み合わせ|融合|合成/,
};

const LANGUAGE_CODES: readonly InferenceLanguageCode[] = [
  "en",
  "zh",
  "es",
  "fr",
  "de",
  "ja",
];

const DEFAULT_DIRECT_LIMIT = 3;

interface LatestGenerationGroup {
  readonly messageId: string;
  readonly images: ReadonlyArray<ChatV2GeneratedImage>;
}

function resetRegex(regex: RegExp): void {
  regex.lastIndex = 0;
}

function matchesAnyPhrase(
  table: Record<InferenceLanguageCode, RegExp>,
  text: string
): boolean {
  return LANGUAGE_CODES.some((code) => {
    const regex = table[code];
    resetRegex(regex);
    return regex.test(text);
  });
}

function firstCapturedNumber(match: RegExpExecArray): number | undefined {
  for (let groupIndex = 1; groupIndex < match.length; groupIndex += 1) {
    const value = match[groupIndex];
    if (value === undefined) continue;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function extractMentionedNumbers(text: string): number[] {
  const numbers: number[] = [];
  for (const code of LANGUAGE_CODES) {
    const regex = NUMBERED_PHRASES[code];
    resetRegex(regex);
    let match: RegExpExecArray | null = regex.exec(text);
    while (match !== null) {
      const parsed = firstCapturedNumber(match);
      if (parsed !== undefined) numbers.push(parsed);
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
      match = regex.exec(text);
    }
    resetRegex(regex);
  }
  return numbers;
}

function dedupeInOrder(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function findLatestGenerationGroup(
  messages: ReadonlyArray<Pick<ChatV2MessageView, "id" | "role" | "metadata">>
): LatestGenerationGroup | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const images = message.metadata?.generatedImages;
    if (Array.isArray(images) && images.length > 0) {
      return { messageId: message.id, images };
    }
  }
  return undefined;
}

function buildCandidates(
  group: LatestGenerationGroup
): GeneratedImageReferenceView[] {
  const candidates: GeneratedImageReferenceView[] = [];
  group.images.forEach((image: ChatV2GeneratedImage, imageIndex: number) => {
    const reference: ChatV2GeneratedImageReference = {
      messageId: group.messageId,
      imageIndex,
    };
    if (typeof image.file_name === "string" && image.file_name.length > 0) {
      candidates.push({ reference, fileName: image.file_name });
    } else {
      candidates.push({ reference });
    }
  });
  return candidates;
}

function buildReferences(
  group: LatestGenerationGroup,
  imageIndexes: readonly number[]
): ChatV2GeneratedImageReference[] {
  return imageIndexes.map((imageIndex) => ({
    messageId: group.messageId,
    imageIndex,
  }));
}

function wholeGroupIndexes(group: LatestGenerationGroup): number[] {
  const indexes: number[] = [];
  for (let imageIndex = 0; imageIndex < group.images.length; imageIndex += 1) {
    indexes.push(imageIndex);
  }
  return indexes;
}

export function isFusionWording(text: string): boolean {
  return matchesAnyPhrase(FUSION_PHRASES, text);
}

export function inferGeneratedImageReferences(
  input: GeneratedImageReferenceInferenceInput
): GeneratedImageInferenceResult {
  if (input.explicitSelection.length > 0) {
    return { kind: "resolved", references: input.explicitSelection };
  }

  const group = findLatestGenerationGroup(input.messages);
  if (group === undefined) {
    return { kind: "none" };
  }

  const directLimit = input.directLimit ?? DEFAULT_DIRECT_LIMIT;

  const mentionedNumbers = dedupeInOrder(extractMentionedNumbers(input.text));
  const referencedIndexes: number[] = [];
  for (const mentioned of mentionedNumbers) {
    const imageIndex = mentioned - 1;
    if (imageIndex >= 0 && imageIndex < group.images.length) {
      referencedIndexes.push(imageIndex);
    }
  }
  if (referencedIndexes.length > 0) {
    if (referencedIndexes.length > directLimit) {
      return {
        kind: "batch_confirmation",
        references: buildReferences(group, referencedIndexes),
      };
    }
    return { kind: "resolved", references: buildReferences(group, referencedIndexes) };
  }

  if (matchesAnyPhrase(SINGULAR_PHRASES, input.text)) {
    if (group.images.length === 1) {
      return {
        kind: "resolved",
        references: [{ messageId: group.messageId, imageIndex: 0 }],
      };
    }
    return { kind: "ambiguous", candidates: buildCandidates(group) };
  }

  if (matchesAnyPhrase(PLURAL_ALL_PHRASES, input.text)) {
    const indexes = wholeGroupIndexes(group);
    if (indexes.length > directLimit) {
      return {
        kind: "batch_confirmation",
        references: buildReferences(group, indexes),
      };
    }
    return { kind: "resolved", references: buildReferences(group, indexes) };
  }

  return { kind: "none" };
}
