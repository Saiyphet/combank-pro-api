import { Module } from '@nestjs/common';
import { PlayerModule } from '../player/player.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminsController } from './admins.controller';
import { AdminsService } from './admins.service';

@Module({
  imports: [PlayerModule],
  // AdminsController ก่อน AdminController: /admin/admins ต้องไม่ถูกจับเป็น route อื่น
  controllers: [AdminsController, AdminController],
  providers: [AdminService, AdminsService],
  exports: [AdminService],
})
export class AdminModule { }