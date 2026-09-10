import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import type { UserRole } from '@/types/admin';

export const dynamic = 'force-dynamic';

// `satisfies` (et non `:`) : garde-fou de compilation — ajouter un role a
// `UserRole` sans le declarer ici casse le build, au lieu de le faire disparaitre
// silencieusement du selecteur de roles (c'est ce qui est arrive a `editor`).
const ROLE_LEVELS = { super_admin: 0, admin: 1, client: 2 } satisfies Record<UserRole, number>;
const ROLE_LABELS = { super_admin: 'Super admin', admin: 'Admin', client: 'Client' } satisfies Record<UserRole, string>;

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();
  // ⛔ DETTE : `get_check_constraint_values` N'EXISTE PAS en base (confirme
  // 2026-09-08, cf. docs/AUDIT_BASE.md). L'appel echoue donc a chaque fois et
  // c'est le fallback `Object.keys(ROLE_LEVELS)` plus bas qui sert TOUJOURS.
  // Le double cast rend l'appel compilable sans pretendre que la fonction
  // existe. A trancher : creer la fonction, ou supprimer l'appel et assumer
  // la constante (le comportement observable serait identique).
  const { data } = await (supabase.rpc as unknown as (
    fn: string, args: Record<string, string>,
  ) => Promise<{ data: unknown }>)('get_check_constraint_values', { p_table: 'profiles', p_constraint: 'profiles_role_check' });

  let roles: string[];
  if (data && typeof data === 'string') {
    const match = data.match(/\(([^)]+)\)/);
    roles = match ? match[1].split(',').map((s: string) => s.trim().replace(/'/g, '')) : Object.keys(ROLE_LEVELS);
  } else {
    roles = Object.keys(ROLE_LEVELS);
  }

  const userLevel = ROLE_LEVELS[profile.role] ?? 99;
  const result = roles
    .filter((r): r is UserRole => r in ROLE_LEVELS)
    .map(r => ({ value: r, label: ROLE_LABELS[r] ?? r, level: ROLE_LEVELS[r] }))
    .filter(r => profile.role === 'super_admin' || r.level >= userLevel)
    .sort((a, b) => a.level - b.level);

  return NextResponse.json(result);
}
