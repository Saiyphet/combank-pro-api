import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { AppError, must } from '../common/app-error';
import { AdminActor } from '../common/auth.guards';
import { AdminService } from './admin.service';
import { CreateAdminDto, UpdateAdminDto, clubOf } from './admins.dto';

const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const SELECT = 'id, username, role, is_active, created_at, club_id, club:ld_clubs(code, name)';

interface AdminRow {
    id: string;
    username: string;
    role: string;
    is_active: boolean;
    created_at: string;
    club_id: string | null;
    club: { code: string; name: string } | null;
}

/** จัดการบัญชี admin — SUPER เท่านั้น */
@Injectable()
export class AdminsService {
    constructor(
        private readonly sb: SupabaseService,
        private readonly players: AdminService,
    ) { }

    async list(actor: AdminActor) {
        requireSuper(actor);
        const rows = must(
            await this.sb.db.from('ld_admins').select(SELECT).order('created_at'),
        ) as unknown as AdminRow[];
        return rows.map(toAdmin);
    }

    async create(actor: AdminActor, dto: CreateAdminDto) {
        requireSuper(actor);
        const username = dto.username.trim().toLowerCase();
        const clubInput = clubOf(dto);
        if (dto.role === 'ADMIN' && !clubInput) throw new AppError(400, 'CLUB_REQUIRED');
        // club ใช้กับ ADMIN เท่านั้น — SUPER / STAFF ดูแลทุก club
        const clubId = dto.role === 'ADMIN' ? (await this.players.resolveClub(clubInput!)).id : null;

        const password = dto.password ?? generatePassword(10);
        const { data, error } = await this.sb.db
            .from('ld_admins')
            .insert({
                username,
                password_hash: await bcrypt.hash(password, 10),
                role: dto.role,
                club_id: clubId,
                is_active: true,
            })
            .select(SELECT)
            .single();
        if (error?.code === '23505') throw new AppError(409, 'ADMIN_ALREADY_EXISTS', { username });
        if (error) throw error;
        return { ...toAdmin(data as unknown as AdminRow), initialPassword: password };
    }

    async update(actor: AdminActor, id: string, dto: UpdateAdminDto) {
        requireSuper(actor);
        const row = await this.row(id);
        const clubInput = clubOf(dto);

        // ห้ามปิดหรือลดสิทธิ์ตัวเอง (กันไม่มี SUPER เหลือ)
        if (id === actor.id && ((dto.isActive === false) || (dto.role && dto.role !== row.role))) {
            throw new AppError(403, 'ADMIN_CANNOT_CHANGE_SELF');
        }

        const role = dto.role ?? row.role;
        const patch: Record<string, unknown> = {};
        if (dto.role !== undefined) patch.role = dto.role;
        if (dto.isActive !== undefined) patch.is_active = dto.isActive;

        if (role === 'ADMIN') {
            if (clubInput) patch.club_id = (await this.players.resolveClub(clubInput)).id;
            else if (!row.club_id) throw new AppError(400, 'CLUB_REQUIRED');
        } else if (row.club_id) {
            patch.club_id = null;
        }
        if (!Object.keys(patch).length) throw new AppError(400, 'NOTHING_TO_UPDATE');

        const updated = must(
            await this.sb.db.from('ld_admins').update(patch).eq('id', id).select(SELECT).single(),
        ) as unknown as AdminRow;
        return toAdmin(updated);
    }

    async resetPassword(actor: AdminActor, id: string) {
        requireSuper(actor);
        const row = await this.row(id);
        const password = generatePassword(10);
        must(
            await this.sb.db
                .from('ld_admins')
                .update({ password_hash: await bcrypt.hash(password, 10) })
                .eq('id', id)
                .select('id'),
        );
        return { id, username: row.username, newPassword: password };
    }

    private async row(id: string) {
        const row = must(
            await this.sb.db.from('ld_admins').select(SELECT).eq('id', id).maybeSingle(),
        ) as unknown as AdminRow | null;
        if (!row) throw new AppError(404, 'ADMIN_NOT_FOUND');
        return row;
    }
}

function requireSuper(actor: AdminActor) {
    if (actor.role !== 'SUPER') throw new AppError(403, 'SUPER_ADMIN_ONLY');
}

function toAdmin(r: AdminRow) {
    const club = Array.isArray(r.club) ? r.club[0] : r.club;
    return {
        id: r.id,
        username: r.username,
        role: r.role,
        isActive: r.is_active,
        club: club ? { code: club.code.toUpperCase(), name: club.name } : null,
        createdAt: r.created_at,
    };
}

function generatePassword(len: number) {
    let s = '';
    for (let i = 0; i < len; i++) s += PW_CHARS[randomInt(PW_CHARS.length)];
    return s;
}