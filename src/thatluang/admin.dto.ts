import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
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
  @IsIn(['NOT_SPUN', 'DONE'])
  spinStatus?: 'NOT_SPUN' | 'DONE';

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

export class TierPrizeDto {
  /** Leave out for a new prize */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @IsIn(['CASH', 'BONUS'])
  group: 'CASH' | 'BONUS';

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  valueLak?: number | null;

  @IsInt()
  @Min(0)
  qtyTotal: number;

  /** % with at most 2 decimals; a wheel's prizes must add up to 100 */
  @IsNumber()
  @Min(0)
  @Max(100)
  weightPct: number;
}

export class SaveTierDto {
  /** null = not confirmed, so the wheel stays locked */
  @IsOptional()
  @IsInt()
  @Min(1)
  handsTarget?: number | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TierPrizeDto)
  prizes: TierPrizeDto[];
}

export class ImportHandsDto {
  @IsString()
  @MinLength(1)
  csv: string;
}
