import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';

/**
 * Audit (Step 9): JWT architecture. One guard, one secret, 15-minute expiry.
 * Covers missing / malformed / forged / expired / subject-less tokens and
 * asserts that the authenticated identity comes from the verified `sub`
 * claim — which is what every ownership check in the services keys off.
 */
const SECRET = 'unit-test-secret-not-a-real-one';

function makeGuard(secret = SECRET): JwtAuthGuard {
  const jwt = new JwtService({ secret, signOptions: { expiresIn: '15m' } });
  return new JwtAuthGuard(jwt);
}

function contextWith(header?: string): ExecutionContext {
  const req: any = { headers: header ? { authorization: header } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const payload = { sub: 'user-a', email: 'a@hostel.ac.in', collegeId: 'college-1' };

  it('rejects a missing Authorization header', async () => {
    await expect(makeGuard().canActivate(contextWith(undefined))).rejects.toThrow(
      /Missing bearer token/,
    );
  });

  it('rejects a header that is not a Bearer token', async () => {
    await expect(makeGuard().canActivate(contextWith('Basic abc'))).rejects.toThrow(
      /Missing bearer token/,
    );
  });

  it('rejects a malformed token', async () => {
    await expect(makeGuard().canActivate(contextWith('Bearer not-a-jwt'))).rejects.toThrow(
      /Invalid or expired token/,
    );
  });

  it('rejects a token signed with a different secret (forged)', async () => {
    const attacker = new JwtService({ secret: 'attacker-secret', signOptions: { expiresIn: '15m' } });
    const forged = attacker.sign(payload);
    await expect(makeGuard().canActivate(contextWith(`Bearer ${forged}`))).rejects.toThrow(
      /Invalid or expired token/,
    );
  });

  it('rejects an expired token', async () => {
    const shortLived = new JwtService({ secret: SECRET, signOptions: { expiresIn: '-1s' } });
    const expired = shortLived.sign(payload);
    await expect(makeGuard().canActivate(contextWith(`Bearer ${expired}`))).rejects.toThrow(
      /Invalid or expired token/,
    );
  });

  it('rejects an alg:none style unsigned attempt (only HS256 with our secret verifies)', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
    await expect(makeGuard().canActivate(contextWith(`Bearer ${unsigned}`))).rejects.toThrow(
      /Invalid or expired token/,
    );
  });

  it('rejects a correctly-signed token that carries no subject', async () => {
    const noSub = new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } }).sign({
      email: 'a@hostel.ac.in',
    });
    await expect(makeGuard().canActivate(contextWith(`Bearer ${noSub}`))).rejects.toThrow(
      /Invalid token subject/,
    );
  });

  it('accepts a valid token and derives identity from the verified sub claim', async () => {
    const token = new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } }).sign(payload);
    const ctx = contextWith(`Bearer ${token}`);
    await expect(makeGuard().canActivate(ctx)).resolves.toBe(true);

    const req = (ctx.switchToHttp() as any).getRequest();
    expect(req.user).toEqual({ id: 'user-a', collegeId: 'college-1' });
    // The client cannot influence this: identity comes from the signature-
    // protected payload, never from a header/body field.
    expect(req.headers['x-user-id']).toBeUndefined();
  });

  it('treats UnauthorizedException from inside as-is (no double wrapping)', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(contextWith('Bearer bad'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
