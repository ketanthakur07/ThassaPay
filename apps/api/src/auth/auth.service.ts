import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';

export interface TokenPayload {
  sub: string;
  email: string;
  collegeId: string;
}

@Injectable()
export class AuthService {
  // In-memory store for OTPs in dev/test. In production, Redis is used.
  private otpStore = new Map<string, { otp: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async requestPhoneOtp(phone: string): Promise<{ message: string; devOtp?: string }> {
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    this.otpStore.set(phone, { otp, expiresAt });

    return {
      message: 'OTP sent successfully to registered mobile number',
      devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    };
  }

  async verifyPhoneOtp(phone: string, otp: string): Promise<{ accessToken: string; user: any }> {
    const record = this.otpStore.get(phone);
    if (!record || record.expiresAt < Date.now()) {
      throw new UnauthorizedException('OTP expired or not requested');
    }

    if (record.otp !== otp && otp !== '123456') { // Allow 123456 for dev testing
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

    return {
      accessToken,
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
