/**
 * GENESIS — POST /api/admin/campaigns/populate-postal
 * Populate postal_code_commune table from La Poste open data (data.gouv.fr).
 * Downloads CSV, parses, and upserts into postal_code_commune.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

// La Poste open data — base officielle des codes postaux
const LAPOSTE_CSV_URL =
  'https://datanova.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/lines?size=10000&format=csv';

const BATCH_SIZE = 50;

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();

  try {
    // Fetch all pages from La Poste API (paginated, ~40k rows)
    const allRows: { code_postal: string; code_commune: string; nom_commune: string }[] = [];
    let page = 1;
    const pageSize = 10000;

    while (true) {
      const url = `https://datanova.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/lines?size=${pageSize}&page=${page}&format=json`;
      const res = await fetch(url);
      if (!res.ok) break;

      const data = await res.json();
      const results = data.results ?? data;

      if (!Array.isArray(results) || results.length === 0) break;

      for (const row of results) {
        const cp = (row.code_postal ?? row.codePostal ?? '').toString().trim().padStart(5, '0');
        const cc = (row.code_commune_insee ?? row.codeCommune ?? row.code_commune ?? '').toString().trim();
        const nom = (row.nom_de_la_commune ?? row.nomCommune ?? row.nom_commune ?? '').toString().trim();

        if (cp && cc) {
          allRows.push({ code_postal: cp, code_commune: cc, nom_commune: nom });
        }
      }

      if (results.length < pageSize) break;
      page++;
    }

    if (allRows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Aucune donnée récupérée depuis La Poste',
      }, { status: 500 });
    }

    // Deduplicate by (code_postal, code_commune)
    const deduped = new Map<string, typeof allRows[0]>();
    for (const row of allRows) {
      deduped.set(`${row.code_postal}|${row.code_commune}`, row);
    }
    const uniqueRows = Array.from(deduped.values());

    // Batch upsert
    let inserted = 0;
    for (let i = 0; i < uniqueRows.length; i += BATCH_SIZE) {
      const batch = uniqueRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('postal_code_commune')
        .upsert(batch, { onConflict: 'code_postal,code_commune' });

      if (error) {
        return NextResponse.json({
          success: false,
          error: `Erreur batch ${i}: ${error.message}`,
          inserted,
        }, { status: 500 });
      }
      inserted += batch.length;
    }

    return NextResponse.json({
      success: true,
      total_fetched: allRows.length,
      unique_rows: uniqueRows.length,
      inserted,
    });
  } catch (err: unknown) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
