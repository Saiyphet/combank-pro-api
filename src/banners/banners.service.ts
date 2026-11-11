import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { AppError, must } from '../common/app-error';
import { AdminActor } from '../common/auth.guards';
import { BannerFieldsDto } from './banners.dto';

const BUCKET = 'banners';
const MAX_IMAGE = 2 * 1024 * 1024;

interface BannerRow {
    id: string;
    title: string;
    image_url: string;
    mobile_image_url: string | null;
    image_path: string | null;
    mobile_image_path: string | null;
    link_type: 'NONE' | 'CAMPAIGN' | 'URL';
    campaign_code: string | null;
    link_url: string | null;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface UploadedImage {
    buffer: Buffer;
    originalname: string;
    size: number;
}

/** banner / poster โปรโมชัน — รูปเก็บที่ Supabase Storage (bucket "banners", public) */
@Injectable()
export class BannersService {
    constructor(private readonly sb: SupabaseService) { }

    /** หน้าเว็บ (ไม่ต้อง login): เฉพาะที่เปิดอยู่ เรียงตาม sortOrder */
    async listPublic() {
        const rows = must(
            await this.sb.db.from('ld_banners').select('*').eq('is_active', true).order('sort_order').order('created_at'),
        ) as BannerRow[];
        return rows.map((r) => ({
            id: r.id,
            title: r.title,
            imageUrl: r.image_url,
            mobileImageUrl: r.mobile_image_url ?? r.image_url,
            link: { type: r.link_type, campaignCode: r.campaign_code, url: r.link_url },
            sortOrder: r.sort_order,
        }));
    }

    async listAdmin(actor: AdminActor) {
        requireSuper(actor);
        const rows = must(await this.sb.db.from('ld_banners').select('*').order('sort_order').order('created_at')) as BannerRow[];
        return rows.map(mapAdmin);
    }

    async create(actor: AdminActor, dto: BannerFieldsDto, image?: UploadedImage, mobile?: UploadedImage) {
        requireSuper(actor);
        if (!dto.title?.trim()) throw new AppError(400, 'BANNER_TITLE_REQUIRED');
        if (!image && !dto.imageUrl) throw new AppError(400, 'BANNER_IMAGE_REQUIRED');
        await this.checkLink(dto);

        const uploaded: string[] = [];
        try {
            const img = image ? await this.upload(image, uploaded) : null;
            const mob = mobile ? await this.upload(mobile, uploaded) : null;
            const row = must(
                await this.sb.db
                    .from('ld_banners')
                    .insert({
                        title: dto.title.trim(),
                        image_url: img?.url ?? dto.imageUrl,
                        image_path: img?.path ?? null,
                        mobile_image_url: mob?.url ?? dto.mobileImageUrl ?? null,
                        mobile_image_path: mob?.path ?? null,
                        link_type: dto.linkType ?? 'NONE',
                        campaign_code: dto.linkType === 'CAMPAIGN' ? dto.campaignCode?.trim().toLowerCase() : null,
                        link_url: dto.linkType === 'URL' ? dto.linkUrl : null,
                        sort_order: dto.sortOrder ?? 0,
                        is_active: dto.isActive ?? true,
                        created_by: actor.id,
                    })
                    .select('*')
                    .single(),
            ) as BannerRow;
            return mapAdmin(row);
        } catch (e) {
            await this.removeFiles(uploaded); // ไม่ทิ้งไฟล์ค้าง
            throw e;
        }
    }

    async update(actor: AdminActor, id: string, dto: BannerFieldsDto, image?: UploadedImage, mobile?: UploadedImage) {
        requireSuper(actor);
        const cur = await this.row(id);
        const linkType = dto.linkType ?? cur.link_type;
        await this.checkLink({
            linkType,
            campaignCode: dto.campaignCode !== undefined ? dto.campaignCode : cur.campaign_code,
            linkUrl: dto.linkUrl !== undefined ? dto.linkUrl : cur.link_url,
        });

        const uploaded: string[] = [];
        const oldFiles: string[] = [];
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        try {
            if (dto.title !== undefined) patch.title = dto.title.trim();
            if (image) {
                const img = await this.upload(image, uploaded);
                Object.assign(patch, { image_url: img.url, image_path: img.path });
                if (cur.image_path) oldFiles.push(cur.image_path);
            } else if (dto.imageUrl) {
                Object.assign(patch, { image_url: dto.imageUrl, image_path: null });
                if (cur.image_path) oldFiles.push(cur.image_path);
            }
            if (mobile) {
                const mob = await this.upload(mobile, uploaded);
                Object.assign(patch, { mobile_image_url: mob.url, mobile_image_path: mob.path });
                if (cur.mobile_image_path) oldFiles.push(cur.mobile_image_path);
            } else if (dto.mobileImageUrl !== undefined) {
                Object.assign(patch, { mobile_image_url: dto.mobileImageUrl, mobile_image_path: null });
                if (cur.mobile_image_path) oldFiles.push(cur.mobile_image_path);
            }
            if (dto.linkType !== undefined || dto.campaignCode !== undefined || dto.linkUrl !== undefined) {
                patch.link_type = linkType;
                patch.campaign_code = linkType === 'CAMPAIGN' ? (dto.campaignCode ?? cur.campaign_code)?.trim().toLowerCase() : null;
                patch.link_url = linkType === 'URL' ? (dto.linkUrl ?? cur.link_url) : null;
            }
            if (dto.sortOrder !== undefined) patch.sort_order = dto.sortOrder;
            if (dto.isActive !== undefined) patch.is_active = dto.isActive;

            const row = must(await this.sb.db.from('ld_banners').update(patch).eq('id', id).select('*').single()) as BannerRow;
            await this.removeFiles(oldFiles);
            return mapAdmin(row);
        } catch (e) {
            await this.removeFiles(uploaded);
            throw e;
        }
    }

    async remove(actor: AdminActor, id: string) {
        requireSuper(actor);
        const cur = await this.row(id);
        must(await this.sb.db.from('ld_banners').delete().eq('id', id).select('id'));
        await this.removeFiles([cur.image_path, cur.mobile_image_path].filter((p): p is string => !!p));
        return { id, deleted: true };
    }

    // ---------------- helpers ----------------
    private async row(id: string) {
        const r = must(await this.sb.db.from('ld_banners').select('*').eq('id', id).maybeSingle()) as BannerRow | null;
        if (!r) throw new AppError(404, 'BANNER_NOT_FOUND');
        return r;
    }

    private async checkLink(d: { linkType?: string; campaignCode?: string | null; linkUrl?: string | null }) {
        if (d.linkType === 'URL' && !d.linkUrl) throw new AppError(400, 'BANNER_LINK_URL_REQUIRED');
        if (d.linkType === 'CAMPAIGN') {
            if (!d.campaignCode) throw new AppError(400, 'BANNER_CAMPAIGN_REQUIRED');
            const c = must(
                await this.sb.db.from('ld_campaigns').select('id').eq('code', d.campaignCode.trim().toLowerCase()).maybeSingle(),
            );
            if (!c) throw new AppError(404, 'CAMPAIGN_NOT_FOUND');
        }
    }

    /** ตรวจชนิดจากเนื้อไฟล์จริง (ไม่เชื่อชื่อ/MIME ที่ส่งมา) แล้วอัปโหลด */
    private async upload(file: UploadedImage, uploaded: string[]) {
        if (file.size > MAX_IMAGE) throw new AppError(413, 'IMAGE_TOO_LARGE', { maxBytes: MAX_IMAGE });
        const type = sniffImage(file.buffer);
        if (!type) throw new AppError(400, 'IMAGE_TYPE_NOT_ALLOWED', { allowed: ['jpg', 'png', 'webp'] });
        const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${type.ext}`;
        const { error } = await this.sb.db.storage.from(BUCKET).upload(path, file.buffer, {
            contentType: type.mime,
            cacheControl: '31536000',
            upsert: false,
        });
        if (error) throw new AppError(502, 'IMAGE_UPLOAD_FAILED', { reason: error.message });
        uploaded.push(path);
        return { path, url: this.sb.db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
    }

    private async removeFiles(paths: string[]) {
        if (!paths.length) return;
        await this.sb.db.storage.from(BUCKET).remove(paths).catch(() => undefined);
    }
}

function sniffImage(b: Buffer): { ext: string; mime: string } | null {
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
    if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return { ext: 'png', mime: 'image/png' };
    }
    if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
        return { ext: 'webp', mime: 'image/webp' };
    }
    return null;
}

function requireSuper(actor: AdminActor) {
    if (actor.role !== 'SUPER') throw new AppError(403, 'SUPER_ADMIN_ONLY');
}

function mapAdmin(r: BannerRow) {
    return {
        id: r.id,
        title: r.title,
        imageUrl: r.image_url,
        mobileImageUrl: r.mobile_image_url,
        uploaded: { image: !!r.image_path, mobileImage: !!r.mobile_image_path },
        link: { type: r.link_type, campaignCode: r.campaign_code, url: r.link_url },
        sortOrder: r.sort_order,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}