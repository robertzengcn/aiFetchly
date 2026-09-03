/**
 * Playwright Electron launch fixture (design §13).
 *
 * Launches the source-built E2E main bundle (.vite/e2e/build/e2e-main.js) with
 * a sanitized environment, waits for a deterministic ready state, installs
 * renderer-side network routing (loopback-only), and captures the diagnostics
 * the teardown/artifact collector needs.
 */

import {
  type ConsoleMessage,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { _electron as electronLauncher } from "playwright";
import * as path from "path";
import { E2E_ENV, RENDERER_ORIGIN, type E2ETestRoot } from "./types";

export interface LaunchOptions {
  readonly testRoot: E2ETestRoot;
  /** Loopback base URL of the FakeOpenAI server (main-process provider target). */
  readonly fakeAiBaseUrl?: string;
  /**
   * Loopback base URL of the FakePluginHub server. When set, the launch env
   * carries VITE_PLUGIN_HUB_URL so the main-process community catalog and
   * install pipeline target the deterministic hub fixture (UPD-GAP-05).
   */
  readonly hubBaseUrl?: string;
}

export interface NetworkViolation {
  readonly method: string;
  readonly url: string;
  readonly origin: string;
}

export interface LaunchedApp {
  readonly electronApp: ElectronApplication;
  readonly mainWindow: Page;
  readonly testRoot: E2ETestRoot;
  readonly consoleMessages: () => readonly ConsoleMessage[];
  readonly pageErrors: () => readonly Error[];
  readonly rendererViolations: () => readonly NetworkViolation[];
  readonly mainStdout: () => string;
  readonly mainStderr: () => string;
  /** PID of the launched Electron process (for bounded cleanup). */
  readonly pid: number | undefined;
}

/**
 * Build a minimal, safe environment for the Electron child process. Only an
 * allowlist of OS/runtime variables is preserved; every API key, token, proxy,
 * credential, and production service URL is dropped (design §13.2).
 */
function buildSanitizedEnv(
  testRoot: E2ETestRoot,
  fakeAiBaseUrl: string | undefined,
  hubBaseUrl: string | undefined
): Record<string, string> {
  // Exact-name allowlist for safe OS/runtime variables. Broad names are matched
  // EXACTLY (not as prefixes) so e.g. `CI` does not also pass `CI_REPOSITORY_URL`
  // (which carries GitLab job credentials) and `HOME` does not pass `HOMEBREW_*`.
  const ALLOWED_EXACT = new Set([
    "PATH",
    "HOME",
    "USER",
    "USERNAME",
    "LOGNAME",
    "SHELL",
    "TERM",
    "LANG",
    "LANGUAGE",
    "DISPLAY",
    "XAUTHORITY",
    "WAYLAND_DISPLAY",
    "NODE_OPTIONS",
    "CI", // the boolean CI flag only — not CI_* (which may carry credentials)
    "PYTHON",
    "PYTHONPATH",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
  ]);
  // Genuine multi-var families, matched by prefix only when narrow.
  const ALLOWED_PREFIXES = ["LC_", "XDG_", "DBUS_", "PLAYWRIGHT_"];

  // Display/X11 variables must always be preserved so the Electron child can
  // authenticate to Xvfb. (XAUTHORITY contains "AUTH" and would otherwise be
  // stripped by the secret filter below, causing "Authorization required, but
  // no authorization protocol specified" under xvfb-run.)
  const DISPLAY_VARS = new Set([
    "DISPLAY",
    "XAUTHORITY",
    "XDG_SESSION_TYPE",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
  ]);

  const allowed: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (DISPLAY_VARS.has(upper)) {
      allowed[key] = value;
      continue;
    }
    // Never inherit anything that looks like a secret, proxy, or service URL.
    if (
      /KEY|TOKEN|SECRET|PASS|CREDENTIAL|PROXY|AUTH|REMOTE|LOGIN_URL|UPDATESERVER/i.test(
        upper
      )
    ) {
      continue;
    }
    if (
      ALLOWED_EXACT.has(upper) ||
      ALLOWED_PREFIXES.some((p) => upper.startsWith(p))
    ) {
      allowed[key] = value;
    }
  }

  // Explicit E2E contract.
  allowed[E2E_ENV.ENABLED] = "1";
  // The local-AI-runtime catalog check would otherwise poll github.com in the
  // main process mid-test (the network guard records any non-loopback fetch).
  // Point it at the fake AI server's origin so the periodic check stays
  // loopback-only; a 404 catalog is a benign, handled result.
  allowed["AIFETCHLY_RUNTIME_CATALOG_URL"] = fakeAiBaseUrl
    ? `${fakeAiBaseUrl.replace(/\/v1$/, "")}/__e2e/runtime-catalog`
    : "http://127.0.0.1:1/local-ai-runtimes.json";
  allowed[E2E_ENV.ROOT] = testRoot.rootPath;
  allowed[E2E_ENV.STATE_FILE] = testRoot.stateFilePath;
  allowed[E2E_ENV.USER_DATA_PATH] = testRoot.userDataPath;
  allowed[E2E_ENV.IS_TEST] = "1";
  allowed[E2E_ENV.NODE_ENV] = "test";
  const allowedOrigins = [RENDERER_ORIGIN];
  if (fakeAiBaseUrl) {
    allowed[E2E_ENV.AI_BASE_URL] = fakeAiBaseUrl;
    try {
      allowedOrigins.push(new URL(fakeAiBaseUrl).origin);
    } catch {
      /* ignore */
    }
  }
  if (hubBaseUrl) {
    // Set explicitly (never inherited from the host env): the main process
    // resolves the Plugin Hub base from this variable at runtime, and the
    // E2E bundle does not bake it in at build time. Also allowlist the
    // origin for the network guard's configured-origins set.
    allowed["VITE_PLUGIN_HUB_URL"] = hubBaseUrl;
    try {
      allowedOrigins.push(new URL(hubBaseUrl).origin);
    } catch {
      /* ignore */
    }
  }
  allowed[E2E_ENV.ALLOWED_ORIGINS] = allowedOrigins.join(",");
  return allowed;
}

function resolveE2eMainPath(): string {
  const candidate = path.resolve(process.cwd(), ".vite/e2e/build/e2e-main.js");
  return candidate;
}

/**
 * Launch the app and resolve only once it has reached the ready state:
 * first window present, renderer URL on the Vite origin, `#app` mounted, and
 * the preload bridge available. No fixed startup sleep (design §13.3).
 */
export async function launchAiFetchly(
  options: LaunchOptions
): Promise<LaunchedApp> {
  const e2eMainPath = resolveE2eMainPath();
  const env = buildSanitizedEnv(
    options.testRoot,
    options.fakeAiBaseUrl,
    options.hubBaseUrl
  );

  const electronApp = await electronLauncher.launch({
    args: [
      e2eMainPath,
      // Headless/CI/WSL Electron needs these to initialize the Aura platform
      // under xvfb (avoids "platform failed to initialize").
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
    cwd: process.cwd(),
    env,
    timeout: 60_000,
  });

  const consoleMsgs: ConsoleMessage[] = [];
  const pageErrs: Error[] = [];
  const rendererViolations: NetworkViolation[] = [];

  const proc = electronApp.process();
  let stdout = "";
  let stderr = "";
  const appendStream = (
    stream: NodeJS.ReadableStream | null,
    sink: (chunk: string) => void
  ): void => {
    if (!stream) return;
    stream.setEncoding("utf8");
    stream.on("data", (chunk: unknown) =>
      sink(typeof chunk === "string" ? chunk : String(chunk))
    );
  };
  appendStream(proc.stdout, (c) => (stdout += c));
  appendStream(proc.stderr, (c) => (stderr += c));

  const mainWindow = await electronApp.firstWindow();

  mainWindow.on("console", (msg) => consoleMsgs.push(msg));
  mainWindow.on("pageerror", (err) => pageErrs.push(err));

  // Renderer network guard: allow loopback origins (the Vite dev server plus any
  // local dev-browser bridge the renderer subscribes to, which is disabled in E2E
  // but still polled once at startup); abort every external origin and record it
  // (design §10.2 — relaxed to loopback so the security goal "no external
  // traffic" is preserved without flagging known-local polls).
  const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
  await mainWindow.route("**/*", (route) => {
    const request = route.request();
    const url = request.url();
    let origin = "";
    let hostname = "";
    try {
      const parsed = new URL(url);
      origin = parsed.origin;
      hostname = parsed.hostname;
    } catch {
      origin = url;
    }
    if (LOOPBACK_HOSTS.has(hostname)) {
      void route.continue();
      return;
    }
    rendererViolations.push({ method: request.method(), url, origin });
    void route.abort("blockedbyclient");
  });

  try {
    // Wait for the page to navigate to the Vite renderer origin. Use a regex so
    // the bare root URL (http://127.0.0.1:5173/) matches — a `**` glob would
    // require a non-empty path and never resolve.
    await mainWindow.waitForURL(/127\.0\.0\.1:5173(\/|$)/, { timeout: 60_000 });
    // Preload bridge must be present (implies the page loaded + contextBridge ran).
    await mainWindow.waitForFunction(
      () => Boolean((window as unknown as { api?: unknown }).api),
      undefined,
      { timeout: 60_000 }
    );
    // Vue app landmark mounted.
    await mainWindow.waitForSelector("#app", { timeout: 60_000 });
  } catch (err) {
    // Readiness failed after Electron already started — close it so CI retries
    // don't accumulate orphan processes. Best-effort; rethrow the real error.
    try {
      await electronApp.close();
    } catch {
      const pid = proc.pid;
      if (pid !== undefined) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    throw err;
  }

  return {
    electronApp,
    mainWindow,
    testRoot: options.testRoot,
    consoleMessages: () => consoleMsgs.slice(),
    pageErrors: () => pageErrs.slice(),
    rendererViolations: () => rendererViolations.slice(),
    mainStdout: () => stdout,
    mainStderr: () => stderr,
    pid: proc.pid,
  };
}
