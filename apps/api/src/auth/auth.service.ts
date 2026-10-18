import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomInt } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

export interface TokenPayload {
  sub: string;
  email: string;
  collegeId: string;
}

/** Only these fields ever leave the auth layer — no password/refresh material. */
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  hostelBlock: string | null;
  roomNo: string | null;
}

/** What a successful login returns: an access/refresh pair plus the profile. */
export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
}

@Injectable()
export class AuthService {
  // OTP store is in-process only. Audit note (P2): the previous comment claimed
  // "in production, Redis is used" — no Redis-backed implementation exists, so
  // OTPs are lost on restart and do not survive across multiple API replicas.
  // Single-instance deployments are correct; horizontal scaling needs a shared
  // store before it is attempted (see docs/PRELAUNCH_AUDIT.md).
  private otpStore = new Map<string, { otp: string; expiresAt: number; attempts: number; requestedAt: number }>();

  /** Drop expired entries so a long-running process cannot grow unbounded. */
  private pruneExpiredOtps(): void {
    const now = Date.now();
    for (const [phone, record] of this.otpStore) {
      if (record.expiresAt < now) this.otpStore.delete(phone);
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  /**
   * Sign a short-lived (15 min) access token for a known user id.
   *
   * The userId MUST come from a server-side lookup (an authenticated session or
   * a verified OTP), never straight from a request body — otherwise a client
   * could mint an access token for any account.
   */
  async signAccessToken(userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      collegeId: user.collegeId,
    };
    return this.jwtService.sign(payload);
  }

  async requestPhoneOtp(phone: string): Promise<{ message: string; devOtp?: string }> {
    this.pruneExpiredOtps();

    // Audit fix (P1): OTP request flooding. Unbounded re-requests let an
    // attacker (or a stuck client) enumerate/generate OTPs endlessly. A phone
    // may request at most 1 new OTP per minute (previous one stays valid).
    const existing = this.otpStore.get(phone);
    if (existing && Date.now() - existing.requestedAt < 60_000) {
      throw new BadRequestException('Please wait a minute before requesting a new OTP');
    }

    // Audit fix (P1): Math.random() is predictable — an attacker who observes
    // one output (or knows the PRNG state) can predict the next OTP.
    // crypto.randomInt is a CSPRNG with an unbiased 6-digit range.
    const otp = randomInt(100000, 1000000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    this.otpStore.set(phone, { otp, expiresAt, attempts: 0, requestedAt: Date.now() });

    return {
      message: 'OTP sent successfully to registered mobile number',
      devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    };
  }

  async verifyPhoneOtp(phone: string, otp: string): Promise<TokenPairResponse> {
    const record = this.otpStore.get(phone);
    if (!record || record.expiresAt < Date.now()) {
      throw new UnauthorizedException('OTP expired or not requested');
    }

    // Audit fix (P1): 5-attempt lockout per OTP. Previously unlimited guesses
    // against a 6-digit space (1e6) made brute force trivial. On lockout the
    // OTP is invalidated and a new one must be requested.
    record.attempts += 1;
    if (record.attempts > 5) {
      this.otpStore.delete(phone);
      throw new UnauthorizedException('Too many incorrect attempts. Request a new OTP.');
    }

    if (record.otp !== otp) {
      throw new UnauthorizedException('Invalid OTP');
    }

    this.otpStore.delete(phone);

    // Find default college or create dummy college for hostel students
    let college = await this.prisma.college.findFirst();
    if (!college) {
      college = await this.prisma.college.create({
        data: {
          name: 'IIT Hostel Campus',
          domain: 'hostel.ac.in',
        },
      });
    }

    // Find or create user by phone
    let user = await this.prisma.user.findFirst({
      where: { phone, deletedAt: null },
    });

    if (!user) {
      const email = `user_${phone.replace(/\D/g, '')}@hostel.ac.in`;
      user = await this.prisma.user.create({
        data: {
          phone,
          name: `Hosteller ${phone.slice(-4)}`,
          email,
          googleSub: `phone_${phone}`,
          collegeId: college.id,
        },
      });
    }

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      collegeId: user.collegeId,
    };

    const accessToken = this.jwtService.sign(payload);

    // New session family per successful login — the raw refresh token is
    // returned once and only its hash is stored (see refresh-token.service.ts).
    const refresh = await this.refreshTokenService.issueForUser(user.id);

    return {
      accessToken,
      refreshToken: refresh.token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        hostelBlock: user.hostelBlock,
        roomNo: user.roomNo,
      },
    };
  }
}
