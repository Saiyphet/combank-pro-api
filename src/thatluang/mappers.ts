import { AppError } from '../common/app-error';

export const TIERS = ['bronze', 'silver', 'gold'] as const;
export type Tier = (typeof TIERS)[number];

export function parseTier(tier: string): Tier {
  if (!TIERS.includes(tier as Tier)) throw new AppError(404, 'TIER_NOT_FOUND');
  return tier as Tier;
}

export type PrizeGroup = 'CASH' | 'BONUS';

/** One entry of tl_admin_players.spins */
export interface SpinRow {
  id: string;
  tier: Tier;
  slot: number;
  spun_at: string;
  fulfillment_status: 'PENDING' | 'DELIVERED' | 'CANCELLED';
  delivered_by: string | null;
  delivered_at: string | null;
  note: string | null;
  prize_code: string;
  prize_group: PrizeGroup;
  prize_name: string;
  prize_value_lak: number | null;
}

/** A row of the view tl_admin_players */
export interface PlayerRow {
  id: string;
  username: string;
  display_name: string;
  xpoker_player_id: string;
  is_active: boolean;
  created_at: string;
  created_by: string;
  club_code: string;
  club_name: string;
  hands: Partial<Record<Tier, number>>;
  spins: SpinRow[];
}

/** What the player sees of a spin */
export function spinResult(s: Pick<SpinRow, 'id' | 'slot' | 'prize_group' | 'prize_name' | 'prize_value_lak'>) {
  return {
    slot: s.slot,
    kind: s.prize_group === 'CASH' ? 'cash' : 'box',
    receipt: s.id.slice(0, 8).toUpperCase(),
    prize: { name: s.prize_name, valueLak: s.prize_value_lak },
  };
}
