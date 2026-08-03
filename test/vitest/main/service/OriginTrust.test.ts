'use strict';
import { describe, test, expect } from 'vitest';
import { isAppTrustedOrigin } from '@/service/OriginTrust';

describe('isAppTrustedOrigin', () => {
  test('trusts the configured dev-server origin', () => {
    expect(
      isAppTrustedOrigin('http://localhost:8080/index.html', {
        devServerUrl: 'http://localhost:8080/',
      })
    ).toBe(true);
  });

  test('rejects a different http origin even when a dev server is set', () => {
    expect(
      isAppTrustedOrigin('https://evil.example.com/', {
        devServerUrl: 'http://localhost:8080/',
      })
    ).toBe(false);
  });

  test('trusts app:// scheme (production bundle)', () => {
    expect(isAppTrustedOrigin('app://./index.html')).toBe(true);
  });

  test('trusts about: scheme (sandboxed/blank frames)', () => {
    expect(isAppTrustedOrigin('about:blank')).toBe(true);
  });

  test('trusts file:// scheme (local scaffolding)', () => {
    expect(isAppTrustedOrigin('file:///app/dist/index.html')).toBe(true);
  });

  test('rejects attacker-controlled https origin when no dev server is set', () => {
    expect(isAppTrustedOrigin('https://attacker.example.com/')).toBe(false);
  });

  test('rejects malformed URLs', () => {
    expect(isAppTrustedOrigin('not-a-url')).toBe(false);
  });

  test('rejects undefined/empty input', () => {
    expect(isAppTrustedOrigin(undefined)).toBe(false);
    expect(isAppTrustedOrigin('')).toBe(false);
  });

  test('rejects javascript: and data: schemes', () => {
    expect(isAppTrustedOrigin('javascript:alert(1)')).toBe(false);
    expect(isAppTrustedOrigin('data:text/html,<script>1</script>')).toBe(false);
  });

  test('port mismatch on localhost is rejected', () => {
    expect(
      isAppTrustedOrigin('http://localhost:3000/', {
        devServerUrl: 'http://localhost:8080/',
      })
    ).toBe(false);
  });
});
