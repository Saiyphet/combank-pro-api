import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';
import { AppError, must, throwRpcError } from '../common/app-error';
import { PlayerRow, RpcSpinResult, mapRowSpin, mapRpcPrize } from '../common/mappers';
import { WheelService } from './wheel.service';
import { LoginDto } from './login.dto';

@Injectable()
export class PlayerService {
  constructor(
    private readonly sb: SupabaseService,
    private readonly jwt: JwtService,
    private readonly wheels: WheelService,
  ) {}

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

    const accessToken = await this.jwt.signAsync({ sub: user.id, role: 'player' });
    const me = await this.me(user.id);
    return {
      accessToken,
      player: { id: me.id, displayName: me.displayName, spinStatus: me.spinStatus },
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
      spinStatus: row.spin_status,
      spin: mapRowSpin(row),
    };
  }

  prizes() {
    return this.wheels.publicWheels();
  }

  /** วงล้อหลัก */
  async spin(playerId: string) {
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