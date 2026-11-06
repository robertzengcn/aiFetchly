/**
 * F23: webServer entry for the Playwright harness — boots the deterministic
 * login fixture on the port the specs hardcode (8443 default).
 */
import { startFakeLoginSite } from "./fakeLoginSite.ts";

const port = Number(process.env.E2E_LOGIN_SITE_PORT ?? 8_443);

const site = await startFakeLoginSite(port);
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
