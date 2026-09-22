import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RoastEngineService } from './roast-engine.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoastTone } from '@thassapay/types';

@Controller('v1/roast')
@UseGuards(JwtAuthGuard)
export class RoastEngineController {
  constructor(private readonly roastService: RoastEngineService) {}

  @Post('generate')
  generate(
    @Body()
    body: {
      amountPaise: number;
      categoryName: string;
      monthlySpendPaise: number;
      monthlyBudgetPaise?: number;
      tone?: RoastTone;
    },
  ) {
    return this.roastService.generateRoast(body);
  }
}
