import { Type } from 'class-transformer';
import {
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
} from 'class-validator';

export class CreatePlayerDto {
  /** X-Poker player ID — ใช้ต่อท้าย prefix ของ club เป็น username */
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-]{1,32}\s*$/, {
    message: 'xpokerPlayerId must be 1-32 letters, digits, _ or -',
  })
  xpokerPlayerId: string;

  /** ชื่อ club เต็ม ("ComBank CLUB"), ตัวย่อ ("CB") หรือ X-Poker club ID ("1216343") */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  clubName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName: string;

  /** ตรวจ >= 1666 ใน service เพื่อคืน HANDS_BELOW_REQUIREMENT */
  @IsInt()
  @Min(0)
  handsCount: number;
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