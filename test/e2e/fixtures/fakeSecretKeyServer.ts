/**
 * Fake secret-key loopback HTTP server for the email-identity E2E scenarios
 * (P0.3, scenario 2). The production import-create path calls
 * `EmailServiceModule.encryptCredentialsForStorage` →
 * `UserSecretKeyService.getKey()` → `GET /apis/api/user/secret-key` to fetch
 * the 32-byte base64 key used by `FieldCipher.encrypt`. In the E2E build,
 * `VITE_LOGIN_URL` is baked as the literal empty string (see
 * `vite.e2e.main.config.mjs:69` and `viteLoginUrl.ts`), so HttpClient's
 * `resolveViteLoginBase()` returns undefined and the constructor falls back
 * to the hardcoded `http://localhost:3000` (httpclient.ts:68-70).
 *
 * Because Vite's `define` statically replaces `process.env.VITE_LOGIN_URL`
 * with `""` at build time, setting the env var at launch does NOT override
 * it — the reference is gone from the bundle. The only way to intercept the
 * secret-key fetch without modifying production code or the build config is
 * to serve the expected envelope on the exact port the fallback already
 * targets: 3000 on the loopback interface.
 *
 * This fixture binds 127.0.0.1:3000 and serves:
 *   GET /apis/api/user/secret-key → 200 {status:true, data:{secretKey:"..."}}
 * so `createEmailService` (import create-rows) can encrypt the row's
 * password and persist. The server never touches the network: connections
 * come from 127.0.0.1 and are allowed by the loopback-permissive
 * E2ENetworkGuard (which patches globalThis.fetch).
 *
 * The served key is a fixed 32-byte value so ciphertext is deterministic
 * across runs. It is NOT a real secret — it exists only to satisfy the
 * FieldCipher KEY_LENGTH=32 contract inside the isolated E2E temp root,
 * and it is never used outside the test process's lifetime.
 *
 * Port 3000 is the same port the production dev backend uses, but E2E tests
 * run in isolation (unique temp root, AIFETCHLY_E2E=1 gate, no real user
 * data) and the suite owns the machine during a run. If the port is busy
 * the bind fails fast with EADDRINUSE — preferable to silently routing the
 * secret-key fetch to the wrong responder.
 */

import * as http from "node:http";

export interface FakeSecretKeyServer {
  readonly port: number;
  close(): Promise<void>;
}

// 32 bytes → 44-char base64 (with padding). FieldCipher requires KEY_LENGTH=32.
const FAKE_SECRET_KEY_B64 = Buffer.alloc(32, 7).toString("base64");

// The port HttpClient falls back to when VITE_LOGIN_URL is empty — see the
// rationale above. DO NOT change this without updating httpclient.ts's
// fallback, or the import-create encryption path will miss the fake server.
const FAKE_SECRET_KEY_PORT = 3000;

/**
 * Start the fake secret-key loopback server on 127.0.0.1:3000. Returns the
 * handle with the resolved port (always 3000) for assertion convenience.
 */
export function startFakeSecretKeyServer(): Promise<FakeSecretKeyServer> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    // Only the secret-key endpoint matters; respond 404 to anything else so a
    // misconfigured test fails loudly rather than hanging on an empty socket.
    if (url.includes("/api/user/secret-key")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: true,
          data: { secretKey: FAKE_SECRET_KEY_B64 },
        })
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: false, data: null }));
  });

  return new Promise<FakeSecretKeyServer>((resolve, reject) => {
    server.on("error", reject);
    server.listen(FAKE_SECRET_KEY_PORT, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(
          new Error("fake secret-key server did not bind to port 3000")
        );
        return;
      }
      resolve({
        port: address.port,
        close(): Promise<void> {
          return new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}
