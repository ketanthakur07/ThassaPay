import '../src/common/bigint-json'; // installs BigInt.prototype.toJSON (idempotent)
import { installBigIntJsonSerialization } from '../src/common/bigint-json';
import { healthHandler } from '../src/common/health';

/**
 * Audit (Step 7): BigInt serialization boundary matrix.
 *
 * Representation decision: paise cross the JSON boundary as *numbers* — exact
 * for every integer up to 2^53-1. We never divide by 100 into a float, and we
 * never silently round an unsafe value: it throws instead.
 */
describe('BigInt JSON serialization (money boundary)', () => {
  const matrix: Array<[string, bigint, number]> = [
    ['1 paise', 1n, 1],
    ['10 paise', 10n, 10],
    ['99 paise', 99n, 99],
    ['₹1', 100n, 100],
    ['₹999.99', 99999n, 99999],
    ['₹0.01', 1n, 1],
    ['₹9,99,999.99', 99999999n, 99999999],
    ['very large but safe', 9007199254740991n, 9007199254740991],
  ];

  it.each(matrix)('serialises %s (%s paise) as the exact JSON number %p', (_label, paise, expected) => {
    const json = JSON.stringify({ amountPaise: paise });
    expect(json).toBe(`{"amountPaise":${expected}}`);
    expect(JSON.parse(json).amountPaise).toBe(expected);
  });

  it('keeps precision across a full parse round-trip (no float drift)', () => {
    const value = 9999999999999n; // ₹99,99,99,99,999.99
    const roundTripped = BigInt(JSON.parse(JSON.stringify({ v: value })).v);
    expect(roundTripped).toBe(value);
  });

  it('emits an integer, never a float, for whole paise', () => {
    expect(JSON.stringify({ v: 25050n })).toBe('{"v":25050}');
    expect(JSON.stringify({ v: 1n })).toBe('{"v":1}');
  });

  it('throws instead of rounding a value beyond the safe integer range', () => {
    const unsafe = 9007199254740992n; // 2^53
    expect(() => JSON.stringify({ v: unsafe })).toThrow(/safe integer range/);
  });

  it('is idempotent and non-writable (a request cannot redefine it)', () => {
    expect(() => installBigIntJsonSerialization()).not.toThrow();
    const desc = Object.getOwnPropertyDescriptor(BigInt.prototype, 'toJSON');
    expect(desc?.writable).toBe(false);
    expect(desc?.configurable).toBe(false);
    expect(typeof desc?.value).toBe('function');
  });
});

/**
 * Audit (Step 21): the liveness probe must answer 200 + `{status:"ok"}` and
 * nothing else — no env, no versions, no credentials, no dependency call.
 */
describe('GET /health liveness probe', () => {
  it('returns exactly { status: "ok" } with 200', () => {
    let code = 0;
    let body: unknown;
    healthHandler({} as unknown, {
      status: (c: number) => ({
        json: (b: unknown) => {
          code = c;
          body = b;
        },
      }),
    });

    expect(code).toBe(200);
    expect(body).toEqual({ status: 'ok' });
    expect(Object.keys(body as object)).toEqual(['status']);
  });

  it('does not leak anything from the process environment', () => {
    let body: any;
    healthHandler({} as unknown, {
      status: () => ({ json: (b: unknown) => (body = b) }),
    });
    const serialised = JSON.stringify(body);
    for (const key of Object.keys(process.env)) {
      const value = process.env[key];
      if (value && value.length >= 8) {
        expect(serialised).not.toContain(value);
      }
    }
    expect(serialised).not.toMatch(/postgres|redis|secret|password|version/i);
  });
});
