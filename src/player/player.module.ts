import { Module } from '@nestjs/common';
import { PlayerController } from './player.controller';
import { PlayerService } from './player.service';
import { WheelService } from './wheel.service';

@Module({
  controllers: [PlayerController],
  providers: [PlayerService, WheelService],
  exports: [WheelService],
})
export class PlayerModule {}
