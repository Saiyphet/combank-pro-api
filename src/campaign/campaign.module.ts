import { Module } from '@nestjs/common';
import { CampaignAdminController, CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

@Module({
    controllers: [CampaignController, CampaignAdminController],
    providers: [CampaignService],
})
export class CampaignModule { }