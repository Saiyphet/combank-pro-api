import { Injectable } from '@nestjs/common';
import { AppError, must } from '../common/app-error';
import { SupabaseService } from '../supabase/supabase.service';

export interface AdminScope {
  isSuper: boolean;
  /** Set for an Admin (role STAFF), the only club they may see. Null for a Super Admin. */
  clubId: string | null;
  clubCode: string | null;
}

/** What one admin may see. Read from the database on every request, so a change or a switched-off account applies at once. */
@Injectable()
export class AdminScopeService {
  constructor(private readonly sb: SupabaseService) {}

  async of(adminId: string): Promise<AdminScope> {
    const row = must(
      await this.sb.db
        .from('ld_admins')
        .select('role, is_active, club_id, club:ld_clubs(code)')
        .eq('id', adminId)
        .maybeSingle(),
    ) as unknown as { role: string; is_active: boolean; club_id: string | null; club: { code: string } | null } | null;

    if (!row || !row.is_active) throw new AppError(401, 'UNAUTHORIZED');
    if (row.role === 'SUPER') return { isSuper: true, clubId: null, clubCode: null };
    // No club set: nothing to show. Never fall back to every club.
    if (!row.club_id || !row.club) throw new AppError(403, 'ADMIN_NO_CLUB');
    return { isSuper: false, clubId: row.club_id, clubCode: row.club.code };
  }

  async requireSuper(adminId: string) {
    const scope = await this.of(adminId);
    if (!scope.isSuper) throw new AppError(403, 'SUPER_ADMIN_ONLY');
    return scope;
  }
}
