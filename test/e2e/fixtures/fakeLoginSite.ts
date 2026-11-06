/**
 * F23: deterministic HTTPS fixture site for the browser E2E specs.
 *
 * Serves https://localhost:8443 with:
 *   - `/login`  — one DECOY search box + one real login form (username +
 *                 password with a show-password toggle); the form POSTs to
 *                 /__e2e__/submit and re-renders;
 *   - `/search?q=` — a trivial search results page;
 *   - `/__e2e__/seed` (POST) — records the seeded account/site;
 *   - `/__e2e__/mode` (POST) — `{ reject: true }` makes every login fail;
 *   - `/__e2e__/last-submit` (GET) — the last submitted credential JSON;
 *   - `/__e2e__/submit-count` (GET) — how many times the form submitted.
 *
 * No real credential ever transits: the specs use a sentinel string.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import https from "node:https";
import type { AddressInfo } from "node:net";

export interface FakeLoginSite {
  readonly port: number;
  readonly close: () => Promise<void>;
}

interface LoginSubmit {
  username: string;
  password: string;
}

export function startFakeLoginSite(
  /** F23: bind an explicit port (the specs hardcode 8443); 0 = ephemeral. */
  requestedPort = 0
): Promise<FakeLoginSite> {
  let lastSubmit: LoginSubmit | null = null;
  let submitCount = 0;
  let rejectLogins = false;
  // F23: the seed the specs injected (account + site) — the app-hook layer
  // reads it back with GET /__e2e__/seed.
  let lastSeed: unknown = null;

  // F23: a locally generated self-signed pair via openssl (present in
  // the project's Git Bash environment) — the fixture is loopback only
  // and every consumer disables verification.
  const keyPath = path.join(os.tmpdir(), `e2e-fixture-key-${process.pid}.pem`);
  const certPath = path.join(os.tmpdir(), `e2e-fixture-cert-${process.pid}.pem`);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "365",
      "-nodes",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" }
  );
  const server = https.createServer(
    {
      key: fs.readFileSync(keyPath, "utf8"),
      cert: fs.readFileSync(certPath, "utf8"),
      rejectUnauthorized: false,
    },
    (req, res) => {
      const url = new URL(req.url ?? "/", "https://localhost");
      const sendJson = (code: number, body: unknown): void => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };

      if (req.method === "POST" && url.pathname === "/__e2e__/mode") {
        let raw = "";
        req.on("data", (chunk: Buffer) => {
          raw += String(chunk);
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(raw || "{}") as { reject?: boolean };
            rejectLogins = parsed.reject === true;
          } catch {
            /* keep previous mode */
          }
          sendJson(200, { reject: rejectLogins });
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/__e2e__/submit") {
        let raw = "";
        req.on("data", (chunk: Buffer) => {
          raw += String(chunk);
        });
        req.on("end", () => {
          submitCount++;
          try {
            const parsed = JSON.parse(raw || "{}") as LoginSubmit;
            lastSubmit = parsed;
          } catch {
            lastSubmit = null;
          }
          // The fixture never stores real credentials beyond the sentinel
          // echo the specs assert on.
          sendJson(200, { ok: !rejectLogins });
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/__e2e__/last-submit") {
        sendJson(200, lastSubmit ?? {});
        return;
      }

      if (req.method === "GET" && url.pathname === "/__e2e__/submit-count") {
        sendJson(200, { count: submitCount });
        return;
      }

      if (req.method === "POST" && url.pathname === "/__e2e__/seed") {
        // The harness records the seed; the app-side hook consumes it.
        let raw = "";
        req.on("data", (chunk: Buffer) => {
          raw += String(chunk);
        });
        req.on("end", () => {
          try {
            lastSeed = JSON.parse(raw || "null");
          } catch {
            lastSeed = null;
          }
          sendJson(200, { seeded: lastSeed !== null });
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/__e2e__/seed") {
        sendJson(200, lastSeed ?? {});
        return;
      }

      if (url.pathname === "/login") {
        const html = `<!doctype html>
<html><head><title>Example Login</title></head>
<body>
  <form role="search" action="/search" method="get">
    <input type="text" name="search" placeholder="Search (decoy)" autocomplete="off">
    <button type="submit">Search</button>
  </form>
  <form id="login" action="/__e2e__/submit" method="post">
    <input type="text" name="username" autocomplete="username">
    <input type="password" name="password" autocomplete="current-password">
    <button type="button" id="show-pw">Show</button>
    <button type="submit">Sign in</button>
  </form>
  <script>
    document.getElementById("show-pw").addEventListener("click", () => {
      const pw = document.querySelector('input[name="password"]');
      pw.type = pw.type === "password" ? "text" : "password";
    });
    document.getElementById("login").addEventListener("submit", (event) => {
      event.preventDefault();
      const payload = {
        username: document.querySelector('input[name="username"]').value,
        password: document.querySelector('input[name="password"]').value,
      };
      fetch("/__e2e__/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    });
  </script>
</body></html>`;
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html);
        return;
      }

      if (url.pathname === "/search") {
        const q = url.searchParams.get("q") ?? "";
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<!doctype html><html><head><title>Search</title></head>
<body><h1>Results for ${q}</h1><ul><li>Result one</li><li>Result two</li></ul>
<input type="text" name="search" value="${q}"></body></html>`);
        return;
      }

      sendJson(404, { error: "not_found" });
    }
  );

  return new Promise((resolve) => {
    server.listen(requestedPort, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () =>
          new Promise((resolveClose) =>
            server.close(() => {
              for (const file of [keyPath, certPath]) {
                try {
                  fs.unlinkSync(file);
                } catch {
                  /* best-effort cleanup */
                }
              }
              resolveClose();
            })
          ),
      });
    });
  });
}
