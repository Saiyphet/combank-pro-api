import { CanActivate, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from './app-error';

/** เปิดให้หมุนเฉพาะช่วง CAMPAIGN_START – CAMPAIGN_END (ไม่ตั้ง = เปิดตลอด) */
@Injectable()
export class CampaignGuard implements CanActivate {
  private readonly start?: number;
  private readonly end?: number;

  constructor(config: ConfigService) {
    const s = config.get<string>('CAMPAIGN_START');
    const e = config.get<string>('CAMPAIGN_END');
    this.start = s ? Date.parse(s) : undefined;
    this.end = e ? Date.parse(e) : undefined;
  }

  canActivate() {
    const now = Date.now();
    if ((this.start && now < this.start) || (this.end && now > this.end)) {
      throw new AppError(403, 'CAMPAIGN_CLOSED', {
        startsAt: this.start ? new Date(this.start).toISOString() : null,
        endsAt: this.end ? new Date(this.end).toISOString() : null,
      });
    }
    return true;
  }
}
