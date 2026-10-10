import { Injectable, NotFoundException } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../common/prisma.service';

/**
 * Audit fix (P1): this was a plain `interface`, which TypeScript erases — the
 * parameter's runtime metatype was `Object`, so the ValidationPipe skipped it
 * and `PUT /v1/users/me` accepted any body shape. As a class it is validated
 * (and, with forbidNonWhitelisted, unknown fields are rejected instead of
 * silently swallowed).
 *
 * P3 note: `preferredRoastTone` is accepted so the app's payload validates,
 * but the User model has no such column — the preference is not persisted.
 * That needs a schema migration (Phase 4), not a silent drop here.
 */
export class UpdateUserProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  hostelBlock?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  roomNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  preferredRoastTone?: string;
}

@Injectable()
export class UsersService {
  /**
   * Audit fix (P1): `getProfile`/`updateProfile` returned the raw Prisma row,
   * which includes `refreshTokenHash` (authentication material) and
   * `googleSub` — neither is needed by any client. Only expose identity fields
   * the app actually renders.
   */
  private readonly profileSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    hostelBlock: true,
    roomNo: true,
    createdAt: true,
    college: { select: { id: true, name: true, domain: true } },
  } as const;

  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: this.profileSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateUserProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        hostelBlock: dto.hostelBlock,
        roomNo: dto.roomNo,
      },
      select: this.profileSelect,
    });

    return user;
  }
}
