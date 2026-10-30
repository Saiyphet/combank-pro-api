import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError } from './app-error';

export interface JwtPayload {
  sub: string;
  role: 'player' | 'admin';
  username?: string;
}

async function verify(jwt: JwtService, ctx: ExecutionContext, role: JwtPayload['role']) {
  const req = ctx.switchToHttp().getRequest();
  const header: string | undefined = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHORIZED');
  try {
    const payload = await jwt.verifyAsync<JwtPayload>(header.slice(7));
    if (payload.role !== role) throw new Error('wrong role');
    req.user = payload;
    return true;
  } catch {
    throw new AppError(401, 'UNAUTHORIZED');
  }
}

@Injectable()
export class PlayerGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  canActivate(ctx: ExecutionContext) {
    return verify(this.jwt, ctx, 'player');
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  canActivate(ctx: ExecutionContext) {
    return verify(this.jwt, ctx, 'admin');
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload => ctx.switchToHttp().getRequest().user,
);
