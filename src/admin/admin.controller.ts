import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminActor, AdminGuard, ClubAdminAllowed, CurrentAdmin, CurrentUser, JwtPayload } from '../common/auth.guards';
import { LoginDto } from '../player/login.dto';
import {
  CreatePlayerDto,
  FulfillmentDto,
  ListPlayersQuery,
  UpdatePlayerDto,
  UpdateWeightsDto,
} from './admin.dto';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) { }

  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.admin.login(dto);
  }

  // ---- admin ประจำ club (ADMIN) ใช้ได้แค่: clubs, รายชื่อ/ดูผู้เล่น, ดูรหัส — เฉพาะ club ตัวเอง ----

  @UseGuards(AdminGuard)
  @ClubAdminAllowed()
  @Get('clubs')
  clubs(@CurrentAdmin() actor: AdminActor) {
    return this.admin.listClubs(actor);
  }

  /** SUPER / STAFF (admin ประจำ club สร้างไม่ได้ — account มาจาก import หรือ SUPER) */
  @UseGuards(AdminGuard)
  @Post('players')
  createPlayer(@CurrentAdmin() actor: AdminActor, @Body() dto: CreatePlayerDto) {
    return this.admin.createPlayer(actor, dto);
  }

  @UseGuards(AdminGuard)
  @ClubAdminAllowed()
  @Get('players')
  listPlayers(@CurrentAdmin() actor: AdminActor, @Query() q: ListPlayersQuery) {
    return this.admin.listPlayers(q, actor);
  }

  @UseGuards(AdminGuard)
  @ClubAdminAllowed()
  @Get('players/:id')
  getPlayer(@CurrentAdmin() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getPlayer(id, actor);
  }

  /** แก้ชื่อ / เปิดปิด / ใส่ club (SUPER / STAFF) */
  @UseGuards(AdminGuard)
  @Patch('players/:id')
  updatePlayer(
    @CurrentAdmin() actor: AdminActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlayerDto,
  ) {
    return this.admin.updatePlayer(id, dto, actor);
  }

  /** SUPER เท่านั้น */
  @UseGuards(AdminGuard)
  @Post('players/:id/reset-password')
  @HttpCode(200)
  resetPassword(@CurrentAdmin() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.resetPassword(id, actor);
  }

  /** ดูรหัส: SUPER ทุกคน · admin club เฉพาะลูก club ตัวเอง (รหัสตอนสร้าง account) — บันทึกทุกครั้ง */
  @UseGuards(AdminGuard)
  @ClubAdminAllowed()
  @Get('players/:id/password')
  viewPassword(@CurrentAdmin() actor: AdminActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.viewPassword(id, actor);
  }

  // ---- ด้านล่าง: SUPER / STAFF เท่านั้น ----

  @UseGuards(AdminGuard)
  @Patch('spins/:id/fulfillment')
  fulfillment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FulfillmentDto,
  ) {
    return this.admin.updateFulfillment(user.sub, id, dto);
  }

  @UseGuards(AdminGuard)
  @Get('prizes')
  prizes() {
    return this.admin.prizes();
  }

  @UseGuards(AdminGuard)
  @Put('prizes/weights')
  updateWeights(@CurrentUser() user: JwtPayload, @Body() dto: UpdateWeightsDto) {
    return this.admin.updateWeights(user.sub, dto);
  }

  @UseGuards(AdminGuard)
  @Get('prizes/weights/history')
  weightHistory() {
    return this.admin.weightHistory();
  }

  @UseGuards(AdminGuard)
  @Get('summary')
  summary() {
    return this.admin.summary();
  }

  @UseGuards(AdminGuard)
  @Get('spins/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="lucky-draw-winners.csv"')
  exportCsv() {
    return this.admin.exportCsv();
  }
}