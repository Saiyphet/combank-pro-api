/** แถวจาก view ld_admin_players */
export interface PlayerRow {
  id: string;
  username: string;
  display_name: string;
  xpoker_player_id: string;
  hands_count: number;
  is_active: boolean;
  created_at: string;
  created_by: string;
  club_code: string | null;
  club_name: string | null;
  club_id: string | null;
  password_scope: 'CLUB' | 'SUPER' | null;
  password_changed_at: string | null;
  spin_status: 'NOT_SPUN' | 'CASH_PENDING' | 'DONE';
  spin_id: string | null;
  main_segment: string | null;
  spun_at: string | null;
  cash_spun_at: string | null;
  fulfillment_status: 'PENDING' | 'DELIVERED' | 'CANCELLED' | null;
  delivered_by: string | null;
  delivered_at: string | null;
  note: string | null;
  prize_code: string | null;
  prize_group: 'CASH' | 'BONUS' | null;
  prize_name: string | null;
  prize_value_lak: number | null;
}

/** prize ใน jsonb ที่ RPC คืน (to_jsonb(ld_prizes)) */
export interface RpcPrize {
  id: string;
  code: string;
  prize_group: 'CASH' | 'BONUS';
  name: string;
  value_lak: number | null;
  image_url: string | null;
  sort_order: number;
}

export interface RpcSpinResult {
  already_spun: boolean;
  spin_id: string;
  segment: string;
  status: 'CASH_PENDING' | 'DONE';
  spun_at: string;
  cash_spun_at: string | null;
  prize: RpcPrize | null;
}

export function mapRpcPrize(p: RpcPrize | null) {
  if (!p) return null;
  return {
    code: p.code,
    group: p.prize_group,
    name: p.name,
    valueLak: p.value_lak,
    imageUrl: p.image_url,
  };
}

export function mapRowPrize(r: PlayerRow) {
  if (!r.prize_code) return null;
  return {
    code: r.prize_code,
    group: r.prize_group,
    name: r.prize_name,
    valueLak: r.prize_value_lak,
  };
}

export function mapRowSpin(r: PlayerRow) {
  if (r.spin_status === 'NOT_SPUN') return null;
  return {
    spinId: r.spin_id,
    segment: r.main_segment,
    spunAt: r.spun_at,
    cashSpunAt: r.cash_spun_at,
    prize: mapRowPrize(r),
    fulfillmentStatus: r.fulfillment_status,
  };
}