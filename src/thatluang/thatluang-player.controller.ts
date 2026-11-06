import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, JwtPayload, PlayerGuard } from '../common/auth.guards';
import { ThatLuangCampaignGuard } from '../common/campaign.guard';
import { parseTier } from './mappers';
import { ThatLuangPlayerService } from './thatluang-player.service';

@Controller()
export class ThatLuangPlayerController {
  constructor(private readonly players: ThatLuangPlayerService) {}

  @UseGuards(PlayerGuard)
  @Get('leaderboard/:tier')
  leaderboard(@CurrentUser() user: JwtPayload, @Param('tier') tier: string) {
    return this.players.leaderboard(user.sub, parseTier(tier));
  }

  @UseGuards(PlayerGuard, ThatLuangCampaignGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('spin/:tier')
  @HttpCode(200)
  spin(@CurrentUser() user: JwtPayload, @Param('tier') tier: string) {
    return this.players.spin(user.sub, parseTier(tier));
  }
}
