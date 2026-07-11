import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { getPluginMarketplaceTempRoot } from "./pluginMarketplacePaths";
import {
  mktErr,
  type PluginMarketplaceFetchResult,
  type PluginMarketplaceFetcher,
  type PluginMarketplaceFetchRequest,
} from "./marketplaceFetcherTypes";

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export class UrlMarketplaceFetcher implements PluginMarketplaceFetcher {
  readonly kind = "url" as const;

  async fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult> {
    const url = req.source.uri?.trim();
    if (!url || !url.startsWith("https://")) {
      return { success: false, errors: [mktErr("marketplace-source-invalid", "Only HTTPS marketplace URLs are allowed.")] };
    }

    const destDir = fs.mkdtempSync(path.join(getPluginMarketplaceTempRoot(), "mkt-url-"));
    const dest = path.join(destDir, "marketplace.json");

    const ok = await downloadTo(url, dest);
    if (!ok) {
      fs.rmSync(destDir, { recursive: true, force: true });
      return { success: false, errors: [mktErr("marketplace-fetch-failed", "Failed to download marketplace.json.")] };
    }

    const manifestJson = fs.readFileSync(dest, "utf-8");
    return {
      success: true,
      marketplace: {
        // No repo root for URL sources: relative plugin entries are unsupported.
        marketplaceRoot: destDir,
        manifestPath: dest,
        manifestJson,
        cleanup: async () => {
          try {
            fs.rmSync(destDir, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        },
      },
    };
  }
}

function downloadTo(url: string, dest: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let redirects = 0;
    let aborted = false;
    const done = (ok: boolean) => {
      if (!aborted) {
        aborted = true;
        resolve(ok);
      }
    };
    const req = (target: string) => {
      const r = https.get(target, { timeout: TIMEOUT_MS }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (++redirects > 5) return done(false);
          res.destroy();
          req(res.headers.location);
          return;
        }
        if (!res.statusCode || res.statusCode !== 200) {
          res.destroy();
          return done(false);
        }
        const out = fs.createWriteStream(dest);
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            r.destroy();
            out.destroy();
            try {
              fs.rmSync(dest, { force: true });
            } catch {
              /* ignore */
            }
            done(false);
          }
        });
        res.pipe(out);
        out.on("finish", () => done(true));
        out.on("error", () => done(false));
      });
      r.on("error", () => done(false));
      r.on("timeout", () => {
        if (!aborted) {
          aborted = true;
          r.destroy(new Error("Request timed out"));
        }
      });
    };
    req(url);
  });
}
