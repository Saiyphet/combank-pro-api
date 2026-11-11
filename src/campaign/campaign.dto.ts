import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
    NotEquals,
    ValidateNested,
} from 'class-validator';

const XPOKER_ID = /^\s*[A-Za-z0-9_-]{1,32}\s*$/;
const XPOKER_ID_MSG = 'xpokerPlayerId must be 1-32 letters, digits, _ or -';

export class HandsEntryDto {
    /** ระดับโต๊ะ เช่น "1/2", "20/40" */
    @IsString()
    @MaxLength(16)
    stake: string;

    @IsInt()
    @Min(0)
    @Max(10_000_000)
    hands: number;
}

/**
 * เพิ่ม/ตั้ง hands ของผู้เล่น (หลายระดับโต๊ะในครั้งเดียว) → ระบบคำนวณสิทธิ์ให้เอง
 * mode ADD = บวกเพิ่มจากยอดเดิม · SET = ตั้งเป็นยอดสะสมทั้งหมด
 */
export class SetHandsDto {
    @IsString()
    @Matches(XPOKER_ID, { message: XPOKER_ID_MSG })
    xpokerPlayerId: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(20)
    @ValidateNested({ each: true })
    @Type(() => HandsEntryDto)
    entries: HandsEntryDto[];

    @IsOptional()
    @IsIn(['ADD', 'SET'])
    mode: 'ADD' | 'SET' = 'ADD';

    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;
}

/** เพิ่ม (+) / ลด (−) สิทธิ์หมุนของวงใดวงหนึ่งด้วยมือ */
export class AdjustSpinsDto {
    @IsString()
    @Matches(XPOKER_ID, { message: XPOKER_ID_MSG })
    xpokerPlayerId: string;

    @IsString()
    @MaxLength(32)
    wheel: string;

    @IsInt()
    @NotEquals(0)
    @Min(-1000)
    @Max(1000)
    delta: number;

    @IsString()
    @MinLength(1)
    @MaxLength(200)
    reason: string;
}

export class ToggleActiveDto {
    @IsBoolean()
    isActive: boolean;
}

/** แก้แคมเปญ / การ์ดหน้าแรก (SUPER) — ส่งเฉพาะช่องที่จะเปลี่ยน */
export class UpdateCampaignDto {
    /** COMING_SOON = ໄວໆນີ້ (login ไม่ได้) · OPEN = ເປີດຢູ່ (หมุนได้) · ENDED = ສິ້ນສຸດ (login ดูประวัติได้ หมุนไม่ได้) */
    @IsOptional()
    @IsIn(['COMING_SOON', 'OPEN', 'ENDED'])
    status?: 'COMING_SOON' | 'OPEN' | 'ENDED';

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    name?: string;

    /** ข้อความวันที่บนการ์ด เช่น "9–29 ພະຈິກ 2026" (null = ไม่แสดง) */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    dateLabel?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    @Matches(/^(https:\/\/|\/)/, { message: 'imageUrl must start with https:// or /' })
    imageUrl?: string | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(1000)
    sortOrder?: number;

    /** ลิงก์ Google Sheet สำหรับ import hands ("" = ลบ) */
    @IsOptional()
    @IsString()
    @MaxLength(500)
    handsSheetUrl?: string;
}

class PageQuery {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    limit = 50;
}

export class ListCampaignPlayersQuery extends PageQuery {
    /** ค้นหา username / X-Poker ID / ชื่อ */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    q?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    club?: string;

    /** YES = เฉพาะคนที่ร่วมแคมเปญแล้ว · NO = ยังไม่มี hands / สิทธิ์ */
    @IsOptional()
    @IsIn(['YES', 'NO'])
    joined?: 'YES' | 'NO';

    /** YES = ยังมีสิทธิ์เหลือ (วงไหนก็ได้) · NO = ไม่เหลือสิทธิ์ */
    @IsOptional()
    @IsIn(['YES', 'NO'])
    hasSpins?: 'YES' | 'NO';
}

/** ผู้ได้รางวัลล่าสุด (โชว์บนหน้าเว็บ) */
export class WinnersQuery {
    @IsOptional()
    @IsString()
    @MaxLength(32)
    wheel?: string;

    /** เฉพาะรางวัลตั้งแต่ … กีบ ขึ้นไป (เช่น 1000000 = รางวัลใหญ่) */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    minValueLak?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limit = 20;
}

/** ประวัติรางวัลของผู้เล่นเอง */
export class MySpinsQuery extends PageQuery {
    @IsOptional()
    @IsString()
    @MaxLength(32)
    wheel?: string;
}

export class ListCampaignSpinsQuery extends PageQuery {
    @IsOptional()
    @IsString()
    @MaxLength(64)
    q?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    club?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    wheel?: string;

    @IsOptional()
    @IsIn(['PENDING', 'DELIVERED', 'CANCELLED'])
    fulfillment?: 'PENDING' | 'DELIVERED' | 'CANCELLED';
}

export class WheelWeightsDto {
    /**
     * { "BR_1": 0.5, "BR_2": 3, ... } เป็น % ทศนิยม 2 ตำแหน่ง ครบทุกรางวัลของวง รวม = 100
     * ส่งทุกตัวเป็น 0 = กลับไปสุ่มตามจำนวนรางวัลที่เหลือ
     */
    @IsObject()
    weights: Record<string, number>;
}