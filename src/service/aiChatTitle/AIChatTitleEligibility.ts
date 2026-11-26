import { normalizeText } from "./AIChatTitleText";

/**
 * Deterministic substantive-request detection (titles design §7.1).
 *
 * Deliberately NOT an English word-count rule: short CJK requests and brief
 * commands are meaningful. A greeting/acknowledgment phrase in any of the six
 * supported UI languages is skipped so naming waits for the real request.
 * This heuristic cannot perfectly understand every language — a missed
 * automatic title is always preferable to another classifier model call.
 */

/**
 * Exact greeting/acknowledgment phrases (case-insensitive, punctuation
 * stripped at the edges) across en/zh/es/fr/de/ja.
 */
const GREETING_PHRASES: ReadonlySet<string> = new Set([
  // English
  "hi", "hello", "hey", "hi there", "hello there",
  "thanks", "thank you", "thanks a lot", "thank you very much", "thx",
  "ok", "okay", "sure", "sounds good", "got it", "i see", "np",
  "no problem", "cool", "great", "nice", "yes", "no", "yeah", "nope",
  "please help", "good morning", "good afternoon", "good evening",
  // Chinese
  "你好", "您好", "嗨", "好的", "好啦", "好呀", "谢谢", "多谢", "谢谢你",
  "辛苦了", "请帮忙", "请帮助", "早上好", "下午好", "晚上好", "明白了",
  "知道了", "收到", "明白", "对", "是的", "不用了",
  // Spanish
  "hola", "gracias", "muchas gracias", "vale", "de acuerdo", "buenos días",
  "buenas tardes", "buenas noches", "perfecto", "entendido", "claro", "sí",
  // French
  "bonjour", "salut", "merci", "merci beaucoup", "d'accord", "bonsoir",
  "parfait", "compris", "bien sûr", "oui", "non",
  // German
  "hallo", "danke", "vielen dank", "guten morgen", "guten tag",
  "guten abend", "verstanden", "klar", "alles klar", "gerne", "ja", "nein",
  // Japanese
  "こんにちは", "こんばんは", "おはよう", "おはようございます", "ありがとう",
  "ありがとうございます", "お願いします", "よろしく",
  "よろしくお願いします", "わかりました", "了解", "了解です", "はい",
  "いいえ", "なるほど",
]);

/** Strip non letter/digit characters from both ends (keeps inner text). */
function stripEdgePunctuation(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/**
 * True when the user's visible typed text contains a substantive request.
 * Empty, whitespace-only, punctuation-only, emoji-only, and exact
 * greeting/acknowledgment phrases are not substantive.
 */
export function isSubstantiveRequest(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const bare = stripEdgePunctuation(normalized);
  // Punctuation/symbol/emoji-only input has no letters or digits left.
  if (!bare) return false;
  return !GREETING_PHRASES.has(bare.toLowerCase());
}
