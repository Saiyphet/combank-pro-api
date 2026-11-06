import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AppError, must, throwRpcError } from '../common/app-error';
import { PlayerRow, Tier, spinResult } from './mappers';

const BOARD_SIZE = 50;

@Injectable()
export class ThatLuangPlayerService {
  constructor(private readonly sb: SupabaseService) {}

  /** Hands, target and status of all three levels. Locked until the target is both set and reached. */
  async progress(playerId: string) {
    const [playerRes, tierRes, importRes] = await Promise.all([
      this.sb.db.from('tl_admin_players').select('hands, spins').eq('id', playerId).maybeSingle(),
      this.sb.db.from('tl_tiers').select('tier, hands_target'),
      this.sb.db.from('ld_settings').select('value').eq('key', 'last_hands_import_at').maybeSingle(),
    ]);
    const row = must(playerRes) as Pick<PlayerRow, 'hands' | 'spins'> | null;
    if (!row) throw new AppError(401, 'UNAUTHORIZED');

    const levels = must(tierRes) as { tier: Tier; hands_target: number | null }[];
    const tiers = Object.fromEntries(
      levels.map(({ tier, hands_target: target }) => {
        const hands = row.hands[tier] ?? 0;
        const spin = row.spins.find((s) => s.tier === tier);
        return [tier, {
          hands,
          target,
          progress: target ? Math.min(100, Math.floor((hands * 100) / target)) : 0,
          status: spin ? 'done' : target && hands >= target ? 'ready' : 'locked',
          result: spin ? spinResult(spin) : null,
        }];
      }),
    );

    return { tiers, updatedAt: (must(importRes) as { value: string } | null)?.value ?? null };
  }

  async spin(playerId: string, tier: Tier) {
    const { data, error } = await this.sb.db.rpc('tl_spin', { p_player_id: playerId, p_tier: tier });
    if (error) throwRpcError(error);
    return spinResult(data);
  }

  /** The top of the board, plus the player's own line so someone below the top still sees their rank. */
  async leaderboard(playerId: string, tier: Tier) {
    const top = must(
      await this.sb.db
        .from('tl_hands')
        .select('player_id, hands, player:ld_players!inner(display_name, is_active)')
        .eq('tier', tier)
        .eq('player.is_active', true)
        .gt('hands', 0)
        .order('hands', { ascending: false })
        .order('player_id')
        .limit(BOARD_SIZE),
    ) as unknown as { player_id: string; hands: number; player: { display_name: string } }[];

    const rows = top.map((r, i) => ({ rank: i + 1, name: r.player.display_name, hands: r.hands }));
    const at = top.findIndex((r) => r.player_id === playerId);
    return { rows, me: at >= 0 ? rows[at] : await this.ownLine(playerId, tier) };
  }

  /** Players tied on hands share this rank here, because the order within a tie only exists inside the top list. */
  private async ownLine(playerId: string, tier: Tier) {
    const [playerRes, handsRes] = await Promise.all([
      this.sb.db.from('ld_players').select('display_name').eq('id', playerId).maybeSingle(),
      this.sb.db.from('tl_hands').select('hands').eq('player_id', playerId).eq('tier', tier).maybeSingle(),
    ]);
    const name = (must(playerRes) as { display_name: string } | null)?.display_name ?? '';
    const hands = (must(handsRes) as { hands: number } | null)?.hands ?? 0;
    if (!hands) return { rank: null, name, hands };

    const { count, error } = await this.sb.db
      .from('tl_hands')
      .select('player_id, player:ld_players!inner(is_active)', { count: 'exact', head: true })
      .eq('tier', tier)
      .eq('player.is_active', true)
      .gt('hands', hands);
    if (error) throw error;
    return { rank: (count ?? 0) + 1, name, hands };
  }
}
