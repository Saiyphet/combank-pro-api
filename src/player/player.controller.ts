import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CampaignTokenGuard, CurrentUser, JwtPayload, PlayerGuard } from '../common/auth.guards';
import { CampaignGuard } from '../common/campaign.guard';
import { LoginDto } from './login.dto';
import { PlayerService } from './player.service';

@Controller()
export class PlayerController {
  constructor(private readonly players: PlayerService) { }

  /** 5 ครั้ง / 15 นาที / IP */
  // login แยกต่อโปร = ผู้เล่น 1 คน login หลายครั้ง + หลายคนอาจใช้ IP เดียวกัน (WiFi คลับ / เน็ตมือถือ) → 10 ครั้ง/15 นาที/IP
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.players.login(dto);
  }

  @UseGuards(PlayerGuard, CampaignTokenGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.players.me(user.sub);
  }

  @Get('prizes')
  prizes() {
    return this.players.prizes();
  }

  @UseGuards(PlayerGuard, CampaignTokenGuard, CampaignGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('spin')
  @HttpCode(200)
  spin(@CurrentUser() user: JwtPayload) {
    return this.players.spin(user.sub);
  }

  @UseGuards(PlayerGuard, CampaignTokenGuard, CampaignGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('spin/cash')
  @HttpCode(200)
  spinCash(@CurrentUser() user: JwtPayload) {
    return this.players.spinCash(user.sub);
  }
}