/**
 * GENESIS — API Route — GET /api/admin/sources/[id]/export
 * Exporte les données d'une source en CSV
 *
 * ── LA BORNE, ET CE QUI SE PASSE QUAND ELLE COUPE ────────────────────────
 *
 * Jusqu'au 2026-10-11 la route lisait `.limit(50000)` en UN appel : PostgREST
 * coupe toute requête de table à `db-max-rows` = 1 000 (`supabase/config.toml`)
 * et aucun `.limit()` client ne lève ce plafond. Mesuré : la plus grosse source
 * de la base locale (5 584 POI) sortait en 1 000 lignes, sans rien qui le dise.
 *
 * Désormais : pages de 1 000 triées sur `id` (clé unique), reprise après le
 * dernier `id` lu (`lireParCleJusqua`), jusqu'à `BORNE_EXPORT_SOURCE`. Au-delà,
 * le fichier se termine par une ligne `# Export tronqué : …`, le nom du
 * fichier porte `_tronque`, et l'en-tête `X-Export-Tronque` vaut `true` —
 * jamais une coupe muette.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { csvEscapeCell } from '@/lib/csv/escape';
import { BORNE_EXPORT_SOURCE, mentionCoupe } from '@/lib/csv/export-source';
import { lireParCleJusqua } from '@/lib/supabase/lire-tout';

export const dynamic = 'force-dynamic';

const COLONNES_POI = ['nom', 'categorie', 'adresse', 'ville', 'code_postal', 'departement', 'region', 'lat', 'lng', 'source', 'date_import'];
const COLONNES_PANNEAUX = ['reference_panneau', 'regie', 'type_panneau', 'ville', 'code_postal', 'departement', 'region', 'lat', 'lng', 'actif'];

type Ligne = Record<string, unknown> & { id: string };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const supabase = createAdminClient();
    const { id } = await params;

    // Get source info
    const { data: source } = await supabase
      .from('data_sources')
      .select('type, name')
      .eq('id', id)
      .single();

    if (!source) {
      return NextResponse.json({ success: false, error: 'Source non trouvee' }, { status: 404 });
    }

    // Fetch data based on type
    let table: 'poi_france' | 'panneaux_affichage' | null = null;
    let columns: string[] = [];
    if (source.type === 'poi') {
      table = 'poi_france';
      columns = COLONNES_POI;
    } else if (source.type === 'panneaux') {
      table = 'panneaux_affichage';
      columns = COLONNES_PANNEAUX;
    }

    let rows: Ligne[] = [];
    let tronque = false;
    let total: number | null = null;

    if (table) {
      const t = table;
      const selection = ['id', ...columns].join(', ');
      const lecture = await lireParCleJusqua<Ligne>(
        (apres, taille) => {
          let q = supabase
            .from(t)
            .select(selection)
            .eq('data_source_id', id)
            .order('id')
            .limit(taille);
          if (apres !== null) q = q.gt('id', apres);
          return q as unknown as PromiseLike<{ data: Ligne[] | null; error: { message: string } | null }>;
        },
        (l) => l.id,
        BORNE_EXPORT_SOURCE,
      );
      rows = lecture.lignes;
      tronque = lecture.tronque;

      if (tronque) {
        // Le total n'est compté QUE si la borne a coupé : un compte par
        // l'index `data_source_id`, pour dire « 50 000 sur combien ».
        const { count, error: erreurCompte } = await supabase
          .from(t)
          .select('id', { count: 'exact', head: true })
          .eq('data_source_id', id);
        total = erreurCompte ? null : count;
      }
    }

    // Build CSV (échappement anti-injection formule + délimiteur : lib/csv/escape.ts)
    const csvLines = [columns.join(';')];
    for (const row of rows) {
      const line = columns.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return '';
        return csvEscapeCell(String(val), ';');
      });
      csvLines.push(line.join(';'));
    }
    if (tronque) csvLines.push(mentionCoupe(rows.length, total));

    const csv = csvLines.join('\n');
    const base = source.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${base}_export${tronque ? '_tronque' : ''}.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Export-Lignes': String(rows.length),
        'X-Export-Tronque': String(tronque),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur export';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
