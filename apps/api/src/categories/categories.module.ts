import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { PrismaService } from '../common/prisma.service';
import { SharedJwtModule } from '../common/shared-jwt.module';

@Module({
  imports: [SharedJwtModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, PrismaService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
