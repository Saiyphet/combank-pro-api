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
import { AdminGuard, CurrentUser, JwtPayload } from '../common/auth.guards';
import { LoginDto } from '../player/login.dto';
import {
  CreateAdminDto,
  CreatePlayerDto,
  FulfillmentDto,
  ListPlayersQuery,
  UpdateAdminDto,
  UpdatePlayerDto,
  UpdateWeightsDto,
} from './admin.dto';
import { AdminScopeService } from './admin-scope.service';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly scope: AdminScopeService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.admin.login(dto);
  }

  @UseGuards(AdminGuard)
  @Get('clubs')
  clubs(@CurrentUser() user: JwtPayload) {
    return this.admin.listClubs(user.sub);
  }

  @UseGuards(AdminGuard)
  @Post('players')
  createPlayer(@CurrentUser() user: JwtPayload, @Body() dto: CreatePlayerDto) {
    return this.admin.createPlayer(user.sub, dto);
  }

  @UseGuards(AdminGuard)
  @Get('players')
  listPlayers(@CurrentUser() user: JwtPayload, @Query() q: ListPlayersQuery) {
    return this.admin.listPlayers(user.sub, q);
  }

  @UseGuards(AdminGuard)
  @Get('players/:id')
  getPlayer(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getPlayer(user.sub, id);
  }

  @UseGuards(AdminGuard)
  @Patch('players/:id')
  updatePlayer(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlayerDto) {
    return this.admin.updatePlayer(user.sub, id, dto);
  }

  @UseGuards(AdminGuard)
  @Post('players/:id/reset-password')
  @HttpCode(200)
  resetPassword(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.resetPassword(user.sub, id);
  }

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
  async prizes(@CurrentUser() user: JwtPayload) {
    await this.scope.requireSuper(user.sub);
    return this.admin.prizes();
  }

  @UseGuards(AdminGuard)
  @Put('prizes/weights')
  updateWeights(@CurrentUser() user: JwtPayload, @Body() dto: UpdateWeightsDto) {
    return this.admin.updateWeights(user.sub, dto);
  }

  @UseGuards(AdminGuard)
  @Get('prizes/weights/history')
  async weightHistory(@CurrentUser() user: JwtPayload) {
    await this.scope.requireSuper(user.sub);
    return this.admin.weightHistory();
  }

  @UseGuards(AdminGuard)
  @Get('summary')
  summary(@CurrentUser() user: JwtPayload) {
    return this.admin.summary(user.sub);
  }

  @UseGuards(AdminGuard)
  @Get('spins/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="lucky-draw-winners.csv"')
  exportCsv(@CurrentUser() user: JwtPayload) {
    return this.admin.exportCsv(user.sub);
  }

  // ---------- admin accounts: Super Admin only ----------
  @UseGuards(AdminGuard)
  @Get('admins')
  async admins(@CurrentUser() user: JwtPayload) {
    await this.scope.requireSuper(user.sub);
    return this.admin.listAdmins();
  }

  @UseGuards(AdminGuard)
  @Post('admins')
  async createAdmin(@CurrentUser() user: JwtPayload, @Body() dto: CreateAdminDto) {
    await this.scope.requireSuper(user.sub);
    return this.admin.createAdmin(dto);
  }

  @UseGuards(AdminGuard)
  @Patch('admins/:id')
  async updateAdmin(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminDto) {
    await this.scope.requireSuper(user.sub);
    return this.admin.updateAdmin(user.sub, id, dto);
  }

  @UseGuards(AdminGuard)
  @Post('admins/:id/reset-password')
  @HttpCode(200)
  async resetAdminPassword(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.scope.requireSuper(user.sub);
    return this.admin.resetAdminPassword(id);
  }
}