import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

class CampaignHandsEntry {
  @IsString()
  @MaxLength(16)
  stake: string;

  @IsInt()
  @Min(0)
  @Max(10_000_000)
  hands: number;
}

class CampaignSpinEntry {
  @IsString()
  @MaxLength(32)
  wheel: string;

  @IsInt()
  @NotEquals(0)
  @Min(1)
  @Max(1000)
  delta: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reason: string;
}

/** ใส่ hands / สิทธิ์ของแคมเปญตอนสร้างผู้เล่น (SUPER เท่านั้น) */
export class CreatePlayerCampaignDto {
  @IsString()
  @MaxLength(40)
  code: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CampaignHandsEntry)
  hands?: CampaignHandsEntry[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CampaignSpinEntry)
  spins?: CampaignSpinEntry[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class CreatePlayerDto {
  /** X-Poker player ID — ใช้เป็น username ด้วย (account ใหม่) */
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-]{1,32}\s*$/, {
    message: 'xpokerPlayerId must be 1-32 letters, digits, _ or -',
  })
  xpokerPlayerId: string;

  /** ไม่บังคับ: ชื่อ club เต็ม ("ComBank CLUB"), ตัวย่อ ("CB") หรือ X-Poker club ID — ไม่ส่ง = ยังไม่มี club */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clubName?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName: string;

  /** hands ของ Halloween — ≥ 1666 = ได้ 1 กล่อง · ไม่ส่ง / น้อยกว่า = มี account แต่ไม่มีสิทธิ์ Halloween */
  @IsOptional()
  @IsInt()
  @Min(0)
  handsCount?: number;

  /** SUPER: ใส่ hands / สิทธิ์แคมเปญพร้อมกันตอนสร้าง */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePlayerCampaignDto)
  campaign?: CreatePlayerCampaignDto;
}

export class UpdatePlayerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** SUPER / STAFF: ใส่ / เปลี่ยน club (รหัส "CB", ชื่อเต็ม หรือ X-Poker club ID) · "" = เอา club ออก */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clubName?: string;
}

/** ลูกค้าเปลี่ยนรหัสเอง */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}

export class ListPlayersQuery {
  @IsOptional()
  @IsIn(['NOT_SPUN', 'CASH_PENDING', 'DONE'])
  spinStatus?: 'NOT_SPUN' | 'CASH_PENDING' | 'DONE';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  prizeCode?: string;

  @IsOptional()
  @IsIn(['PENDING', 'DELIVERED', 'CANCELLED'])
  fulfillment?: 'PENDING' | 'DELIVERED' | 'CANCELLED';

  /** รหัส club เช่น CB · "none" = ยังไม่มี club */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  club?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  q?: string;

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

export class FulfillmentDto {
  @IsIn(['PENDING', 'DELIVERED', 'CANCELLED'])
  status: 'PENDING' | 'DELIVERED' | 'CANCELLED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** อัตราเป็น % (ทศนิยมได้ 2 ตำแหน่ง) ต้องครบทุกช่องของวงล้อนั้น และรวม = 100 */
export class UpdateWeightsDto {
  /** { "CASH": 4, "BONUS_1": 7.37, ... } — 9 ช่อง */
  @IsOptional()
  @IsObject()
  mainWheel?: Record<string, number>;

  /** { "CASH_1": 4, ..., "CASH_7": 64 } — 7 ช่อง */
  @IsOptional()
  @IsObject()
  cashWheel?: Record<string, number>;
}