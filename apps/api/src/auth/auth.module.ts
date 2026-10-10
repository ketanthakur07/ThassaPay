import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaService } from '../common/prisma.service';
import { SharedJwtModule } from '../common/shared-jwt.module';

@Module({
  imports: [SharedJwtModule],
  controllers: [AuthController],
  providers: [AuthService, PrismaService],
  exports: [AuthService],
})
export class AuthModule {}
