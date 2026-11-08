import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';
import { AppError, must, throwRpcError } from '../common/app-error';
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
        .select('id, password_hash, is_active')
        .eq('username', dto.username.trim().toLowerCase())
        .maybeSingle(),
    ) as { id: string; password_hash: string; is_active: boolean } | null;

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

    const accessToken = await this.jwt.signAsync(
      dto.campaign ? { sub: user.id, role: 'player', cmp: campaign } : { sub: user.id, role: 'player' },
    );
    const me = await this.me(user.id);
    return {
      accessToken,
      campaign,
      player: {
        id: me.id,
        displayName: me.displayName,
        spinStatus: me.spinStatus,
        halloweenEligible: me.halloweenEligible,
      },
    };
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
      club: { code: row.club_code.toUpperCase(), name: row.club_name },
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