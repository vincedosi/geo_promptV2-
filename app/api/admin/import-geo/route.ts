import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Une maille a inserer. Les quatre premiers champs sont des chaines cote client
 * (`app/admin/carreaux-import/page.tsx` : `resolution` et `millesime` sont des
 * `useState('200m')` / `useState('2021')`, et `idcar` passe par `String()`).
 *
 * Les deux bornes du lot portent les messages d'origine : ce sont eux que le
 * journal d'import affiche ligne par ligne.
 */
const LigneCarreauSchema = z.object({
  idcar: z.string(),
  resolution: z.string(),
  millesime: z.string(),
  geom_wkt: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

const ImporterCarreauxSchema = z.object({
  rows: z.array(LigneCarreauSchema)
    .min(1, 'rows vide')
    .max(2000, 'batch trop gros (max 2000)'),
});

type ImportRow = z.infer<typeof LigneCarreauSchema>;

/**
 * POST /api/admin/import-geo
 * Insère un batch de features dans carreaux_filosofi via RPC Supabase (HTTPS).
 * Body: { rows: Array<{ idcar, resolution, millesime, geom_wkt, metadata }> }
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return adminUnauthorized();

  try {
    const corps = await lireCorps(request, ImporterCarreauxSchema);
    if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
    const { rows } = corps.valeur;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const typedRows: ImportRow[] = rows;
    const { error } = await supabase.rpc('import_carreaux_batch', {
      p_idcars:      typedRows.map(r => r.idcar),
      p_resolutions: typedRows.map(r => r.resolution),
      p_millesimes:  typedRows.map(r => r.millesime),
      p_geom_wkts:   typedRows.map(r => r.geom_wkt),
      p_metadatas:   typedRows.map(r => r.metadata ?? {}),
    });

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, inserted: rows.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur inconnue';
    console.error('[import-geo] Error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
