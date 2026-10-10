import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RequestOtpDto, VerifyOtpDto } from './auth.dto';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Audit fix (P1): typed DTOs — the ValidationPipe now bounds phone/OTP shape
  // before anything reaches the credential store.
  @Post('otp/request')
  async requestOtp(@Body() body: RequestOtpDto) {
    return this.authService.requestPhoneOtp(body.phoneNumber);
  }

  @Post('otp/verify')
  async verifyOtp(@Body() body: VerifyOtpDto) {
    return this.authService.verifyPhoneOtp(body.phoneNumber, body.otp);
  }
}
