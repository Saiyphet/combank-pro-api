import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';
import { fetchAll } from '../supabase/fetch-all';
import { AppError, must, throwRpcError } from '../common/app-error';
import { AdminActor } from '../common/auth.guards';
import { generatePassword, passwordVault } from '../common/password-vault';
import { PlayerRow, mapRowPrize } from '../common/mappers';
import { LoginDto } from '../player/login.dto';
import { WheelService } from '../player/wheel.service';
import {
  CreatePlayerDto,
  FulfillmentDto,
  ListPlayersQuery,
  UpdatePlayerDto,
  UpdateWeightsDto,
} from './admin.dto';

/** สิทธิ์ Halloween (ไม่ใช่เงื่อนไขสร้าง account แล้ว) */
const MIN_HANDS = 1666;

@Injectable()
export class AdminService {
  constructor(
    private readonly sb: SupabaseService,
    private readonly jwt: JwtService,
    private readonly wheels: WheelService,
  ) { }

  // ---------- auth ----------
  async login(dto: LoginDto) {
    const admin = must(
      await this.sb.db
        .from('ld_admins')
        .select('id, username, password_hash, role, is_active, club:ld_clubs(code, name)')
        // ไม่สนตัวพิมพ์ (admin เก่าบางคนอาจสร้างด้วยตัวใหญ่)
        .ilike('username', dto.username.trim().replace(/[\\%_]/g, (c) => '\\' + c))
        .limit(1)
        .maybeSingle(),
    ) as unknown as {
      id: string;
      username: string;
      password_hash: string;
      role: string;
      is_active: boolean;
      club: { code: string; name: string } | null;
    } | null;

    if (!admin || !(await bcrypt.compare(dto.password, admin.password_hash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS');
    }
    // บอกว่าถูกปิดหลังตรวจรหัสแล้วเท่านั้น (ไม่ให้เดาได้ว่ามี username นี้)
    if (!admin.is_active) throw new AppError(403, 'ADMIN_DISABLED');
    const accessToken = await this.jwt.signAsync({
      sub: admin.id,
      role: 'admin',
      username: admin.username,
    });
    return {
      accessToken,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        club: admin.club ? { code: admin.club.code.toUpperCase(), name: admin.club.name } : null,
      },
    };
  }

  // ---------- players ----------
  /**
   * สร้างผู้เล่น (SUPER / STAFF — admin ประจำ club สร้างไม่ได้)
   * username = X-Poker ID (account เก่าที่มี prefix club ใช้ต่อได้ตามเดิม)
   * club ไม่บังคับ · รหัสที่สุ่มให้เก็บแบบเข้ารหัส ให้ SUPER / admin club นั้นเปิดดูได้
   * campaign (SUPER): ใส่ hands / สิทธิ์ของแคมเปญพร้อมกัน — ถ้าส่วนนี้ผิด จะไม่สร้าง account
   */
  async createPlayer(actor: AdminActor, dto: CreatePlayerDto) {
    const adminId = actor.id;
    const club = dto.clubName?.trim() ? await this.findClub(dto.clubName) : null;
    const xpokerId = dto.xpokerPlayerId.trim();
    const username = xpokerId.toLowerCase();

    // ตรวจส่วนแคมเปญก่อนสร้าง (โต๊ะ / วงต้องมีจริง)
    const camp = dto.campaign ? await this.validateCampaignPart(actor, dto.campaign) : null;

    // 1 X-Poker ID = 1 account ทั้งระบบ
    const existing = await this.findByXpokerId(xpokerId);
    if (existing) throw new AppError(409, 'PLAYER_ALREADY_EXISTS', existing);

    const password = generatePassword();
    const enc = passwordVault.encrypt(password);
    const { data, error } = await this.sb.db
      .from('ld_players')
      .insert({
        username,
        password_hash: await bcrypt.hash(password, 10),
        display_name: dto.displayName.trim(),
        xpoker_player_id: xpokerId,
        hands_count: dto.handsCount ?? 0,
        club_id: club?.id ?? null,
        created_by: adminId,
        password_enc: enc,
        password_scope: enc ? 'CLUB' : null,
      })
      .select('id')
      .single();

    if (error?.code === '23505') {
      // สร้างพร้อมกัน 2 request / username ชนกับ account เก่า → ฐานข้อมูลกันไว้อีกชั้น
      const dup = await this.findByXpokerId(xpokerId);
      throw new AppError(409, 'PLAYER_ALREADY_EXISTS', dup ?? { username });
    }
    if (error) throw error;

    let campaign: Record<string, unknown> | null = null;
    if (camp) {
      try {
        campaign = await this.applyCampaignPart(adminId, data.id, camp);
      } catch (e) {
        await this.deletePlayerHard(data.id); // ไม่ให้เหลือ account ครึ่ง ๆ
        throw e;
      }
    }

    return {
      id: data.id,
      username,
      initialPassword: password,
      club: club ? { code: club.code.toUpperCase(), name: club.name } : null,
      halloweenEligible: (dto.handsCount ?? 0) >= MIN_HANDS,
      ...(campaign ? { campaign } : {}),
    };
  }

  private async validateCampaignPart(actor: AdminActor, c: NonNullable<CreatePlayerDto['campaign']>) {
    if (actor.role !== 'SUPER') throw new AppError(403, 'SUPER_ADMIN_ONLY', { field: 'campaign' });
    const camp = must(
      await this.sb.db
        .from('ld_campaigns')
        .select('id, code, wheels:ld_wheels(code, stakes:ld_wheel_stakes(code))')
        .eq('code', c.code.trim().toLowerCase())
        .maybeSingle(),
    ) as { id: string; code: string; wheels: { code: string; stakes: { code: string }[] }[] } | null;
    if (!camp || !camp.wheels.length) throw new AppError(404, 'CAMPAIGN_NOT_FOUND');
    const stakes = new Set(camp.wheels.flatMap((w) => w.stakes.map((s) => s.code)));
    const wheels = new Set(camp.wheels.map((w) => w.code));
    for (const h of c.hands ?? []) {
      if (!stakes.has(h.stake.trim())) throw new AppError(400, 'STAKE_NOT_FOUND', { stake: h.stake });
    }
    for (const sp of c.spins ?? []) {
      if (!wheels.has(sp.wheel.trim().toLowerCase())) throw new AppError(404, 'WHEEL_NOT_FOUND', { wheel: sp.wheel });
    }
    return { ...c, code: camp.code };
  }

  private async applyCampaignPart(adminId: string, playerId: string, c: NonNullable<CreatePlayerDto['campaign']>) {
    const hands = (c.hands ?? []).filter((h) => h.hands > 0);
    if (hands.length) {
      const { error } = await this.sb.db.rpc('ld_set_hands', {
        p_campaign_code: c.code,
        p_player_id: playerId,
        p_entries: hands.map((h) => ({ stake: h.stake.trim(), hands: h.hands })),
        p_mode: 'SET',
        p_source: 'ADMIN',
        p_admin_id: adminId,
        p_note: c.note?.trim() || 'สร้าง account',
      });
      if (error) throwRpcError(error);
    }
    for (const sp of c.spins ?? []) {
      const { error } = await this.sb.db.rpc('ld_adjust_spins', {
        p_campaign_code: c.code,
        p_player_id: playerId,
        p_wheel_code: sp.wheel.trim().toLowerCase(),
        p_delta: sp.delta,
        p_reason: sp.reason.trim(),
        p_admin_id: adminId,
      });
      if (error) throwRpcError(error);
    }
    return { code: c.code, hands, spins: c.spins ?? [] };
  }

  /** ลบ account ที่เพิ่งสร้าง (ใช้ตอนส่วนแคมเปญล้มเหลวเท่านั้น) */
  private async deletePlayerHard(id: string) {
    await this.sb.db.from('ld_hands_log').delete().eq('player_id', id);
    await this.sb.db.from('ld_player_hands').delete().eq('player_id', id);
    await this.sb.db.from('ld_spin_adjustments').delete().eq('player_id', id);
    await this.sb.db.from('ld_players').delete().eq('id', id);
  }

  private async findByXpokerId(xpokerId: string) {
    const row = must(
      await this.sb.db
        .from('ld_admin_players')
        .select('id, username, club_code, club_name')
        .ilike('xpoker_player_id', xpokerId.replace(/[\\%_]/g, (c) => '\\' + c))
        .limit(1)
        .maybeSingle(),
    ) as { id: string; username: string; club_code: string | null; club_name: string | null } | null;
    if (!row) return null;
    return {
      playerId: row.id,
      username: row.username,
      club: row.club_code ? { code: row.club_code.toUpperCase(), name: row.club_name } : null,
    };
  }

  // ---------- clubs ----------
  /** admin ประจำ club เห็นแค่ club ตัวเอง */
  async listClubs(actor?: AdminActor) {
    let query = this.sb.db
      .from('ld_clubs')
      .select('code, name, username_prefix, xpoker_club_id')
      .eq('is_active', true);
    if (actor?.role === 'ADMIN') query = query.eq('id', actor.clubId!);
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
  private async clubById(id: string) {
    const club = must(
      await this.sb.db.from('ld_clubs').select('id, code, name, username_prefix').eq('id', id).maybeSingle(),
    ) as { id: string; code: string; name: string; username_prefix: string } | null;
    if (!club) throw new AppError(403, 'ADMIN_NO_CLUB');
    return club;
  }

  /** ใช้โดย AdminsService ตอนสร้าง/แก้ admin ประจำ club */
  async resolveClub(clubName: string) {
    return this.findClub(clubName);
  }

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


  async listPlayers(q: ListPlayersQuery, actor?: AdminActor) {
    let query = this.sb.db.from('ld_admin_players').select('*', { count: 'exact' });
    // admin ประจำ club เห็นแค่ผู้เล่น club ตัวเอง (ไม่สน ?club= ที่ส่งมา)
    if (actor?.role === 'ADMIN') query = query.eq('club_code', actor.club!.code.toLowerCase());
    if (q.spinStatus) query = query.eq('spin_status', q.spinStatus);
    if (q.prizeCode) query = query.eq('prize_code', q.prizeCode);
    if (q.fulfillment) query = query.eq('fulfillment_status', q.fulfillment);
    if (q.club?.trim().toLowerCase() === 'none') query = query.is('club_id', null);
    else if (q.club) query = query.eq('club_code', q.club.trim().toLowerCase());
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
      items: (data as PlayerRow[]).map((r) => toAdminPlayer(r, actor)),
    };
  }

  async getPlayer(id: string, actor?: AdminActor) {
    return toAdminPlayer(await this.playerRow(id, actor), actor);
  }

  async updatePlayer(id: string, dto: UpdatePlayerDto, actor?: AdminActor) {
    await this.playerRow(id, actor);
    const patch: Record<string, unknown> = {};
    if (dto.displayName !== undefined) patch.display_name = dto.displayName.trim();
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    // ใส่ / เปลี่ยน club ("" = เอาออก) — หลังจากนี้ admin ของ club นั้นถึงจะเห็นผู้เล่นคนนี้
    if (dto.clubName !== undefined) {
      patch.club_id = dto.clubName.trim() ? (await this.findClub(dto.clubName)).id : null;
    }
    if (Object.keys(patch).length) {
      must(await this.sb.db.from('ld_players').update(patch).eq('id', id).select('id'));
    }
    return this.getPlayer(id, actor);
  }

  /** SUPER เท่านั้น — รหัสใหม่ SUPER ดูย้อนหลังได้ (admin club ดูไม่ได้) */
  async resetPassword(id: string, actor: AdminActor) {
    if (actor.role !== 'SUPER') throw new AppError(403, 'SUPER_ADMIN_ONLY');
    const row = await this.playerRow(id, actor);
    const password = generatePassword();
    const enc = passwordVault.encrypt(password);
    must(
      await this.sb.db
        .from('ld_players')
        .update({
          password_hash: await bcrypt.hash(password, 10),
          password_enc: enc,
          password_scope: enc ? 'SUPER' : null,
          password_changed_at: null,
        })
        .eq('id', id)
        .select('id'),
    );
    return { id, username: row.username, newPassword: password };
  }

  /**
   * เปิดดูรหัสของผู้เล่น (บันทึกทุกครั้งว่าใครดู)
   *   SUPER  → รหัสที่ระบบออกให้ / ที่ SUPER reset
   *   ADMIN  → เฉพาะลูก club ตัวเอง และเฉพาะรหัสตอนสร้าง account
   *   ลูกค้าเปลี่ยนรหัสเองแล้ว → ไม่มีใครดูได้ (404 PASSWORD_NOT_AVAILABLE)
   */
  async viewPassword(id: string, actor: AdminActor) {
    if (actor.role !== 'SUPER' && actor.role !== 'ADMIN') throw new AppError(403, 'SUPER_ADMIN_ONLY');
    const row = await this.playerRow(id, actor);
    const stored = must(
      await this.sb.db.from('ld_players').select('password_enc, password_scope').eq('id', id).single(),
    ) as { password_enc: string | null; password_scope: 'CLUB' | 'SUPER' | null };

    const reason = row.password_changed_at
      ? 'CHANGED_BY_PLAYER'
      : !stored.password_scope
        ? 'NOT_STORED'
        : actor.role === 'ADMIN' && stored.password_scope !== 'CLUB'
          ? 'RESET_BY_SUPER'
          : null;
    const password = reason ? null : passwordVault.decrypt(stored.password_enc);
    if (!password) throw new AppError(404, 'PASSWORD_NOT_AVAILABLE', { reason: reason ?? 'NOT_STORED' });

    must(await this.sb.db.from('ld_password_views').insert({ admin_id: actor.id, player_id: id }).select('id'));
    return { id, username: row.username, password, scope: stored.password_scope };
  }

  /** admin ประจำ club: ผู้เล่น club อื่น = 404 (ไม่บอกว่ามีอยู่) */
  private async playerRow(id: string, actor?: AdminActor) {
    const row = must(
      await this.sb.db.from('ld_admin_players').select('*').eq('id', id).maybeSingle(),
    ) as PlayerRow | null;
    if (!row) throw new AppError(404, 'PLAYER_NOT_FOUND');
    if (actor?.role === 'ADMIN' && row.club_code?.toLowerCase() !== actor.club!.code.toLowerCase()) {
      throw new AppError(404, 'PLAYER_NOT_FOUND');
    }
    return row;
  }

  // ---------- fulfillment ----------
  async updateFulfillment(adminId: string, spinId: string, dto: FulfillmentDto) {
    const spin = must(
      await this.sb.db.from('ld_spins').select('id, player_id, status').eq('id', spinId).maybeSingle(),
    ) as { id: string; player_id: string; status: string } | null;
    if (!spin) throw new AppError(404, 'SPIN_NOT_FOUND');
    if (spin.status === 'CASH_PENDING') throw new AppError(400, 'CASH_NOT_REVEALED');

    const delivered = dto.status === 'DELIVERED';
    const patch: Record<string, unknown> = {
      fulfillment_status: dto.status,
      delivered_by: delivered ? adminId : null,
      delivered_at: delivered ? new Date().toISOString() : null,
    };
    if (dto.note !== undefined) patch.note = dto.note;

    must(await this.sb.db.from('ld_spins').update(patch).eq('id', spinId).select('id'));
    return this.getPlayer(spin.player_id);
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
    const admin = must(
      await this.sb.db.from('ld_admins').select('role').eq('id', adminId).maybeSingle(),
    ) as { role: string } | null;
    if (admin?.role !== 'SUPER') throw new AppError(403, 'SUPER_ADMIN_ONLY');

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

  async summary() {
    const rows = await this.allRows();
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
        halloweenEligible: count((r) => r.hands_count >= MIN_HANDS),
        notSpun: count((r) => r.spin_status === 'NOT_SPUN' && r.hands_count >= MIN_HANDS),
        cashPending: count((r) => r.spin_status === 'CASH_PENDING'),
        done: count((r) => r.spin_status === 'DONE'),
      },
      prizes: { total: totalQty, given: totalQty - remainingQty, remaining: remainingQty },
      cashPaidLak: cashSum((r) => r.fulfillment_status === 'DELIVERED'),
      cashPendingLak: cashSum((r) => r.fulfillment_status === 'PENDING'),
      fulfillment: {
        PENDING: count((r) => r.spin_status === 'DONE' && r.fulfillment_status === 'PENDING'),
        DELIVERED: count((r) => r.fulfillment_status === 'DELIVERED'),
        CANCELLED: count((r) => r.fulfillment_status === 'CANCELLED'),
      },
    };
  }


  async exportCsv() {
    const rows = (await this.allRows()).filter((r) => r.spin_status !== 'NOT_SPUN');
    const header = [
      'club_name', 'username', 'display_name', 'xpoker_player_id', 'hands_count', 'spin_status',
      'main_segment', 'prize_code', 'prize_name', 'prize_value_lak', 'spun_at', 'cash_spun_at',
      'fulfillment_status', 'delivered_by', 'delivered_at', 'note',
    ] as const;
    const lines = rows.map((r) => header.map((k) => csvCell(r[k])).join(','));
    // BOM ให้ Excel อ่านภาษาลาว/ไทยถูก
    return '\uFEFF' + [header.join(','), ...lines].join('\r\n');
  }

  private allRows() {
    return fetchAll<PlayerRow>((from, to) =>
      this.sb.db.from('ld_admin_players').select('*').order('created_at').range(from, to),
    );
  }
}

/** รหัสของผู้เล่นคนนี้ admin คนนี้เปิดดูได้ไหม */
function passwordAvailable(r: PlayerRow, actor?: AdminActor) {
  if (!actor || r.password_changed_at || !r.password_scope || !passwordVault.enabled()) return false;
  if (actor.role === 'SUPER') return true;
  return actor.role === 'ADMIN' && r.password_scope === 'CLUB';
}

function toAdminPlayer(r: PlayerRow, actor?: AdminActor) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    xpokerPlayerId: r.xpoker_player_id,
    handsCount: r.hands_count,
    halloweenEligible: r.hands_count >= MIN_HANDS,
    isActive: r.is_active,
    createdAt: r.created_at,
    createdBy: r.created_by,
    club: r.club_code ? { code: r.club_code.toUpperCase(), name: r.club_name } : null,
    passwordAvailable: passwordAvailable(r, actor),
    passwordChangedByPlayer: !!r.password_changed_at,
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