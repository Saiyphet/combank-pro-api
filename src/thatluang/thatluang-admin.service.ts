import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { fetchAll } from '../supabase/fetch-all';
import { AppError, must, throwRpcError } from '../common/app-error';
import { PlayerRow, PrizeGroup, SpinRow, TIERS, Tier } from './mappers';
import { CreatePlayerDto, FulfillmentDto, ListPlayersQuery, SaveTierDto, UpdatePlayerDto } from './admin.dto';
import { parseHandsReport } from './hands-report';

// ไม่มีตัวที่สับสนกันง่าย (0/O, 1/l/I)
const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const UPSERT_BATCH = 1000;
// ld_players.hands_count is NOT NULL and must be at least 1666. It is Halloween's column, so it gets the lowest allowed value.
const HALLOWEEN_MIN_HANDS = 1666;

interface PrizeRow {
  code: string;
  tier: Tier;
  prize_group: PrizeGroup;
  name: string;
  value_lak: number | null;
  qty_total: number;
  qty_remaining: number;
  weight_bp: number;
}

@Injectable()
export class ThatLuangAdminService {
  constructor(private readonly sb: SupabaseService) {}

  // ---------- players ----------
  async createPlayer(adminId: string, dto: CreatePlayerDto) {
    const club = await this.findClub(dto.clubName);
    const xpokerId = dto.xpokerPlayerId.trim();
    // username = prefix ของ club + X-Poker ID เช่น cb45678
    const username = `${club.username_prefix}${xpokerId}`.toLowerCase();

    const password = generatePassword();
    const { data, error } = await this.sb.db
      .from('ld_players')
      .insert({
        username,
        password_hash: await bcrypt.hash(password, 10),
        display_name: dto.displayName.trim(),
        xpoker_player_id: xpokerId,
        hands_count: HALLOWEEN_MIN_HANDS,
        club_id: club.id,
        created_by: adminId,
      })
      .select('id')
      .single();

    if (error?.code === '23505') {
      throw new AppError(409, 'PLAYER_ALREADY_EXISTS', { username, club: club.code.toUpperCase() });
    }
    if (error) throw error;
    return {
      id: data.id,
      username,
      initialPassword: password,
      club: { code: club.code.toUpperCase(), name: club.name },
    };
  }

  // ---------- clubs ----------
  async listClubs() {
    const rows = must(
      await this.sb.db
        .from('ld_clubs')
        .select('code, name, username_prefix, xpoker_club_id')
        .eq('is_active', true)
        .order('code'),
    ) as { code: string; name: string; username_prefix: string; xpoker_club_id: string | null }[];
    return rows.map((c) => ({
      code: c.code.toUpperCase(),
      name: c.name,
      usernamePrefix: c.username_prefix,
      xpokerClubId: c.xpoker_club_id,
    }));
  }

  /**
   * หา club จาก: ชื่อเต็ม ("ComBank CLUB"), ตัวย่อ ("CB") หรือ X-Poker club ID ("1216343")
   * ไม่สนตัวพิมพ์เล็ก/ใหญ่
   */
  private async findClub(clubName: string) {
    const raw = clubName.trim();
    const select = 'id, code, name, username_prefix';
    type Club = { id: string; code: string; name: string; username_prefix: string };
    const base = () => this.sb.db.from('ld_clubs').select(select).eq('is_active', true);

    let club: Club | null = null;
    if (/^\d+$/.test(raw)) {
      club = must(await base().eq('xpoker_club_id', raw).maybeSingle()) as Club | null;
    }
    if (!club) {
      club = must(await base().eq('code', raw.toLowerCase()).maybeSingle()) as Club | null;
    }
    if (!club) {
      // ilike = เทียบแบบไม่สนตัวพิมพ์; escape % _ \ ในชื่อ (เช่น "Play Good_Bad Luck")
      const pattern = raw.replace(/[\\%_]/g, (c) => '\\' + c);
      club = must(await base().ilike('name', pattern).maybeSingle()) as Club | null;
    }
    if (!club) throw new AppError(400, 'CLUB_NOT_FOUND', { club: raw });
    return club;
  }

  async listPlayers(q: ListPlayersQuery) {
    let query = this.sb.db.from('tl_admin_players').select('*', { count: 'exact' });
    if (q.spinStatus === 'NOT_SPUN') query = query.eq('spins', '[]');
    if (q.spinStatus === 'DONE') query = query.neq('spins', '[]');
    // A string: supabase-js would write an array as a Postgres array, and spins is jsonb
    if (q.prizeCode) query = query.contains('spins', JSON.stringify([{ prize_code: q.prizeCode }]));
    if (q.fulfillment) query = query.contains('spins', JSON.stringify([{ fulfillment_status: q.fulfillment }]));
    if (q.club) query = query.eq('club_code', q.club.trim().toLowerCase());
    if (q.q) {
      const term = q.q.replace(/[,()%*\\]/g, ' ').trim();
      if (term) {
        query = query.or(
          `display_name.ilike.%${term}%,xpoker_player_id.ilike.%${term}%,username.ilike.%${term}%`,
        );
      }
    }
    const from = (q.page - 1) * q.limit;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + q.limit - 1);
    if (error) throw error;

    return {
      total: count ?? 0,
      page: q.page,
      limit: q.limit,
      items: (data as PlayerRow[]).map(toAdminPlayer),
    };
  }

  async getPlayer(id: string) {
    return toAdminPlayer(await this.playerRow(id));
  }

  async updatePlayer(id: string, dto: UpdatePlayerDto) {
    await this.playerRow(id);
    const patch: Record<string, unknown> = {};
    if (dto.displayName !== undefined) patch.display_name = dto.displayName.trim();
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    if (Object.keys(patch).length) {
      must(await this.sb.db.from('ld_players').update(patch).eq('id', id).select('id'));
    }
    return this.getPlayer(id);
  }

  async resetPassword(id: string) {
    const row = await this.playerRow(id);
    const password = generatePassword();
    must(
      await this.sb.db
        .from('ld_players')
        .update({ password_hash: await bcrypt.hash(password, 10) })
        .eq('id', id)
        .select('id'),
    );
    return { id, username: row.username, newPassword: password };
  }

  private async playerRow(id: string) {
    const row = must(
      await this.sb.db.from('tl_admin_players').select('*').eq('id', id).maybeSingle(),
    ) as PlayerRow | null;
    if (!row) throw new AppError(404, 'PLAYER_NOT_FOUND');
    return row;
  }

  // ---------- fulfillment ----------
  async updateFulfillment(adminId: string, spinId: string, dto: FulfillmentDto) {
    const spin = must(
      await this.sb.db.from('tl_spins').select('id, player_id').eq('id', spinId).maybeSingle(),
    ) as { id: string; player_id: string } | null;
    if (!spin) throw new AppError(404, 'SPIN_NOT_FOUND');

    const delivered = dto.status === 'DELIVERED';
    const patch: Record<string, unknown> = {
      fulfillment_status: dto.status,
      delivered_by: delivered ? adminId : null,
      delivered_at: delivered ? new Date().toISOString() : null,
    };
    if (dto.note !== undefined) patch.note = dto.note;

    must(await this.sb.db.from('tl_spins').update(patch).eq('id', spinId).select('id'));
    return this.getPlayer(spin.player_id);
  }

  // ---------- hands report ----------
  /** Players missing from the file keep their numbers. Ids with no account are listed back, not created: an account needs a password. */
  async importHands(csv: string) {
    const { rows, skipped } = parseHandsReport(csv);
    if (!rows.length) throw new AppError(400, 'REPORT_EMPTY', { skipped });

    const players = await fetchAll<{ id: string; xpoker_player_id: string }>((from, to) =>
      this.sb.db.from('ld_players').select('id, xpoker_player_id').order('id').range(from, to),
    );
    const idOf = new Map(players.map((p) => [p.xpoker_player_id, p.id]));
    const importedAt = new Date().toISOString();
    const known = rows
      .filter((r) => idOf.has(r.xpokerId))
      .map((r) => ({ player_id: idOf.get(r.xpokerId), tier: r.tier, hands: r.hands, updated_at: importedAt }));

    for (let i = 0; i < known.length; i += UPSERT_BATCH) {
      must(await this.sb.db.from('tl_hands').upsert(known.slice(i, i + UPSERT_BATCH), { onConflict: 'player_id,tier' }));
    }
    must(await this.sb.db.from('ld_settings').upsert({ key: 'last_hands_import_at', value: importedAt }));

    return {
      updated: known.length,
      unknown: [...new Set(rows.filter((r) => !idOf.has(r.xpokerId)).map((r) => r.xpokerId))],
      skipped,
      importedAt,
    };
  }

  // ---------- targets and prizes ----------
  async prizes() {
    const [tierRes, prizeRes] = await Promise.all([
      this.sb.db.from('tl_tiers').select('tier, hands_target').order('sort_order'),
      this.sb.db.from('tl_prizes').select('*').eq('is_active', true).order('sort_order'),
    ]);
    const tiers = must(tierRes) as { tier: Tier; hands_target: number | null }[];
    const rows = must(prizeRes) as PrizeRow[];
    return tiers.map(({ tier, hands_target }) => {
      const own = rows.filter((r) => r.tier === tier);
      const live = own.reduce((a, r) => a + (r.qty_remaining > 0 ? r.weight_bp : 0), 0);
      return {
        tier,
        handsTarget: hands_target,
        prizes: own.map((r) => ({
          code: r.code,
          group: r.prize_group,
          name: r.name,
          valueLak: r.value_lak,
          qtyTotal: r.qty_total,
          qtyGiven: r.qty_total - r.qty_remaining,
          qtyRemaining: r.qty_remaining,
          /** อัตราที่ admin ตั้ง (%) */
          weightPct: r.weight_bp / 100,
          /** อัตราจริงตอนนี้ (%) — รางวัลที่หมดจะเป็น 0 และช่องอื่นเพิ่มตามสัดส่วน */
          oddsPct: live && r.qty_remaining > 0 ? Math.round((r.weight_bp * 10000) / live) / 100 : 0,
        })),
      };
    });
  }

  /** SUPER only. The level's prizes must add up to 100%, unless it has none yet. */
  async saveTier(adminId: string, tier: Tier, dto: SaveTierDto) {
    const admin = must(
      await this.sb.db.from('ld_admins').select('role').eq('id', adminId).maybeSingle(),
    ) as { role: string } | null;
    if (admin?.role !== 'SUPER') throw new AppError(403, 'SUPER_ADMIN_ONLY');

    const prizes = dto.prizes.map((p) => ({
      code: p.code,
      group: p.group,
      name: p.name.trim(),
      value_lak: p.valueLak ?? null,
      qty_total: p.qtyTotal,
      weight_bp: toBasisPoints(p.weightPct, p.code ?? p.name),
    }));
    const sum = prizes.reduce((a, p) => a + p.weight_bp, 0);
    if (prizes.length && sum !== 10000) throw new AppError(400, 'WEIGHTS_SUM_NOT_100', { field: tier, sumPct: sum / 100 });

    const { error } = await this.sb.db.rpc('tl_save_tier', {
      p_admin_id: adminId,
      p_tier: tier,
      p_target: dto.handsTarget ?? null,
      p_prizes: prizes,
    });
    if (error) throwRpcError(error);
    return this.prizes();
  }

  // ---------- summary / export ----------
  async summary() {
    const [rows, prizeRes, importRes] = await Promise.all([
      this.allRows(),
      this.sb.db.from('tl_prizes').select('qty_total, qty_remaining').eq('is_active', true),
      this.sb.db.from('ld_settings').select('value').eq('key', 'last_hands_import_at').maybeSingle(),
    ]);
    const prizes = must(prizeRes) as { qty_total: number; qty_remaining: number }[];
    const spins = rows.flatMap((r) => r.spins);
    const spinCount = (f: (s: SpinRow) => boolean) => spins.filter(f).length;
    const cashSum = (status: SpinRow['fulfillment_status']) =>
      spins
        .filter((s) => s.prize_group === 'CASH' && s.fulfillment_status === status)
        .reduce((a, s) => a + Number(s.prize_value_lak ?? 0), 0);
    const totalQty = prizes.reduce((a, p) => a + p.qty_total, 0);
    const remainingQty = prizes.reduce((a, p) => a + p.qty_remaining, 0);

    return {
      players: {
        total: rows.length,
        active: rows.filter((r) => r.is_active).length,
        notSpun: rows.filter((r) => !r.spins.length).length,
        spun: rows.filter((r) => r.spins.length).length,
      },
      spinsByTier: Object.fromEntries(TIERS.map((t) => [t, spinCount((s) => s.tier === t)])),
      prizes: { total: totalQty, given: totalQty - remainingQty, remaining: remainingQty },
      cashPaidLak: cashSum('DELIVERED'),
      cashPendingLak: cashSum('PENDING'),
      fulfillment: {
        PENDING: spinCount((s) => s.fulfillment_status === 'PENDING'),
        DELIVERED: spinCount((s) => s.fulfillment_status === 'DELIVERED'),
        CANCELLED: spinCount((s) => s.fulfillment_status === 'CANCELLED'),
      },
      lastImportAt: (must(importRes) as { value: string } | null)?.value ?? null,
    };
  }

  /** One line per spin */
  async exportCsv() {
    const rows = await this.allRows();
    const header = [
      'club_name', 'username', 'display_name', 'xpoker_player_id', 'tier', 'hands', 'prize_code', 'prize_name',
      'prize_value_lak', 'spun_at', 'fulfillment_status', 'delivered_by', 'delivered_at', 'note',
    ];
    const lines = rows.flatMap((r) =>
      r.spins.map((s) =>
        [
          r.club_name, r.username, r.display_name, r.xpoker_player_id, s.tier, r.hands[s.tier] ?? 0, s.prize_code, s.prize_name,
          s.prize_value_lak, s.spun_at, s.fulfillment_status, s.delivered_by, s.delivered_at, s.note,
        ].map(csvCell).join(','),
      ),
    );
    // BOM ให้ Excel อ่านภาษาลาว/ไทยถูก
    return '﻿' + [header.join(','), ...lines].join('\r\n');
  }

  private allRows() {
    return fetchAll<PlayerRow>((from, to) =>
      this.sb.db.from('tl_admin_players').select('*').order('created_at').range(from, to),
    );
  }
}

function toAdminPlayer(r: PlayerRow) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    xpokerPlayerId: r.xpoker_player_id,
    hands: r.hands,
    isActive: r.is_active,
    createdAt: r.created_at,
    createdBy: r.created_by,
    club: { code: r.club_code.toUpperCase(), name: r.club_name },
    spins: r.spins.map((s) => ({
      id: s.id,
      tier: s.tier,
      spunAt: s.spun_at,
      prize: { code: s.prize_code, group: s.prize_group, name: s.prize_name, valueLak: s.prize_value_lak },
      fulfillmentStatus: s.fulfillment_status,
      deliveredBy: s.delivered_by,
      deliveredAt: s.delivered_at,
      note: s.note,
    })),
  };
}

function generatePassword(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += PW_CHARS[randomInt(PW_CHARS.length)];
  return s;
}

function csvCell(v: unknown) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** % → หน่วย 0.01% ทศนิยมไม่เกิน 2 ตำแหน่ง */
function toBasisPoints(pct: number, code: string) {
  const bp = Math.round(pct * 100);
  if (Math.abs(pct * 100 - bp) > 1e-6) throw new AppError(400, 'WEIGHTS_INVALID_VALUE', { code });
  return bp;
}
