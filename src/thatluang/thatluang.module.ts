import { Module } from '@nestjs/common';
import { AdminScopeService } from '../admin/admin-scope.service';
import { ThatLuangAdminController } from './thatluang-admin.controller';
import { ThatLuangAdminService } from './thatluang-admin.service';
import { ThatLuangPlayerController } from './thatluang-player.controller';
import { ThatLuangPlayerService } from './thatluang-player.service';

@Module({
  controllers: [ThatLuangPlayerController, ThatLuangAdminController],
  providers: [ThatLuangPlayerService, ThatLuangAdminService, AdminScopeService],
  exports: [ThatLuangPlayerService],
})
export class ThatLuangModule {}
