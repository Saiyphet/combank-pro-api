import { Module } from '@nestjs/common';
import { PlayerModule } from '../player/player.module';
import { AdminScopeService } from './admin-scope.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [PlayerModule],
  controllers: [AdminController],
  providers: [AdminService, AdminScopeService],
})
export class AdminModule {}
