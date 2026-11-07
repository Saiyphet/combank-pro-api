import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { fetchAll } from '../supabase/fetch-all';
import { AppError, must, throwRpcError } from '../common/app-error';
import { PlayerRow, mapRowPrize } from '../common/mappers';
import { LoginDto } from '../player/login.dto';
import { WheelService } from '../player/wheel.service';
import { AdminScopeService } from './admin-scope.service';
import {
  CreateAdminDto,
  CreatePlayerDto,
  FulfillmentDto,
  ListPlayersQuery,
  UpdateAdminDto,
  UpdatePlayerDto,
  UpdateWeightsDto,
} from './admin.dto';

const MIN_HANDS = 1666;
// ไม่มีตัวที่สับสนกันง่าย (0/O, 1/l/I)
const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

@Injectable()
export class AdminService {
  constructor(
    private readonly sb: SupabaseService,
    private readonly jwt: JwtService,
    private readonly wheels: WheelService,
    private readonly scope: AdminScopeService,
  ) {}

  // ---------- auth ----------
  async login(dto: LoginDto) {
    const admin = must(
      await this.sb.db
        .from('ld_admins')
        .select('id, username, password_hash, role, is_active, club:ld_clubs(code, name)')
        .eq('username', dto.username.trim())
        .maybeSingle(),
    ) as unknown as (AdminRow & { password_hash: string }) | null;

    if (!admin || !(await bcrypt.compare(dto.password, admin.password_hash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS');
    }
    if (!admin.is_active) throw new AppError(403, 'ADMIN_DISABLED');
    const accessToken = await this.jwt.signAsync({
      sub: admin.id,
      role: 'admin',
      username: admin.username,
    });
    return { accessToken, admin: { id: admin.id, username: admin.username, role: admin.role, club: toClub(admin.club) } };
  }

  // ---------- admin accounts: the controller lets only a Super Admin in ----------
  async listAdmins() {
    const rows = must(
      await this.sb.db
        .from('ld_admins')
        .select('id, username, role, is_active, created_at, club:ld_clubs(code, name)')
        .order('username'),
    ) as unknown as AdminRow[];
    return rows.map(toAdmin);
  }

  async createAdmin(dto: CreateAdminDto) {
    const clubId = await this.clubForRole(dto.role, dto.clubCode);
    const password = generatePassword(12);
    const { data, error } = await this.sb.db
      .from('ld_admins')
      .insert({ username: dto.username, password_hash: await bcrypt.hash(password, 10), role: dto.role, club_id: clubId })
      .select('id, username, role, is_active, created_at, club:ld_clubs(code, name)')
      .single();
    if (error?.code === '23505') throw new AppError(409, 'ADMIN_ALREADY_EXISTS');
    if (error) throw error;
    return { ...toAdmin(data as unknown as AdminRow), initialPassword: password };
  }

  async updateAdmin(actorId: string, id: string, dto: UpdateAdminDto) {
    const current = must(
      await this.sb.db.from('ld_admins').select('role, club:ld_clubs(code)').eq('id', id).maybeSingle(),
    ) as unknown as { role: string; club: { code: string } | null } | null;
    if (!current) throw new AppError(404, 'ADMIN_NOT_FOUND');
    // Nobody can lock themselves out, so there is always one Super Admin left.
    if (id === actorId && (dto.role === 'STAFF' || dto.isActive === false)) throw new AppError(400, 'ADMIN_CANNOT_CHANGE_SELF');

    const role = dto.role ?? current.role;
    const patch: Record<string, unknown> = { role, club_id: await this.clubForRole(role, dto.clubCode ?? current.club?.code) };
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    const row = must(
      await this.sb.db
        .from('ld_admins')
        .update(patch)
        .eq('id', id)
        .select('id, username, role, is_active, created_at, club:ld_clubs(code, name)')
        .single(),
    ) as unknown as AdminRow;
    return toAdmin(row);
  }

  async resetAdminPassword(id: string) {
    const password = generatePassword(12);
    const rows = must(
      await this.sb.db.from('ld_admins').update({ password_hash: await bcrypt.hash(password, 10) }).eq('id', id).select('username'),
    ) as { username: string }[];
    if (!rows.length) throw new AppError(404, 'ADMIN_NOT_FOUND');
    return { id, username: rows[0].username, newPassword: password };
  }

  /** An Admin must have a club. A Super Admin has none. */
  private async clubForRole(role: string, clubCode?: string | null) {
    if (role === 'SUPER') return null;
    if (!clubCode) throw new AppError(400, 'CLUB_REQUIRED');
    const club = must(
      await this.sb.db.from('ld_clubs').select('id').eq('code', clubCode.trim().toLowerCase()).eq('is_active', true).maybeSingle(),
    ) as { id: string } | null;
    if (!club) throw new AppError(400, 'CLUB_NOT_FOUND', { club: clubCode });
    return club.id;
  }

  // ---------- players ----------
  async createPlayer(adminId: string, dto: CreatePlayerDto) {
    if (dto.handsCount < MIN_HANDS) {
      throw new AppError(400, 'HANDS_BELOW_REQUIREMENT', { minHands: MIN_HANDS });
    }
    const club = await this.findClub(dto.clubName);
    const scope = await this.scope.of(adminId);
    if (scope.clubId && club.id !== scope.clubId) throw new AppError(403, 'CLUB_NOT_ALLOWED');
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
        hands_count: dto.handsCount,
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
  async listClubs(adminId: string) {
    const scope = await this.scope.of(adminId);
    let query = this.sb.db.from('ld_clubs').select('code, name, username_prefix, xpoker_club_id').eq('is_active', true);
    if (scope.clubCode) query = query.eq('code', scope.clubCode);
    const rows = must(await query.order('code')) as { code: string; name: string; username_prefix: string; xpoker_club_id: string | null }[];
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


  async listPlayers(adminId: string, q: ListPlayersQuery) {
    const scope = await this.scope.of(adminId);
    let query = this.sb.db.from('ld_admin_players').select('*', { count: 'exact' });
    if (q.spinStatus) query = query.eq('spin_status', q.spinStatus);
    if (q.prizeCode) query = query.eq('prize_code', q.prizeCode);
    if (q.fulfillment) query = query.eq('fulfillment_status', q.fulfillment);
    // An Admin always gets their own club, whatever the filter asks for.
    const club = scope.clubCode ?? q.club?.trim().toLowerCase();
    if (club) query = query.eq('club_code', club);
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

  async getPlayer(adminId: string, id: string) {
    return toAdminPlayer(await this.playerRow(adminId, id));
  }

  async updatePlayer(adminId: string, id: string, dto: UpdatePlayerDto) {
    await this.playerRow(adminId, id);
    const patch: Record<string, unknown> = {};
    if (dto.displayName !== undefined) patch.display_name = dto.displayName.trim();
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    if (Object.keys(patch).length) {
      must(await this.sb.db.from('ld_players').update(patch).eq('id', id).select('id'));
    }
    return this.getPlayer(adminId, id);
  }

  async resetPassword(adminId: string, id: string) {
    const row = await this.playerRow(adminId, id);
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

  private async playerRow(adminId: string, id: string) {
    const scope = await this.scope.of(adminId);
    const row = must(
      await this.sb.db.from('ld_admin_players').select('*').eq('id', id).maybeSingle(),
    ) as PlayerRow | null;
    // To an Admin, another club's player does not exist.
    if (!row || (scope.clubCode && row.club_code !== scope.clubCode)) throw new AppError(404, 'PLAYER_NOT_FOUND');
    return row;
  }

  // ---------- fulfillment ----------
  async updateFulfillment(adminId: string, spinId: string, dto: FulfillmentDto) {
    const spin = must(
      await this.sb.db.from('ld_spins').select('id, player_id, status').eq('id', spinId).maybeSingle(),
    ) as { id: string; player_id: string; status: string } | null;
    if (!spin) throw new AppError(404, 'SPIN_NOT_FOUND');
    await this.playerRow(adminId, spin.player_id);
    if (spin.status === 'CASH_PENDING') throw new AppError(400, 'CASH_NOT_REVEALED');

    const delivered = dto.status === 'DELIVERED';
    const patch: Record<string, unknown> = {
      fulfillment_status: dto.status,
      delivered_by: delivered ? adminId : null,
      delivered_at: delivered ? new Date().toISOString() : null,
    };
    if (dto.note !== undefined) patch.note = dto.note;

    must(await this.sb.db.from('ld_spins').update(patch).eq('id', spinId).select('id'));
    return this.getPlayer(adminId, spin.player_id);
  }

  // ---------- prizes / summary / export ----------
  async prizes() {
    const [{ main, cash }, configured] = await Promise.all([
      this.wheels.raw(),
      this.configuredWeights(),
    ]);
    const map = (r: (typeof main)[number], wheel: 'main' | 'cash') => ({
      code: r.code,
      name: r.name,
      qtyTotal: r.qty_total,
      qtyGiven: r.qty_total - r.qty_remaining,
      qtyRemaining: r.qty_remaining,
      /** อัตราที่ admin ตั้ง (%) */
      weightPct: (configured[wheel][r.code] ?? 0) / 100,
      /** อัตราจริงตอนนี้ (%) — รางวัลที่หมดจะเป็น 0 และช่องอื่นเพิ่มตามสัดส่วน */
      oddsPct: Number(r.odds_pct ?? 0),
    });
    return {
      mainWheel: main.map((r) => map(r, 'main')),
      cashWheel: cash.map((r) => ({ ...map(r, 'cash'), valueLak: r.value_lak })),
    };
  }

  // ---------- weights ----------
  /** ปรับอัตรา (SUPER เท่านั้น) — ส่งวงล้อเดียวหรือทั้งสองก็ได้ */
  async updateWeights(adminId: string, dto: UpdateWeightsDto) {
    await this.scope.requireSuper(adminId);

    if (!dto.mainWheel && !dto.cashWheel) throw new AppError(400, 'WEIGHTS_EMPTY');
    const p_main = dto.mainWheel ? toBasisPoints(dto.mainWheel, 'mainWheel') : null;
    const p_cash = dto.cashWheel ? toBasisPoints(dto.cashWheel, 'cashWheel') : null;

    const { error } = await this.sb.db.rpc('ld_set_weights', {
      p_admin_id: adminId,
      p_main,
      p_cash,
    });
    if (error) throwRpcError(error);
    return this.prizes();
  }

  async weightHistory() {
    const rows = must(
      await this.sb.db
        .from('ld_weight_changes')
        .select('id, created_at, before, after, admin:ld_admins(username)')
        .order('created_at', { ascending: false })
        .limit(50),
    ) as unknown as {
      id: string;
      created_at: string;
      before: Weights;
      after: Weights;
      admin: { username: string } | null;
    }[];
    const pct = (w: Weights) => ({
      mainWheel: bpToPct(w.main),
      cashWheel: bpToPct(w.cash),
    });
    return rows.map((r) => ({
      id: r.id,
      changedAt: r.created_at,
      changedBy: r.admin?.username ?? null,
      before: pct(r.before),
      after: pct(r.after),
    }));
  }

  private async configuredWeights(): Promise<Weights> {
    const { data, error } = await this.sb.db.rpc('ld_current_weights');
    if (error) throw error;
    return data as Weights;
  }

  async summary(adminId: string) {
    const scope = await this.scope.of(adminId);
    const rows = await this.allRows(scope.clubCode);
    const prizes = must(
      await this.sb.db.from('ld_prizes').select('qty_total, qty_remaining').eq('is_active', true),
    ) as { qty_total: number; qty_remaining: number }[];

    const count = (f: (r: PlayerRow) => boolean) => rows.filter(f).length;
    const cashSum = (f: (r: PlayerRow) => boolean) =>
      rows.filter((r) => r.prize_group === 'CASH' && f(r)).reduce((a, r) => a + Number(r.prize_value_lak ?? 0), 0);
    const totalQty = prizes.reduce((a, p) => a + p.qty_total, 0);
    const remainingQty = prizes.reduce((a, p) => a + p.qty_remaining, 0);

    return {
      players: {
        total: rows.length,
        active: count((r) => r.is_active),
        notSpun: count((r) => r.spin_status === 'NOT_SPUN'),
        cashPending: count((r) => r.spin_status === 'CASH_PENDING'),
        done: count((r) => r.spin_status === 'DONE'),
      },
      // Prize stock belongs to the whole event, so a club Admin does not get it.
      ...(scope.isSuper ? { prizes: { total: totalQty, given: totalQty - remainingQty, remaining: remainingQty } } : {}),
      cashPaidLak: cashSum((r) => r.fulfillment_status === 'DELIVERED'),
      cashPendingLak: cashSum((r) => r.fulfillment_status === 'PENDING'),
      fulfillment: {
        PENDING: count((r) => r.spin_status === 'DONE' && r.fulfillment_status === 'PENDING'),
        DELIVERED: count((r) => r.fulfillment_status === 'DELIVERED'),
        CANCELLED: count((r) => r.fulfillment_status === 'CANCELLED'),
      },
    };
  }


  async exportCsv(adminId: string) {
    const scope = await this.scope.of(adminId);
    const rows = (await this.allRows(scope.clubCode)).filter((r) => r.spin_status !== 'NOT_SPUN');
    const header = [
      'club_name', 'username', 'display_name', 'xpoker_player_id', 'hands_count', 'spin_status',
      'main_segment', 'prize_code', 'prize_name', 'prize_value_lak', 'spun_at', 'cash_spun_at',
      'fulfillment_status', 'delivered_by', 'delivered_at', 'note',
    ] as const;
    const lines = rows.map((r) => header.map((k) => csvCell(r[k])).join(','));
    // BOM ให้ Excel อ่านภาษาลาว/ไทยถูก
    return '\uFEFF' + [header.join(','), ...lines].join('\r\n');
  }

  private allRows(clubCode: string | null = null) {
    return fetchAll<PlayerRow>((from, to) => {
      const query = this.sb.db.from('ld_admin_players').select('*');
      return (clubCode ? query.eq('club_code', clubCode) : query).order('created_at').range(from, to);
    });
  }
}

interface AdminRow {
  id: string;
  username: string;
  role: string;
  is_active: boolean;
  created_at: string;
  club: { code: string; name: string } | null;
}

function toClub(club: AdminRow['club']) {
  return club ? { code: club.code.toUpperCase(), name: club.name } : null;
}

function toAdmin(r: AdminRow) {
  return { id: r.id, username: r.username, role: r.role, isActive: r.is_active, createdAt: r.created_at, club: toClub(r.club) };
}

function toAdminPlayer(r: PlayerRow) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    xpokerPlayerId: r.xpoker_player_id,
    handsCount: r.hands_count,
    isActive: r.is_active,
    createdAt: r.created_at,
    createdBy: r.created_by,
    club: { code: r.club_code.toUpperCase(), name: r.club_name },
    spinStatus: r.spin_status,
    spinId: r.spin_id,
    mainSegment: r.main_segment,
    spunAt: r.spun_at,
    cashSpunAt: r.cash_spun_at,
    prize: mapRowPrize(r),
    fulfillmentStatus: r.fulfillment_status,
    deliveredBy: r.delivered_by,
    deliveredAt: r.delivered_at,
    note: r.note,
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

type Weights = { main: Record<string, number>; cash: Record<string, number> };

/** % → หน่วย 0.01% พร้อมตรวจค่า และตรวจผลรวม = 100 */
function toBasisPoints(input: Record<string, number>, field: string) {
  const out: Record<string, number> = {};
  let sum = 0;
  for (const [code, pct] of Object.entries(input)) {
    const bp = Math.round(Number(pct) * 100);
    if (
      typeof pct !== 'number' ||
      !Number.isFinite(pct) ||
      pct < 0 ||
      pct > 100 ||
      Math.abs(pct * 100 - bp) > 1e-6
    ) {
      throw new AppError(400, 'WEIGHTS_INVALID_VALUE', {
        field,
        code,
        message: 'ต้องเป็นตัวเลข 0–100 ทศนิยมไม่เกิน 2 ตำแหน่ง',
      });
    }
    out[code.trim().toUpperCase()] = bp;
    sum += bp;
  }
  if (sum !== 10000) {
    throw new AppError(400, 'WEIGHTS_SUM_NOT_100', { field, sumPct: sum / 100 });
  }
  return out;
}

function bpToPct(w: Record<string, number> | null) {
  return Object.fromEntries(Object.entries(w ?? {}).map(([k, v]) => [k, v / 100]));
}