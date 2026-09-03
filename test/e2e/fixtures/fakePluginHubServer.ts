/**
 * FakePluginHub — deterministic loopback stand-in for the AiFetchly Plugin Hub
 * (unified plugin page E2E, UPD-GAP-05/06).
 *
 * Serves the first-party catalog contract that AiFetchHubMarketplaceFetcher
 * consumes (GET {base}/api/v1/plugins/catalog → {plugins:[…]}), plus the
 * fixture plugin zip referenced by the installable entry's `url` source. The
 * main process reaches it because the E2E launcher sets
 * VITE_PLUGIN_HUB_URL=http://127.0.0.1:<port> (the fetcher accepts loopback
 * http as local-dev) and the E2E network guard permits loopback hosts.
 *
 * The zip is downloaded over plain http under the E2E-only
 * UrlPluginFetcher loopback exception (AIFETCHLY_E2E=1).
 *
 * Mirrors fakeOpenAiServer.ts: worker-scoped lifecycle, reset() between tests,
 * request counters for assertions.
 */

import * as http from "http";
import AdmZip from "adm-zip";

/** A minimal valid plugin package: plugin.json + one skill at the zip root. */
export function buildFixturePluginZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "plugin.json",
    Buffer.from(
      JSON.stringify(
        {
          name: "e2e-fixture-plugin",
          version: "1.0.0",
          description:
            "Deterministic E2E fixture plugin from the FakePluginHub.",
          displayName: "E2E Fixture Plugin",
          skills: ["skills/fixture-skill/manifest.json"],
        },
        null,
        2
      ),
      "utf8"
    )
  );
  zip.addFile(
    "skills/fixture-skill/manifest.json",
    Buffer.from(
      JSON.stringify(
        {
          name: "fixture-skill",
          version: "1.0.0",
          description:
            "Deterministic fixture skill shipped inside the E2E plugin zip.",
          runtime: "javascript",
          entry: "skill.js",
          parameters: { type: "object", properties: {} },
        },
        null,
        2
      ),
      "utf8"
    )
  );
  zip.addFile(
    "skills/fixture-skill/skill.js",
    Buffer.from("// E2E fixture skill entry — intentionally empty.\n", "utf8")
  );
  return zip.toBuffer();
}

export interface FakePluginHubEntrySpec {
  readonly slug: string;
  readonly displayName: string;
  readonly description: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly access: {
    readonly status:
      | "allowed"
      | "login_required"
      | "subscription_required"
      | "forbidden"
      | "unavailable";
    readonly installMode: "direct" | "ticket";
  };
}

export interface FakePluginHubController {
  readonly baseUrl: string;
  readonly port: number;
  /** Replace the catalog served to subsequent requests. */
  setCatalog(entries: readonly FakePluginHubEntrySpec[]): void;
  /** Number of catalog requests since the last reset. */
  catalogRequestCount(): number;
  /** Number of plugin-zip downloads since the last reset. */
  zipRequestCount(): number;
  /** Clear counters (catalog stays as last set / default). */
  reset(): void;
  stop(): Promise<void>;
}

/** The installable entry used by the unified-plugin critical flow. */
export const FIXTURE_INSTALLABLE_SLUG = "e2e-fixture-plugin";
export const FIXTURE_INSTALLABLE_TAG = "e2e-tag";

export function defaultHubCatalog(): readonly FakePluginHubEntrySpec[] {
  return [
    {
      slug: FIXTURE_INSTALLABLE_SLUG,
      displayName: "E2E Fixture Plugin",
      description:
        "A deterministic fixture plugin served by the FakePluginHub loopback server.",
      category: "Productivity",
      tags: [FIXTURE_INSTALLABLE_TAG, "fixture"],
      access: { status: "allowed", installMode: "direct" },
    },
    {
      slug: "e2e-coming-soon",
      displayName: "E2E Coming Soon Plugin",
      description: "Ticket-mode entry that renders the Preview affordance.",
      access: { status: "allowed", installMode: "ticket" },
    },
    {
      slug: "e2e-pro-plugin",
      displayName: "E2E Pro Plugin",
      description: "Subscription-gated entry that renders the Upgrade CTA.",
      access: { status: "subscription_required", installMode: "ticket" },
    },
  ];
}

/** Hub response entry: installable entries carry the loopback zip url source. */
interface HubResponseBody {
  plugins: Array<Record<string, unknown>>;
  segment?: string;
}

export async function startFakePluginHubServer(): Promise<FakePluginHubController> {
  const zipBytes = buildFixturePluginZip();

  let entries: readonly FakePluginHubEntrySpec[] = [];
  let catalogRequests = 0;
  let zipRequests = 0;
  // Assigned right after listen(0) resolves; the handler reads it per request.
  let port = 0;

  const server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.startsWith("/api/v1/plugins/catalog")) {
        catalogRequests += 1;
        const zipOrigin = `http://127.0.0.1:${port}`;
        const body: HubResponseBody = {
          plugins: entries.map((entry) => ({
            slug: entry.slug,
            displayName: entry.displayName,
            description: entry.description,
            ...(entry.category ? { category: entry.category } : {}),
            ...(entry.tags ? { tags: entry.tags } : {}),
            access: {
              status: entry.access.status,
              installMode: entry.access.installMode,
            },
            ...(entry.access.status === "allowed" &&
            entry.access.installMode === "direct"
              ? {
                  source: {
                    source: "url",
                    url: `${zipOrigin}/zips/plugin.zip`,
                  },
                }
              : {}),
          })),
          segment: "e2e",
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
        return;
      }
      if (req.method === "GET" && url.startsWith("/zips/plugin.zip")) {
        zipRequests += 1;
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Length": zipBytes.length,
        });
        res.end(zipBytes);
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found", url }));
    }
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("FakePluginHub failed to bind a loopback port.");
  }
  port = address.port;

  // Recompute the default catalog now that the port is known.
  entries = defaultHubCatalog();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    setCatalog(next: readonly FakePluginHubEntrySpec[]): void {
      entries = next;
    },
    catalogRequestCount(): number {
      return catalogRequests;
    },
    zipRequestCount(): number {
      return zipRequests;
    },
    reset(): void {
      catalogRequests = 0;
      zipRequests = 0;
    },
    stop(): Promise<void> {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
