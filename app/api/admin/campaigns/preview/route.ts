/**
 * GENESIS — POST /api/admin/campaigns/preview
 * Parse a DSP file and return mapped columns + sample rows WITHOUT inserting.
 *
 * Backed by lib/dsp-mapping/* — mappings dynamiques depuis dsp_source_mappings.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { loadMappings } from '@/lib/dsp-mapping/loader';
import { parseFile, readHeaders } from '@/lib/dsp-mapping/parser';
import { validateCsvHeaders } from '@/lib/dsp-mapping/validator';
import {
  MissingRequiredColumnError,
  NoMappingsFoundError,
} from '@/lib/dsp-mapping/types';

export const dynamic = 'force-dynamic';

const PREVIEW_ROWS = 30;

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const dspSource = ((formData.get('dsp_source') as string) || 'adform').toLowerCase();

  if (!file) {
    return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHeaders = readHeaders(buffer, file.name);

    const mappings = await loadMappings(dspSource);
    const validation = validateCsvHeaders(fileHeaders, mappings);

    const parsed = parseFile(buffer, file.name, mappings);

    // Flatten ParsedRow {core, metrics, dimensions} pour compat UI : la table
    // d'aperçu affiche `row[col]` (col = nom de target_field), pas la structure.
    const flatRows = parsed.rows.map((p) => ({
      ...p.dimensions,
      ...p.metrics,
      ...p.core,
    }));

    const columnMapping = mappings
      .filter((m) =>
        fileHeaders.some(
          (h) => h.toLowerCase().trim() === m.sourceColumn.toLowerCase().trim(),
        ),
      )
      .map((m) => ({
        source_column: m.sourceColumn,
        db_field: m.targetField,
        target_location: m.targetLocation,
        is_required: m.isRequired,
      }));

    return NextResponse.json({
      file_name: file.name,
      dsp_source: dspSource,
      column_mapping: columnMapping,
      file_headers: fileHeaders,
      missing_required: validation.missingRequired,
      unknown_columns: validation.unknownColumns,
      total_rows: parsed.totalRows,
      campaign_name: parsed.campaignName,
      countries: parsed.countries,
      date_start: parsed.dateStart,
      date_end: parsed.dateEnd,
      total_tracked_ads: parsed.totalTrackedAds,
      total_unique_impressions: parsed.totalUniqueImpressions,
      total_impressions: parsed.totalImpressions,
      errors: parsed.validationErrors.slice(0, 10),
      sample_rows: flatRows.slice(0, PREVIEW_ROWS),
      detected_columns: columnMapping.map((c) => c.db_field),
    });
  } catch (err: unknown) {
    if (err instanceof NoMappingsFoundError) {
      return NextResponse.json(
        {
          error: err.message,
          code: 'no_mappings_found',
          dsp_source: err.dspSource,
        },
        { status: 400 },
      );
    }
    if (err instanceof MissingRequiredColumnError) {
      return NextResponse.json(
        {
          error: err.message,
          code: 'missing_required_columns',
          missing: err.missingColumns,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: `Erreur parsing : ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
