import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { fetchAll } from '../supabase/fetch-all';
import { AppError, must, throwRpcError } from '../common/app-error';
import { FulfillmentDto } from '../admin/admin.dto';
import {
    AdjustSpinsDto,
    ListCampaignPlayersQuery,
    ListCampaignSpinsQuery,
    SetHandsDto,
    UpdateCampaignDto,
} from './campaign.dto';

interface CampaignRow {
    id: string;
    code: string;
    name: string;
    status: 'COMING_SOON' | 'OPEN' | 'ENDED';
    date_label: string | null;
    image_url: string | null;
    sort_order: number;
}

interface WheelRow {
    id: string;
    code: string;
    name: string;
    vip_days: number;
    sort_order: number;
    is_active: boolean;
    stakes: { id: string; code: string; hands_per_spin: number; sort_order: number }[];
}

interface OddsRow {
    wheel_code: string;
    code: string;
    prize_type: string;
    name: string;
    value_lak: number | null;
    image_url: string | null;
    sort_order: number;
    qty_total: number;
    qty_remaining: number;
    weight_bp: number;
    odds_mode: 'WEIGHT' | 'QUANTITY';
    odds_pct: number | string | null;
}

interface StatusRow {
    player_id: string;
    username: string;
    display_name: string;
    xpoker_player_id: string;
    is_active: boolean;
    club_code: string;
    club_name: string;
    wheel_code: string;
    wheel_sort: number;
    earned_from_hands: number;
    adjusted: number;
    used: number;
    remaining: number;
}

interface SpinListRow {
    spin_id: string;
    wheel_code: string;
    wheel_name: string;
    player_id: string;
    username: string;
    display_name: string;
    xpoker_player_id: string;
    club_code: string;
    club_name: string;
    prize_code: string;
    prize_type: string;
    prize_name: string;
    prize_value_lak: number | null;
    vip_days: number;
    spun_at: string;
    fulfillment_status: 'PENDING' | 'DELIVERED' | 'CANCELLED';
    delivered_by: string | null;
    delivered_at: string | null;
    note: string | null;
}

interface RpcSpin {
    spin_id: string;
    wheel: string;
    spun_at: string;
    vip_days: number;
    remaining: number;
    prize: { code: string; type: string; name: string; value_lak: number | null; image_url: string | null };
}

interface PlayerRef {
    id: string;
    username: string;
    displayName: string;
    xpokerPlayerId: string;
    isActive: boolean;
    club: { code: string; name: string };
}

@Injectable()
export class CampaignService {
    constructor(private readonly sb: SupabaseService) { }

    // =========================== ผู้เล่น ===========================

    /** การ์ดหน้าแรก — ทุกโปร (ไม่ต้อง login) */
    async listCards() {
        const rows = must(
            await this.sb.db.from('ld_campaigns').select('*').order('sort_order').order('created_at'),
        ) as CampaignRow[];
        return rows.map(card);
    }

    /** ข้อมูลแคมเปญ + วงล้อ + ระดับโต๊ะ + รางวัล + อัตราสด (ต้อง login โปรนี้) */
    async publicInfo(code: string) {
        const camp = await this.campaign(code);
        const [wheels, odds] = await Promise.all([this.wheels(camp.id), this.odds(camp.code)]);
        return {
            ...card(camp),
            wheels: wheels.map((w) => {
                const prizes = odds.filter((o) => o.wheel_code === w.code);
                return {
                    code: w.code,
                    name: w.name,
                    vipDays: w.vip_days,
                    isOpen: w.is_active,
                    stakes: w.stakes.map((s) => ({ stake: s.code, handsPerSpin: s.hands_per_spin })),
                    totalRemaining: prizes.reduce((a, p) => a + p.qty_remaining, 0),
                    segments: prizes.map((p, i) => ({
                        slot: i + 1,
                        code: p.code,
                        type: p.prize_type,
                        name: p.name,
                        valueLak: p.value_lak,
                        imageUrl: p.image_url,
                        qtyTotal: p.qty_total,
                        qtyRemaining: p.qty_remaining,
                        oddsPct: Number(p.odds_pct ?? 0),
                    })),
                };
            }),
        };
    }

    /** สิทธิ์ของผู้เล่น: เหลือกี่ครั้งต่อวง + hands แต่ละระดับโต๊ะ + อีกกี่ hands ได้สิทธิ์ถัดไป + ประวัติหมุน */
    async myStatus(playerId: string, code: string) {
        const camp = await this.campaign(code);
        const d = await this.playerDetail(camp, playerId, false);
        return {
            campaign: camp.code,
            status: camp.status,
            totalRemaining: d.totalRemaining,
            wheels: d.wheels.map(({ adjusted: _a, ...w }) => w),
            spins: d.spins.map((s) => ({
                spinId: s.spinId,
                wheel: s.wheel,
                spunAt: s.spunAt,
                prize: s.prize,
                vipDays: s.vipDays,
                fulfillmentStatus: s.fulfillmentStatus,
            })),
        };
    }

    async spin(playerId: string, code: string, wheelCode: string) {
        const { data, error } = await this.sb.db.rpc('ld_spin_wheel', {
            p_player_id: playerId,
            p_campaign_code: code,
            p_wheel_code: wheelCode.trim().toLowerCase(),
        });
        if (error) throwRpcError(error);
        const r = data as RpcSpin;

        // ลำดับช่องบนวงล้อ = ลำดับ segments ของ GET /campaigns/:code (รางวัลที่หมดยังอยู่บนวง)
        const odds = (await this.odds(code)).filter((o) => o.wheel_code === r.wheel);
        const slot = odds.findIndex((o) => o.code === r.prize.code) + 1 || null;

        return {
            spinId: r.spin_id,
            wheel: r.wheel,
            slot,
            spunAt: r.spun_at,
            vipDays: r.vip_days,
            remaining: r.remaining,
            prize: {
                code: r.prize.code,
                type: r.prize.type,
                name: r.prize.name,
                valueLak: r.prize.value_lak,
                imageUrl: r.prize.image_url,
            },
        };
    }

    // =========================== admin ===========================

    async adminList() {
        const camps = must(
            await this.sb.db.from('ld_campaigns').select('*').order('sort_order').order('created_at'),
        ) as CampaignRow[];
        return Promise.all(
            camps.map(async (c) => ({
                ...card(c),
                wheels: (await this.wheels(c.id)).map((w) => ({
                    code: w.code,
                    name: w.name,
                    vipDays: w.vip_days,
                    isActive: w.is_active,
                    stakes: w.stakes.map((s) => ({ stake: s.code, handsPerSpin: s.hands_per_spin })),
                })),
            })),
        );
    }

    /**
     * แก้แคมเปญ / การ์ดหน้าแรก (SUPER): status COMING_SOON | OPEN | ENDED, name, dateLabel, imageUrl, sortOrder
     * ใช้ปิด Halloween ด้วย: PATCH /admin/campaigns/halloween-2026 { status: "ENDED" }
     */
    async updateCampaign(adminId: string, code: string, dto: UpdateCampaignDto) {
        await this.requireSuper(adminId);
        const camp = await this.campaign(code);
        const patch: Record<string, unknown> = {};
        if (dto.status !== undefined) patch.status = dto.status;
        if (dto.name !== undefined) patch.name = dto.name.trim();
        if (dto.dateLabel !== undefined) patch.date_label = dto.dateLabel?.trim() || null;
        if (dto.imageUrl !== undefined) patch.image_url = dto.imageUrl?.trim() || null;
        if (dto.sortOrder !== undefined) patch.sort_order = dto.sortOrder;
        if (!Object.keys(patch).length) throw new AppError(400, 'NOTHING_TO_UPDATE');
        const row = must(
            await this.sb.db.from('ld_campaigns').update(patch).eq('id', camp.id).select('*').single(),
        ) as CampaignRow;
        return card(row);
    }

    /** เปิด/ปิดวงล้อ (SUPER) — สิทธิ์ที่สะสมไว้ยังอยู่ เปิดใหม่ก็หมุนต่อได้ */
    async setWheelActive(adminId: string, code: string, wheelCode: string, isActive: boolean) {
        await this.requireSuper(adminId);
        const camp = await this.campaign(code);
        const wheel = await this.wheel(camp, wheelCode);
        must(await this.sb.db.from('ld_wheels').update({ is_active: isActive }).eq('id', wheel.id).select('id'));
        return { campaign: camp.code, wheel: wheel.code, isActive };
    }

    /** เพิ่ม/ตั้ง hands → คืนรายละเอียดผู้เล่นพร้อมสิทธิ์ที่คำนวณใหม่ */
    async setHands(adminId: string, code: string, dto: SetHandsDto) {
        const camp = await this.campaign(code);
        const player = await this.playerByXpokerId(dto.xpokerPlayerId);
        const { error } = await this.sb.db.rpc('ld_set_hands', {
            p_campaign_code: camp.code,
            p_player_id: player.id,
            p_entries: dto.entries.map((e) => ({ stake: e.stake.trim(), hands: e.hands })),
            p_mode: dto.mode ?? 'ADD',
            p_source: 'ADMIN',
            p_admin_id: adminId,
            p_note: dto.note?.trim() || null,
        });
        if (error) throwRpcError(error);
        return this.playerDetail(camp, player.id, true);
    }

    async adjustSpins(adminId: string, code: string, dto: AdjustSpinsDto) {
        const camp = await this.campaign(code);
        const player = await this.playerByXpokerId(dto.xpokerPlayerId);
        const { error } = await this.sb.db.rpc('ld_adjust_spins', {
            p_campaign_code: camp.code,
            p_player_id: player.id,
            p_wheel_code: dto.wheel.trim().toLowerCase(),
            p_delta: dto.delta,
            p_reason: dto.reason.trim(),
            p_admin_id: adminId,
        });
        if (error) throwRpcError(error);
        return this.playerDetail(camp, player.id, true);
    }

    /** ผู้เล่นที่ร่วมแคมเปญ (มี hands / ถูกเพิ่มสิทธิ์ / เคยหมุน) — 1 แถวต่อคน */
    async listPlayers(code: string, q: ListCampaignPlayersQuery) {
        const camp = await this.campaign(code);
        const rows = await fetchAll<StatusRow>((from, to) =>
            this.sb.db
                .from('ld_player_wheel_status')
                .select('*')
                .eq('campaign_code', camp.code)
                .order('username')
                .order('wheel_sort')
                .range(from, to),
        );

        const map = new Map<string, StatusRow[]>();
        for (const r of rows) map.set(r.player_id, [...(map.get(r.player_id) ?? []), r]);
        let items = [...map.values()].map((list) => {
            const r = list[0];
            const wheels = list.map((w) => ({
                code: w.wheel_code,
                earned: w.earned_from_hands + w.adjusted,
                used: w.used,
                remaining: w.remaining,
            }));
            return {
                playerId: r.player_id,
                username: r.username,
                displayName: r.display_name,
                xpokerPlayerId: r.xpoker_player_id,
                isActive: r.is_active,
                club: { code: r.club_code.toUpperCase(), name: r.club_name },
                totalRemaining: wheels.reduce((a, w) => a + w.remaining, 0),
                totalUsed: wheels.reduce((a, w) => a + w.used, 0),
                wheels,
            };
        });

        if (q.club) items = items.filter((e) => e.club.code === q.club!.trim().toUpperCase());
        if (q.q) {
            const t = q.q.trim().toLowerCase();
            items = items.filter(
                (e) =>
                    e.username.includes(t) ||
                    e.xpokerPlayerId.toLowerCase().includes(t) ||
                    e.displayName.toLowerCase().includes(t),
            );
        }
        if (q.hasSpins === 'YES') items = items.filter((e) => e.totalRemaining > 0);
        if (q.hasSpins === 'NO') items = items.filter((e) => e.totalRemaining === 0);

        const from = (q.page - 1) * q.limit;
        return { total: items.length, page: q.page, limit: q.limit, items: items.slice(from, from + q.limit) };
    }

    /** รายละเอียดผู้เล่น — ใส่ playerId (uuid) หรือ X-Poker ID ก็ได้ (ยังไม่ร่วมแคมเปญก็ดูได้ ค่าเป็น 0) */
    async getPlayer(code: string, idOrXpokerId: string) {
        const camp = await this.campaign(code);
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrXpokerId);
        const playerId = isUuid ? idOrXpokerId : (await this.playerByXpokerId(idOrXpokerId)).id;
        return this.playerDetail(camp, playerId, true);
    }

    async listSpins(code: string, q: ListCampaignSpinsQuery) {
        const camp = await this.campaign(code);
        let query = this.sb.db
            .from('ld_wheel_spin_list')
            .select('*', { count: 'exact' })
            .eq('campaign_code', camp.code);
        if (q.wheel) query = query.eq('wheel_code', q.wheel.trim().toLowerCase());
        if (q.fulfillment) query = query.eq('fulfillment_status', q.fulfillment);
        if (q.club) query = query.ilike('club_code', escapeLike(q.club.trim()));
        if (q.q) {
            const t = `%${escapeLike(q.q.trim()).replace(/[,()]/g, '')}%`;
            query = query.or(`username.ilike.${t},xpoker_player_id.ilike.${t},display_name.ilike.${t}`);
        }
        const from = (q.page - 1) * q.limit;
        const { data, error, count } = await query
            .order('spun_at', { ascending: false })
            .range(from, from + q.limit - 1);
        if (error) throw error;
        return { total: count ?? 0, page: q.page, limit: q.limit, items: (data as SpinListRow[]).map(mapSpin) };
    }

    /** ส่งมอบรางวัล (เงินสด + VIP) — DELIVERED / CANCELLED / PENDING */
    async updateFulfillment(adminId: string, spinId: string, dto: FulfillmentDto) {
        const delivered = dto.status === 'DELIVERED';
        const patch: Record<string, unknown> = {
            fulfillment_status: dto.status,
            delivered_by: delivered ? adminId : null,
            delivered_at: delivered ? new Date().toISOString() : null,
        };
        if (dto.note !== undefined) patch.note = dto.note;
        const updated = must(
            await this.sb.db.from('ld_wheel_spins').update(patch).eq('id', spinId).select('id'),
        ) as { id: string }[];
        if (!updated.length) throw new AppError(404, 'SPIN_NOT_FOUND');

        const row = must(
            await this.sb.db.from('ld_wheel_spin_list').select('*').eq('spin_id', spinId).single(),
        ) as SpinListRow;
        return mapSpin(row);
    }

    async adminPrizes(code: string) {
        const camp = await this.campaign(code);
        const [wheels, odds] = await Promise.all([this.wheels(camp.id), this.odds(camp.code)]);
        return wheels.map((w) => {
            const prizes = odds.filter((o) => o.wheel_code === w.code);
            return {
                code: w.code,
                name: w.name,
                vipDays: w.vip_days,
                isActive: w.is_active,
                oddsMode: prizes[0]?.odds_mode ?? 'QUANTITY',
                prizes: prizes.map((p, i) => ({
                    slot: i + 1,
                    code: p.code,
                    type: p.prize_type,
                    name: p.name,
                    valueLak: p.value_lak,
                    qtyTotal: p.qty_total,
                    qtyGiven: p.qty_total - p.qty_remaining,
                    qtyRemaining: p.qty_remaining,
                    weightPct: p.weight_bp / 100,
                    oddsPct: Number(p.odds_pct ?? 0),
                })),
            };
        });
    }

    /** ปรับอัตรา 1 วง (SUPER) — รวม 100% หรือทั้งหมด 0 = สุ่มตามจำนวนที่เหลือ */
    async updateWheelWeights(adminId: string, code: string, wheelCode: string, weights: Record<string, number>) {
        await this.requireSuper(adminId);
        const camp = await this.campaign(code);
        const wheel = await this.wheel(camp, wheelCode);
        const { error } = await this.sb.db.rpc('ld_set_wheel_weights', {
            p_wheel_id: wheel.id,
            p_weights: toBasisPoints(weights),
        });
        if (error) throwRpcError(error);
        return this.adminPrizes(code);
    }

    async summary(code: string) {
        const camp = await this.campaign(code);
        const [wheels, odds, status, spins] = await Promise.all([
            this.wheels(camp.id),
            this.odds(camp.code),
            fetchAll<StatusRow>((from, to) =>
                this.sb.db
                    .from('ld_player_wheel_status')
                    .select('player_id, wheel_code, earned_from_hands, adjusted, used, remaining')
                    .eq('campaign_code', camp.code)
                    .order('player_id')
                    .order('wheel_code')
                    .range(from, to) as never,
            ),
            fetchAll<SpinListRow>((from, to) =>
                this.sb.db
                    .from('ld_wheel_spin_list')
                    .select('wheel_code, prize_type, prize_value_lak, fulfillment_status')
                    .eq('campaign_code', camp.code)
                    .order('spin_id')
                    .range(from, to) as never,
            ),
        ]);

        const sumCash = (list: SpinListRow[], st: string) =>
            list
                .filter((s) => s.prize_type === 'CASH' && s.fulfillment_status === st)
                .reduce((a, s) => a + Number(s.prize_value_lak ?? 0), 0);

        return {
            campaign: camp.code,
            status: camp.status,
            participants: new Set(status.map((s) => s.player_id)).size,
            wheels: wheels.map((w) => {
                const prizes = odds.filter((o) => o.wheel_code === w.code);
                const st = status.filter((s) => s.wheel_code === w.code);
                const sp = spins.filter((s) => s.wheel_code === w.code);
                const total = prizes.reduce((a, p) => a + p.qty_total, 0);
                const remaining = prizes.reduce((a, p) => a + p.qty_remaining, 0);
                return {
                    code: w.code,
                    name: w.name,
                    isActive: w.is_active,
                    spinsEarned: st.reduce((a, s) => a + s.earned_from_hands + s.adjusted, 0),
                    spinsUsed: sp.length,
                    spinsOutstanding: st.reduce((a, s) => a + s.remaining, 0),
                    prizes: { total, given: total - remaining, remaining },
                    cashPaidLak: sumCash(sp, 'DELIVERED'),
                    cashPendingLak: sumCash(sp, 'PENDING'),
                    vipDays: w.vip_days,
                };
            }),
            fulfillment: {
                PENDING: spins.filter((s) => s.fulfillment_status === 'PENDING').length,
                DELIVERED: spins.filter((s) => s.fulfillment_status === 'DELIVERED').length,
                CANCELLED: spins.filter((s) => s.fulfillment_status === 'CANCELLED').length,
            },
            cashPaidLak: sumCash(spins, 'DELIVERED'),
            cashPendingLak: sumCash(spins, 'PENDING'),
        };
    }

    // =========================== helpers ===========================

    /**
     * คำนวณสิทธิ์จากตารางจริง (สูตรเดียวกับ ld_spin_wheel):
     * สิทธิ์ต่อวง = Σ floor(hands ÷ hands_per_spin) + ปรับด้วยมือ − หมุนไปแล้ว
     */
    private async playerDetail(camp: CampaignRow, playerId: string, withAdminInfo: boolean) {
        const wheels = await this.wheels(camp.id);
        const stakeIds = wheels.flatMap((w) => w.stakes.map((s) => s.id));
        const wheelIds = wheels.map((w) => w.id);

        const [player, hands, adjustments, spins] = await Promise.all([
            this.playerById(playerId),
            stakeIds.length
                ? this.sb.db.from('ld_player_hands').select('stake_id, hands, updated_at').eq('player_id', playerId).in('stake_id', stakeIds)
                : Promise.resolve({ data: [], error: null }),
            wheelIds.length
                ? this.sb.db
                    .from('ld_spin_adjustments')
                    .select('id, wheel_id, delta, reason, created_at, admin:ld_admins(username)')
                    .eq('player_id', playerId)
                    .in('wheel_id', wheelIds)
                    .order('created_at', { ascending: false })
                : Promise.resolve({ data: [], error: null }),
            this.sb.db
                .from('ld_wheel_spin_list')
                .select('*')
                .eq('campaign_code', camp.code)
                .eq('player_id', playerId)
                .order('spun_at', { ascending: false }),
        ]);
        const handRows = must(hands) as { stake_id: string; hands: number; updated_at: string }[];
        const adjRows = must(adjustments) as unknown as {
            id: string;
            wheel_id: string;
            delta: number;
            reason: string;
            created_at: string;
            admin: { username: string } | null;
        }[];
        const spinRows = must(spins) as SpinListRow[];

        const wheelOut = wheels.map((w) => {
            const stakes = w.stakes.map((s) => {
                const h = handRows.find((r) => r.stake_id === s.id)?.hands ?? 0;
                return {
                    stake: s.code,
                    handsPerSpin: s.hands_per_spin,
                    hands: h,
                    spinsEarned: Math.floor(h / s.hands_per_spin),
                    handsToNext: s.hands_per_spin - (h % s.hands_per_spin),
                };
            });
            const fromHands = stakes.reduce((a, s) => a + s.spinsEarned, 0);
            const adjusted = adjRows.filter((a) => a.wheel_id === w.id).reduce((a, r) => a + r.delta, 0);
            const used = spinRows.filter((s) => s.wheel_code === w.code).length;
            return {
                code: w.code,
                name: w.name,
                vipDays: w.vip_days,
                isOpen: w.is_active,
                spinsFromHands: fromHands,
                adjusted,
                used,
                remaining: Math.max(fromHands + adjusted - used, 0),
                stakes,
            };
        });

        const base = {
            campaign: camp.code,
            player: withAdminInfo ? player : { username: player.username, displayName: player.displayName },
            totalRemaining: wheelOut.reduce((a, w) => a + w.remaining, 0),
            wheels: wheelOut,
            spins: spinRows.map(mapSpin),
        };
        if (!withAdminInfo) return { ...base, adjustments: [], handsLog: [] };

        const log = stakeIds.length
            ? (must(
                await this.sb.db
                    .from('ld_hands_log')
                    .select('id, stake_id, old_hands, new_hands, source, note, created_at, admin:ld_admins(username)')
                    .eq('player_id', playerId)
                    .in('stake_id', stakeIds)
                    .order('created_at', { ascending: false })
                    .limit(100),
            ) as unknown as {
                id: string;
                stake_id: string;
                old_hands: number;
                new_hands: number;
                source: string;
                note: string | null;
                created_at: string;
                admin: { username: string } | null;
            }[])
            : [];
        const stakeCode = new Map(wheels.flatMap((w) => w.stakes.map((s) => [s.id, s.code] as const)));
        const wheelCode = new Map(wheels.map((w) => [w.id, w.code] as const));

        return {
            ...base,
            adjustments: adjRows.map((a) => ({
                id: a.id,
                wheel: wheelCode.get(a.wheel_id),
                delta: a.delta,
                reason: a.reason,
                by: a.admin?.username ?? null,
                at: a.created_at,
            })),
            handsLog: log.map((l) => ({
                id: l.id,
                stake: stakeCode.get(l.stake_id),
                oldHands: l.old_hands,
                newHands: l.new_hands,
                added: l.new_hands - l.old_hands,
                source: l.source,
                note: l.note,
                by: l.admin?.username ?? null,
                at: l.created_at,
            })),
        };
    }

    private async campaign(code: string) {
        const c = must(
            await this.sb.db.from('ld_campaigns').select('*').eq('code', code.trim().toLowerCase()).maybeSingle(),
        ) as CampaignRow | null;
        if (!c) throw new AppError(404, 'CAMPAIGN_NOT_FOUND');
        return c;
    }

    private async wheels(campaignId: string) {
        const rows = must(
            await this.sb.db
                .from('ld_wheels')
                .select('id, code, name, vip_days, sort_order, is_active, stakes:ld_wheel_stakes(id, code, hands_per_spin, sort_order)')
                .eq('campaign_id', campaignId)
                .order('sort_order'),
        ) as WheelRow[];
        for (const w of rows) w.stakes.sort((a, b) => a.sort_order - b.sort_order);
        return rows;
    }

    private async wheel(camp: CampaignRow, wheelCode: string) {
        const w = (await this.wheels(camp.id)).find((x) => x.code === wheelCode.trim().toLowerCase());
        if (!w) throw new AppError(404, 'WHEEL_NOT_FOUND');
        return w;
    }

    private async odds(campaignCode: string) {
        return must(
            await this.sb.db.from('ld_wheel_odds').select('*').eq('campaign_code', campaignCode).order('sort_order'),
        ) as OddsRow[];
    }

    private async requireSuper(adminId: string) {
        const admin = must(
            await this.sb.db.from('ld_admins').select('role').eq('id', adminId).maybeSingle(),
        ) as { role: string } | null;
        if (admin?.role !== 'SUPER') throw new AppError(403, 'SUPER_ADMIN_ONLY');
    }

    private async playerByXpokerId(xpokerId: string): Promise<PlayerRef> {
        const row = must(
            await this.sb.db
                .from('ld_admin_players')
                .select('id, username, display_name, xpoker_player_id, is_active, club_code, club_name')
                .ilike('xpoker_player_id', escapeLike(xpokerId.trim()))
                .limit(1)
                .maybeSingle(),
        ) as PlayerViewRow | null;
        if (!row) throw new AppError(404, 'PLAYER_NOT_FOUND', { xpokerPlayerId: xpokerId.trim() });
        return toPlayerRef(row);
    }

    private async playerById(id: string): Promise<PlayerRef> {
        const row = must(
            await this.sb.db
                .from('ld_admin_players')
                .select('id, username, display_name, xpoker_player_id, is_active, club_code, club_name')
                .eq('id', id)
                .maybeSingle(),
        ) as PlayerViewRow | null;
        if (!row) throw new AppError(404, 'PLAYER_NOT_FOUND');
        return toPlayerRef(row);
    }
}

interface PlayerViewRow {
    id: string;
    username: string;
    display_name: string;
    xpoker_player_id: string;
    is_active: boolean;
    club_code: string;
    club_name: string;
}

function toPlayerRef(r: PlayerViewRow): PlayerRef {
    return {
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        xpokerPlayerId: r.xpoker_player_id,
        isActive: r.is_active,
        club: { code: r.club_code.toUpperCase(), name: r.club_name },
    };
}

function card(c: CampaignRow) {
    return {
        code: c.code,
        name: c.name,
        status: c.status,
        dateLabel: c.date_label,
        imageUrl: c.image_url,
        sortOrder: c.sort_order,
    };
}

function mapSpin(r: SpinListRow) {
    return {
        spinId: r.spin_id,
        wheel: r.wheel_code,
        spunAt: r.spun_at,
        player: r.username
            ? {
                id: r.player_id,
                username: r.username,
                displayName: r.display_name,
                xpokerPlayerId: r.xpoker_player_id,
                club: { code: r.club_code?.toUpperCase(), name: r.club_name },
            }
            : undefined,
        prize: { code: r.prize_code, type: r.prize_type, name: r.prize_name, valueLak: r.prize_value_lak },
        vipDays: r.vip_days,
        fulfillmentStatus: r.fulfillment_status,
        deliveredBy: r.delivered_by,
        deliveredAt: r.delivered_at,
        note: r.note,
    };
}

function escapeLike(s: string) {
    return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

/** % → หน่วย 0.01% · รวมต้อง = 100 หรือ 0 (0 = สุ่มตามจำนวนที่เหลือ) */
function toBasisPoints(input: Record<string, number>) {
    const out: Record<string, number> = {};
    let sum = 0;
    for (const [code, pct] of Object.entries(input ?? {})) {
        const bp = Math.round(Number(pct) * 100);
        if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100 || Math.abs(pct * 100 - bp) > 1e-6) {
            throw new AppError(400, 'WEIGHTS_INVALID_VALUE', { code });
        }
        out[code.trim().toUpperCase()] = bp;
        sum += bp;
    }
    if (sum !== 10000 && sum !== 0) throw new AppError(400, 'WEIGHTS_SUM_NOT_100', { sumPct: sum / 100 });
    return out;
}