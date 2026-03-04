/**
 * GENESIS — API Route — GET /api/admin/health
 * Diagnostic endpoint: vérifie toutes les clés et la connectivité Supabase
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import type { Check, TableStats, DatabaseOverview } from '@/types/admin';

export async function GET() {
  const checks: Check[] = [];

  // ============================================================
  // 1. Variables d'environnement
  // ============================================================

  // NEXT_PUBLIC_SUPABASE_URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  checks.push({
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    status: supabaseUrl && supabaseUrl.startsWith('https://') ? 'OK' : 'ERROR',
    value: supabaseUrl ? `${supabaseUrl.slice(0, 30)}...` : '(vide)',
    message: supabaseUrl ? 'URL Supabase configuree' : 'MANQUANT — requis pour toute connexion Supabase',
  });

  // SUPABASE_ANON_KEY
  const anonKey = process.env.SUPABASE_ANON_KEY;
  checks.push({
    name: 'SUPABASE_ANON_KEY',
    status: anonKey && anonKey.startsWith('eyJ') ? 'OK' : 'ERROR',
    value: anonKey ? `eyJ...${anonKey.slice(-8)}` : '(vide)',
    message: anonKey ? 'Cle anon presente' : 'MANQUANT — requis pour les requetes Supabase',
  });

  // NEXT_PUBLIC_SUPABASE_ANON_KEY (client-side)
  const publicAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  checks.push({
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    status: publicAnonKey && publicAnonKey.startsWith('eyJ') ? 'OK' : 'WARN',
    value: publicAnonKey ? `eyJ...${publicAnonKey.slice(-8)}` : '(vide)',
    message: publicAnonKey ? 'Cle publique presente (login page)' : 'MANQUANT — la page /login ne fonctionnera pas',
  });

  // SUPABASE_SERVICE_ROLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isPlaceholder = serviceKey === 'A_REMPLACER';
  checks.push({
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    status: serviceKey && !isPlaceholder && serviceKey.startsWith('eyJ') ? 'OK' : 'ERROR',
    value: serviceKey && !isPlaceholder ? `eyJ...${serviceKey.slice(-8)}` : isPlaceholder ? 'A_REMPLACER (placeholder!)' : '(vide)',
    message: isPlaceholder
      ? 'PLACEHOLDER — remplace par la vraie cle dans Settings > API > service_role'
      : serviceKey
        ? 'Service role key presente (bypass RLS)'
        : 'MANQUANT — les operations admin (import, sources, orgs) ne fonctionneront pas correctement',
  });

  // SUPABASE_DB_URL
  const dbUrl = process.env.SUPABASE_DB_URL;
  checks.push({
    name: 'SUPABASE_DB_URL',
    status: dbUrl && dbUrl.startsWith('postgresql://') ? 'OK' : 'WARN',
    value: dbUrl ? `postgresql://...${dbUrl.slice(-30)}` : '(vide)',
    message: dbUrl ? 'URL base de donnees presente' : 'MANQUANT — le delete de sources ne fonctionnera pas',
  });

  // MISTRAL_API_KEY
  const mistralKey = process.env.MISTRAL_API_KEY;
  checks.push({
    name: 'MISTRAL_API_KEY',
    status: mistralKey && mistralKey.length > 10 ? 'OK' : 'WARN',
    value: mistralKey ? `${mistralKey.slice(0, 6)}...` : '(vide)',
    message: mistralKey ? 'Cle Mistral presente (resumes IA)' : 'MANQUANT — les resumes IA ne fonctionneront pas',
  });

  // ============================================================
  // 2. Test connectivité Supabase
  // ============================================================

  let dbConnected = false;
  let orgCount = 0;
  let tablesOk = { organizations: false, profiles: false, data_sources: false };
  let databaseOverview: DatabaseOverview | undefined;

  try {
    const supabase = createAdminClient();

    // Test organizations table
    const { data: orgs, error: orgErr } = await supabase
      .from('organizations')
      .select('id', { count: 'exact', head: false })
      .limit(1);

    if (!orgErr) {
      tablesOk.organizations = true;
      // Get real count
      const { count } = await supabase.from('organizations').select('id', { count: 'exact', head: true });
      orgCount = count || 0;
    }

    // Test profiles table
    const { error: profErr } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
    if (!profErr) tablesOk.profiles = true;

    // Test data_sources table
    const { error: dsErr } = await supabase.from('data_sources').select('id', { count: 'exact', head: true });
    if (!dsErr) tablesOk.data_sources = true;

    dbConnected = true;

    // ============================================================
    // 2.5 Récupération des statistiques détaillées des tables
    // ============================================================

    try {
      // Liste des tables à analyser
      const tablesToCheck = [
        'organizations',
        'profiles', 
        'data_sources',
        'panneaux',
        'poi',
        'carreaux_insee',
        'carreaux_filosofi',
        'isochrones_cache',
        'saved_maps',
        'org_memberships',
        'poi_sources',
        'voronoi_cells'
      ];

      const tables: TableStats[] = [];

      // Pour chaque table, récupérer le nombre de lignes
      for (const tableName of tablesToCheck) {
        try {
          const { count, error } = await supabase
            .from(tableName)
            .select('*', { count: 'exact', head: true });

          if (!error && count !== null) {
            tables.push({
              table_name: tableName,
              row_count: count,
              total_size: 'N/A', 
              total_size_bytes: 0,
              table_size: 'N/A',
              indexes_size: 'N/A',
            });
          }
        } catch (tableErr) {
          // Table n'existe pas ou pas accessible - ignorer
          continue;
        }
      }

      // Essayer d'obtenir les tailles via une fonction SQL si elle existe
      try {
        const { data: sizeData } = await supabase.rpc('get_table_sizes');
        if (sizeData && Array.isArray(sizeData)) {
          sizeData.forEach((sizeRow: any) => {
            const table = tables.find(t => t.table_name === sizeRow.table_name);
            if (table) {
              table.total_size = sizeRow.total_size || 'N/A';
              table.total_size_bytes = parseInt(sizeRow.total_size_bytes) || 0;
              table.table_size = sizeRow.table_size || 'N/A';
              table.indexes_size = sizeRow.indexes_size || 'N/A';
            }
          });
        }
      } catch (sizeErr) {
        // Fonction n'existe pas - continuer sans les tailles
      }

      const totalRows = tables.reduce((sum, t) => sum + t.row_count, 0);
      const totalSizeBytes = tables.reduce((sum, t) => sum + t.total_size_bytes, 0);
      const totalSizeMB = totalSizeBytes > 0 
        ? (totalSizeBytes / (1024 * 1024)).toFixed(2) 
        : 'N/A';

      databaseOverview = {
        total_tables: tables.length,
        total_rows: totalRows,
        total_size: totalSizeBytes > 0 ? `${totalSizeMB} MB` : 'N/A',
        total_size_bytes: totalSizeBytes,
        tables: tables.sort((a, b) => b.row_count - a.row_count),
      };
    } catch (statsErr) {
      console.error('Failed to fetch table stats:', statsErr);
    }

    checks.push({
      name: 'SUPABASE_CONNEXION',
      status: 'OK',
      message: `Connecte a Supabase — ${orgCount} organisation(s) trouvee(s)`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      name: 'SUPABASE_CONNEXION',
      status: 'ERROR',
      message: `Echec connexion Supabase: ${msg}`,
    });
  }

  // Table checks
  for (const [table, ok] of Object.entries(tablesOk)) {
    checks.push({
      name: `TABLE_${table.toUpperCase()}`,
      status: ok ? 'OK' : 'ERROR',
      message: ok ? `Table "${table}" accessible` : `Table "${table}" INTROUVABLE — execute le SQL de migration dans Supabase`,
    });
  }

  // ============================================================
  // 3. Résumé global
  // ============================================================

  const errors = checks.filter((c) => c.status === 'ERROR').length;
  const warns = checks.filter((c) => c.status === 'WARN').length;
  const globalStatus = errors > 0 ? 'ERROR' : warns > 0 ? 'WARN' : 'OK';

  return NextResponse.json({
    success: true,
    status: globalStatus,
    summary: errors > 0
      ? `${errors} erreur(s) critique(s) — corrige les problemes ci-dessous`
      : warns > 0
        ? `${warns} avertissement(s) — fonctionnel mais incomplet`
        : 'Tout est OK — toutes les cles sont configurees et Supabase est connecte',
    checks,
    database: databaseOverview,
    timestamp: new Date().toISOString(),
  });
}
