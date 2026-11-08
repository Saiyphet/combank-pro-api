import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError } from './app-error';

export interface JwtPayload {
  sub: string;
  role: 'player' | 'admin';
  username?: string;
  /** player token ผูกกับโปร (login แยกต่อโปร) — ไม่มี = token Halloween แบบเดิม */
  cmp?: string;
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
  constructor(private readonly jwt: JwtService) { }
  canActivate(ctx: ExecutionContext) {
    return verify(this.jwt, ctx, 'player');
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) { }
  canActivate(ctx: ExecutionContext) {
    return verify(this.jwt, ctx, 'admin');
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload => ctx.switchToHttp().getRequest().user,
);

/**
 * ใช้หลัง PlayerGuard — login แยกต่อโปร:
 *  - route ที่มี :code → token ต้องเป็นของโปรนั้น (cmp = code)
 *  - route Halloween เดิม (ไม่มี :code) → token ไม่มี cmp หรือ cmp = halloween
 * ไม่ตรง → 401 CAMPAIGN_LOGIN_REQUIRED { campaign } ให้ frontend พาไปหน้า login ของโปรนั้น
 */
@Injectable()
export class CampaignTokenGuard implements CanActivate {
  private readonly halloween = process.env.HALLOWEEN_CAMPAIGN_CODE || 'halloween-2026';

  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const user: JwtPayload | undefined = req.user;
    const code: string | undefined = req.params?.code?.trim().toLowerCase();
    const required = code ?? this.halloween;
    const ok = code ? user?.cmp === code : !user?.cmp || user.cmp === this.halloween;
    if (!ok) throw new AppError(401, 'CAMPAIGN_LOGIN_REQUIRED', { campaign: required });
    return true;
  }
}