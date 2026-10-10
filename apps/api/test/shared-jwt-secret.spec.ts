import { DEV_JWT_FALLBACK_SECRET, resolveJwtSecret } from '../src/common/shared-jwt.module';

/**
 * Compromised-secret remediation: the dev fallback literal was committed to
 * the public repo, so every token it signed must be treated as forged. The
 * only invalidation path today is secret rotation — production must refuse to
 * boot with the old value, an unset value, or a guessable one.
 */
describe('resolveJwtSecret (compromised-secret remediation)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Fresh copy per test so a leaked mutation cannot mask another case.
    process.env = { ...ORIGINAL_ENV };
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('non-production', () => {
    it('falls back to the dev secret when nothing is configured', () => {
      expect(resolveJwtSecret()).toBe(DEV_JWT_FALLBACK_SECRET);
    });

    it('prefers JWT_ACCESS_SECRET over JWT_SECRET', () => {
      process.env.JWT_ACCESS_SECRET = 'access-secret-value';
      process.env.JWT_SECRET = 'legacy-secret-value';
      expect(resolveJwtSecret()).toBe('access-secret-value');
    });

    it('uses JWT_SECRET when JWT_ACCESS_SECRET is absent', () => {
      process.env.JWT_SECRET = 'legacy-secret-value';
      expect(resolveJwtSecret()).toBe('legacy-secret-value');
    });
  });

  describe('production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('refuses to boot with no secret configured', () => {
      expect(() => resolveJwtSecret()).toThrow(/must be set in production/);
    });

    it('refuses to boot with the compromised dev fallback secret', () => {
      process.env.JWT_ACCESS_SECRET = DEV_JWT_FALLBACK_SECRET;
      expect(() => resolveJwtSecret()).toThrow(/compromised dev fallback/);
    });

    it('also refuses the compromised secret via the legacy JWT_SECRET var', () => {
      process.env.JWT_SECRET = DEV_JWT_FALLBACK_SECRET;
      expect(() => resolveJwtSecret()).toThrow(/compromised dev fallback/);
    });

    it('refuses a secret shorter than 32 characters', () => {
      process.env.JWT_ACCESS_SECRET = 'short-but-not-the-dev-secret';
      expect(() => resolveJwtSecret()).toThrow(/at least 32 characters/);
    });

    it('accepts a rotated 32+ character secret', () => {
      const rotated = 'rotated-secret-please-rotate-again-soon-0123456789';
      process.env.JWT_ACCESS_SECRET = rotated;
      expect(resolveJwtSecret()).toBe(rotated);
    });
  });
});
