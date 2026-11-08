import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;

  /**
   * โปรที่ login เข้า (เช่น "that-luang-2026") — token ใช้ได้เฉพาะโปรนั้น
   * ไม่ส่ง = Halloween (หน้า Halloween เดิมทำงานต่อได้โดยไม่ต้องแก้)
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{1,40}$/i)
  campaign?: string;
}