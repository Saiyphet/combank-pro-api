import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';
import { AppError, must, throwRpcError } from '../common/app-error';
import { JwtPayload, forcePasswordChange } from '../common/auth.guards';
import { PlayerRow, RpcSpinResult, mapRowSpin, mapRpcPrize } from '../common/mappers';
import { WheelService } from './wheel.service';
import { LoginDto } from './login.dto';

/** สิทธิ์ Halloween: 1,666 hands = 1 กล่อง (account สร้างได้โดยไม่ต้องถึง) */
export const HALLOWEEN_MIN_HANDS = 1666;

@Injectable()
export class PlayerService {
  constructor(
    private readonly sb: SupabaseService,
    private readonly jwt: JwtService,
    private readonly wheels: WheelService,
  ) { }

  async login(dto: LoginDto) {
    const user = must(
      await this.sb.db
        .from('ld_players')
        .select('id, password_hash, is_active, password_scope')
        .eq('username', dto.username.trim().toLowerCase())
        .maybeSingle(),
    ) as { id: string; password_hash: string; is_active: boolean; password_scope: string | null } | null;

    if (!user || !(await bcrypt.compare(dto.password, user.password_hash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS');
    }
    if (!user.is_active) throw new AppError(403, 'PLAYER_DISABLED');

    // login แยกต่อโปร: token ผูกกับโปรที่ login เข้า
    const halloween = process.env.HALLOWEEN_CAMPAIGN_CODE || 'halloween-2026';
    const campaign = (dto.campaign ?? halloween).trim().toLowerCase();
    const camp = must(
      await this.sb.db.from('ld_campaigns').select('code, status').eq('code', campaign).maybeSingle(),
    ) as { code: string; status: string } | null;
    if (!camp && campaign !== halloween) throw new AppError(404, 'CAMPAIGN_NOT_FOUND');
    if (camp?.status === 'COMING_SOON') throw new AppError(403, 'CAMPAIGN_NOT_OPEN');

    // ยังใช้รหัสที่ระบบออกให้ (admin สร้าง / import / Super reset) → ต้องเปลี่ยนรหัสก่อน
    // บัญชีเก่าที่ระบบไม่ได้เก็บรหัส (password_scope = null) ไม่ถูกบังคับ
    const mustChangePassword = !!user.password_scope;
    const payload: JwtPayload = { sub: user.id, role: 'player' };
    if (dto.campaign) payload.cmp = campaign;
    if (mustChangePassword && forcePasswordChange()) payload.pwc = true;
    const accessToken = await this.jwt.signAsync(payload);
    const me = await this.me(user.id);
    return {
      accessToken,
      campaign,
      player: {
        id: me.id,
        displayName: me.displayName,
        spinStatus: me.spinStatus,
        halloweenEligible: me.halloweenEligible,
        mustChangePassword,
      },
    };
  }

  /** ลูกค้าเปลี่ยนรหัสเอง → ส่ง token ใหม่ (โปรเดิม, ไม่มี pwc) กลับไป ไม่ต้อง login ซ้ำ */
  async changePassword(user: JwtPayload, dto: { currentPassword: string; newPassword: string }) {
    const playerId = user.sub;
    const row = must(
      await this.sb.db.from('ld_players').select('id, password_hash, is_active').eq('id', playerId).maybeSingle(),
    ) as { id: string; password_hash: string; is_active: boolean } | null;
    if (!row || !row.is_active) throw new AppError(403, 'PLAYER_DISABLED');
    if (!(await bcrypt.compare(dto.currentPassword, row.password_hash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS');
    }
    if (dto.currentPassword === dto.newPassword) throw new AppError(400, 'PASSWORD_SAME');
    must(
      await this.sb.db
        .from('ld_players')
        .update({
          password_hash: await bcrypt.hash(dto.newPassword, 10),
          password_enc: null, // รหัสที่ลูกค้าตั้งเอง ไม่เก็บ — admin ดูไม่ได้
          password_scope: null,
          password_changed_at: new Date().toISOString(),
        })
        .eq('id', playerId)
        .select('id'),
    );
    const payload: JwtPayload = { sub: playerId, role: 'player' };
    if (user.cmp) payload.cmp = user.cmp;
    const accessToken = await this.jwt.signAsync(payload);
    return { ok: true, accessToken, campaign: user.cmp ?? (process.env.HALLOWEEN_CAMPAIGN_CODE || 'halloween-2026') };
  }

  async me(playerId: string) {
    const row = must(
      await this.sb.db.from('ld_admin_players').select('*').eq('id', playerId).maybeSingle(),
    ) as PlayerRow | null;
    if (!row) throw new AppError(401, 'UNAUTHORIZED');
    if (!row.is_active) throw new AppError(403, 'PLAYER_DISABLED');

    return {
      id: row.id,
      displayName: row.display_name,
      xpokerPlayerId: row.xpoker_player_id,
      club: row.club_code ? { code: row.club_code.toUpperCase(), name: row.club_name } : null,
      handsCount: row.hands_count,
      halloweenEligible: row.hands_count >= HALLOWEEN_MIN_HANDS,
      spinStatus: row.spin_status,
      spin: mapRowSpin(row),
    };
  }

  prizes() {
    return this.wheels.publicWheels();
  }

  /** วงล้อหลัก */
  async spin(playerId: string) {
    const p = must(
      await this.sb.db.from('ld_players').select('hands_count').eq('id', playerId).maybeSingle(),
    ) as { hands_count: number } | null;
    if (p && p.hands_count < HALLOWEEN_MIN_HANDS) {
      throw new AppError(403, 'NOT_ELIGIBLE', { minHands: HALLOWEEN_MIN_HANDS });
    }
    const { data, error } = await this.sb.db.rpc('ld_spin', { p_player_id: playerId });
    if (error) throwRpcError(error);
    const r = data as RpcSpinResult;

    const body = {
      alreadySpun: r.already_spun,
      spinId: r.spin_id,
      segment: r.segment,
      slot: await this.wheels.slotOf('main', r.segment),
      status: r.status,
      nextStep: r.status === 'CASH_PENDING' ? 'CASH_SPIN' : null,
      spunAt: r.spun_at,
      prize: mapRpcPrize(r.prize),
    };
    if (r.already_spun) throw new AppError(409, 'ALREADY_SPUN', body);
    return body;
  }

  /** วงล้อเงินสด */
  async spinCash(playerId: string) {
    const { data, error } = await this.sb.db.rpc('ld_spin_cash', { p_player_id: playerId });
    if (error) throwRpcError(error);
    const r = data as RpcSpinResult;

    const body = {
      alreadySpun: r.already_spun,
      spinId: r.spin_id,
      segment: r.segment,
      slot: r.prize ? await this.wheels.slotOf('cash', r.prize.code) : null,
      status: r.status,
      cashSpunAt: r.cash_spun_at,
      prize: mapRpcPrize(r.prize),
    };
    if (r.already_spun) throw new AppError(409, 'CASH_ALREADY_SPUN', body);
    return body;
  }
}