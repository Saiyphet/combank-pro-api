import { Module } from '@nestjs/common';
import { AdminScopeService } from '../admin/admin-scope.service';
import { CampaignAdminController, CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

@Module({
    controllers: [CampaignController, CampaignAdminController],
    providers: [CampaignService, AdminScopeService],
})
export class CampaignModule { }
