import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  redactBase64,
  redactExternalPaths,
  redactDiagnostics,
} from "../../../e2e/support/redact";

const ROOT = "/tmp/aifetchly-e2e/run-1/worker-0/test-abc";

describe("artifact redaction", () => {
  describe("redactSecrets", () => {
    it("redacts Authorization Bearer headers", () => {
      expect(redactSecrets("Authorization: Bearer eyXYZ123")).toBe(
        "Authorization: <redacted>"
      );
    });
    it("redacts api_key / token / password assignments", () => {
      expect(redactSecrets("api_key=sk-abc123")).toBe("api_key= <redacted>");
      expect(redactSecrets("token: abc.def.ghi")).toBe("token: <redacted>");
      expect(redactSecrets("password=hidden")).toBe("password= <redacted>");
    });
    it("redacts bare Bearer tokens + JWTs anywhere", () => {
      const out = redactSecrets("Bearer eyJhbGci.eyJzdWIi.SflKxwRJ");
      expect(out).not.toContain("eyJhbGci");
      expect(out).toContain("<redacted>");
    });
    it("keeps non-secret content", () => {
      expect(redactSecrets("model=aifetchly-e2e-model status=200")).toBe(
        "model=aifetchly-e2e-model status=200"
      );
    });
  });

  describe("redactBase64", () => {
    it("truncates long data URIs", () => {
      const long = `data:image/png;base64,${"A".repeat(500)}`;
      const out = redactBase64(long);
      expect(out).toContain("<base64 len=");
      expect(out).not.toContain("A".repeat(500));
    });
    it("keeps short base64", () => {
      expect(redactBase64("data:image/png;base64,QUJD")).toBe(
        "data:image/png;base64,QUJD"
      );
    });
  });

  describe("redactExternalPaths", () => {
    it("keeps paths inside the E2E root", () => {
      const p = `${ROOT}/database/scraper.db`;
      expect(redactExternalPaths(`db at ${p}`, ROOT)).toContain(p);
    });
    it("redacts paths outside the root (home/project)", () => {
      expect(redactExternalPaths("file at /home/user/secret.txt", ROOT)).toContain(
        "<external-path>"
      );
      expect(
        redactExternalPaths("file at /home/user/secret.txt", ROOT)
      ).not.toContain("/home/user/secret.txt");
    });
    it("keeps common system/temp paths for diagnostics", () => {
      expect(redactExternalPaths("log at /var/log/app.log", ROOT)).toContain(
        "/var/log/app.log"
      );
    });
  });

  describe("redactDiagnostics (combined)", () => {
    it("redacts a mixed diagnostic string end-to-end", () => {
      const input = [
        `Authorization: Bearer sk-secret`,
        `path: ${ROOT}/user-data/store.json`,
        `external: /home/user/.ssh/id_rsa`,
        `model=aifetchly-e2e-model`,
      ].join("\n");
      const out = redactDiagnostics(input, ROOT);
      expect(out).not.toContain("sk-secret");
      expect(out).not.toContain("/home/user/.ssh/id_rsa");
      expect(out).toContain(`${ROOT}/user-data/store.json`);
      expect(out).toContain("model=aifetchly-e2e-model");
    });
  });
});
