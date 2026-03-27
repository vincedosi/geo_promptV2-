/**
 * GET /api/correlation/metrics
 * Retourne les métriques IRIS disponibles, enrichies depuis IRIS_DB_COLUMNS.
 * Source de vérité : lib/iris-crawler/db-columns.ts
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data: raw, error } = await supabase.rpc('get_iris_metric_columns');

    if (error) throw error;

    // Enrichir les noms de colonnes bruts avec labels depuis la source de vérité
    const enriched = ((raw ?? []) as { key: string }[]).map(row => {
      const meta = IRIS_DB_COLUMNS.find(c => c.name === row.key);
      return {
        key:    row.key,
        label:  meta?.label ?? row.key.replace(/_/g, ' '),
        source: 'iris',
      };
    });

    return NextResponse.json(enriched);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
