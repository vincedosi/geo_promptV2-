import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import postgres from 'postgres';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/import-geo/rename-columns
 * Renomme des clés JSONB dans metadata de carreaux_filosofi.
 * Body: { renames: Array<{ from: string, to: string }>, resolution?: string, millesime?: string }
 *
 * Exécute un UPDATE SQL pour chaque paire from→to
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return adminUnauthorized();

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    return NextResponse.json({ success: false, error: 'SUPABASE_DB_URL manquante' }, { status: 500 });
  }

  let sql: ReturnType<typeof postgres> | null = null;

  try {
    const { renames, resolution, millesime } = await request.json();

    if (!Array.isArray(renames) || renames.length === 0) {
      return NextResponse.json({ success: false, error: 'renames vide' }, { status: 400 });
    }

    sql = postgres(dbUrl, { connect_timeout: 10, idle_timeout: 60, max: 1 });

    const results: { from: string; to: string; rows: number }[] = [];

    for (const { from, to } of renames) {
      if (!from || !to || from === to) continue;

      // Sanitize key names (only allow alphanumeric + underscore)
      if (!/^[a-zA-Z0-9_]+$/.test(from) || !/^[a-zA-Z0-9_]+$/.test(to)) {
        results.push({ from, to, rows: -1 });
        continue;
      }

      // Rename JSONB key using fully parameterized query
      const result = await sql`
        UPDATE carreaux_filosofi
        SET metadata = (metadata - ${from}) || jsonb_build_object(${to}, metadata->${from})
        WHERE metadata ? ${from}
          ${resolution ? sql`AND resolution = ${resolution}` : sql``}
          ${millesime ? sql`AND millesime = ${millesime}` : sql``}
      `;

      results.push({ from, to, rows: result.count ?? 0 });
    }

    await sql.end();
    sql = null;

    return NextResponse.json({ success: true, results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur inconnue';
    console.error('[rename-columns] Error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    if (sql) {
      try { await sql.end(); } catch { /* ignore */ }
    }
  }
}
