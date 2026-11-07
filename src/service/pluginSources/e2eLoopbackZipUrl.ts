/**
 * E2E-only: loopback http zip URL served by the FakePluginHub fixture
 * (deterministic critical install flow, UPD-GAP-05/06).
 *
 * Gated on BOTH AIFETCHLY_E2E=1 and the launcher-only AIFETCHLY_E2E_ROOT
 * sentinel — both are set exclusively by the sanitized E2E launcher and
 * validated by the E2E bootstrap, so a packaged or developer launch with a
 * hostile AIFETCHLY_E2E env var alone can never activate the exception. The
 * E2E network guard already denies every non-loopback host in that mode, so
 * this exception cannot widen the reachable surface.
 *
 * Source of truth: Spec §5.6. Shared by the URL classifier
 * (UrlPluginFetcher.classifyUrlKind) AND the default bounded transport
 * (PluginHttpDownloadService.defaultRequest) so the classification and the
 * actual download always agree on which layer serves the fixture.
 */

export function isE2ELoopbackHttpZipUrl(raw: string): boolean {
  if (process.env.AIFETCHLY_E2E !== "1") return false;
  if (!process.env.AIFETCHLY_E2E_ROOT) return false;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(raw)) return false;
  if (!/\.zip(\?.*)?$/i.test(raw)) return false;
  return true;
}
