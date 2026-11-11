import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

// ส่งเป็น multipart/form-data → ทุกค่าเป็นข้อความ แปลงก่อนตรวจ
const toBool = ({ value }: { value: unknown }) =>
    value === undefined || value === '' ? undefined : value === true || value === 'true' || value === '1';
const emptyToNull = ({ value }: { value: unknown }) => (value === '' ? null : value);
const URL_RE = /^(https:\/\/|\/)\S+$/;

export class BannerFieldsDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    title?: string;

    /** ใช้รูปจากลิงก์แทนการอัปโหลด (https://… หรือ /assets/…) */
    @IsOptional()
    @Transform(emptyToNull)
    @IsString()
    @MaxLength(500)
    @Matches(URL_RE, { message: 'imageUrl must start with https:// or /' })
    imageUrl?: string | null;

    @IsOptional()
    @Transform(emptyToNull)
    @IsString()
    @MaxLength(500)
    @Matches(URL_RE, { message: 'mobileImageUrl must start with https:// or /' })
    mobileImageUrl?: string | null;

    /** กดแล้วไปไหน: NONE · CAMPAIGN (campaignCode) · URL (linkUrl) */
    @IsOptional()
    @IsIn(['NONE', 'CAMPAIGN', 'URL'])
    linkType?: 'NONE' | 'CAMPAIGN' | 'URL';

    @IsOptional()
    @Transform(emptyToNull)
    @IsString()
    @MaxLength(40)
    campaignCode?: string | null;

    @IsOptional()
    @Transform(emptyToNull)
    @IsString()
    @MaxLength(500)
    @Matches(URL_RE, { message: 'linkUrl must start with https:// or /' })
    linkUrl?: string | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(1000)
    sortOrder?: number;

    @IsOptional()
    @Transform(toBool)
    @IsBoolean()
    isActive?: boolean;
}