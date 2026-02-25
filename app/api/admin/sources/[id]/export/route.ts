/**
 * GENESIS — API Route — GET /api/admin/sources/[id]/export
 * Exporte les données d'une source en CSV
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createAdminClient();
    const { id } = params;

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
    let rows: Record<string, unknown>[] = [];
    let columns: string[] = [];

    if (source.type === 'poi') {
      const { data } = await supabase
        .from('poi_france')
        .select('nom, categorie, adresse, ville, code_postal, departement, region, lat, lng, source, date_import')
        .eq('data_source_id', id)
        .limit(50000);
      rows = data || [];
      columns = ['nom', 'categorie', 'adresse', 'ville', 'code_postal', 'departement', 'region', 'lat', 'lng', 'source', 'date_import'];
    } else if (source.type === 'panneaux') {
      const { data } = await supabase
        .from('panneaux_affichage')
        .select('reference_panneau, regie, type_panneau, ville, code_postal, departement, region, lat, lng, actif')
        .eq('data_source_id', id)
        .limit(50000);
      rows = data || [];
      columns = ['reference_panneau', 'regie', 'type_panneau', 'ville', 'code_postal', 'departement', 'region', 'lat', 'lng', 'actif'];
    }

    // Build CSV
    const csvLines = [columns.join(';')];
    for (const row of rows) {
      const line = columns.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return '';
        const str = String(val).replace(/"/g, '""');
        return str.includes(';') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
      });
      csvLines.push(line.join(';'));
    }

    const csv = csvLines.join('\n');
    const filename = `${source.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_export.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur export';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
