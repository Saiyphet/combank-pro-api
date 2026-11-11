import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard, CampaignTokenGuard, CurrentUser, JwtPayload, PlayerGuard } from '../common/auth.guards';
import { FulfillmentDto } from '../admin/admin.dto';
import {
    AdjustSpinsDto,
    ListCampaignPlayersQuery,
    ListCampaignSpinsQuery,
    MySpinsQuery,
    SetHandsDto,
    ToggleActiveDto,
    WinnersQuery,
    UpdateCampaignDto,
    WheelWeightsDto,
} from './campaign.dto';
import { CampaignService } from './campaign.service';

const CODE = 'code';

/** ฝั่งผู้เล่น: /api/campaigns/... */
@Controller('campaigns')
export class CampaignController {
    constructor(private readonly campaigns: CampaignService) { }

    /** การ์ดหน้าแรก (ไม่ต้อง login) */
    @Get()
    list() {
        return this.campaigns.listCards();
    }

    /** รายละเอียดวงล้อ/รางวัล — ต้อง login ด้วย token ของโปรนี้ */
    @UseGuards(PlayerGuard, CampaignTokenGuard)
    @Get(':code')
    info(@Param(CODE) code: string) {
        return this.campaigns.publicInfo(code);
    }

    @UseGuards(PlayerGuard, CampaignTokenGuard)
    @Get(':code/me')
    me(@CurrentUser() user: JwtPayload, @Param(CODE) code: string) {
        return this.campaigns.myStatus(user.sub, code);
    }

    /** ผู้ได้รางวัลล่าสุด (ทุกคน, ID ถูกปิดบางส่วน) ?wheel=&minValueLak=&page=&limit= (สูงสุด 50) */
    @UseGuards(PlayerGuard, CampaignTokenGuard)
    @Get(':code/winners')
    winners(@CurrentUser() user: JwtPayload, @Param(CODE) code: string, @Query() q: WinnersQuery) {
        return this.campaigns.winners(user.sub, code, q);
    }

    /** ประวัติรางวัลของตัวเอง (เห็นเฉพาะของตัวเอง — ระบุตัวจาก token) ?wheel=&page=&limit= */
    @UseGuards(PlayerGuard, CampaignTokenGuard)
    @Get(':code/me/spins')
    mySpins(@CurrentUser() user: JwtPayload, @Param(CODE) code: string, @Query() q: MySpinsQuery) {
        return this.campaigns.mySpins(user.sub, code, q);
    }

    @UseGuards(PlayerGuard, CampaignTokenGuard)
    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    @Post(':code/wheels/:wheel/spin')
    @HttpCode(200)
    spin(@CurrentUser() user: JwtPayload, @Param(CODE) code: string, @Param('wheel') wheel: string) {
        return this.campaigns.spin(user.sub, code, wheel);
    }
}

/** ฝั่ง admin: /api/admin/... */
@UseGuards(AdminGuard)
@Controller('admin')
export class CampaignAdminController {
    constructor(private readonly campaigns: CampaignService) { }

    @Get('campaigns')
    list() {
        return this.campaigns.adminList();
    }

    /** สถานะ / ชื่อ / วันที่ / รูปการ์ด (SUPER) */
    @Patch('campaigns/:code')
    updateCampaign(@CurrentUser() user: JwtPayload, @Param(CODE) code: string, @Body() dto: UpdateCampaignDto) {
        return this.campaigns.updateCampaign(user.sub, code, dto);
    }

    @Patch('campaigns/:code/wheels/:wheel')
    toggleWheel(
        @CurrentUser() user: JwtPayload,
        @Param(CODE) code: string,
        @Param('wheel') wheel: string,
        @Body() dto: ToggleActiveDto,
    ) {
        return this.campaigns.setWheelActive(user.sub, code, wheel, dto.isActive);
    }

    @Get('campaigns/:code/summary')
    summary(@Param(CODE) code: string) {
        return this.campaigns.summary(code);
    }

    /** เพิ่ม/ตั้ง hands ตามระดับโต๊ะ → ระบบคำนวณสิทธิ์ */
    @Post('campaigns/:code/hands')
    @HttpCode(200)
    setHands(@CurrentUser() user: JwtPayload, @Param(CODE) code: string, @Body() dto: SetHandsDto) {
        return this.campaigns.setHands(user.sub, code, dto);
    }

    /** เพิ่ม/ลดสิทธิ์ด้วยมือ */
    @Post('campaigns/:code/spin-adjustments')
    @HttpCode(200)
    adjust(@CurrentUser() user: JwtPayload, @Param(CODE) code: string, @Body() dto: AdjustSpinsDto) {
        return this.campaigns.adjustSpins(user.sub, code, dto);
    }

    @Get('campaigns/:code/players')
    players(@Param(CODE) code: string, @Query() q: ListCampaignPlayersQuery) {
        return this.campaigns.listPlayers(code, q);
    }

    /** :player = playerId (uuid) หรือ X-Poker ID */
    @Get('campaigns/:code/players/:player')
    player(@Param(CODE) code: string, @Param('player') player: string) {
        return this.campaigns.getPlayer(code, player);
    }

    @Get('campaigns/:code/spins')
    spins(@Param(CODE) code: string, @Query() q: ListCampaignSpinsQuery) {
        return this.campaigns.listSpins(code, q);
    }

    @Patch('campaign-spins/:id/fulfillment')
    fulfillment(
        @CurrentUser() user: JwtPayload,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: FulfillmentDto,
    ) {
        return this.campaigns.updateFulfillment(user.sub, id, dto);
    }

    @Get('campaigns/:code/prizes')
    prizes(@Param(CODE) code: string) {
        return this.campaigns.adminPrizes(code);
    }

    @Put('campaigns/:code/wheels/:wheel/weights')
    weights(
        @CurrentUser() user: JwtPayload,
        @Param(CODE) code: string,
        @Param('wheel') wheel: string,
        @Body() dto: WheelWeightsDto,
    ) {
        return this.campaigns.updateWheelWeights(user.sub, code, wheel, dto.weights);
    }
}