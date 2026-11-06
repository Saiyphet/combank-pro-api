import { Module } from '@nestjs/common';
import { PlayerController } from './player.controller';
import { PlayerService } from './player.service';
import { WheelService } from './wheel.service';
import { ThatLuangModule } from '../thatluang/thatluang.module';

@Module({
  // This module's routes register first, so POST /spin/cash is matched before That Luang's POST /spin/:tier.
  imports: [ThatLuangModule],
  controllers: [PlayerController],
  providers: [PlayerService, WheelService],
  exports: [WheelService],
})
export class PlayerModule {}
