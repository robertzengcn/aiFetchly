/**
 * Proxy URL/server conversion utilities — extracted from lib/function.ts (R5.6).
 *
 * These 3 functions convert between the two proxy representations used across
 * the scraper stack: ProxyParseItem (parsed from user input) ↔ ProxyServer
 * (puppeteer-page-proxy format) ↔ URL string.
 */
import { ProxyParseItem, ProxyServer } from "@/entityTypes/proxyType";

/** Convert a proxy entity to a URL string (protocol://[user:pass@]host:port). */
export function proxyEntityToUrl(proxyEntity: ProxyParseItem): string {
  if (!proxyEntity.protocol) {
    throw new Error("protocol is required");
  }
  if (!proxyEntity.host) {
    throw new Error("host is required");
  }
  if (!proxyEntity.port) {
    throw new Error("port is required");
  }
  let proxyUrl = "";
  if (proxyEntity.protocol.includes("http")) {
    if (
      proxyEntity.user &&
      proxyEntity.user?.length > 0 &&
      proxyEntity.pass &&
      proxyEntity.pass?.length > 0
    ) {
      proxyUrl = `${proxyEntity.protocol}://${proxyEntity.user}:${proxyEntity.pass}@${proxyEntity.host}:${proxyEntity.port}`;
    } else {
      proxyUrl = `${proxyEntity.protocol}://${proxyEntity.host}:${proxyEntity.port}`;
    }
  } else if (proxyEntity.protocol.includes("socks")) {
    proxyUrl = `${proxyEntity.protocol}://${proxyEntity.host}:${proxyEntity.port}`;
  } else {
    throw new Error("protocol is not valid");
  }
  return proxyUrl;
}

/** Convert a ProxyServer (puppeteer-page-proxy format) to a URL string. */
export function convertProxyServertourl(proxyServer: ProxyServer): string {
  if (!proxyServer.server) {
    throw new Error("server is required");
  }
  let proxyUrl = "";
  if (
    proxyServer.username &&
    proxyServer.username?.length > 0 &&
    proxyServer.password &&
    proxyServer.password?.length > 0
  ) {
    proxyUrl = `${proxyServer.server}://${proxyServer.username}:${proxyServer.password}`;
  } else {
    proxyUrl = `${proxyServer.server}`;
  }
  return proxyUrl;
}

/** Convert a proxy entity to a ProxyServer object. */
export function proxyEntityToServer(proxyEntity: ProxyParseItem): ProxyServer {
  if (!proxyEntity.protocol) {
    throw new Error("protocol is required");
  }
  if (!proxyEntity.host) {
    throw new Error("host is required");
  }
  if (!proxyEntity.port) {
    throw new Error("port is required");
  }
  const proxyUrl = `${proxyEntity.protocol}://${proxyEntity.host}:${proxyEntity.port}`;
  const rest: ProxyServer = {
    server: proxyUrl,
    username: proxyEntity.user,
    password: proxyEntity.pass,
  };
  return rest;
}
