import * as http from "http";
import type { AddressInfo } from "net";

/**
 * Loopback fixture server for the managed-browser E2E spec (technical
 * design §26). Serves deterministic pages over 127.0.0.1 so the real
 * Chrome + worker + supervisor path can be exercised without any external
 * network (the E2E network guard permits loopback).
 *
 * Pages:
 *   /            landing with interactive controls (buttons/input/select)
 *   /login       credential-shaped page (password field) for handoff tests
 *   /challenge   a reCAPTCHA-shaped marker for challenge-detection tests
 *   /consequential a "Publish" button for approval-gate tests
 */

export interface FixtureServer {
  readonly port: number;
  readonly requests: string[];
  close(): Promise<void>;
}

const LANDING_HTML = `<!doctype html>
<html><head><title>Fixture Landing</title></head>
<body>
  <h1>Fixture Landing</h1>
  <button id="like">Like</button>
  <button id="next">Next</button>
  <input id="search" type="text" placeholder="Search" aria-label="Search" />
  <a id="nav-login" href="/login">Go to login</a>
</body></html>`;

const LOGIN_HTML = `<!doctype html>
<html><head><title>Sign in</title></head>
<body>
  <h1>Fixture Sign In</h1>
  <input id="email" type="text" aria-label="Email" />
  <input id="password" type="password" aria-label="Password" />
  <button id="submit">Sign in</button>
</body></html>`;

const CHALLENGE_HTML = `<!doctype html>
<html><head><title>Verification</title></head>
<body>
  <h1>Verify you are human</h1>
  <div class="g-recaptcha" data-sitekey="fixture-site-key">recaptcha fixture</div>
</body></html>`;

const CONSEQUENTIAL_HTML = `<!doctype html>
<html><head><title>Studio</title></head>
<body>
  <h1>Fixture Studio</h1>
  <input id="title" type="text" aria-label="Title" />
  <button id="publish">Publish video</button>
</body></html>`;

/** E01: the deterministic search fixture page (the task's start). */
const SEARCH_HTML = `<!doctype html>
<html><head><title>Fixture Search</title></head>
<body>
  <h1>Fixture Search</h1>
  <form action="/results" method="get">
    <input id="search" name="q" type="text" value="__QUERY__" aria-label="Search" />
    <button id="go" type="submit">Search</button>
  </form>
</body></html>`;

/** E01: the deterministic results page (the verified-completion target). */
const RESULTS_HTML = `<!doctype html>
<html><head><title>Fixture Results</title></head>
<body>
  <h1>Fixture Results</h1>
  <p class="query-term">__QUERY__</p>
  <ul id="results">
    <li>supplier prices list A</li>
    <li>supplier prices list B</li>
  </ul>
</body></html>`;

export async function startManagedBrowserFixtureServer(): Promise<FixtureServer> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    requests.push(url);
    const [path] = url.split("?");
    // E01/D-AC-02/06/09: the deterministic SEARCH fixture - a search
    // box that navigates to /results?q=<term> (the accelerated
    // task's verified-completion criteria live on the RESULT URL).
    if (path === "/search") {
      const q = new URL(url, "http://127.0.0.1").searchParams.get("q") ?? "";
      res.writeHead(200, { "content-type": "text/html" });
      res.end(SEARCH_HTML.replace("__QUERY__", q));
      return;
    }
    if (path === "/results") {
      const q = new URL(url, "http://127.0.0.1").searchParams.get("q") ?? "";
      res.writeHead(200, { "content-type": "text/html" });
      res.end(RESULTS_HTML.replace("__QUERY__", q));
      return;
    }
    const page =
      path === "/login"
        ? LOGIN_HTML
        : path === "/challenge"
          ? CHALLENGE_HTML
          : path === "/consequential"
            ? CONSEQUENTIAL_HTML
            : LANDING_HTML;
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}
