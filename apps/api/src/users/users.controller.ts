import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { UsersService, UpdateUserProfileDto } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Controller('v1/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@CurrentUser() user: CurrentUserPayload) {
    return this.usersService.getProfile(user.id);
  }

  @Put('me')
  updateProfile(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateUserProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }
}
