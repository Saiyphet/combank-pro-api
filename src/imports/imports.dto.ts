import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class PreviewQuery {
    /** เตือนเมื่อ hands เพิ่มจากรอบก่อนเกินเท่านี้ (ค่าเริ่มต้น 2000) */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(1_000_000)
    jumpThreshold?: number;
}

export class GoogleSheetPreviewDto {
    /** ลิงก์ Google Sheet (ไม่ส่ง = ใช้ลิงก์ที่บันทึกไว้ครั้งก่อน) */
    @IsOptional()
    @IsString()
    @MaxLength(500)
    url?: string;

    /** จำลิงก์นี้ไว้ใช้ครั้งต่อไป (ค่าเริ่มต้น true) */
    @IsOptional()
    @IsBoolean()
    remember?: boolean;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(1_000_000)
    jumpThreshold?: number;
}

export class RevertDto {
    @IsOptional()
    @IsBoolean()
    force?: boolean;
}

export class ImportListQuery {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(500)
    limit = 50;
}