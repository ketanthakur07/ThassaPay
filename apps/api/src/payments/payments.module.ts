import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReconciliationJob } from './reconciliation.job';
import { PrismaService } from '../common/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SharedJwtModule } from '../common/shared-jwt.module';

@Module({
  imports: [SharedJwtModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, ReconciliationJob, PrismaService, JwtAuthGuard],
})
export class PaymentsModule {}
