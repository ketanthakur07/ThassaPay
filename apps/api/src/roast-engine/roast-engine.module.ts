import { Module } from '@nestjs/common';
import { RoastEngineService } from './roast-engine.service';
import { RoastEngineController } from './roast-engine.controller';

@Module({
  controllers: [RoastEngineController],
  providers: [RoastEngineService],
  exports: [RoastEngineService],
})
export class RoastEngineModule {}
