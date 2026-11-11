import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AdminActor, AdminGuard, CurrentAdmin } from '../common/auth.guards';
import { ReportsService } from './reports.service';

class TopQuery {
    @IsOptional() @IsString() @MaxLength(16) stake?: string;
    @IsOptional() @IsString() @MaxLength(32) wheel?: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}
class AnomalyQuery {
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) jump?: number;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days?: number;
}

/** รายงานวิเคราะห์ hands (SUPER): /api/admin/campaigns/:code/reports/... */
@UseGuards(AdminGuard)
@Controller('admin/campaigns/:code/reports')
export class ReportsController {
    constructor(private readonly reports: ReportsService) { }

    @Get('summary')
    summary(@CurrentAdmin() a: AdminActor, @Param('code') code: string) {
        return this.reports.summary(a, code);
    }

    @Get('clubs')
    clubs(@CurrentAdmin() a: AdminActor, @Param('code') code: string) {
        return this.reports.clubs(a, code);
    }

    @Get('top-players')
    top(@CurrentAdmin() a: AdminActor, @Param('code') code: string, @Query() q: TopQuery) {
        return this.reports.topPlayers(a, code, q);
    }

    @Get('anomalies')
    anomalies(@CurrentAdmin() a: AdminActor, @Param('code') code: string, @Query() q: AnomalyQuery) {
        return this.reports.anomalies(a, code, q);
    }
}