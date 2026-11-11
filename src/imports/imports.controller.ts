import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    Post,
    Query,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminActor, AdminGuard, CurrentAdmin } from '../common/auth.guards';
import { AppError } from '../common/app-error';
import { GoogleSheetPreviewDto, ImportListQuery, PreviewQuery, RevertDto } from './imports.dto';
import { ImportsService } from './imports.service';

const MAX_FILE = 10 * 1024 * 1024;

/** Import hands (SUPER เท่านั้น): /api/admin/campaigns/:code/imports/... */
@UseGuards(AdminGuard)
@Controller('admin/campaigns/:code/imports')
export class ImportsController {
    constructor(private readonly imports: ImportsService) { }

    /** อัปไฟล์ .xlsx (multipart field "file") → ตรวจทุกแถว ยังไม่บันทึก */
    @Post('preview')
    @HttpCode(200)
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE, files: 1 } }))
    preview(
        @CurrentAdmin() actor: AdminActor,
        @Param('code') code: string,
        @UploadedFile() file: Express.Multer.File | undefined,
        @Query() q: PreviewQuery,
    ) {
        if (!file) throw new AppError(400, 'FILE_REQUIRED');
        if (!/\.xlsx$/i.test(file.originalname)) throw new AppError(400, 'FILE_NOT_XLSX');
        return this.imports.preview(actor, code, {
            buffer: file.buffer,
            fileName: file.originalname,
            source: 'FILE',
            jumpThreshold: q.jumpThreshold,
        });
    }

    /** ดึงจาก Google Sheet (แชร์แบบ Anyone with the link → Viewer) → ตรวจ ยังไม่บันทึก */
    @Post('preview-gsheet')
    @HttpCode(200)
    previewGsheet(@CurrentAdmin() actor: AdminActor, @Param('code') code: string, @Body() dto: GoogleSheetPreviewDto) {
        return this.imports.previewGoogleSheet(actor, code, dto.url, dto.remember ?? true, dto.jumpThreshold);
    }

    /** ยืนยัน → บันทึกทั้งไฟล์ทีเดียว (สร้าง account ที่ยังไม่มีให้ด้วย) */
    @Post(':id/confirm')
    @HttpCode(200)
    confirm(@CurrentAdmin() actor: AdminActor, @Param('code') code: string, @Param('id') id: string) {
        return this.imports.confirm(actor, code, id);
    }

    /** ยกเลิกทั้งไฟล์ (เฉพาะ import ครั้งล่าสุด) */
    @Post(':id/revert')
    @HttpCode(200)
    revert(@CurrentAdmin() actor: AdminActor, @Param('code') code: string, @Param('id') id: string, @Body() dto: RevertDto) {
        return this.imports.revert(actor, code, id, dto.force ?? false);
    }

    @Get()
    list(@CurrentAdmin() actor: AdminActor, @Param('code') code: string, @Query() q: ImportListQuery) {
        return this.imports.list(actor, code, q.page, q.limit);
    }

    @Get(':id')
    detail(@CurrentAdmin() actor: AdminActor, @Param('code') code: string, @Param('id') id: string, @Query() q: ImportListQuery) {
        return this.imports.detail(actor, code, id, q.page, q.limit);
    }
}