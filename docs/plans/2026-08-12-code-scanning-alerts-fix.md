# Fix Open Code Scanning Alerts + Regression Tests

## Scope
19 open alerts in `docs/code-scanning-alerts.json` (CodeQL). The other 46 are already `fixed`.

## Open alerts by category

| Category (CodeQL rule) | Files | Alerts |
|---|---|---|
| `js/incomplete-multi-character-sanitization` | `src/views/utils/securityUtils.ts` (#60 line 10, #61 line 13) | 2 |
| `js/bad-tag-filter` | `src/views/utils/securityUtils.ts` (#63 line 10, #64 line 267); `src/service/HtmlConversionService.ts` (#62 line 118) | 3 |
| `js/incomplete-url-substring-sanitization` | `src/childprocess/baiduScraper.ts:81` (#49), `bingScraper.ts:19,142` (#50,#51), `yandexScraper.ts:160` (#52), `YellowPagesComAdapter.ts:295` (#53); test files: `yelpAdapterTest.ts:151` (#59), `yellowPagesAdapterTest.ts:151` (#58), `yellComAdapterTest.ts:148` (#57), `192ComAdapterTest.ts:148` (#54), `cookieNormalize.test.ts:119,193` (#55,#56) | 11 |
| `js/insecure-randomness` | `src/childprocess/scrapeManager.ts:528` (#46, root at line 520) | 1 |
| `js/insecure-download` | `src/service/localAiRuntime/LocalAiRuntimeDownloadService.ts:228` (#48) | 1 |
| `js/server-side-unvalidated-url-redirection` | `test/vitest/main/service/LocalAiRuntimeDownloadService.test.ts:267` (#65) | 1 |

## Shared helper (NEW file)
`src/views/utils/urlHostAllowlist.ts` — a registrable-domain check used by the scrapers and by tests:
```ts
export const ALLOWED_HOSTS = { bing: 'bing.com', baidu: 'baidu.com', yandex: ['yandex.com','yandex.ru'], yellowpages: 'yellowpages.com', yelp: 'yelp.com', yell: 'yell.com', '192': '192.com' } as const;
export function isSameRegistrableHost(hostname: string, registrableDomain: string): boolean
export function hostMatchesAny(hostname: string, domains: readonly string[]): boolean
```
Semantics: lowercase the hostname, compare exact equality OR `hostname === 'www.'+domain` OR `hostname.endsWith('.'+domain)`. Refuses to match `evilbing.com` / `bing.com.evil.com` (the exact substring-matching bug CodeQL flags).

## Fixes

### 1. URL substring → registrable-host checks (11 alerts)
- **scrapers** (`baiduScraper.ts`, `bingScraper.ts`×2, `yandexScraper.ts`, `YellowPagesComAdapter.ts`): replace `.endsWith('www.x.com')` / `.endsWith('bing.com')` with `isSameRegistrableHost(host, ALLOWED_HOSTS.x)`. Keep behavior (yandex matches `.com` and `.ru`).
- **test files** (`yelpAdapterTest`, `yellowPagesAdapterTest`, `yellComAdapterTest`, `192ComAdapterTest`): change `hostname.endsWith('x.com')` assertions to exact hostname equality (`=== 'www.x.com'`), which is stricter AND removes the alert.
- **`cookieNormalize.test.ts`**: the `matchesDomain` callback is *test input* for a predicate-based API. Keep it a predicate but switch from `endsWith('youtube.com')` to an exact-equality/registrable check via the new helper, preserving the test intent (accept `youtube.com`/`.youtube.com`, reject `evil.com`). Asserts still expect 1 accepted.

### 2. HTML sanitization: regex blocklist → allowlist parser (5 alerts: #60,#61,#62,#63,#64)
The repo already depends on `sanitize-html` (used in `src/service/emailReceive/EmailHtmlSanitizer.ts`).
- **`securityUtils.ts` — `sanitizeInput.string`**: replace the hand-rolled regex strip (`/<script…>/`, `/<[^>]*>/`, `/[<>]/`) with `sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} })` (text-only). This is the CodeQL-recommended allowlist approach and closes both `bad-tag-filter` and `incomplete-multi-character-sanitization`. Also `checkXss` (#64 line 267) keeps a *detection* regex — refactor to use `sanitize-html`'s diff/`html-to-text` comparison instead of blocklist regex.
- **`HtmlConversionService.cleanHtmlContent`** (markdown-bound, #62): replace the script/style/noscript/comment regex loop with `sanitize-html` using a **broad markdown-preserving allowlist** (p, headings, a, ul, ol, li, code, pre, blockquote, table, img, br, hr, strong, em, div, span, meta[viewport], link[canonical]); `disallowedTagsMode: 'discard'`. Keep the existing inline-event-handler removal as defense-in-depth (no longer the primary control). Verify turndown output parity via new tests.

### 3. Insecure randomness → crypto (1 alert: #46, +line 538 proxy)
- `scrapeManager.ts`: replace `Math.floor(Math.random() * arr.length)` (lines 520 & 538) with `crypto.randomInt(arr.length)` using node's `node:crypto`. Add `import { randomInt } from 'node:crypto'`.

### 4. Insecure download → content/size preflight (1 alert: #48)
`LocalAiRuntimeDownloadService.ts`: before streaming, preflight the response — reject when `Content-Length` exceeds `entry.archiveSizeBytes` (or `maxArchiveBytes`) and when `Content-Type` is not an expected archive type. HTTPS, host allowlist, SHA-256, and size ceiling already exist; the preflight makes the "download is verified" claim explicit and satisfies `js/insecure-download`. Add a minor `verifyResponse(res, entry)` helper.

### 5. Test redirect URL → fixed loopback (#65)
`LocalAiRuntimeDownloadService.test.ts:267`: the mock server sets `Location: req.url` (self-redirect). CodeQL flags `req.url` as unvalidated redirect. Replace with a fixed path constant (`/loop`) so the mock loops deterministically and the alert clears.

## Tests (regression — prevent recurrence)
Add NEW vitest files; the type-check gate runs `tsc --noEmit` so they must be type-clean.

1. **`test/vitest/utilitycode/urlHostAllowlist.test.ts`** (NEW): prove `isSameRegistrableHost` rejects `evilbing.com`, `bing.com.evil.com`, `notbing.com` and accepts `www.bing.com`, `bing.com`. Covers all 11 url-substring cases via parametrized table.
2. **`test/vitest/utilitycode/securityUtilsSanitize.test.ts`** (NEW): pin securityUtils fixes — `<script>`, `<script src=x>`, `<img src=x onerror=alert(1)>`, nested/broken tags, `<svg><script>` all fully neutralized; output contains no `<`/`>`. `checkXss` true for those, false for plain text.
3. **`test/vitest/main/service/HtmlConversionService.test.ts`** (extend existing): `cleanHtmlContent` strips script/style/noscript/comments/event-handlers, preserves `<p>/<a href>/<code>`, output markdown-safe. Add a "script cannot re-form" assertion.
4. **`test/vitest/main/scrapeManagerRandom.test.ts`** (NEW): unit-test the crypto-based index selector extracted into a small pure helper `pickRandomIndex(arr)` to avoid pulling puppeteer-cluster. Asserts 0..len-1, never throws on len 1, distribution sanity.
5. **`test/vitest/main/service/LocalAiRuntimeDownloadService.test.ts`** (extend existing): add a "rejects oversized Content-Length preflight" and "rejects unexpected Content-Type" test, plus keep the redirect-limit test using fixed `/loop`.
6. adapter tests: existing tests continue to pass under the stricter exact-hostname assertions.

## Commits (per CLAUDE.md auto-commit rule)
One commit per logical unit:
1. `feat: add urlHostAllowlist registrable-domain helper`
2. `fix: apply registrable-host checks to baidu/bing/yandex/yellowpages scrapers`
3. `fix: use exact-hostname assertions in adapter search-url tests`
4. `fix: replace regex HTML sanitization with sanitize-html allowlist in securityUtils`
5. `fix: replace regex tag stripping in HtmlConversionService with sanitize-html allowlist`
6. `fix: use crypto.randomInt for scrapeManager account/proxy selection`
7. `fix: add content-length/type preflight to LocalAiRuntimeDownloadService`
8. `fix: avoid unvalidated redirect in download redirect-limit test`
9. `test: add regression tests for code-scanning fixes`

## Non-goals
- The 46 already-`fixed` alerts — left alone.
- Re-architecting the scraper cookie/redirect resolution logic beyond host-validation.
- Changing `sanitizeEmailHtml` (already robust).

## Risk
- `sanitize-html` behavior differs slightly from regex stripping for `cleanHtmlContent` markdown output; tests in step 3 guard parity. If turndown output regresses, fall back to allowlist that includes the unions of currently-preserved tags.

## Verification
- `AIFETCHLY_SKIP_TSC=1` is NOT used — full `tsc` gate must pass.
- `yarn testmain` and `yarn vitest-puppeteer` (utilitycode) green.
- Re-scan: the 19 alert locations no longer match the CodeQL rules (manual rule-pattern check, since we can't run CodeQL locally).