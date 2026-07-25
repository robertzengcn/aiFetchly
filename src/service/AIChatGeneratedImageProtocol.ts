import path from "path";

export const AI_CHAT_GENERATED_IMAGE_PROTOCOL = "aifetchly-generated-image";
export const AI_CHAT_GENERATED_IMAGE_HOST = "local";
export const AI_CHAT_GENERATED_IMAGE_DIR = "ai-chat-generated-images";
const UNKNOWN_GENERATED_IMAGE_USER = "unknown-user";

export function getGeneratedImageRoot(userDataPath: string): string {
  return path.join(userDataPath, AI_CHAT_GENERATED_IMAGE_DIR);
}

export function normalizeGeneratedImageUserEmail(email: string): string {
  return (
    email
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._@+-]/g, "_")
      .slice(0, 160) || UNKNOWN_GENERATED_IMAGE_USER
  );
}

export function getGeneratedImageUserRoot(
  userDataPath: string,
  userEmail: string
): string {
  return path.join(
    getGeneratedImageRoot(userDataPath),
    normalizeGeneratedImageUserEmail(userEmail)
  );
}

export function buildGeneratedImageProtocolUrl(parts: {
  userEmail: string;
  conversationId: string;
  messageId: string;
  fileName: string;
}): string {
  const userEmail = encodeURIComponent(
    normalizeGeneratedImageUserEmail(parts.userEmail)
  );
  const conversationId = encodeURIComponent(parts.conversationId);
  const messageId = encodeURIComponent(parts.messageId);
  const fileName = encodeURIComponent(parts.fileName);
  return `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}://${AI_CHAT_GENERATED_IMAGE_HOST}/${userEmail}/${conversationId}/${messageId}/${fileName}`;
}

export function resolveGeneratedImageProtocolPath(
  requestUrl: string,
  userDataPath: string
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}:` ||
    parsed.host !== AI_CHAT_GENERATED_IMAGE_HOST
  ) {
    return null;
  }
  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (segments.length !== 4 || segments.some((segment) => segment.length === 0)) {
    return null;
  }
  const root = getGeneratedImageRoot(userDataPath);
  const candidate = path.resolve(root, ...segments);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}
