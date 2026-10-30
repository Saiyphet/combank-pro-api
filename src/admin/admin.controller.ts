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
  CreatePlayerDto,
  FulfillmentDto,
  ListPlayersQuery,
  UpdatePlayerDto,
  UpdateWeightsDto,
} from './admin.dto';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.admin.login(dto);
  }

  @UseGuards(AdminGuard)
  @Get('clubs')
  clubs() {
    return this.admin.listClubs();
  }

  @UseGuards(AdminGuard)
  @Post('players')
  createPlayer(@CurrentUser() user: JwtPayload, @Body() dto: CreatePlayerDto) {
    return this.admin.createPlayer(user.sub, dto);
  }

  @UseGuards(AdminGuard)
  @Get('players')
  listPlayers(@Query() q: ListPlayersQuery) {
    return this.admin.listPlayers(q);
  }

  @UseGuards(AdminGuard)
  @Get('players/:id')
  getPlayer(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getPlayer(id);
  }

  @UseGuards(AdminGuard)
  @Patch('players/:id')
  updatePlayer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlayerDto) {
    return this.admin.updatePlayer(id, dto);
  }

  @UseGuards(AdminGuard)
  @Post('players/:id/reset-password')
  @HttpCode(200)
  resetPassword(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.resetPassword(id);
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