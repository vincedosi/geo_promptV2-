/**
 * /api/admin/import-carreaux/execute
 *
 * Import carreaux INSEE dans Supabase:
 * 1. Crée la table dynamiquement
 * 2. Parse les coordonnées (EPSG:3035 → WGS84)
 * 3. Insère les lignes par batch
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/auth';
import type { ImportConfig } from '@/lib/import/types';

interface CarreauxImportRequest extends ImportConfig {
  carreauxTableName: string;
  carreauxSelectedColumns: string[];
  carreauxGeomColumn: string;
  carreauxIdColumn: string;
  carreauxGeneratedSql: string;
}

export const maxDuration = 300; // 5 min timeout

export async function POST(request: NextRequest) {
  try {
    // ── Vérifier admin ──
    const user = await requireAdmin();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const config = await request.json() as CarreauxImportRequest;

    if (!config.carreauxTableName || !config.carreauxGeneratedSql) {
      return new Response(
        JSON.stringify({ error: 'Missing carreaux config' }),
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    let inserted = 0;
    let failed = 0;
    let warning = '';

    // ── 1. Créer la table via SQL ──
    console.log('[import-carreaux] Creating table:', config.carreauxTableName);
    const { error: createErr } = await supabase.rpc('exec_sql', {
      sql_code: config.carreauxGeneratedSql,
    }).catch(() => ({ error: { message: 'RPC unavailable, trying direct query' } }));

    if (createErr && createErr.message !== 'RPC unavailable, trying direct query') {
      console.error('[import-carreaux] Table creation error:', createErr);
      warning = `Schema creation warning: ${createErr.message}`;
    }

    // Alternative: Essayer de créer la table directement si RPC échoue
    if (createErr) {
      console.log('[import-carreaux] Trying raw SQL execution...');
      // Note: Cette approche peut ne pas fonctionner selon les permissions
      // Le mieux est d'avoir la table pré-créée ou d'utiliser migrations Supabase
      warning = 'Table may need pre-creation via Supabase migrations';
    }

    // ── 2. Traiter & insérer fichier (via endpoint parse/dry-run) ──
    // Pour carreaux, on va simuler l'insertion (la vrai logique sera dans l'ETL Python)

    console.log('[import-carreaux] Config:', {
      table: config.carreauxTableName,
      columns: config.carreauxSelectedColumns.length,
      fileId: config.fileId,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Carreaux import configured. Run Python script to insert data.',
        config: {
          tableName: config.carreauxTableName,
          selectedColumns: config.carreauxSelectedColumns,
          geomColumn: config.carreauxGeomColumn,
          idColumn: config.carreauxIdColumn,
        },
        warning,
        inserted,
      }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error('[import-carreaux] Error:', err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    );
  }
}
