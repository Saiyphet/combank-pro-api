import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  /** client ด้วย service_role (bypass RLS) — ใช้ใน backend เท่านั้น */
  readonly db: SupabaseClient;

  constructor(config: ConfigService) {
    this.db = createClient(
      normalizeSupabaseUrl(config.getOrThrow<string>('SUPABASE_URL')),
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY').trim(),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
}

/** รับได้ทั้ง https://xxx.supabase.co และ https://xxx.supabase.co/rest/v1/ */
export function normalizeSupabaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
}