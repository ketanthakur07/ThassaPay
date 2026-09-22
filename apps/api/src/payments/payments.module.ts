import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReconciliationJob } from './reconciliation.job';
import { PrismaService } from '../common/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, ReconciliationJob, PrismaService, JwtAuthGuard],
})
export class PaymentsModule {}
