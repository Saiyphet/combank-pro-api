import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UploadedFiles,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AdminActor, AdminGuard, CurrentAdmin } from '../common/auth.guards';
import { BannerFieldsDto } from './banners.dto';
import { BannersService } from './banners.service';

type Files = { image?: Express.Multer.File[]; mobileImage?: Express.Multer.File[] };
const upload = FileFieldsInterceptor(
    [
        { name: 'image', maxCount: 1 },
        { name: 'mobileImage', maxCount: 1 },
    ],
    { limits: { fileSize: 2 * 1024 * 1024, files: 2 } },
);

/** หน้าเว็บ: GET /api/banners (ไม่ต้อง login) */
@Controller('banners')
export class BannersController {
    constructor(private readonly banners: BannersService) { }

    @Get()
    list() {
        return this.banners.listPublic();
    }
}

/** admin (SUPER): /api/admin/banners — multipart/form-data: image, mobileImage + ช่องข้อความ */
@UseGuards(AdminGuard)
@Controller('admin/banners')
export class BannersAdminController {
    constructor(private readonly banners: BannersService) { }

    @Get()
    list(@CurrentAdmin() a: AdminActor) {
        return this.banners.listAdmin(a);
    }

    @Post()
    @UseInterceptors(upload)
    create(@CurrentAdmin() a: AdminActor, @Body() dto: BannerFieldsDto, @UploadedFiles() files: Files = {}) {
        return this.banners.create(a, dto, files.image?.[0], files.mobileImage?.[0]);
    }

    @Patch(':id')
    @UseInterceptors(upload)
    update(
        @CurrentAdmin() a: AdminActor,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: BannerFieldsDto,
        @UploadedFiles() files: Files = {},
    ) {
        return this.banners.update(a, id, dto, files.image?.[0], files.mobileImage?.[0]);
    }

    @Delete(':id')
    remove(@CurrentAdmin() a: AdminActor, @Param('id', ParseUUIDPipe) id: string) {
        return this.banners.remove(a, id);
    }
}