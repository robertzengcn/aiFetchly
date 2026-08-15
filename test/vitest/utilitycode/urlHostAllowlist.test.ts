/**
 * Regression tests for the registrable-domain host helper.
 *
 * Pins the CodeQL `js/incomplete-url-substring-sanitization` fix: a bare
 * `host.endsWith("bing.com")` check accepted look-alikes such as
 * `evilbing.com` and `bing.com.evil.com`. `isSameRegistrableHost` must
 * reject those while accepting the exact domain, its `www.` prefix, and
 * true subdomains.
 */
import { describe, it, expect } from "vitest";
import {
  isSameRegistrableHost,
  hostMatchesAny,
  ALLOWED_HOSTS,
} from "@/modules/lib/urlHostAllowlist";

describe("isSameRegistrableHost", () => {
  it.each([
    ["bing.com", "bing.com", true],
    ["www.bing.com", "bing.com", true],
    ["search.bing.com", "bing.com", true],
    ["WWW.BING.COM", "bing.com", true],
    [" BING.com ", "bing.com", true],
  ])("accepts %p for %p", (host, domain, expected) => {
    expect(isSameRegistrableHost(host, domain)).toBe(expected);
  });

  it.each([
    // The exact substring-matching bypass CodeQL flagged:
    ["evilbing.com", "bing.com"],
    ["notbing.com", "bing.com"],
    ["bing.com.evil.com", "bing.com"],
    ["bingxcom", "bing.com"],
    ["www.bing.com.evil.com", "bing.com"],
    ["fakeyellowpages.com", "yellowpages.com"],
    ["yellowpages.com.fake.com", "yellowpages.com"],
  ])("rejects look-alike %p for %p", (host, domain) => {
    expect(isSameRegistrableHost(host, domain)).toBe(false);
  });

  it("rejects empty inputs", () => {
    expect(isSameRegistrableHost("", "bing.com")).toBe(false);
    expect(isSameRegistrableHost("bing.com", "")).toBe(false);
    expect(isSameRegistrableHost("", "")).toBe(false);
  });
});

describe("hostMatchesAny", () => {
  it("matches across multiple registrable domains (yandex)", () => {
    expect(hostMatchesAny("yandex.com", ALLOWED_HOSTS.yandex)).toBe(true);
    expect(hostMatchesAny("www.yandex.ru", ALLOWED_HOSTS.yandex)).toBe(true);
    expect(hostMatchesAny("mail.yandex.com", ALLOWED_HOSTS.yandex)).toBe(true);
  });

  it("rejects look-alikes across the set", () => {
    expect(hostMatchesAny("yandex.com.evil.com", ALLOWED_HOSTS.yandex)).toBe(
      false
    );
    expect(hostMatchesAny("evilbaidux.com", ALLOWED_HOSTS.yandex)).toBe(false);
  });
});

describe("ALLOWED_HOSTS contract", () => {
  it("exposes the scraper domains used by the fixes", () => {
    expect(ALLOWED_HOSTS.bing).toBe("bing.com");
    expect(ALLOWED_HOSTS.baidu).toBe("baidu.com");
    expect(ALLOWED_HOSTS.yellowpages).toBe("yellowpages.com");
    expect(ALLOWED_HOSTS.yelp).toBe("yelp.com");
    expect(ALLOWED_HOSTS.yell).toBe("yell.com");
    expect(ALLOWED_HOSTS["192"]).toBe("192.com");
    expect(Array.isArray(ALLOWED_HOSTS.yandex)).toBe(true);
  });
});