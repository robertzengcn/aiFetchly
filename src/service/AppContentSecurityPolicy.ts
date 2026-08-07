import { AI_CHAT_GENERATED_IMAGE_PROTOCOL } from "@/service/AIChatGeneratedImageProtocol";

export function buildAppContentSecurityPolicy(isDevelopment: boolean): string {
  const commonDirectives = [
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `img-src 'self' data: https:${
      isDevelopment ? " http:" : ""
    } ${AI_CHAT_GENERATED_IMAGE_PROTOCOL}:`,
    "font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com",
    // Spoken responses are synthesized as in-memory WAV Blob URLs in the
    // renderer. Keep this scoped to media elements instead of broadening
    // default-src so scripts/frames/objects remain restricted.
    "media-src 'self' blob:",
    isDevelopment
      ? "connect-src 'self' http://localhost:* https://localhost:* https: http: https://fonts.googleapis.com https://fonts.gstatic.com"
      : "connect-src 'self' https: https://fonts.googleapis.com https://fonts.gstatic.com",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  return [
    "default-src 'self'",
    isDevelopment
      ? "script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:* https://localhost:*"
      : "script-src 'self'",
    ...commonDirectives,
  ].join("; ");
}
