import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { RequestOtpDto, VerifyOtpDto, RefreshTokenDto, LogoutDto } from './auth.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  // Audit fix (P1): typed DTOs — the ValidationPipe now bounds phone/OTP shape
  // before anything reaches the credential store.
  @Post('otp/request')
  async requestOtp(@Body() body: RequestOtpDto) {
    return this.authService.requestPhoneOtp(body.phoneNumber);
  }

  @Post('otp/verify')
  async verifyOtp(@Body() body: VerifyOtpDto) {
    // Returns { accessToken, refreshToken, user } — the refresh token opens a
    // new session family and is the only time the raw value leaves the server.
    return this.authService.verifyPhoneOtp(body.phoneNumber, body.otp);
  }

  /**
   * Rotate: consume the presented refresh token, mint its successor.
   *
   * Unguarded by design (the refresh token IS the credential). Reuse of an
   * already-rotated token revokes the whole family. All failures return the
   * same generic 401 from the service — this endpoint reveals nothing.
   */
  @Post('refresh')
  async refresh(@Body() body: RefreshTokenDto) {
    const rotated = await this.refreshTokenService.rotate(body.refreshToken);
    // Re-sign a fresh 15-minute access token for the owning user. The user id
    // comes from the SERVER-side session row, never from the request body.
    const accessToken = await this.authService.signAccessToken(rotated.userId);
    return { accessToken, refreshToken: rotated.token };
  }

  /**
   * Logout this device: revoke the session family behind the refresh token.
   *
   * Authenticated so we can enforce ownership (a user can only revoke their own
   * session). Always returns success — logout is idempotent and must not leak
   * whether a token existed or whose it was.
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: CurrentUserPayload, @Body() body: LogoutDto) {
    await this.refreshTokenService.revokeByToken(body.refreshToken, user.id);
    return { success: true };
  }

  /**
   * Logout everywhere: revoke every live session for the authenticated user.
   * Access JWTs remain valid until their 15-minute expiry (documented limit).
   */
  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  async logoutAll(@CurrentUser() user: CurrentUserPayload) {
    const revoked = await this.refreshTokenService.revokeAllForUser(user.id);
    return { success: true, revokedSessions: revoked };
  }
}
