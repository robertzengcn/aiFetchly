/**
 * F23: webServer entry for the Playwright harness — boots the deterministic
 * login fixture on the port the specs hardcode (8443 default).
 */
import { startFakeLoginSite } from "./fakeLoginSite.ts";

import * as http from "node:http";

const port = Number(process.env.E2E_LOGIN_SITE_PORT ?? 8_443);

const site = await startFakeLoginSite(port);

// P1-fix (CI): Playwright's webServer readiness poll uses Node's fetch,
// which REJECTS the self-signed HTTPS cert on some Node versions (CI
// Node 22) even with ignoreHTTPSErrors configured. Serve a PLAIN HTTP
// health endpoint alongside the fixture so readiness never depends on
// TLS negotiation.
const httpHealthPort = port + 1;
const health = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});
health.listen(httpHealthPort, "127.0.0.1");
process.on("SIGTERM", () => health.close());
process.on("SIGINT", () => health.close());
// The boot wrapper cannot pick the ephemeral port — rebind expectations:
// startFakeLoginSite binds 127.0.0.1:0, so expose the chosen port for the
// harness log and keep the process alive for Playwright.
console.log(`[fake-login-site] listening on 127.0.0.1:${site.port} (requested ${port})`);
process.on("SIGTERM", () => {
  void site.close().then(() => process.exit(0));
});
process.on("SIGINT", () => {
  void site.close().then(() => process.exit(0));
});
// Keep the event loop alive for the webServer lifetime.
setInterval(() => undefined, 1 << 30);
