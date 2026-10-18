import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/auth/auth.service';

/**
 * Audit (Step 8): OTP security. The store is in-memory (a Map on the service),
 * so a single instance is testable without Redis/Postgres. Prisma is mocked —
 * only the credential lifecycle is under test here.
 */
const prismaMock = {
  college: { findFirst: jest.fn(), create: jest.fn() },
  user: { findFirst: jest.fn(), create: jest.fn() },
};

const PHONE = '+919876543210';

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.college.findFirst.mockResolvedValue({ id: 'college-1' });
  prismaMock.user.findFirst.mockResolvedValue({
    id: 'user-1',
    email: 'a@hostel.ac.in',
    collegeId: 'college-1',
    name: 'n',
    phone: PHONE,
    hostelBlock: null,
    roomNo: null,
  });
});

function makeAuth(): AuthService {
  return new AuthService(
    prismaMock as any,
    new JwtService({ secret: 'test-secret' }),
    // Mock refresh service: OTP verify now opens a session family. Only the
    // shape matters here — the refresh lifecycle itself is under test in
    // refresh-token.spec.ts.
    { issueForUser: jest.fn().mockResolvedValue({ token: 'raw-refresh-token', sessionId: 's1', familyId: 'f1', expiresAt: new Date() }) } as any,
  );
}

describe('OTP request throttle (1 per minute)', () => {
  beforeEach(() => jest.useRealTimers());

  it('allows the first request and rate-limits an immediate second one', async () => {
    const auth = makeAuth();
    await auth.requestPhoneOtp(PHONE);
    await expect(auth.requestPhoneOtp(PHONE)).rejects.toThrow(BadRequestException);
    await expect(auth.requestPhoneOtp(PHONE)).rejects.toThrow(/wait a minute/i);
  });

  it('allows a new request once the minute has elapsed', async () => {
    jest.useFakeTimers({ now: Date.now() });
    const auth = makeAuth();
    await auth.requestPhoneOtp(PHONE);
    jest.advanceTimersByTime(60_001);
    await expect(auth.requestPhoneOtp(PHONE)).resolves.toBeDefined();
    jest.useRealTimers();
  });

  it('does not return the OTP value in production responses', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const auth = makeAuth();
      const res = await auth.requestPhoneOtp(PHONE);
      expect(res.devOtp).toBeUndefined();
      expect(JSON.stringify(res)).not.toMatch(/\b\d{6}\b/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('returns a dev OTP outside production only', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const auth = makeAuth();
      const res = await auth.requestPhoneOtp(PHONE);
      expect(res.devOtp).toMatch(/^\d{6}$/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('OTP verification', () => {
  beforeEach(() => jest.useRealTimers());

  it('rejects the old dev bypass code 123456 unconditionally', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development'; // bypass used to live here
    try {
      const auth = makeAuth();
      const { devOtp } = await auth.requestPhoneOtp(PHONE);
      await expect(auth.verifyPhoneOtp(PHONE, '123456')).rejects.toThrow(UnauthorizedException);
      // and the real code still works
      await expect(auth.verifyPhoneOtp(PHONE, devOtp!)).resolves.toHaveProperty('accessToken');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('locks out after 5 wrong attempts and invalidates the OTP', async () => {
    const auth = makeAuth();
    const { devOtp } = await auth.requestPhoneOtp(PHONE);

    for (let i = 1; i <= 5; i++) {
      await expect(auth.verifyPhoneOtp(PHONE, '000000')).rejects.toThrow(/Invalid OTP/);
    }
    // 6th attempt: lockout message (not "invalid")
    await expect(auth.verifyPhoneOtp(PHONE, '000000')).rejects.toThrow(/Too many incorrect attempts/);
    // the OTP is gone now — even the correct code must fail
    await expect(auth.verifyPhoneOtp(PHONE, devOtp!)).rejects.toThrow(/expired or not requested/);
  });

  it('rejects an OTP that was never requested', async () => {
    const auth = makeAuth();
    await expect(auth.verifyPhoneOtp(PHONE, '111111')).rejects.toThrow(/expired or not requested/);
  });

  it('rejects an expired OTP', async () => {
    jest.useFakeTimers({ now: Date.now() });
    const auth = makeAuth();
    const { devOtp } = await auth.requestPhoneOtp(PHONE);
    jest.advanceTimersByTime(5 * 60_000 + 1);
    await expect(auth.verifyPhoneOtp(PHONE, devOtp!)).rejects.toThrow(/expired or not requested/);
    jest.useRealTimers();
  });

  it('uses the OTP exactly once (consumed on success)', async () => {
    const auth = makeAuth();
    prismaMock.college.findFirst.mockResolvedValue({ id: 'college-1' });
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.c',
      collegeId: 'college-1',
      name: 'n',
      phone: PHONE,
      hostelBlock: null,
      roomNo: null,
    });

    const { devOtp } = await auth.requestPhoneOtp(PHONE);
    const first = await auth.verifyPhoneOtp(PHONE, devOtp!);
    expect(first.accessToken).toBeTruthy();
    // replay of the same OTP must fail — no replay window
    await expect(auth.verifyPhoneOtp(PHONE, devOtp!)).rejects.toThrow(/expired or not requested/);
  });

  it('never logs or echoes the OTP value in the verify response', async () => {
    const auth = makeAuth();
    prismaMock.college.findFirst.mockResolvedValue({ id: 'college-1' });
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.c',
      collegeId: 'college-1',
      name: 'n',
      phone: PHONE,
      hostelBlock: null,
      roomNo: null,
    });
    const { devOtp } = await auth.requestPhoneOtp(PHONE);
    const res = await auth.verifyPhoneOtp(PHONE, devOtp!);
    expect(JSON.stringify(res)).not.toContain(devOtp!);
    // Login returns the access/refresh pair plus the profile — and never the OTP.
    expect(Object.keys(res)).toEqual(['accessToken', 'refreshToken', 'user']);
    expect(res.refreshToken).toBe('raw-refresh-token');
  });
});
