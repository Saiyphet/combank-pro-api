import { CanActivate, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { AppError } from './app-error';

/**
 * ด่านหมุน Halloween:
 *  1) ช่วง CAMPAIGN_START – CAMPAIGN_END ใน env (ไม่ตั้ง = เปิดตลอด)
 *  2) สวิตช์ในฐานข้อมูล ld_campaigns (code = HALLOWEEN_CAMPAIGN_CODE, ค่าเริ่มต้น halloween-2026)
 *     หมุนได้เมื่อ status = OPEN · admin ปิดด้วย PATCH /api/admin/campaigns/halloween-2026 { "status": "ENDED" }
 *     ไม่มีแถว = เปิด
 */
@Injectable()
export class CampaignGuard implements CanActivate {
  private readonly start?: number;
  private readonly end?: number;
  private readonly code?: string;

  constructor(
    config: ConfigService,
    private readonly sb: SupabaseService,
  ) {
    const prefix = this.envPrefix();
    const s = config.get<string>(`${prefix}_START`);
    const e = config.get<string>(`${prefix}_END`);
    this.start = s ? Date.parse(s) : undefined;
    this.end = e ? Date.parse(e) : undefined;
    if (prefix === 'CAMPAIGN') this.code = config.get<string>('HALLOWEEN_CAMPAIGN_CODE') || 'halloween-2026';
  }

  protected envPrefix() {
    return 'CAMPAIGN';
  }

  async canActivate() {
    const now = Date.now();
    const closed = () =>
      new AppError(403, 'CAMPAIGN_CLOSED', {
        startsAt: this.start ? new Date(this.start).toISOString() : null,
        endsAt: this.end ? new Date(this.end).toISOString() : null,
      });
    if ((this.start && now < this.start) || (this.end && now > this.end)) throw closed();

    if (!this.code) return true;
    const { data, error } = await this.sb.db
      .from('ld_campaigns')
      .select('status')
      .eq('code', this.code)
      .maybeSingle();
    if (error) throw error;
    if (data && data.status !== 'OPEN') throw closed();
    return true;
  }
}

/** That Luang opens on its own dates: THATLUANG_START to THATLUANG_END (unset = always open) */
@Injectable()
export class ThatLuangCampaignGuard extends CampaignGuard {
  protected envPrefix() {
    return 'THATLUANG';
  }
}
