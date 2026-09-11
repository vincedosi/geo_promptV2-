/**
 * GENESIS — API Route — GET /api/admin/health
 * Diagnostic endpoint: vérifie toutes les clés et la connectivité Supabase
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import postgres from 'postgres';
import type { Check, TableStats, DatabaseOverview } from '@/types/admin';
import type { TableName } from '@/lib/supabase/tables';
import { comparerEmpreinte, RPC_RELEVE_EMPREINTE, EMPREINTE_MESURE } from '@/lib/carreaux/empreinte-source';

export const dynamic = 'force-dynamic';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(2) : val < 100 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

export async function GET(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

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

  // SUPABASE_DB_URL (optionnel — utilisé uniquement pour les tailles exactes dans health)
  const dbUrlEnv = process.env.SUPABASE_DB_URL;
  checks.push({
    name: 'SUPABASE_DB_URL',
    status: dbUrlEnv && dbUrlEnv.startsWith('postgresql://') ? 'OK' : 'OK',
    value: dbUrlEnv ? `postgresql://...${dbUrlEnv.slice(-30)}` : '(optionnel)',
    message: dbUrlEnv
      ? 'URL base de donnees — tailles exactes dans Database Overview'
      : 'Optionnel — les tailles exactes seront obtenues via get_table_sizes() RPC si installé',
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
      // Typee `TableName[]` : un nom absent du schema ne compile plus.
      // C'est ce qui a revele, au branchement des types (2026-09-08), que 6 des
      // 12 tables surveillees ici n'existaient pas — `carreaux_insee`,
      // `org_memberships`, `panneaux`, `poi`, `poi_sources`, `voronoi_cells`.
      // Le `if (!error && count !== null)` plus bas les ignorait en silence :
      // le health check affichait donc un etat partiel sans le dire.
      const tablesToCheck: TableName[] = [
        'organizations', 'profiles', 'data_sources', 'panneaux_affichage',
        'carreaux_filosofi', 'isochrones_cache', 'saved_maps', 'iris',
        'dsp_campaigns', 'dsp_campaign_data',
      ];

      const tables: TableStats[] = [];

      // Get row counts via Supabase client (always works)
      for (const tableName of tablesToCheck) {
        try {
          // `.from()` sur une UNION de noms fait exploser l'inference
          // (TS2589 : instantiation excessivement profonde) — limite connue de
          // supabase-js. Ce bloc ne lit AUCUNE colonne, il ne fait qu'un count
          // en `head: true` : on fige donc le parametre de type sur un nom
          // valide quelconque. `tableName` reste la valeur reellement envoyee,
          // et il est deja garanti `TableName` par la declaration ci-dessus.
          const { count, error } = await supabase
            .from(tableName as 'profiles')
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
        } catch {
          continue;
        }
      }

      // Get actual sizes — try multiple strategies
      let dbSizeBytes = 0;
      let dbSizeLabel = 'N/A';

      // Strategy 1: Direct Postgres connection if SUPABASE_DB_URL is set
      const dbUrl = process.env.SUPABASE_DB_URL || '';
      if (dbUrl) {
        let sql: ReturnType<typeof postgres> | null = null;
        try {
          sql = postgres(dbUrl, { connect_timeout: 5, idle_timeout: 5 });

          const dbSizeResult = await sql`SELECT pg_database_size(current_database()) AS size_bytes`;
          if (dbSizeResult[0]?.size_bytes) {
            dbSizeBytes = Number(dbSizeResult[0].size_bytes);
            dbSizeLabel = formatBytes(dbSizeBytes);
          }

          const sizeRows = await sql`
            SELECT
              t.tablename::text AS table_name,
              pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)) AS total_bytes,
              pg_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)) AS table_bytes
            FROM pg_tables t
            WHERE t.schemaname = 'public'
          `;

          for (const row of sizeRows) {
            const totalBytes = Number(row.total_bytes);
            const tableBytes = Number(row.table_bytes);
            const indexBytes = totalBytes - tableBytes;
            const existing = tables.find(t => t.table_name === row.table_name);
            if (existing) {
              existing.total_size = formatBytes(totalBytes);
              existing.total_size_bytes = totalBytes;
              existing.table_size = formatBytes(tableBytes);
              existing.indexes_size = formatBytes(indexBytes);
            } else {
              tables.push({
                table_name: row.table_name as string, row_count: 0,
                total_size: formatBytes(totalBytes), total_size_bytes: totalBytes,
                table_size: formatBytes(tableBytes), indexes_size: formatBytes(indexBytes),
              });
            }
          }
        } catch (pgErr) {
          console.error('Direct PG size query failed:', pgErr);
        } finally {
          if (sql) await sql.end().catch(() => {});
        }
      }

      // Strategy 2: RPC get_table_sizes (if function exists in DB)
      if (tables.every(t => t.total_size === 'N/A')) {
        try {
          const { data: sizeData } = await supabase.rpc('get_table_sizes');
          if (sizeData && Array.isArray(sizeData)) {
            interface TableSizeRow {
              table_name: string;
              total_size?: string;
              total_size_bytes?: string | number;
              table_size?: string;
              indexes_size?: string;
            }
            for (const sizeRow of sizeData as TableSizeRow[]) {
              const table = tables.find(t => t.table_name === sizeRow.table_name);
              if (table) {
                table.total_size = sizeRow.total_size || 'N/A';
                table.total_size_bytes = parseInt(String(sizeRow.total_size_bytes ?? '0')) || 0;
                table.table_size = sizeRow.table_size || 'N/A';
                table.indexes_size = sizeRow.indexes_size || 'N/A';
              }
            }
          }
        } catch { /* function not installed */ }
      }

      // Strategy 3: Estimate sizes from row counts if nothing else worked
      if (tables.every(t => t.total_size === 'N/A')) {
        // Rough estimate: ~200 bytes/row for metadata tables, ~500 bytes/row for geo/data tables
        const heavyTables = new Set(['poi', 'carreaux_insee', 'carreaux_filosofi', 'panneaux', 'isochrones_cache', 'voronoi_cells']);
        for (const t of tables) {
          if (t.row_count > 0) {
            const bytesPerRow = heavyTables.has(t.table_name) ? 500 : 200;
            const est = t.row_count * bytesPerRow;
            t.total_size = `~${formatBytes(est)}`;
            t.total_size_bytes = est;
            t.table_size = `~${formatBytes(Math.round(est * 0.7))}`;
            t.indexes_size = `~${formatBytes(Math.round(est * 0.3))}`;
          }
        }
      }

      const totalRows = tables.reduce((sum, t) => sum + t.row_count, 0);
      const totalSizeBytes = tables.reduce((sum, t) => sum + t.total_size_bytes, 0);
      const isEstimated = tables.some(t => t.total_size.startsWith('~'));

      databaseOverview = {
        total_tables: tables.length,
        total_rows: totalRows,
        total_size: totalSizeBytes > 0 ? `${isEstimated ? '~' : ''}${formatBytes(totalSizeBytes)}` : 'N/A',
        total_size_bytes: totalSizeBytes,
        db_size: dbSizeBytes > 0 ? dbSizeLabel : (totalSizeBytes > 0 ? `${isEstimated ? '~' : ''}${formatBytes(totalSizeBytes)}` : 'N/A'),
        db_size_bytes: dbSizeBytes > 0 ? dbSizeBytes : totalSizeBytes,
        tables: tables.sort((a, b) => b.total_size_bytes - a.total_size_bytes || b.row_count - a.row_count),
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
  // 2 bis. Fraîcheur des bornes nationales des carreaux
  // ============================================================
  // Les 28 bornes de lib/carreaux/bornes.ts sont un instantané des données
  // Filosofi. Un ré-import les périme SANS AUCUN SIGNAL : la carte reste
  // plausible et devient fausse. Cette vérification est le signal manquant.
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc(RPC_RELEVE_EMPREINTE);
    if (error || !data) {
      checks.push({
        name: 'BORNES_CARREAUX',
        status: 'WARN',
        value: `mesurées le ${EMPREINTE_MESURE.mesureLe}`,
        message: `Fraîcheur des bornes non vérifiable : ${error?.message ?? 'relevé vide'}`,
      });
    } else {
      const r = data as Record<string, number>;
      const d = comparerEmpreinte({
        carreaux5kmLignes:      Number(r.carreaux_5km_lignes),
        carreaux5kmPopulation:  Number(r.carreaux_5km_population),
        carreaux5kmMenages:     Number(r.carreaux_5km_menages),
        carreauxFilosofiEstime: Number(r.carreaux_filosofi_estime),
      });
      checks.push({
        name: 'BORNES_CARREAUX',
        status: d.perimees ? 'ERROR' : 'OK',
        value: `mesurées le ${d.mesureLe}`,
        message: d.perimees
          ? `PÉRIMÉES — la source a changé depuis la mesure : ${d.ecarts.join(' ; ')}. `
            + `L'échelle de couleurs des carreaux décrit une distribution qui n'existe plus : `
            + `re-mesurer via sql/123 et mettre à jour lib/carreaux/bornes.ts ET l'empreinte.`
          : `Les bornes décrivent bien la source actuelle (${EMPREINTE_MESURE.carreaux5km.lignes.toLocaleString('fr-FR')} carreaux 5 km, `
            + `${EMPREINTE_MESURE.carreaux5km.population.toLocaleString('fr-FR')} habitants)`,
      });
    }
  } catch (e) {
    checks.push({
      name: 'BORNES_CARREAUX',
      status: 'WARN',
      value: `mesurées le ${EMPREINTE_MESURE.mesureLe}`,
      message: `Fraîcheur des bornes non vérifiable : ${e instanceof Error ? e.message : String(e)}`,
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
