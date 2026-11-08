import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SupabaseModule } from './supabase/supabase.module';
import { PlayerModule } from './player/player.module';
import { AdminModule } from './admin/admin.module';
import { HealthController } from './health.controller';
import { CampaignModule } from './campaign/campaign.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // ค่า default: 60 request/นาที/IP — login ตั้งเข้มกว่านี้ที่ controller
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: strongSecret(config.getOrThrow<string>('JWT_SECRET')),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '12h') as any },
      }),
    }),
    SupabaseModule,
    PlayerModule,
    AdminModule,
    CampaignModule
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule { }

/** JWT_SECRET สั้น = เดาได้ = ปลอม token admin ได้ */
function strongSecret(secret: string) {
  if (secret.length < 32 || /change-me/i.test(secret)) {
    throw new Error('JWT_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษรและเป็นค่าสุ่ม');
  }
  return secret;
}