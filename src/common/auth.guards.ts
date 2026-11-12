import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../supabase/supabase.service';
import { AppError } from './app-error';

export interface JwtPayload {
  sub: string;
  role: 'player' | 'admin';
  username?: string;
  /** player token ผูกกับโปร (login แยกต่อโปร) — ไม่มี = token Halloween แบบเดิม */
  cmp?: string;
  /** player ยังใช้รหัสที่ระบบออกให้ → ต้องเปลี่ยนรหัสก่อนใช้ API อื่น (เฉพาะตอน FORCE_PASSWORD_CHANGE=true) */
  pwc?: boolean;
}

/** บังคับเปลี่ยนรหัสครั้งแรก — เปิด/ปิดด้วย env (ค่าเริ่มต้น = ปิด จนกว่า frontend จะพร้อม) */
export const forcePasswordChange = () =>
  ['true', '1', 'yes'].includes((process.env.FORCE_PASSWORD_CHANGE ?? '').trim().toLowerCase());

/** route ที่ player ใช้ได้แม้ยังไม่ได้เปลี่ยนรหัส (POST /me/password) */
export const ALLOW_PASSWORD_CHANGE_PENDING = 'allowPasswordChangePending';
export const AllowPasswordChangePending = () => SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING, true);

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
  constructor(
    private readonly jwt: JwtService,
    private readonly sb: SupabaseService,
    private readonly reflector: Reflector,
  ) { }

  async canActivate(ctx: ExecutionContext) {
    await verify(this.jwt, ctx, 'player');
    const req = ctx.switchToHttp().getRequest();
    const user: JwtPayload = req.user;

    // token ที่ออกตอนยังใช้รหัสระบบ → ต้องเปลี่ยนรหัสก่อน
    if (user.pwc && forcePasswordChange()) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_PENDING, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
      if (!allowed) {
        // เช็คฐานข้อมูลเฉพาะ token ที่มี pwc — ถ้าเปลี่ยนรหัสไปแล้ว (เช่นจากอีกแท็บ) ให้ผ่าน
        const { data, error } = await this.sb.db
          .from('ld_players')
          .select('password_scope')
          .eq('id', user.sub)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new AppError(401, 'UNAUTHORIZED');
        if (data.password_scope) throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED');
      }
    }
    return true;
  }
}

/** admin ที่กำลังเรียก API (โหลดจากฐานข้อมูลทุก request → ปิดบัญชี / เปลี่ยน role มีผลทันที) */
export interface AdminActor {
  id: string;
  username: string;
  role: 'SUPER' | 'STAFF' | 'ADMIN';
  clubId: string | null;
  club: { code: string; name: string } | null;
}

/** route ที่ admin ประจำ club (role ADMIN) ใช้ได้ — นอกนั้น ADMIN ได้ 403 CLUB_ADMIN_FORBIDDEN */
export const CLUB_ADMIN_ALLOWED = 'clubAdminAllowed';
export const ClubAdminAllowed = () => SetMetadata(CLUB_ADMIN_ALLOWED, true);

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly sb: SupabaseService,
    private readonly reflector: Reflector,
  ) { }

  async canActivate(ctx: ExecutionContext) {
    await verify(this.jwt, ctx, 'admin');
    const req = ctx.switchToHttp().getRequest();
    const { data, error } = await this.sb.db
      .from('ld_admins')
      .select('id, username, role, is_active, club_id, club:ld_clubs(code, name)')
      .eq('id', req.user.sub)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError(401, 'UNAUTHORIZED');
    if (!data.is_active) throw new AppError(403, 'ADMIN_DISABLED');

    const club = (Array.isArray(data.club) ? data.club[0] : data.club) as { code: string; name: string } | null;
    const actor: AdminActor = {
      id: data.id,
      username: data.username,
      role: data.role,
      clubId: data.club_id,
      club: club ? { code: club.code.toUpperCase(), name: club.name } : null,
    };
    req.admin = actor;

    if (actor.role === 'ADMIN') {
      const allowed = this.reflector.getAllAndOverride<boolean>(CLUB_ADMIN_ALLOWED, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
      if (!allowed) throw new AppError(403, 'CLUB_ADMIN_FORBIDDEN');
      if (!actor.clubId) throw new AppError(403, 'ADMIN_NO_CLUB');
    }
    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminActor => ctx.switchToHttp().getRequest().admin,
);

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