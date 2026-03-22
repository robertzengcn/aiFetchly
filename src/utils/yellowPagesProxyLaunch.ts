import type { YellowPagesTaskProxyConfig } from "@/entityTypes/yellowPagesTaskProxyType";

/**
 * Validate one persisted proxy object (root form or an element of `proxies`).
 */
function parseSingleProxyRecord(
  o: Record<string, unknown>
): YellowPagesTaskProxyConfig | undefined {
  const host = typeof o.host === "string" ? o.host.trim() : "";
  const portRaw = o.port;
  const port =
    typeof portRaw === "number"
      ? portRaw
      : typeof portRaw === "string"
      ? parseInt(portRaw, 10)
      : NaN;
  const protocolRaw =
    typeof o.protocol === "string" ? o.protocol.trim().toLowerCase() : "";
  const protocol = protocolRaw.length > 0 ? protocolRaw : "http";
  if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
    return undefined;
  }
  const username =
    typeof o.username === "string" && o.username.length > 0
      ? o.username
      : undefined;
  const password =
    typeof o.password === "string" && o.password.length > 0
      ? o.password
      : undefined;
  return { host, port, protocol, username, password };
}

/**
 * Parse `yellow_pages_task.proxy_config` JSON from the database into a validated object
 * for **launch** (first usable proxy). Supports legacy single-object rows and `{ proxies: [...] }`.
 */
export function parseYellowPagesProxyConfigJson(
  raw: string | undefined | null
): YellowPagesTaskProxyConfig | undefined {
  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    return undefined;
  }
  try {
    let j: unknown = JSON.parse(raw);
    // Legacy rows: proxy_config was double-stringified; first parse yields a JSON string.
    if (typeof j === "string") {
      j = JSON.parse(j);
    }
    if (!j || typeof j !== "object") {
      return undefined;
    }
    const o = j as Record<string, unknown>;
    if (Array.isArray(o.proxies) && o.proxies.length > 0) {
      for (const item of o.proxies) {
        if (item && typeof item === "object") {
          const parsed = parseSingleProxyRecord(
            item as Record<string, unknown>
          );
          if (parsed) {
            return parsed;
          }
        }
      }
      return undefined;
    }
    return parseSingleProxyRecord(o);
  } catch {
    return undefined;
  }
}

export type PuppeteerProxyLaunchPieces = {
  args: string[];
  authenticate?: { username: string; password: string };
};

/**
 * Build Chromium `--proxy-server` args and optional `page.authenticate` for HTTP proxies.
 * SOCKS proxies embed credentials in the URL when present (Chromium-supported form).
 */
export function buildPuppeteerProxyLaunchPieces(
  config: YellowPagesTaskProxyConfig | undefined
): PuppeteerProxyLaunchPieces {
  if (!config) {
    return { args: [] };
  }
  const host = config.host.trim();
  const port = String(config.port);
  const proto = (config.protocol || "http").toLowerCase();

  if (proto.includes("socks")) {
    const scheme = proto.includes("socks4") ? "socks4" : "socks5";
    let url: string;
    if (config.username && config.password) {
      const u = encodeURIComponent(config.username);
      const p = encodeURIComponent(config.password);
      url = `${scheme}://${u}:${p}@${host}:${port}`;
    } else {
      url = `${scheme}://${host}:${port}`;
    }
    return { args: [`--proxy-server=${url}`] };
  }

  const args = [`--proxy-server=http://${host}:${port}`];
  const authenticate =
    config.username && config.password
      ? { username: config.username, password: config.password }
      : undefined;
  return { args, authenticate };
}
