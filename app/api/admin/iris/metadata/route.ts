import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';

/**
 * Table clef/valeur libre : les clefs ne sont pas connues d'avance, mais les
 * DEUX colonnes sont `text`. Sans ce schema, `Object.entries` d'une chaine
 * rendait ses caracteres indexes et ecrivait « 0 → 'a' » en base.
 */
const MetadataSchema = z.record(z.string());

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { data, error } = await sb.from('iris_metadata').select('key, value');
  if (error) return NextResponse.json({}, { status: 500 });
  const result: Record<string, string> = {};
  for (const row of data ?? []) result[row.key] = row.value;
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const corps = await lireCorps(req, MetadataSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const updates = Object.entries(corps.valeur);
  for (const [key, value] of updates) {
    await sb.from('iris_metadata').upsert({ key, value });
  }
  return NextResponse.json({ success: true });
}
