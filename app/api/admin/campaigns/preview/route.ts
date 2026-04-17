/**
 * GENESIS — POST /api/admin/campaigns/preview
 * Parse a DSP file and return mapped columns + sample rows WITHOUT inserting.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { parseCampaignFile } from '@/lib/campaigns/parser';
import { getMappingForSource, autoDetectMapping } from '@/lib/campaigns/column-mappings';

export const dynamic = 'force-dynamic';

const PREVIEW_ROWS = 30;

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const dspSource = (formData.get('dsp_source') as string) || 'adform';

  if (!file) {
    return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseCampaignFile(buffer, file.name, dspSource);

    // Column mapping used (auto-detect first, fallback to DSP source)
    const rawHeaders = parsed.rows.length > 0 ? Object.keys(parsed.rows[0]) : [];
    // Re-read the file to get raw headers before mapping
    const Papa = await import('papaparse');
    const XLSX = await import('xlsx');
    const isXlsx = /\.xlsx?$/i.test(file.name);
    let fileHeaders: string[] = [];
    if (isXlsx) {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (ws) {
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', raw: false });
        fileHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];
      }
    } else {
      let text = buffer.toString('utf-8');
      if (text.includes('\ufffd')) text = buffer.toString('latin1');
      const result = Papa.default.parse<Record<string, string>>(text, { header: true, preview: 1, transformHeader: (h: string) => h.trim() });
      fileHeaders = result.meta.fields ?? [];
    }
    const mapping = autoDetectMapping(fileHeaders) ?? getMappingForSource(dspSource);
    const columnMapping = Object.entries(mapping).map(([source, target]) => ({
      source_column: source,
      db_field: target,
    }));

    // Sample rows (first N)
    const sampleRows = parsed.rows.slice(0, PREVIEW_ROWS);

    return NextResponse.json({
      file_name: file.name,
      dsp_source: dspSource,
      column_mapping: columnMapping,
      file_headers: fileHeaders,
      total_rows: parsed.rows.length,
      campaign_name: parsed.campaign_name,
      countries: parsed.countries,
      date_start: parsed.date_start,
      date_end: parsed.date_end,
      total_tracked_ads: parsed.total_tracked_ads,
      errors: parsed.errors.slice(0, 10),
      sample_rows: sampleRows,
      detected_columns: parsed.detected_columns,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Erreur parsing : ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
