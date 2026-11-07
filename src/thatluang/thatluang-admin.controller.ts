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
import { AdminScopeService } from '../admin/admin-scope.service';
import { AdminGuard, CurrentUser, JwtPayload } from '../common/auth.guards';
import { parseTier } from './mappers';
import {
  CreatePlayerDto,
  FulfillmentDto,
  ImportHandsDto,
  ListPlayersQuery,
  SaveTierDto,
  UpdatePlayerDto,
} from './admin.dto';
import { ThatLuangAdminService } from './thatluang-admin.service';

/** The That Luang admin. Signing in stays at /admin/auth/login, shared with Halloween. */
@UseGuards(AdminGuard)
@Controller('admin/tl')
export class ThatLuangAdminController {
  constructor(
    private readonly admin: ThatLuangAdminService,
    private readonly scope: AdminScopeService,
  ) {}

  @Get('clubs')
  clubs(@CurrentUser() user: JwtPayload) {
    return this.admin.listClubs(user.sub);
  }

  @Post('players')
  createPlayer(@CurrentUser() user: JwtPayload, @Body() dto: CreatePlayerDto) {
    return this.admin.createPlayer(user.sub, dto);
  }

  @Get('players')
  listPlayers(@CurrentUser() user: JwtPayload, @Query() q: ListPlayersQuery) {
    return this.admin.listPlayers(user.sub, q);
  }

  @Get('players/:id')
  getPlayer(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getPlayer(user.sub, id);
  }

  @Patch('players/:id')
  updatePlayer(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlayerDto) {
    return this.admin.updatePlayer(user.sub, id, dto);
  }

  @Post('players/:id/reset-password')
  @HttpCode(200)
  resetPassword(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.resetPassword(user.sub, id);
  }

  @Patch('spins/:id/fulfillment')
  fulfillment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FulfillmentDto,
  ) {
    return this.admin.updateFulfillment(user.sub, id, dto);
  }

  @Post('reports/hands')
  @HttpCode(200)
  async importHands(@CurrentUser() user: JwtPayload, @Body() dto: ImportHandsDto) {
    await this.scope.requireSuper(user.sub);
    return this.admin.importHands(dto.csv);
  }

  @Get('prizes')
  async prizes(@CurrentUser() user: JwtPayload) {
    await this.scope.requireSuper(user.sub);
    return this.admin.prizes();
  }

  @Put('tiers/:tier')
  saveTier(@CurrentUser() user: JwtPayload, @Param('tier') tier: string, @Body() dto: SaveTierDto) {
    return this.admin.saveTier(user.sub, parseTier(tier), dto);
  }

  @Get('summary')
  summary(@CurrentUser() user: JwtPayload) {
    return this.admin.summary(user.sub);
  }

  @Get('spins/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="that-luang-winners.csv"')
  exportCsv(@CurrentUser() user: JwtPayload) {
    return this.admin.exportCsv(user.sub);
  }
}
