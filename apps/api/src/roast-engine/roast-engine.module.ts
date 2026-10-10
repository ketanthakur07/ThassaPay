import { Module } from '@nestjs/common';
import { RoastEngineService } from './roast-engine.service';
import { RoastEngineController } from './roast-engine.controller';
import { SharedJwtModule } from '../common/shared-jwt.module';

@Module({
  imports: [SharedJwtModule],
  controllers: [RoastEngineController],
  providers: [RoastEngineService],
  exports: [RoastEngineService],
})
export class RoastEngineModule {}
