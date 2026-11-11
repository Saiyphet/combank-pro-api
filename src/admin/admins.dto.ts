import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const ADMIN_ROLES = ['SUPER', 'STAFF', 'ADMIN'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * club ของ admin ประจำ club ส่งได้หลายชื่อ field (ใช้ตัวแรกที่มีค่า):
 * club / clubCode / clubName — ค่าเป็นชื่อเต็ม ("ComBank CLUB"), ตัวย่อ ("CB") หรือ X-Poker club ID
 */
class ClubFields {
    @IsOptional()
    @IsString()
    @MaxLength(64)
    club?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    clubCode?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    clubName?: string;
}

export class CreateAdminDto extends ClubFields {
    /** a-z 0-9 . _ - ยาว 3-32 (เก็บเป็นตัวพิมพ์เล็ก) */
    @IsString()
    @Matches(/^\s*[A-Za-z0-9._-]{3,32}\s*$/, { message: 'username must be 3-32 letters, digits, . _ or -' })
    username: string;

    /** SUPER = ทุกอย่าง · STAFF = ทุก club ยกเว้นงาน SUPER · ADMIN = admin ประจำ club (ต้องมี club) */
    @IsIn(ADMIN_ROLES)
    role: AdminRole;

    /** ไม่ส่ง = ระบบสุ่มให้ (คืนใน initialPassword) */
    @IsOptional()
    @IsString()
    @MinLength(8)
    @MaxLength(72)
    password?: string;
}

export class UpdateAdminDto extends ClubFields {
    @IsOptional()
    @IsIn(ADMIN_ROLES)
    role?: AdminRole;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export function clubOf(dto: ClubFields) {
    return (dto.club ?? dto.clubCode ?? dto.clubName)?.trim() || undefined;
}