import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { fetchAll } from '../supabase/fetch-all';
import { AppError, must } from '../common/app-error';
import { AdminActor } from '../common/auth.guards';
import { generatePassword, passwordVault } from '../common/password-vault';
import { ImportIssue, ParsedEntry, StakeRef, parseHandsWorkbook } from './hands-parser';

const PREVIEW_TTL_MIN = 120;
const CHANGE_SAMPLE = 300;

interface CampaignRef {
    id: string;
    code: string;
    hands_sheet_url: string | null;
}

interface ImportRow {
    id: string;
    campaign_id: string;
    source: 'FILE' | 'GSHEET';
    file_name: string | null;
    sheet_url: string | null;
    content_hash: string;
    status: 'PREVIEW' | 'APPLIED' | 'REVERTED';
    summary: Record<string, unknown>;
    created_at: string;
    applied_at: string | null;
    reverted_at: string | null;
    creator?: { username: string } | null;
    applier?: { username: string } | null;
    reverter?: { username: string } | null;
}

export interface PreviewInput {
    buffer: Buffer;
    fileName: string | null;
    source: 'FILE' | 'GSHEET';
    sheetUrl?: string | null;
    jumpThreshold?: number;
}

/**
 * Import hands (SUPER เท่านั้น) — ยอดสะสมจาก LD = ตั้งเป็นยอดรวม (SET)
 *  preview: อ่านไฟล์ + ตรวจทุกแถว (ยังไม่บันทึก) · ผิดแม้แถวเดียว = 422 IMPORT_INVALID + รายการปัญหา
 *  confirm: สร้าง account ที่ยังไม่มี + ตั้ง hands ทั้งไฟล์ใน transaction เดียว
 *  revert:  คืน hands ของ import ครั้งล่าสุด
 */
@Injectable()
export class ImportsService {
    constructor(private readonly sb: SupabaseService) { }

    // ---------------- preview ----------------
    async preview(actor: AdminActor, code: string, input: PreviewInput) {
        requireSuper(actor);
        const camp = await this.campaign(code);
        const stakes = await this.stakes(camp.id);
        const parsed = await parseHandsWorkbook(input.buffer, stakes);

        const errors: ImportIssue[] = [...parsed.errors];
        const warnings: ImportIssue[] = [];
        const jump = input.jumpThreshold ?? 2000;

        // ผู้เล่น + hands ปัจจุบัน
        const [players, current] = await Promise.all([
            fetchAll<{ id: string; xpoker_player_id: string; is_active: boolean }>((from, to) =>
                this.sb.db.from('ld_players').select('id, xpoker_player_id, is_active').order('id').range(from, to),
            ),
            fetchAll<{ player_id: string; stake_id: string; hands: number }>((from, to) =>
                this.sb.db
                    .from('ld_player_hands')
                    .select('player_id, stake_id, hands')
                    .in('stake_id', stakes.map((s) => s.id))
                    .order('player_id')
                    .order('stake_id')
                    .range(from, to),
            ),
        ]);
        const playerBy = new Map(players.map((p) => [p.xpoker_player_id.toLowerCase(), p]));
        const handsBy = new Map(current.map((h) => [`${h.player_id}|${h.stake_id}`, h.hands]));

        const changes: (ParsedEntry & { playerId: string | null; oldHands: number })[] = [];
        const newAccounts = new Map<string, { xpokerPlayerId: string; name: string | null }>();
        let unchanged = 0;

        for (const e of parsed.entries) {
            const p = playerBy.get(e.xpokerPlayerId.toLowerCase());
            const old = p ? handsBy.get(`${p.id}|${e.stake.id}`) ?? 0 : 0;

            if (p && old > e.hands) {
                errors.push({
                    sheet: e.sheet, row: e.row, column: 'hands', code: 'HANDS_DECREASED', xpokerPlayerId: e.xpokerPlayerId,
                    value: e.hands,
                    message: `hands ลดลงจาก ${old.toLocaleString()} เป็น ${e.hands.toLocaleString()} (ยอดสะสมไม่ควรลด — ตรวจว่าอ่าน LD ถูกไหม)`,
                });
                continue;
            }
            if (!p && e.hands === 0) continue; // ยังไม่มี account และไม่มี hands — ไม่ต้องสร้าง
            if (p && old === e.hands) {
                unchanged++;
                continue;
            }
            if (!p && !newAccounts.has(e.xpokerPlayerId.toLowerCase())) {
                newAccounts.set(e.xpokerPlayerId.toLowerCase(), { xpokerPlayerId: e.xpokerPlayerId, name: e.name });
            }
            if (p && !p.is_active) {
                warnings.push({ sheet: e.sheet, row: e.row, code: 'PLAYER_DISABLED', xpokerPlayerId: e.xpokerPlayerId, message: 'บัญชีถูกปิดอยู่ — hands ถูกบันทึก แต่หมุนไม่ได้จนกว่าจะเปิด' });
            }
            if (old > 0 && e.hands - old > jump) {
                warnings.push({
                    sheet: e.sheet, row: e.row, column: 'hands', code: 'BIG_JUMP', xpokerPlayerId: e.xpokerPlayerId, value: e.hands,
                    message: `hands เพิ่ม ${(e.hands - old).toLocaleString()} จากรอบก่อน (${old.toLocaleString()} → ${e.hands.toLocaleString()}) — ตรวจว่าอ่าน LD ถูกไหม`,
                });
            }
            changes.push({ ...e, playerId: p?.id ?? null, oldHands: old });
        }

        const contentHash = createHash('sha256')
            .update(
                parsed.entries
                    .map((e) => `${e.stake.code}|${e.xpokerPlayerId.toLowerCase()}|${e.hands}`)
                    .sort()
                    .join('\n'),
            )
            .digest('hex');

        // ข้อมูลชุดเดียวกับที่เคย import แล้ว → เตือน (ยอดสะสม import ซ้ำก็ไม่เพิ่ม)
        const dup = must(
            await this.sb.db
                .from('ld_hand_imports')
                .select('id, applied_at, file_name, applier:ld_admins!ld_hand_imports_applied_by_fkey(username)')
                .eq('campaign_id', camp.id)
                .eq('content_hash', contentHash)
                .eq('status', 'APPLIED')
                .order('applied_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ) as unknown as { id: string; applied_at: string; file_name: string | null; applier: { username: string } | null } | null;
        if (dup) {
            warnings.unshift({
                code: 'DUPLICATE_DATA',
                message: `ข้อมูลชุดนี้เหมือนกับที่ import ไปแล้วเมื่อ ${dup.applied_at} โดย ${dup.applier?.username ?? '-'} (import ซ้ำ hands ไม่เพิ่ม)`,
                value: dup.id,
            });
        }

        const summary = {
            sheets: parsed.sheets,
            ignoredSheets: parsed.ignoredSheets,
            rows: parsed.entries.length,
            changedRows: changes.length,
            unchangedRows: unchanged,
            players: new Set(changes.map((c) => c.xpokerPlayerId.toLowerCase())).size,
            newAccounts: newAccounts.size,
            spinsGained: spinsGained(changes, stakes),
            warnings: warnings.length,
        };

        if (errors.length) {
            // ผิดแม้แถวเดียว → ไม่บันทึกอะไรเลย + บอกทุกจุดที่ผิด
            throw new AppError(422, 'IMPORT_INVALID', { errors: errors.slice(0, 500), errorCount: errors.length, summary });
        }
        if (!changes.length) {
            throw new AppError(422, 'IMPORT_NOTHING_CHANGED', { summary, warnings });
        }

        const imp = must(
            await this.sb.db
                .from('ld_hand_imports')
                .insert({
                    campaign_id: camp.id,
                    source: input.source,
                    file_name: input.fileName,
                    sheet_url: input.sheetUrl ?? null,
                    content_hash: contentHash,
                    summary,
                    created_by: actor.id,
                })
                .select('id, created_at')
                .single(),
        ) as { id: string; created_at: string };

        for (let i = 0; i < changes.length; i += 1000) {
            must(
                await this.sb.db.from('ld_hand_import_rows').insert(
                    changes.slice(i, i + 1000).map((c) => ({
                        import_id: imp.id,
                        sheet: c.sheet,
                        row_no: c.row,
                        stake_id: c.stake.id,
                        xpoker_player_id: c.xpokerPlayerId,
                        name: c.name,
                        hands: c.hands,
                        player_id: c.playerId,
                        old_hands: c.oldHands,
                    })),
                ),
            );
        }

        return {
            importId: imp.id,
            expiresAt: new Date(Date.parse(imp.created_at) + PREVIEW_TTL_MIN * 60_000).toISOString(),
            canConfirm: true,
            summary,
            warnings: warnings.slice(0, 500),
            newAccounts: [...newAccounts.values()].slice(0, 1000),
            changes: changes.slice(0, CHANGE_SAMPLE).map((c) => ({
                sheet: c.sheet,
                row: c.row,
                stake: c.stake.code,
                xpokerPlayerId: c.xpokerPlayerId,
                name: c.name,
                oldHands: c.oldHands,
                hands: c.hands,
                newAccount: !c.playerId,
            })),
        };
    }

    /** ดึงไฟล์จาก Google Sheet (ต้องแชร์ "Anyone with the link → Viewer") แล้ว preview */
    async previewGoogleSheet(actor: AdminActor, code: string, url: string | undefined, remember: boolean, jumpThreshold?: number) {
        requireSuper(actor);
        const camp = await this.campaign(code);
        const sheetUrl = (url ?? camp.hands_sheet_url ?? '').trim();
        if (!sheetUrl) throw new AppError(400, 'GSHEET_URL_REQUIRED');
        const id = sheetUrl.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
        if (!id) throw new AppError(400, 'GSHEET_URL_INVALID');

        const buffer = await downloadGoogleSheet(id);
        if (remember && sheetUrl !== camp.hands_sheet_url) {
            must(await this.sb.db.from('ld_campaigns').update({ hands_sheet_url: sheetUrl }).eq('id', camp.id).select('id'));
        }
        return this.preview(actor, code, { buffer, fileName: 'Google Sheet', source: 'GSHEET', sheetUrl, jumpThreshold });
    }

    // ---------------- confirm ----------------
    async confirm(actor: AdminActor, code: string, importId: string) {
        requireSuper(actor);
        const camp = await this.campaign(code);
        const imp = await this.importRow(camp, importId);
        if (imp.status !== 'PREVIEW') throw new AppError(409, 'IMPORT_NOT_PREVIEW', { status: imp.status });

        // account ที่ต้องสร้าง = ID ในไฟล์ที่ยังไม่มีในระบบ (ตรวจใหม่ตอนยืนยัน)
        const rows = await fetchAll<{ xpoker_player_id: string; name: string | null }>((from, to) =>
            this.sb.db.from('ld_hand_import_rows').select('xpoker_player_id, name').eq('import_id', imp.id).order('id').range(from, to),
        );
        const ids = [...new Map(rows.map((r) => [r.xpoker_player_id.toLowerCase(), r])).values()];
        const existing = new Set<string>();
        for (let i = 0; i < ids.length; i += 300) {
            const chunk = ids.slice(i, i + 300).map((r) => r.xpoker_player_id);
            const found = must(
                await this.sb.db.from('ld_players').select('xpoker_player_id').in('xpoker_player_id', chunk),
            ) as { xpoker_player_id: string }[];
            found.forEach((f) => existing.add(f.xpoker_player_id.toLowerCase()));
        }
        const newAccounts = ids
            .filter((r) => !existing.has(r.xpoker_player_id.toLowerCase()))
            .map((r) => {
                const password = generatePassword();
                return {
                    xpoker_player_id: r.xpoker_player_id,
                    username: r.xpoker_player_id.toLowerCase(),
                    password,
                    password_enc: passwordVault.encrypt(password),
                    display_name: (r.name ?? '').trim().slice(0, 100) || r.xpoker_player_id,
                };
            });

        const { data, error } = await this.sb.db.rpc('ld_apply_hand_import', {
            p_import_id: imp.id,
            p_admin_id: actor.id,
            p_new_accounts: newAccounts,
        });
        if (error) throw importRpcError(error);
        const result = data as { appliedRows: number; createdAccounts: number };
        return {
            importId: imp.id,
            status: 'APPLIED',
            ...result,
            newAccounts: newAccounts.map((a) => ({ xpokerPlayerId: a.xpoker_player_id, username: a.username })),
        };
    }

    // ---------------- history ----------------
    async list(actor: AdminActor, code: string, page = 1, limit = 50) {
        requireSuper(actor);
        const camp = await this.campaign(code);
        const from = (page - 1) * limit;
        const { data, error, count } = await this.sb.db
            .from('ld_hand_imports')
            .select(IMPORT_SELECT, { count: 'exact' })
            .eq('campaign_id', camp.id)
            .order('created_at', { ascending: false })
            .range(from, from + limit - 1);
        if (error) throw error;
        return {
            sheetUrl: camp.hands_sheet_url,
            total: count ?? 0,
            page,
            limit,
            items: (data as unknown as ImportRow[]).map(mapImport),
        };
    }

    async detail(actor: AdminActor, code: string, importId: string, page = 1, limit = 200) {
        requireSuper(actor);
        const camp = await this.campaign(code);
        const imp = await this.importRow(camp, importId);
        const from = (page - 1) * limit;
        const { data, error, count } = await this.sb.db
            .from('ld_hand_import_rows')
            .select('sheet, row_no, xpoker_player_id, name, hands, old_hands, player_id, stake:ld_wheel_stakes(code)', { count: 'exact' })
            .eq('import_id', imp.id)
            .order('id')
            .range(from, from + limit - 1);
        if (error) throw error;
        return {
            ...mapImport(imp),
            rows: {
                total: count ?? 0,
                page,
                limit,
                items: (data as unknown as {
                    sheet: string; row_no: number; xpoker_player_id: string; name: string | null;
                    hands: number; old_hands: number | null; player_id: string | null; stake: { code: string } | null;
                }[]).map((r) => ({
                    sheet: r.sheet,
                    row: r.row_no,
                    stake: r.stake?.code,
                    xpokerPlayerId: r.xpoker_player_id,
                    name: r.name,
                    oldHands: r.old_hands,
                    hands: r.hands,
                })),
            },
        };
    }

    // ---------------- revert ----------------
    async revert(actor: AdminActor, code: string, importId: string, force: boolean) {
        requireSuper(actor);
        const camp = await this.campaign(code);
        const imp = await this.importRow(camp, importId);
        const { data, error } = await this.sb.db.rpc('ld_revert_hand_import', {
            p_import_id: imp.id,
            p_admin_id: actor.id,
            p_force: force,
        });
        if (error) throw importRpcError(error);
        return { importId: imp.id, status: 'REVERTED', ...(data as Record<string, unknown>) };
    }

    // ---------------- helpers ----------------
    private async campaign(code: string) {
        const c = must(
            await this.sb.db.from('ld_campaigns').select('id, code, hands_sheet_url').eq('code', code.trim().toLowerCase()).maybeSingle(),
        ) as CampaignRef | null;
        if (!c) throw new AppError(404, 'CAMPAIGN_NOT_FOUND');
        return c;
    }

    private async stakes(campaignId: string): Promise<StakeRef[]> {
        const rows = must(
            await this.sb.db
                .from('ld_wheel_stakes')
                .select('id, code, hands_per_spin, wheel:ld_wheels!inner(code, campaign_id)')
                .eq('wheel.campaign_id', campaignId),
        ) as unknown as { id: string; code: string; hands_per_spin: number; wheel: { code: string } }[];
        if (!rows.length) throw new AppError(400, 'CAMPAIGN_HAS_NO_STAKES');
        return rows.map((r) => ({ id: r.id, code: r.code, wheelCode: r.wheel.code, handsPerSpin: r.hands_per_spin }));
    }

    private async importRow(camp: CampaignRef, id: string) {
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(404, 'IMPORT_NOT_FOUND');
        const imp = must(
            await this.sb.db.from('ld_hand_imports').select(IMPORT_SELECT).eq('id', id).eq('campaign_id', camp.id).maybeSingle(),
        ) as unknown as ImportRow | null;
        if (!imp) throw new AppError(404, 'IMPORT_NOT_FOUND');
        return imp;
    }
}

const IMPORT_SELECT =
    'id, campaign_id, source, file_name, sheet_url, content_hash, status, summary, created_at, applied_at, reverted_at, ' +
    'creator:ld_admins!ld_hand_imports_created_by_fkey(username), ' +
    'applier:ld_admins!ld_hand_imports_applied_by_fkey(username), ' +
    'reverter:ld_admins!ld_hand_imports_reverted_by_fkey(username)';

function mapImport(r: ImportRow) {
    return {
        id: r.id,
        source: r.source,
        fileName: r.file_name,
        sheetUrl: r.sheet_url,
        status: r.status,
        summary: r.summary,
        createdBy: r.creator?.username ?? null,
        createdAt: r.created_at,
        appliedBy: r.applier?.username ?? null,
        appliedAt: r.applied_at,
        revertedBy: r.reverter?.username ?? null,
        revertedAt: r.reverted_at,
    };
}

/** สิทธิ์ที่เพิ่มต่อวง (คิดต่อโต๊ะ: floor(ใหม่ ÷ เกณฑ์) − floor(เดิม ÷ เกณฑ์)) */
function spinsGained(changes: { stake: StakeRef; hands: number; oldHands: number }[], stakes: StakeRef[]) {
    const out: Record<string, number> = {};
    for (const s of stakes) out[s.wheelCode] = out[s.wheelCode] ?? 0;
    for (const c of changes) {
        out[c.stake.wheelCode] +=
            Math.floor(c.hands / c.stake.handsPerSpin) - Math.floor(c.oldHands / c.stake.handsPerSpin);
    }
    return out;
}

function requireSuper(actor: AdminActor) {
    if (actor.role !== 'SUPER') throw new AppError(403, 'SUPER_ADMIN_ONLY');
}

/** error จาก RPC import → code + รายละเอียด (details เป็น JSON) */
function importRpcError(error: { message: string; details?: string | null }) {
    const code = error.message;
    let details: unknown = error.details ?? null;
    try {
        details = details ? JSON.parse(String(details)) : null;
    } catch {
        /* ข้อความธรรมดา */
    }
    const map: Record<string, [number, string]> = {
        IMPORT_NOT_FOUND: [404, 'ไม่พบ import นี้'],
        IMPORT_NOT_PREVIEW: [409, 'import นี้ยืนยันไปแล้ว หรือถูกยกเลิกแล้ว'],
        IMPORT_EXPIRED: [410, `ผลตรวจหมดอายุ (เกิน ${PREVIEW_TTL_MIN} นาที) — อัปไฟล์ใหม่`],
        IMPORT_CONFLICT: [409, 'hands ในระบบเปลี่ยนระหว่างรอยืนยัน (ยอดในระบบมากกว่าในไฟล์) — ไม่ได้บันทึกอะไร อัปไฟล์ใหม่'],
        IMPORT_PLAYER_MISSING: [409, 'สร้าง account ไม่ครบ — ไม่ได้บันทึกอะไร ลองยืนยันใหม่'],
        IMPORT_NOT_APPLIED: [409, 'import นี้ยังไม่ได้ยืนยัน หรือถูกยกเลิกไปแล้ว'],
        IMPORT_NOT_LATEST: [409, 'ยกเลิกได้เฉพาะ import ครั้งล่าสุด'],
        REVERT_CHANGED_AFTER: [409, 'hands บางแถวถูกแก้หลัง import นี้ — ส่ง force: true เพื่อข้ามแถวเหล่านั้น'],
        REVERT_SPINS_USED: [409, 'ผู้เล่นบางคนใช้สิทธิ์จาก import นี้ไปแล้ว — ส่ง force: true เพื่อยกเลิกต่อ'],
    };
    const hit = map[code];
    if (!hit) return error;
    return new AppError(hit[0], code, { message: hit[1], details });
}

async function downloadGoogleSheet(id: string): Promise<Buffer> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    try {
        const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, {
            redirect: 'follow',
            signal: ctrl.signal,
        });
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || type.includes('text/html')) {
            throw new AppError(400, 'GSHEET_NOT_ACCESSIBLE', {
                message: 'เปิด Google Sheet ไม่ได้ — ตั้งแชร์เป็น "Anyone with the link → Viewer"',
            });
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 10 * 1024 * 1024) throw new AppError(413, 'FILE_TOO_LARGE');
        return buf;
    } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(502, 'GSHEET_DOWNLOAD_FAILED');
    } finally {
        clearTimeout(t);
    }
}