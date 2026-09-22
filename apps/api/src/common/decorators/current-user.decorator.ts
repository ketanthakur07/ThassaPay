import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  id: string;
  collegeId: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): CurrentUserPayload => {
  const req = ctx.switchToHttp().getRequest();
  return req.user;
});
