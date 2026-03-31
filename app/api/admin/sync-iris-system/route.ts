/**
 * POST /api/admin/sync-iris-system
 * Compare les colonnes IRIS en base avec IRIS_DB_COLUMNS (source de vérité code).
 * Retourne un rapport de synchronisation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { IRIS_DB_COLUMNS } from '@/lib/iris-crawler/db-columns';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();
  try {
    const supabase = createAdminClient();

    // 1. Colonnes numériques réelles en base (via RPC dynamique)
    const { data: rawCols, error: colsError } = await supabase.rpc('get_iris_metric_columns');
    if (colsError) throw colsError;

    const dbColumnNames: string[] = ((rawCols ?? []) as { key: string }[]).map(r => r.key);
    const codeColumnNames: string[] = IRIS_DB_COLUMNS.map(c => c.name);

    // 2. Diff
    const missingInCode = dbColumnNames.filter(c => !codeColumnNames.includes(c));
    const missingInDb   = codeColumnNames.filter(c => !dbColumnNames.includes(c));

    // 3. Fill status via RPC (compte les valeurs non-NULL > 0 par colonne)
    const { data: fillRaw, error: fillError } = await supabase.rpc('get_iris_fill_status');
    if (fillError) throw fillError;

    const fillStatus: Record<string, number> = {};
    for (const row of ((fillRaw ?? []) as { col: string; n: number }[])) {
      fillStatus[row.col] = Number(row.n);
    }

    // 4. Total IRIS (utilise la colonne population si disponible, sinon count)
    const totalIris = fillStatus['population'] ?? 0;

    // 5. Actions manuelles recommandées
    const manualActionsNeeded: string[] = [
      ...missingInCode.map(c => `Ajouter '${c}' dans IRIS_DB_COLUMNS (lib/iris-crawler/db-columns.ts)`),
      ...missingInDb.map(c => `Colonne '${c}' déclarée dans le code mais absente de la table iris`),
    ];

    return NextResponse.json({
      synced:              missingInCode.length === 0 && missingInDb.length === 0,
      total_iris:          totalIris,
      db_columns:          dbColumnNames,
      code_columns:        codeColumnNames,
      missing_in_code:     missingInCode,
      missing_in_db:       missingInDb,
      fill_status:         fillStatus,
      rpc_status: {
        correlation: 'dynamique — information_schema (zéro whitelist)',
        metrics:     'dynamique — information_schema (zéro whitelist)',
      },
      manual_actions_needed: manualActionsNeeded,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
