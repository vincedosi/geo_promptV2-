import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const ROLE_LEVELS: Record<string, number> = { super_admin: 0, admin: 1, editor: 2, client: 3 };
const ROLE_LABELS: Record<string, string> = { super_admin: 'Super admin', admin: 'Admin', editor: 'Editor', client: 'Client' };

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();
  const { data } = await supabase.rpc('get_check_constraint_values' as never, { p_table: 'profiles', p_constraint: 'profiles_role_check' });

  let roles: string[];
  if (data && typeof data === 'string') {
    const match = data.match(/\(([^)]+)\)/);
    roles = match ? match[1].split(',').map((s: string) => s.trim().replace(/'/g, '')) : Object.keys(ROLE_LEVELS);
  } else {
    roles = Object.keys(ROLE_LEVELS);
  }

  const userLevel = ROLE_LEVELS[profile.role] ?? 99;
  const result = roles
    .filter(r => ROLE_LEVELS[r] !== undefined)
    .map(r => ({ value: r, label: ROLE_LABELS[r] ?? r, level: ROLE_LEVELS[r] }))
    .filter(r => profile.role === 'super_admin' || r.level >= userLevel)
    .sort((a, b) => a.level - b.level);

  return NextResponse.json(result);
}
