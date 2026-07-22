'use strict';
import { describe, test, expect } from 'vitest';
import { redactString, redactMetadata } from '@/modules/diagnostics/DiagnosticRedactor';

describe('DiagnosticRedactor', () => {
  test('redacts Authorization Bearer', () => {
    expect(redactString('Authorization: Bearer abc.def.ghi'))
      .toBe('Authorization: [REDACTED]');
  });

  test('redacts token query params', () => {
    expect(redactString('https://x/y?token=secret&code=cn&state=sn'))
      .toBe('https://x/y?token=[REDACTED]&code=[REDACTED]&state=[REDACTED]');
  });

  test('redacts password fields in metadata', () => {
    const out = redactMetadata({ password: 'p', name: 'alice' });
    expect(out.password).toBe('[REDACTED]');
    expect(out.name).toBe('alice');
  });

  test('coerces unknown leaf types to string', () => {
    const out = redactMetadata({ fn: () => 1, big: BigInt(2) }) as Record<string, unknown>;
    expect(typeof out.fn).toBe('string');
    expect(typeof out.big).toBe('string');
  });

  test('respects max depth', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'x' } } } } } };
    const out = redactMetadata(deep) as Record<string, unknown>;
    expect(typeof JSON.stringify(out)).toBe('string');
  });

  test('respects max property count', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 200; i++) obj[`k${i}`] = i;
    const out = redactMetadata(obj) as Record<string, unknown>;
    expect(Object.keys(out).length).toBeLessThanOrEqual(101);
  });

  test('truncates long string values', () => {
    const long = 'x'.repeat(2000);
    const out = redactMetadata({ blob: long }) as { blob: string };
    expect(out.blob.length).toBeLessThan(2000);
    expect(out.blob).toContain('[truncated');
  });
});
