import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { RefreshSessionSweepJob } from './refresh-session-sweep.job';
import { AuthController } from './auth.controller';
import { PrismaService } from '../common/prisma.service';
import { SharedJwtModule } from '../common/shared-jwt.module';

@Module({
  imports: [SharedJwtModule],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenService, RefreshSessionSweepJob, PrismaService],
  exports: [AuthService, RefreshTokenService],
})
export class AuthModule {}
