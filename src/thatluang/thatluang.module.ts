import { Module } from '@nestjs/common';
import { ThatLuangAdminController } from './thatluang-admin.controller';
import { ThatLuangAdminService } from './thatluang-admin.service';
import { ThatLuangPlayerController } from './thatluang-player.controller';
import { ThatLuangPlayerService } from './thatluang-player.service';

@Module({
  controllers: [ThatLuangPlayerController, ThatLuangAdminController],
  providers: [ThatLuangPlayerService, ThatLuangAdminService],
  exports: [ThatLuangPlayerService],
})
export class ThatLuangModule {}
