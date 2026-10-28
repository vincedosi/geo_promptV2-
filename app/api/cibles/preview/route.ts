/**
 * GET /api/cibles/preview?indicator=&operator=&threshold=
 * Aperçu count/population d'un seuil — COUNT indexé, jamais de géométrie.
 * Un indicateur invisible de l'espace actif (sql/288) répond comme un inconnu : 400 `preview_failed`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { indicateursVisibles } from '@/lib/auth/perimetre-donnees';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  indicator: z.string().min(1).max(100),
  operator: z.enum(['>=', '<=']),
  threshold: z.string().min(1).transform(Number).pipe(z.number().finite()),
});

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const sp = new URL(request.url).searchParams;
  const parsed = QuerySchema.safeParse({
    indicator: sp.get('indicator'), operator: sp.get('operator'), threshold: sp.get('threshold'),
  });
  if (!parsed.success) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  // Même réponse que la RPC sur un code inconnu (elle lève → `preview_failed`).
  if (!(await indicateursVisibles(request)).visibles.has(parsed.data.indicator)) {
    return NextResponse.json({ error: 'preview_failed' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_indicator_threshold_selection', {
    p_indicator_code: parsed.data.indicator,
    p_operator: parsed.data.operator,
    p_threshold: parsed.data.threshold,
    p_preview: true,
  });
  if (error) {
    console.error('[cibles/preview]', error.message);
    return NextResponse.json({ error: 'preview_failed' }, { status: 400 });
  }
  const result = typeof data === 'string' ? JSON.parse(data) : data;
  return NextResponse.json(result);
}
