import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Dependency-graph guard (design DoD #10): the shared deterministic
 * verification modules that the contact-extraction WORKER process imports
 * must NOT pull Electron, TypeORM, the Token service, or renderer code. A
 * worker process has no Electron app/safeStorage and must not resolve the
 * user DB path. This test reads the source files and asserts their import
 * statements are runtime-neutral so an accidental import is caught before it
 * lands in the worker bundle.
 */
const SRC_ROOT = path.resolve(process.cwd(), "src");

const WORKER_SAFE_FILES = [
  "service/contact-verification/ContactVerificationService.ts",
  "service/contact-verification/EmailVerifier.ts",
  "service/contact-verification/PhoneVerifier.ts",
  "service/contact-verification/DnsMailRouteResolver.ts",
  "service/contact-verification/ContactVerificationCache.ts",
  "config/contactVerification.ts",
  "config/contact-verification/disposableEmailDomains.ts",
  "config/contact-verification/countryAliases.ts",
  "schemas/contactVerification.ts",
  "entityTypes/contactVerificationTypes.ts",
  "childprocess/contact-extraction/ContactEvidenceExtractor.ts",
];

const FORBIDDEN_PATTERNS: RegExp[] = [
  /from\s+["']electron["']/, // Electron main-process APIs
  /from\s+["']typeorm["']/, // ORM
  /from\s+["']@\/modules\/token["']/, // Token service (resolves DB path)
  /from\s+["']@\/config\/usersetting["']/, // USER_AI_ENABLED / USERSDBPATH
  /app\.getPath\s*\(/, // Electron app.getPath
  /safeStorage/, // Electron safeStorage
];

describe("contact-verification worker boundary (DoD #10)", () => {
  for (const rel of WORKER_SAFE_FILES) {
    it(`${rel} imports no Electron/TypeORM/Token`, () => {
      const full = path.join(SRC_ROOT, rel);
      const src = fs.readFileSync(full, "utf8");
      for (const re of FORBIDDEN_PATTERNS) {
        expect(re.test(src)).toBe(false);
      }
    });
  }
});
