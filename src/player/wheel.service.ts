import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { must } from '../common/app-error';

interface MainOddsRow {
  code: string;
  name: string;
  sort_order: number;
  qty_total: number;
  qty_remaining: number;
  w: number;
  odds_pct: number | string | null;
}

interface CashOddsRow extends MainOddsRow {
  value_lak: number | null;
  image_url: string | null;
}

/** อ่านอัตราสดของ 2 วงล้อ (ld_main_wheel_odds / ld_cash_wheel_odds) */
@Injectable()
export class WheelService {
  constructor(private readonly sb: SupabaseService) {}

  async raw() {
    const [main, cash] = await Promise.all([
      this.sb.db.from('ld_main_wheel_odds').select('*').order('sort_order'),
      this.sb.db.from('ld_cash_wheel_odds').select('*').order('sort_order'),
    ]);
    return { main: must<MainOddsRow[]>(main), cash: must<CashOddsRow[]>(cash) };
  }

  /** รูปแบบสำหรับผู้เล่น (GET /api/prizes) */
  async publicWheels() {
    const { main, cash } = await this.raw();
    return {
      mainWheel: {
        totalRemaining: sum(main.map((r) => r.qty_remaining)),
        segments: main.map((r, i) => ({
          slot: i + 1,
          code: r.code,
          name: r.name,
          qtyTotal: r.qty_total,
          qtyRemaining: r.qty_remaining,
          oddsPct: Number(r.odds_pct ?? 0),
        })),
      },
      cashWheel: {
        totalRemaining: sum(cash.map((r) => r.qty_remaining)),
        segments: cash.map((r, i) => ({
          slot: i + 1,
          code: r.code,
          name: r.name,
          valueLak: r.value_lak,
          imageUrl: r.image_url,
          qtyTotal: r.qty_total,
          qtyRemaining: r.qty_remaining,
          oddsPct: Number(r.odds_pct ?? 0),
        })),
      },
    };
  }

  // ลำดับช่องไม่เปลี่ยนระหว่างแคมเปญ — แคชไว้
  private slots?: { main: Map<string, number>; cash: Map<string, number> };

  async slotOf(wheel: 'main' | 'cash', code: string): Promise<number | null> {
    if (!this.slots) {
      const { main, cash } = await this.raw();
      this.slots = {
        main: new Map(main.map((r, i) => [r.code, i + 1])),
        cash: new Map(cash.map((r, i) => [r.code, i + 1])),
      };
    }
    return this.slots[wheel].get(code) ?? null;
  }
}

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
