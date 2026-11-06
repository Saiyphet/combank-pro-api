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
  constructor(private readonly admin: ThatLuangAdminService) {}

  @Get('clubs')
  clubs() {
    return this.admin.listClubs();
  }

  @Post('players')
  createPlayer(@CurrentUser() user: JwtPayload, @Body() dto: CreatePlayerDto) {
    return this.admin.createPlayer(user.sub, dto);
  }

  @Get('players')
  listPlayers(@Query() q: ListPlayersQuery) {
    return this.admin.listPlayers(q);
  }

  @Get('players/:id')
  getPlayer(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getPlayer(id);
  }

  @Patch('players/:id')
  updatePlayer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlayerDto) {
    return this.admin.updatePlayer(id, dto);
  }

  @Post('players/:id/reset-password')
  @HttpCode(200)
  resetPassword(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.resetPassword(id);
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
  importHands(@Body() dto: ImportHandsDto) {
    return this.admin.importHands(dto.csv);
  }

  @Get('prizes')
  prizes() {
    return this.admin.prizes();
  }

  @Put('tiers/:tier')
  saveTier(@CurrentUser() user: JwtPayload, @Param('tier') tier: string, @Body() dto: SaveTierDto) {
    return this.admin.saveTier(user.sub, parseTier(tier), dto);
  }

  @Get('summary')
  summary() {
    return this.admin.summary();
  }

  @Get('spins/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="that-luang-winners.csv"')
  exportCsv() {
    return this.admin.exportCsv();
  }
}
