/**
 * DELETE /api/radio/data
 * Suppression des données radio. Super-admin uniquement.
 * Body: { target: 'emetteurs' | 'radios' | 'all', confirm: boolean }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const deleteSchema = z.object({
  target: z.enum(['emetteurs', 'radios', 'all']),
  confirm: z.boolean(),
});

export async function DELETE(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const body = await req.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'target (emetteurs|radios|all) et confirm (boolean) requis' }, { status: 400 });
  }

  const { target, confirm } = parsed.data;
  const supabase = createAdminClient();

  // Dry run — return counts without deleting
  if (!confirm) {
    const counts: Record<string, number> = {};
    if (target === 'emetteurs' || target === 'all') {
      const { count } = await supabase.from('emetteurs_radio').select('*', { count: 'exact', head: true });
      counts.emetteurs = count ?? 0;
    }
    if (target === 'radios' || target === 'all') {
      const { count } = await supabase.from('radios').select('*', { count: 'exact', head: true });
      counts.radios = count ?? 0;
    }
    if (target === 'all') {
      const { count: archCount } = await supabase.from('emetteurs_radio_archive').select('*', { count: 'exact', head: true });
      counts.archive = archCount ?? 0;
    }
    return NextResponse.json({ dry_run: true, would_delete: counts });
  }

  // Real deletion
  const deleted: Record<string, number> = {};

  if (target === 'emetteurs' || target === 'all') {
    const { count } = await supabase.from('emetteurs_radio').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    deleted.emetteurs = count ?? 0;
  }

  if (target === 'radios' || target === 'all') {
    // First nullify FK references
    await supabase.from('emetteurs_radio').update({ radio_id: null }).not('radio_id', 'is', null);
    const { count } = await supabase.from('radios').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    deleted.radios = count ?? 0;
  }

  if (target === 'all') {
    const { count: archCount } = await supabase.from('emetteurs_radio_archive').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    deleted.archive = archCount ?? 0;
    await supabase.from('radio_imports_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    deleted.logs = 0;
  }

  return NextResponse.json({ success: true, deleted });
}
