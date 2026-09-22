import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  async requestOtp(@Body() body: { phoneNumber: string }) {
    return this.authService.requestPhoneOtp(body.phoneNumber);
  }

  @Post('otp/verify')
  async verifyOtp(@Body() body: { phoneNumber: string; otp: string }) {
    return this.authService.verifyPhoneOtp(body.phoneNumber, body.otp);
  }
}
