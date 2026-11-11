import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminActor, AdminGuard, CurrentAdmin } from '../common/auth.guards';
import { CreateAdminDto, UpdateAdminDto } from './admins.dto';
import { AdminsService } from './admins.service';

/** จัดการบัญชี admin (SUPER เท่านั้น): /api/admin/admins */
@UseGuards(AdminGuard)
@Controller('admin/admins')
export class AdminsController {
    constructor(private readonly admins: AdminsService) { }

    @Get()
    list(@CurrentAdmin() actor: AdminActor) {
        return this.admins.list(actor);
    }

    @Post()
    create(@CurrentAdmin() actor: AdminActor, @Body() dto: CreateAdminDto) {
        return this.admins.create(actor, dto);
    }

    @Patch(':id')
    update(@CurrentAdmin() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminDto) {
        return this.admins.update(actor, id, dto);
    }

    @Post(':id/reset-password')
    @HttpCode(200)
    resetPassword(@CurrentAdmin() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string) {
        return this.admins.resetPassword(actor, id);
    }
}