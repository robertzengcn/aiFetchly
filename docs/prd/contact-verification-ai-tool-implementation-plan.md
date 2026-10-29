# Contact Verification AI Tool — Implementation Plan

Implements `docs/prd/contact-verification-ai-tool-prd.md` following
`docs/prd/contact-verification-ai-tool-technical-design.md`.
Branch: `worktree-emailverify` (the checked-out worktree).

## Scope & key architectural facts verified in code

- New built-in tool `verify_contact_info`, registered in BOTH
  `src/config/skillsRegistry.ts` (`BUILT_IN_SKILLS`) and
  `src/config/aiTools.config.ts` (`STATIC_TOOL_FUNCTIONS`). Shared
  description + schema constants live in a new config module so they
  cannot drift (design §7.1).
- `SkillDefinition` (`entityTypes/skillTypes.ts`) is the exact registry
  shape: `name/description/parameters/tier:"main"/requiresConfirmation:false/
  permissionCategory:"pure"/source:"built-in"/timeoutClass:"network"/execute`.
  `execute` returns `Promise<SkillExecutionResult>` where `result` is
  `Record<string, unknown>`. The snake_case JSON contract is built inside
  `ContactVerificationAiTools`, not in the registry.
- AI gate: reuse `isAiEnabled()` from `src/service/AiFeatureGate.ts`
  (single source of truth: `new Token().getValue(USER_AI_ENABLED) === "true"`,
  try/catch → false). Gate runs BEFORE Zod parse. Mirrors
  `KnowledgeLibraryAiTools`.
- `ToolExecutor.executeContactExtraction` (line ~1442) returns the
  snake_case extraction result directly (`success`, `results[]` with
  `emails/phones/address/socialLinks`). The design wants a `verification`
  block added to each URL result + top-level
  `verification_required`/`verification_performed` markers — extend here.
- Worker boundary: `ContactExtractionWorker.handleExtractContactFromUrls`
  builds the per-URL `UrlExtractionResultMessage` from
  `discoverAndExtractContactInfo`. Per design §15.1, verification is
  composed HERE (per-URL, before `process.send`) so the model never sees
  raw unverified contacts.
- Worker schema `src/schemas/worker/contactExtraction.ts`:
  `contactExtractionWorkerOutboundSchema` (worker→main) and `...Inbound`.
  Extend outbound with optional typed `verification` + `contactEvidence`
  fields (no `z.unknown()`). Uses `lazySchema`; currently imports bare
  `"zod"` — I will NOT touch that import line (avoid churn); new schema
  files I author use `zod/v4` per CLAUDE.md.
- `src/utils/concurrency.ts` `mapWithConcurrency` reused for bounded DNS.
- `ContactDiscovery.discoverAndExtractContactInfo` returns
  `ExtractionResult { success, data?: ContactInfo, error?, method? }`.
  New `ContactEvidenceExtractor` runs BEFORE `page.close()` to capture
  per-value DOM evidence.

## Dependencies (design §6)

`libphonenumber-js` and `validator` are NOT installed anywhere (verified
main + worktree). `@types/validator` IS present in the main repo.
- Add `libphonenumber-js` (runtime; import from `libphonenumber-js/max`)
  and `validator` (runtime) as direct deps via `yarn add` in the MAIN
  repo, then symlink worktree `node_modules` → main repo's
  (worktree-node-modules-symlink memory; worktree currently has none).
- `yarn.lock` is v1 format, no `.yarnrc.yml` — no Berry pitfall.

## emitProgress phase note
`SkillExecutionContext.emitProgress` phase type is currently
`"queued"|"running"|"fetching"|"extracting"|"finalizing"`. Design §12.4
wants `validating/checking_email_domains/checking_phones/finalizing`.
I will NOT widen the shared type (would ripple across SkillExecutor /
query loop). Instead map verification phases onto the existing enum
(`validating`→`running`, `checking_email_domains`→`fetching`,
`checking_phones`→`extracting`, `finalizing`→`finalizing`) and carry the
precise phase in the progress `message` string. Documented in code.

## Implementation phases (TDD: tests first per global testing rule)

### Phase 1 — Contracts, types, local data, config constants
1. `src/entityTypes/contactVerificationTypes.ts`: `ContactVerificationRequest`,
   `ContactVerificationGroup`, `CountryEvidence`, `CountryEvidenceSource`,
   all result interfaces (Email/Phone/Contact/Group/Summary),
   `EmailVerificationStatus`, `PhoneVerificationStatus`,
   `MailRoutingStatus`, `ContactVerificationErrorCode`,
   `ContactVerificationProgress`, `ExtractedContactEvidence`.
2. `src/config/contactVerification.ts`: limits (groups=25, total values=100,
   per-group=50, DNS concurrency=8, DNS timeout=3s, soft deadline=30s,
   progress interval 4/s, cache cap=1000, cache TTLs), `RULES_VERSION`,
   progress phase names, limitations strings.
3. `src/config/contact-verification/disposableEmailDomains.ts`: versioned
   compile-time list + `DISPOSABLE_DOMAINS_VERSION`.
4. `src/config/contact-verification/countryAliases.ts`: name→ISO-3166-1
   alpha-2 map + `COUNTRY_ALIASES_VERSION`.
5. `src/schemas/contactVerification.ts` (Zod v4): external snake_case input
   schema (`contactVerificationInputSchema`, `countryEvidenceSourceSchema`)
   with refinement; exported JSON-schema parameters constant for the
   registry; snake_case result adapter types.
6. Tests: zod parse (email-only/phone-only/mixed/multi-block/partial
   failures/limits/refinement).

### Phase 2 — Email + DNS verifiers (deterministic, runtime-neutral)
7. `src/service/contact-verification/EmailVerifier.ts`: conservative
   cleanup, `domainToASCII`+lowercase, `validator.isEmail` (require domain,
   no display names, reject IP/single-label/localhost), placeholder/role/
   suspicious/disposable local rules, case-preserving dedup, classification
   precedence (§9.9).
8. `src/service/contact-verification/DnsMailRouteResolver.ts`:
   `DnsMailRouteAdapter` interface + production adapter wrapping
   `dns.promises.resolveMx/4/6`, per-op 3s timeout race, 1 retry for temp
   failures only, error→`MailRoutingStatus` mapping (§9.7), never cast
   caught errors to `any`.
9. `src/service/contact-verification/ContactVerificationCache.ts`: bounded
   `Map` (cap 1000, evict expired-then-oldest), domain TTLs
   (mx/implicit=15m, null_mx/no_route/nxdomain=5m, temp=30s), no LRU pkg.
10. Tests (TDD, fake DNS adapter): all rows of §9.7 table + retry/timer
    cleanup + cache eviction. NO public DNS dependency.

### Phase 3 — Phone verifier (runtime-neutral)
11. `src/service/contact-verification/PhoneVerifier.ts`: Unicode NFKC +
    Arabic-Indic digit maps, extension extraction, non-phone heuristics
    (dates/prices/postal/IDs/repeated-digits), explicit `+`/`00`
    international parse (no default region), strong-evidence allowlist
    vs weak (never authorize E.164), `ambiguous_region` on 0 or ≥2 strong
    countries, libphonenumber-js/max parse/isValid/isPossible/type mapping.
12. Tests: every bullet in design §10.5 and PRD §15.2 (multi-region
    fixtures, isolation, weak-evidence never-normalizes).

### Phase 4 — Main service (DI, bounded concurrency, partials)
13. `src/service/contact-verification/ContactVerificationService.ts`:
    `ContactVerificationServiceDeps` (dnsResolver, cache, now), default
    production ctor, `verify(request, options)` runs §12.2 phases,
    `mapWithConcurrency` for email domains, signal checks, partial-results
    (unknown/possible/ambiguous_region on skip), deterministic ordering,
    summary counters, dataVersions block, privacy-safe.
14. Tests: batch dedup, partials, cancellation, deadline, stable ordering,
    summary correctness, DI.

### Phase 5 — Direct AI tool + redaction + discovery
15. `src/service/ContactVerificationAiTools.ts`: `verifyContactInfoForAi
    (args, context)` — AI gate FIRST, Zod parse, call service, convert
    camelCase→snake_case result (§8), emit progress, handle `AbortSignal`.
16. Register in `skillsRegistry.ts` (`BUILT_IN_SKILLS`, after
    `extract_contact_info`) and `aiTools.config.ts`
    (`STATIC_TOOL_FUNCTIONS`), both sourcing description+schema from the
    shared config/schema module.
17. `src/service/ToolExecutor.ts`: add `case "verify_contact_info"` +
    private `executeContactVerification` delegating to the same
    `verifyContactInfoForAi` (one shared function — §14.4).
18. `src/service/SkillExecutor.ts` `sanitizeValue`: extend with a
    contact-key set (`email,emails,phone,phones,nearbytext,address,
    countryevidence,evidencetext,contacts`) → log counts not values (§17.1).
    Keep existing `SENSITIVE_KEY_RE`.
19. `src/service/ToolLoadPolicyService.ts`: add
    `CONTEXTUAL_VERIFICATION_TOOL_NAMES` set + `VERIFY_CONTACT_INTENT_RE`
    (verify|validate|check|clean|normalize|classify NEAR
    email|mail address|phone|telephone|mobile|contact), wire into `classify()`.
20. `src/service/ToolCatalogService.ts` `TOOL_SEARCH_HINTS`: add
    verify_contact_info hints (§16.2).
21. `src/service/BuiltInToolCapabilitiesPromptSection.ts`: replace the
    extraction-only row with the grouped extraction+verification row (§16.3).
22. `extract_contact_info` description: append §16.4 postcondition + the
    "do not re-verify when verification_performed:true" note, in BOTH
    skillsRegistry and aiTools.config.
23. Tests: `ContactVerificationAiTools.test.ts` (AI-disabled-before-parse,
    email/phone/mixed, batch limits, snake_case mapping, progress,
    cancellation, partial, no-permission-prompt, redacted audit),
    `SkillExecutorContactRedaction.test.ts`, extend
    `ToolLoadPolicyService.test.ts` + `ToolCatalogService.test.ts`.

### Phase 6 — Extraction evidence + automatic worker composition
24. `src/childprocess/contact-extraction/ContactEvidenceExtractor.ts`:
    capture JSON-LD Organization/LocalBusiness/ContactPoint/address,
    `mailto:`/`tel:` anchors, text matches, regex fallback; nearest bounded
    semantic container; cap nearby 1500 / evidence 240 chars; strong-only
    evidence scoping (§11).
25. `src/entityTypes/contactExtractionTypes.ts`: extend `ContactInfo` with
    optional `contactEvidence?: readonly ExtractedContactEvidence[]`.
26. `src/schemas/worker/contactExtraction.ts`: extend
    `contactExtractionWorkerOutboundSchema` `extract-contact-url-result`
    `data` with optional typed `verification` + `contactEvidence`.
27. `src/childprocess/contact-extraction/ContactExtractionWorker.ts`: after
    `discoverAndExtractContactInfo`, build evidence groups via
    `ContactEvidenceExtractor`, call `ContactVerificationService.verify`,
    attach `verification` to the payload. Failure isolation (§15.2):
    on verifier throw, synthesize unknown/ambiguous_region, `partial:true`,
    keep `success:true`.
28. `src/childprocess/contact-extraction/ContactDiscovery.ts`: expose the
    page/evidence to `ContactEvidenceExtractor` before `finally` closes it
    (capture during success branches where the page is still open, return
    evidence alongside `ContactInfo`).
29. `src/main-process/communication/urlExtractionCollector.ts`: widen
    `UrlContactExtractionResult.data` to carry optional `verification` +
    `contactEvidence` (type-only; no verification logic — §5.2).
30. `src/main-process/communication/contactExtraction-ipc.ts`
    `handleUrlExtractionResult`: pass through verification fields to
    collector. Main-process compatibility fallback (§15.4): if a worker
    result lacks `verification` (old bundle), run the shared verifier in
    main WITHOUT page-level address as strong evidence, attach completed
    shape, emit counts+version warning (no contacts).
31. `src/service/ToolExecutor.executeContactExtraction`: include
    `verification` block per URL result + top-level
    `verification_required:false` + `verification_performed:true` (§8.5).
32. Tests: extend `contactExtractionWorkerIpc.test.ts` (verified, partial,
    raw-compat, malformed rejection), new `contactExtractionRecovery.test.ts`
    (no-contact skips verify, email/phone-only includes verify, multinational
    isolation, verifier failure→partial-uncertain, timeout partial has verify,
    old-worker fallback), extend
    `test/vitest/utilitycode/schemas/contactExtractionWorker.test.ts`.
33. Dependency-graph guard test: assert worker verification import chain
    pulls no Electron/TypeORM/Token (DoD #10).

### Phase 7 — Packaging, typecheck, full suites
34. `forge.config.js` / packaged-worker: confirm new deps + data modules
    bundle into the worker (verify `libphonenumber-js/max` + `validator`
    resolve in ASAR — likely no config change, verify).
35. Run: `yarn tsc` (one-shot), `yarn vue-check` (one-shot), focused
    vitest files, then `yarn testmain`, `yarn vitest-puppeteer`.

## Commits (CLAUDE.md auto-commit rule — one per logical unit)
Commit after each phase's completed unit (types+config, EmailVerifier,
DnsMailRouteResolver, PhoneVerifier, Service, AI tool+redaction+discovery,
extraction worker composition, tests). NO `--no-verify`; pre-commit
husky/lint-staged/tsc gate must pass — fix all reported errors. Each
commit: `<type>: <desc>`.

## Definition of Done (design §26 + PRD §20)
- `verify_contact_info` callable directly + via ToolExecutor.
- AI gate before parse. No paid/SMTP/call/text.
- `extract_contact_info` returns verification for every extracted
  email/phone; partial snapshots verified-or-uncertain.
- National phones get E.164 only from explicit `+`/`00` or one strong
  same-block country; weak hints never normalize.
- Temp DNS → `unknown`, never `invalid`.
- No raw contacts/context in logs/telemetry.
- Worker verifier imports no Electron/TypeORM/Token.
- Tool descriptions/policy/catalog/capabilities prompt agree.
- Backward-compatible extraction fields. No DB migration/renderer change.
- `yarn tsc`, `yarn vue-check`, `yarn testmain`, focused vitest pass.
