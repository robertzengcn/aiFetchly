/**
 * F23: webServer entry for the Playwright harness — boots the deterministic
 * login fixture on the port the specs hardcode (8443). Plain .mjs so NO
 * Node version/type-stripping flag is required on CI.
 */
import * as http from "node:http";
import { startFakeLoginSite } from "./fakeLoginSite.mjs";

const port = Number(process.env.E2E_LOGIN_SITE_PORT ?? 8_443);

const site = await startFakeLoginSite(port);

// P1-fix (CI): Playwright's webServer readiness poll uses Node's fetch,
// which REJECTS the self-signed HTTPS cert on some Node versions even with
// ignoreHTTPSErrors configured. Serve a PLAIN HTTP health endpoint
// alongside the fixture so readiness never depends on TLS negotiation.
const httpHealthPort = port + 1;
const health = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});
health.listen(httpHealthPort, "127.0.0.1");

const shutdown = () => {
  health.close();
  void site.close().then(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`[fake-login-site] https://127.0.0.1:${site.port} ready (health :${httpHealthPort})`);

// Keep the event loop alive for the webServer lifetime.
setInterval(() => undefined, 1 << 30);
