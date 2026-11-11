import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { fetchAll } from '../supabase/fetch-all';
import { AppError, must } from '../common/app-error';
import { AdminActor } from '../common/auth.guards';

interface Stake {
    id: string;
    code: string;
    handsPerSpin: number;
    wheel: string;
    sort: number;
}
interface HandRow {
    player_id: string;
    stake_id: string;
    hands: number;
    updated_at: string;
}
interface PlayerInfo {
    id: string;
    username: string;
    display_name: string;
    xpoker_player_id: string;
    is_active: boolean;
    club_code: string | null;
    club_name: string | null;
}
interface StatusRow {
    player_id: string;
    wheel_code: string;
    earned_from_hands: number;
    adjusted: number;
    used: number;
    remaining: number;
}

/** รายงานวิเคราะห์ hands (SUPER) */
@Injectable()
export class ReportsService {
    constructor(private readonly sb: SupabaseService) { }

    /** hands รวมต่อโต๊ะ / ต่อวง + สิทธิ์ที่ออก/ใช้ + import ล่าสุด */
    async summary(actor: AdminActor, code: string) {
        const d = await this.load(actor, code);
        const stakes = d.stakes.map((s) => {
            const rows = d.hands.filter((h) => h.stake_id === s.id && h.hands > 0);
            return {
                stake: s.code,
                wheel: s.wheel,
                handsPerSpin: s.handsPerSpin,
                players: rows.length,
                totalHands: rows.reduce((a, h) => a + h.hands, 0),
                spinsFromHands: rows.reduce((a, h) => a + Math.floor(h.hands / s.handsPerSpin), 0),
                playersWithSpin: rows.filter((h) => h.hands >= s.handsPerSpin).length,
            };
        });
        const wheels = [...new Set(d.stakes.map((s) => s.wheel))].map((w) => {
            const st = d.status.filter((s) => s.wheel_code === w);
            return {
                wheel: w,
                totalHands: stakes.filter((s) => s.wheel === w).reduce((a, s) => a + s.totalHands, 0),
                spinsFromHands: st.reduce((a, s) => a + s.earned_from_hands, 0),
                spinsAdjusted: st.reduce((a, s) => a + s.adjusted, 0),
                spinsUsed: st.reduce((a, s) => a + s.used, 0),
                spinsRemaining: st.reduce((a, s) => a + s.remaining, 0),
            };
        });
        const lastImport = must(
            await this.sb.db
                .from('ld_hand_imports')
                .select('id, applied_at, file_name, source')
                .eq('campaign_id', d.campaignId)
                .eq('status', 'APPLIED')
                .order('applied_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ) as { id: string; applied_at: string; file_name: string | null; source: string } | null;

        return {
            campaign: d.code,
            playersWithHands: new Set(d.hands.filter((h) => h.hands > 0).map((h) => h.player_id)).size,
            totalHands: stakes.reduce((a, s) => a + s.totalHands, 0),
            stakes,
            wheels,
            lastImport: lastImport
                ? { id: lastImport.id, appliedAt: lastImport.applied_at, fileName: lastImport.file_name, source: lastImport.source }
                : null,
        };
    }

    /** ต่อ club (club ของ account · ยังไม่มี club = NONE) */
    async clubs(actor: AdminActor, code: string) {
        const d = await this.load(actor, code);
        const spins = await fetchAll<{ player_id: string; prize_type: string; prize_value_lak: number | null; fulfillment_status: string }>(
            (from, to) =>
                this.sb.db
                    .from('ld_wheel_spin_list')
                    .select('player_id, prize_type, prize_value_lak, fulfillment_status')
                    .eq('campaign_code', d.code)
                    .order('spin_id')
                    .range(from, to) as never,
        );
        const groups = new Map<string, { club: { code: string; name: string | null } | null; ids: Set<string> }>();
        for (const p of d.players.values()) {
            const key = p.club_code ?? 'NONE';
            if (!groups.has(key)) {
                groups.set(key, { club: p.club_code ? { code: p.club_code.toUpperCase(), name: p.club_name } : null, ids: new Set() });
            }
            groups.get(key)!.ids.add(p.id);
        }
        const items = [...groups.values()].map((g) => {
            const hands = d.hands.filter((h) => g.ids.has(h.player_id) && h.hands > 0);
            const byWheel: Record<string, number> = {};
            for (const s of d.stakes) byWheel[s.wheel] = byWheel[s.wheel] ?? 0;
            for (const h of hands) byWheel[d.stakeBy.get(h.stake_id)!.wheel] += h.hands;
            const st = d.status.filter((s) => g.ids.has(s.player_id));
            const sp = spins.filter((s) => g.ids.has(s.player_id) && s.fulfillment_status !== 'CANCELLED');
            return {
                club: g.club,
                accounts: g.ids.size,
                playersWithHands: new Set(hands.map((h) => h.player_id)).size,
                totalHands: hands.reduce((a, h) => a + h.hands, 0),
                handsByWheel: byWheel,
                spinsEarned: st.reduce((a, s) => a + s.earned_from_hands + s.adjusted, 0),
                spinsUsed: st.reduce((a, s) => a + s.used, 0),
                cashWonLak: sp.filter((s) => s.prize_type === 'CASH').reduce((a, s) => a + Number(s.prize_value_lak ?? 0), 0),
            };
        });
        items.sort((a, b) => b.totalHands - a.totalHands);
        return { campaign: d.code, items };
    }

    /** ใครเล่นมากสุด — ?stake=1/2 (โต๊ะเดียว) หรือ ?wheel=gold (รวมโต๊ะในวง) หรือรวมทุกโต๊ะ */
    async topPlayers(actor: AdminActor, code: string, q: { stake?: string; wheel?: string; limit?: number }) {
        const d = await this.load(actor, code);
        let stakes = d.stakes;
        if (q.stake) stakes = stakes.filter((s) => s.code === q.stake!.trim().replace(/-/g, '/'));
        if (q.wheel) stakes = stakes.filter((s) => s.wheel === q.wheel!.trim().toLowerCase());
        if (!stakes.length) throw new AppError(404, 'STAKE_NOT_FOUND');
        const ids = new Set(stakes.map((s) => s.id));

        const per = new Map<string, { hands: number; spins: number; byStake: Record<string, number> }>();
        for (const h of d.hands) {
            if (!ids.has(h.stake_id) || h.hands <= 0) continue;
            const s = d.stakeBy.get(h.stake_id)!;
            const e = per.get(h.player_id) ?? { hands: 0, spins: 0, byStake: {} };
            e.hands += h.hands;
            e.spins += Math.floor(h.hands / s.handsPerSpin);
            e.byStake[s.code] = h.hands;
            per.set(h.player_id, e);
        }
        const items = [...per.entries()]
            .sort((a, b) => b[1].hands - a[1].hands)
            .slice(0, Math.min(q.limit ?? 50, 500))
            .map(([pid, e], i) => {
                const p = d.players.get(pid);
                return {
                    rank: i + 1,
                    playerId: pid,
                    xpokerPlayerId: p?.xpoker_player_id,
                    displayName: p?.display_name,
                    username: p?.username,
                    club: p?.club_code ? { code: p.club_code.toUpperCase(), name: p.club_name } : null,
                    hands: e.hands,
                    spinsFromHands: e.spins,
                    byStake: e.byStake,
                };
            });
        return { campaign: d.code, stakes: stakes.map((s) => s.code), items };
    }

    /**
     * ความผิดปกติ (ไม่ได้แปลว่าผิดเสมอ — ให้ SUPER ตรวจ)
     *  BIG_JUMP     hands เพิ่มต่อครั้งเกิน ?jump= (ค่าเริ่มต้น 2000) ใน ?days= วันล่าสุด
     *  DECREASED    hands ถูกลดลง (admin SET ต่ำกว่าเดิม)
     *  NO_CLUB      มี hands แต่ account ยังไม่มี club (admin club มองไม่เห็นคนนี้)
     *  DISABLED     บัญชีถูกปิด แต่ยังมี hands / สิทธิ์
     * (ID ที่เล่นหลาย club ตรวจไม่ได้ เพราะ LD ไม่มีข้อมูล club)
     */
    async anomalies(actor: AdminActor, code: string, q: { jump?: number; days?: number }) {
        const d = await this.load(actor, code);
        const jump = q.jump ?? 2000;
        const since = new Date(Date.now() - (q.days ?? 7) * 86_400_000).toISOString();
        const logs = await fetchAll<{ player_id: string; stake_id: string; old_hands: number; new_hands: number; source: string; note: string | null; created_at: string; import_id: string | null }>(
            (from, to) =>
                this.sb.db
                    .from('ld_hands_log')
                    .select('player_id, stake_id, old_hands, new_hands, source, note, created_at, import_id')
                    .in('stake_id', d.stakes.map((s) => s.id))
                    .gte('created_at', since)
                    .order('created_at', { ascending: false })
                    .range(from, to) as never,
        );
        const who = (pid: string) => {
            const p = d.players.get(pid);
            return {
                playerId: pid,
                xpokerPlayerId: p?.xpoker_player_id,
                displayName: p?.display_name,
                club: p?.club_code ? p.club_code.toUpperCase() : null,
            };
        };

        const bigJumps = logs
            .filter((l) => l.new_hands - l.old_hands > jump && l.old_hands > 0)
            .map((l) => ({
                ...who(l.player_id),
                stake: d.stakeBy.get(l.stake_id)?.code,
                oldHands: l.old_hands,
                newHands: l.new_hands,
                added: l.new_hands - l.old_hands,
                source: l.source,
                importId: l.import_id,
                at: l.created_at,
            }));
        const decreased = logs
            .filter((l) => l.new_hands < l.old_hands && l.note !== 'REVERT')
            .map((l) => ({
                ...who(l.player_id),
                stake: d.stakeBy.get(l.stake_id)?.code,
                oldHands: l.old_hands,
                newHands: l.new_hands,
                source: l.source,
                at: l.created_at,
            }));
        const withHands = new Set(d.hands.filter((h) => h.hands > 0).map((h) => h.player_id));
        const noClub = [...withHands].filter((pid) => !d.players.get(pid)?.club_code).map(who);
        const disabled = [...withHands].filter((pid) => d.players.get(pid) && !d.players.get(pid)!.is_active).map(who);

        return {
            campaign: d.code,
            params: { jump, days: q.days ?? 7 },
            counts: { bigJumps: bigJumps.length, decreased: decreased.length, noClub: noClub.length, disabled: disabled.length },
            bigJumps: bigJumps.slice(0, 500),
            decreased: decreased.slice(0, 500),
            noClub: noClub.slice(0, 1000),
            disabled: disabled.slice(0, 500),
        };
    }

    // ---------------- data ----------------
    private async load(actor: AdminActor, code: string) {
        if (actor.role !== 'SUPER') throw new AppError(403, 'SUPER_ADMIN_ONLY');
        const camp = must(
            await this.sb.db.from('ld_campaigns').select('id, code').eq('code', code.trim().toLowerCase()).maybeSingle(),
        ) as { id: string; code: string } | null;
        if (!camp) throw new AppError(404, 'CAMPAIGN_NOT_FOUND');

        const stakeRows = must(
            await this.sb.db
                .from('ld_wheel_stakes')
                .select('id, code, hands_per_spin, sort_order, wheel:ld_wheels!inner(code, sort_order, campaign_id)')
                .eq('wheel.campaign_id', camp.id),
        ) as unknown as { id: string; code: string; hands_per_spin: number; sort_order: number; wheel: { code: string; sort_order: number } }[];
        if (!stakeRows.length) throw new AppError(400, 'CAMPAIGN_HAS_NO_STAKES');
        const stakes: Stake[] = stakeRows
            .map((s) => ({ id: s.id, code: s.code, handsPerSpin: s.hands_per_spin, wheel: s.wheel.code, sort: s.wheel.sort_order * 100 + s.sort_order }))
            .sort((a, b) => a.sort - b.sort);

        const [hands, players, status] = await Promise.all([
            fetchAll<HandRow>((from, to) =>
                this.sb.db
                    .from('ld_player_hands')
                    .select('player_id, stake_id, hands, updated_at')
                    .in('stake_id', stakes.map((s) => s.id))
                    .order('player_id')
                    .order('stake_id')
                    .range(from, to),
            ),
            fetchAll<PlayerInfo>((from, to) =>
                this.sb.db
                    .from('ld_admin_players')
                    .select('id, username, display_name, xpoker_player_id, is_active, club_code, club_name')
                    .order('id')
                    .range(from, to),
            ),
            fetchAll<StatusRow>((from, to) =>
                this.sb.db
                    .from('ld_player_wheel_status')
                    .select('player_id, wheel_code, earned_from_hands, adjusted, used, remaining')
                    .eq('campaign_code', camp.code)
                    .order('player_id')
                    .order('wheel_code')
                    .range(from, to) as never,
            ),
        ]);
        return {
            campaignId: camp.id,
            code: camp.code,
            stakes,
            stakeBy: new Map(stakes.map((s) => [s.id, s])),
            hands,
            players: new Map(players.map((p) => [p.id, p])),
            status,
        };
    }
}