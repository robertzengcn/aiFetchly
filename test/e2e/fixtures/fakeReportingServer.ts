/**
 * Fake conversation-report loopback HTTP server (§24.6 successful-journey
 * certification).
 *
 * The report service's IPC→main path resolves its backend through
 * `HttpClient`, which in the E2E build (`VITE_LOGIN_URL` baked as "")
 * falls back to `http://localhost:3000` + `/apis` (httpclient.ts fallback).
 * This fixture binds 127.0.0.1:3000 and serves exactly two endpoints:
 *
 *   GET  /apis/api/ai/content-reports/capabilities → enabled envelope
 *   POST /apis/api/ai/content-reports             → success reportId
 *
 * So the renderer's fail-closed guard flips to enabled:true and the full
 * report journey (dialog → select → submit → success message with the
 * server-assigned reference) can run without touching the real backend.
 *
 * Port 3000 follows the `fakeSecretKeyServer` convention (same fallback
 * port, never overlaps with fakeAi). The playwright config runs with
 * `fullyParallel: false, workers: 1`, so at most one spec binds it at a
 * time; a busy port fails fast with EADDRINUSE instead of silently
 * routing the fetches to the wrong responder.
 */

import * as http from "node:http";

export interface FakeReportingServer {
  close(): Promise<void>;
}

/** The reportId the fake backend hands back — asserted by specs. */
export const FAKE_REPORT_ID = "air_e2e-reference-0001";

export function startFakeReportingServer(): Promise<FakeReportingServer> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url.includes("/content-reports/capabilities")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: true,
          code: 0,
          msg: "",
          data: {
            acceptedSchemaVersions: [1, 2],
            conversationReporting: {
              enabled: true,
              maxAIItems: 10,
              maxUserItems: 10,
              maxTotalItems: 20,
              maxItemTextChars: 8000,
              maxAggregateTextChars: 32000,
              maxImages: 3,
            },
          },
        })
      );
      return;
    }
    if (req.method === "POST" && url.includes("/content-reports")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: true,
          code: 0,
          msg: "",
          data: {
            reportId: FAKE_REPORT_ID,
            status: "submitted",
            receivedAt: new Date().toISOString(),
            duplicate: false,
          },
        })
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: false, data: null }));
  });

  return new Promise<FakeReportingServer>((resolve, reject) => {
    server.on("error", reject);
    server.listen(3000, "127.0.0.1", () => {
      resolve({
        // server.close() alone waits for open sockets to drain; the app's
        // HTTP client keeps the loopback connection pooled, which wedged
        // this fixture's close() until the test budget expired (the
        // historical "post-submit runner stall"). Force-destroy the pooled
        // sockets before draining.
        close: () =>
          new Promise((d) => {
            server.closeAllConnections();
            server.close(() => d());
            // The app's HTTP client may re-pool the loopback socket around
            // the drained listen socket, and server.close() then waits for
            // it indefinitely (observed as the historical "post-submit
            // runner stall" that consumed the whole test budget). Give
            // teardown a hard ceiling instead of trusting socket drain.
            setTimeout(() => d(), 2_000).unref();
          }),
      });
    });
  });
}
